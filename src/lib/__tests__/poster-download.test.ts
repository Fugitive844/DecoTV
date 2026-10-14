/** @jest-environment node */
/* global describe, it, expect, jest, beforeEach, queueMicrotask */
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request } from 'node:https';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { getPoster } from '@/lib/poster-proxy';
import { resolveProxyTargetUrl } from '@/lib/proxy-security';

jest.mock('node:https', () => ({ request: jest.fn() }));
jest.mock('node:http', () => ({ request: jest.fn() }));
jest.mock('@/lib/proxy-security', () => ({ resolveProxyTargetUrl: jest.fn() }));

const requestMock = jest.mocked(request);
const resolveMock = jest.mocked(resolveProxyTargetUrl);
let body: Buffer;
let headers: Record<string, string>;
let status: number;

beforeEach(() => {
  jest.clearAllMocks();
  body = Buffer.from('GIF89a-test-payload');
  headers = { 'content-type': 'application/octet-stream' };
  status = 200;
  resolveMock.mockImplementation(async (url) => {
    if (url.includes('127.0.0.1')) throw new Error('Blocked IP address');
    return {
      url: new URL(url),
      addresses: [{ address: '8.8.8.8', family: 4 }],
    };
  });
  requestMock.mockImplementation((_url, _options, listener) => {
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = jest.fn(() => req);
    req.end = jest.fn(() => {
      const response = new PassThrough() as PassThrough & IncomingMessage;
      response.statusCode = status;
      response.headers = headers;
      queueMicrotask(() => {
        listener?.(response);
        response.end(body);
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  });
});

describe('poster download pipeline', () => {
  it('deduplicates concurrent requests and caches successful bytes', async () => {
    const [first, second] = await Promise.all([
      getPoster('https://image.example/dedup'),
      getPoster('https://image.example/dedup'),
    ]);
    expect(first.body).toBe(second.body);
    expect(first.type).toBe('image/gif');
    expect((await getPoster('https://image.example/dedup')).body).toBe(
      first.body,
    );
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('decompresses gzip before checking the image signature', async () => {
    const original = body;
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
    expect((await getPoster('https://image.example/gzip')).body).toEqual(
      original,
    );
  });

  it('rejects HTML even when upstream claims image/jpeg', async () => {
    body = Buffer.from('<html>upstream blocked</html>');
    headers['content-type'] = 'image/jpeg';
    await expect(getPoster('https://image.example/html')).rejects.toThrow(
      'not a supported image',
    );
  });

  it('validates redirect destinations before opening another connection', async () => {
    status = 302;
    headers.location = 'http://127.0.0.1/internal';
    await expect(getPoster('https://image.example/redirect')).rejects.toThrow(
      'Blocked IP',
    );
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).toHaveBeenLastCalledWith('http://127.0.0.1/internal');
  });

  it('caps body size instead of buffering unlimited upstream data', async () => {
    body = Buffer.alloc(5 * 1024 * 1024 + 1);
    await expect(getPoster('https://image.example/large')).rejects.toThrow(
      '5 MiB',
    );
  });
});
