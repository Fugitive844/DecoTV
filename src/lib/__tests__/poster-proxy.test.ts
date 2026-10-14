/** @jest-environment node */
/* global describe, it, expect */
import { detectPosterType } from '@/lib/poster-proxy';
import { resolveProxyTargetUrl } from '@/lib/proxy-security';

describe('poster response validation', () => {
  it.each([
    [Buffer.from([255, 216, 255, 0]), 'image/jpeg'],
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
    [Buffer.from('GIF89a'), 'image/gif'],
    [Buffer.from('RIFF1234WEBP'), 'image/webp'],
    [Buffer.from('\0\0\0\x18ftypavif'), 'image/avif'],
    [Buffer.from('BM1234'), 'image/bmp'],
    [Buffer.from([0, 0, 1, 0]), 'image/x-icon'],
    [
      Buffer.from(
        '<?xml version="1.0"?><!DOCTYPE svg SYSTEM "about:legacy-compat"><svg/>',
      ),
      'image/svg+xml',
    ],
    [
      Buffer.from(
        '\uFEFF<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      ),
      'image/svg+xml',
    ],
  ])(
    'recognizes signatures without trusting MIME headers',
    (body, expected) => {
      expect(detectPosterType(body as Buffer)).toBe(expected);
    },
  );

  it.each(['<html>upstream blocked</html>', 'RIFF1234WAVE', ''])(
    'rejects non-image bodies',
    (body) => {
      expect(detectPosterType(Buffer.from(body))).toBeNull();
    },
  );

  it.each([
    'http://127.0.0.1/a',
    'http://[::ffff:7f00:1]/a',
    'http://[0:0:0:0:0:ffff:7f00:1]/a',
    'http://169.254.169.254/a',
    'file:///etc/passwd',
    'https://user:pass@example.com/a',
  ])(
    'blocks private and credentialed targets before downloading',
    async (url) => {
      await expect(resolveProxyTargetUrl(url)).rejects.toThrow();
    },
  );
});
