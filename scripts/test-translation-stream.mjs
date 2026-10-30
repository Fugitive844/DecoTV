import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTranslationRequestBody } from '../src/lib/translation/protocol.mjs';
import { createSseParser } from '../src/lib/translation/sse.mjs';
import { postStreamingCompletion } from '../src/lib/translation/stream-transport.mjs';

const frame = (delta, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\r\n\r\n`;
const content =
  '{"items":[{"id":"1","needsTranslation":true,"translation":"新闻"}]}';
const responseStream = (text, chunkSize = 1) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, (offset += chunkSize)));
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
};
const call = (fetchImpl, events = [], signal) =>
  postStreamingCompletion(
    'http://mock/v1/chat/completions',
    {},
    '{}',
    1000,
    (event) => events.push(event),
    signal,
    fetchImpl,
  );

test('SSE supports CRLF split across chunks, comments and multiline events', () => {
  const events = [];
  const parser = createSseParser((data) => events.push(data));
  for (const char of ': heartbeat\r\ndata: first\r\ndata: second\r\n\r\ndata: tail')
    parser.push(char);
  parser.finish();
  assert.deepEqual(events, ['first\nsecond', 'tail']);
});

test('streaming keeps production thinking defaults and configured output budget', () => {
  const config = { baseUrl: 'https://api.deepseek.com', model: 'fake' };
  const items = [{ id: '1', text: 'News' }];
  const manual = buildTranslationRequestBody(config, items, {
    stream: true,
    thinking: true,
  });
  assert.equal(manual.stream, true);
  assert.deepEqual(manual.thinking, { type: 'enabled' });
  assert.ok(manual.max_tokens >= 4096);
  assert.deepEqual(
    buildTranslationRequestBody({ ...config, thinking: false }, items).thinking,
    { type: 'disabled' },
  );
  assert.equal(
    'thinking' in
      buildTranslationRequestBody(
        { ...config, baseUrl: 'http://mock' },
        items,
        { thinking: true },
      ),
    false,
  );
});

test('model reasoning and UTF-8 content reach observers before stream completes', async () => {
  const events = [];
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let stage = 0;
  const response = new Response(
    new ReadableStream({
      async pull(controller) {
        if (stage++ === 0)
          controller.enqueue(
            new TextEncoder().encode(
              frame({ reasoning_content: '识别频道名称' }),
            ),
          );
        else {
          await wait;
          controller.enqueue(
            new TextEncoder().encode(
              frame({ content }, 'stop') + 'data: [DONE]\n\n',
            ),
          );
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
  const pending = call(async () => response, events);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(
    events.some(
      (event) => event.type === 'reasoning' && event.delta === '识别频道名称',
    ),
  );
  release();
  assert.equal((await pending).content, content);
  const split = await call(
    async () =>
      responseStream(
        frame({ reasoning: '思考' }) +
          frame({ content }, 'stop') +
          'data: [DONE]\n\n',
      ),
    events,
  );
  assert.equal(split.content, content);
  assert.ok(events.some((event) => event.delta === '思考'));
});

test('JSON-only compatible models still expose returned reasoning and content', async () => {
  const events = [];
  const outcome = await call(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { reasoning_content: '简要分析', content },
              finish_reason: 'stop',
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    events,
  );
  assert.equal(outcome.content, content);
  assert.deepEqual(
    events.map((event) => event.type),
    ['reasoning', 'content'],
  );
});

test('broken streams and model errors fail once instead of accepting partial output', async () => {
  for (const text of [
    frame({ content }),
    'data: broken\n\n',
    'data: {"error":{"message":"upstream failed"}}\n\n',
  ]) {
    let calls = 0;
    await assert.rejects(
      call(async () => {
        calls++;
        return responseStream(text);
      }),
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    call(async () => new Response('error', { status: 500 })),
    /HTTP 500/,
  );
  assert.equal(
    (await call(async () => responseStream(frame({ content: '{' }, 'length'))))
      .truncated,
    true,
  );
});

test('manual cancellation reaches the model transport signal', async () => {
  const abort = new AbortController();
  const pending = call(
    async (_url, init) => {
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          'abort',
          () => reject(init.signal.reason),
          { once: true },
        ),
      );
    },
    [],
    abort.signal,
  );
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

// Cross-instance background progress remains ordered and bounded.
test('manual task journal resumes sequence numbers and retains bounded history', async () => {
  const { createMemoryKv } = await import('./test-helpers/memory-kv.mjs');
  const { createManualProgress, manualProgressKey } =
    await import('../src/lib/translation/manual-progress.mjs');
  const kv = createMemoryKv();
  const first = await createManualProgress(kv, 'job-1');
  first.emit({ type: 'reasoning', delta: 'early thought' });
  await first.flush();
  const second = await createManualProgress(kv, 'job-1');
  for (let index = 0; index < 1000; index++)
    second.emit({ type: 'content', delta: String(index) });
  second.emit({ type: 'complete', message: 'saved' });
  await second.flush();
  const snapshot = JSON.parse(await kv.kvGet(manualProgressKey('job-1')));
  assert.equal(snapshot.seq, 1002);
  assert.ok(snapshot.events.length <= 400);
  assert.equal(snapshot.events.at(-1).event.type, 'complete');
  assert.ok(
    snapshot.events.every(
      (event, index, events) =>
        index === 0 || event.seq > events[index - 1].seq,
    ),
  );
});
