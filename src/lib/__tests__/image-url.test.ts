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

  it('recovers the target from old wsrv URLs instead of requesting wsrv again', () => {
    const candidates = resolveImageUrlCandidates(
      'https://wsrv.nl/?url=cdn.example.com%3A8090%2Fa.jpg',
    );
    expect(
      new URL(candidates[0], 'https://localhost').searchParams.get('url'),
    ).toBe('cdn.example.com:8090/a.jpg');
  });

  it('keeps HTTPS direct fallback and avoids wrapping local URLs twice', () => {
    const target = 'https://cdn.example.com/a.jpg';
    const candidates = resolveImageUrlCandidates(target);
    expect(candidates[1]).toBe(target);
    expect(resolveImageUrlCandidates(candidates[0])[0]).toBe(candidates[0]);
    expect(resolveImageUrlCandidates('/poster-fallback.svg')).toEqual([
      POSTER_FALLBACK_SRC,
    ]);
  });
});
