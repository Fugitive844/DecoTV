/** @jest-environment node */
/* global describe, it, expect */
import {
  POSTER_FALLBACK_SRC,
  resolveImageUrlCandidates,
} from '@/lib/image-url';

describe('poster URL candidates', () => {
  it('preserves HTTP and nonstandard ports inside the same-origin proxy', () => {
    const target = 'http://cdn.example.com:8090/a.jpg?x=1&y=2';
    const candidates = resolveImageUrlCandidates(target);
    expect(
      new URL(candidates[0], 'https://localhost').searchParams.get('url'),
    ).toBe(target);
    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toBe(POSTER_FALLBACK_SRC);
  });

  it('tries the recovered wsrv source directly, retaining scheme-less proxy fallback', () => {
    const candidates = resolveImageUrlCandidates(
      'https://wsrv.nl/?url=cdn.example.com%3A8090%2Fa.jpg',
    );
    expect(
      new URL(candidates[1], 'https://localhost').searchParams.get('url'),
    ).toBe('cdn.example.com:8090/a.jpg');
    expect(candidates[0]).toBe('https://cdn.example.com:8090/a.jpg');
  });

  it('prefers HTTPS direct images, then server proxy and placeholder', () => {
    const target = 'https://cdn.example.com/a.jpg';
    const candidates = resolveImageUrlCandidates(target);
    expect(candidates[0]).toBe(target);
    expect(
      new URL(candidates[1], 'https://localhost').searchParams.get('url'),
    ).toBe(target);
    expect(resolveImageUrlCandidates(candidates[0])[0]).toBe(candidates[0]);
    expect(resolveImageUrlCandidates('/poster-fallback.svg')).toEqual([
      POSTER_FALLBACK_SRC,
    ]);
  });

  it('recovers direct HTTPS images from API proxy URLs', () => {
    const target = 'https://cdn.example.com:8443/a.jpg?x=1&y=2';
    const wrapped = `/api/image-proxy?url=${encodeURIComponent(target)}&w=256`;
    const candidates = resolveImageUrlCandidates(wrapped);
    expect(candidates[0]).toBe(target);
    expect(candidates[1]).toBe(wrapped);
  });

  it('allows HTTP direct images only on HTTP pages', () => {
    const target = 'http://cdn.example.com/a.jpg';
    expect(
      resolveImageUrlCandidates(target, { pageProtocol: 'http:' })[0],
    ).toBe(target);
    expect(
      resolveImageUrlCandidates(target, { pageProtocol: 'https:' })[0],
    ).toContain('/api/image-proxy?');
  });

  it('keeps private image endpoints on their internal transport', () => {
    const target = '/api/private-library/poster?id=123';
    expect(resolveImageUrlCandidates(target)[0]).toBe(target);
  });

  it('tries Douban directly even when the previous provider was the server', () => {
    const target =
      'https://img9.doubanio.com/view/photo/s_ratio_poster/public/a.jpg';
    expect(
      resolveImageUrlCandidates(target, {
        doubanImageProxy: { proxyType: 'server' },
      })[0],
    ).toBe(target);
  });
});
