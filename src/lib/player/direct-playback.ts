/** Browser-side checks: a server request cannot establish browser CORS access. */
export function unwrapPlaybackProxy(rawUrl: string, origin: string): string {
  let url = rawUrl;
  for (let depth = 0; depth < 4; depth += 1) {
    const parsed = new URL(url, origin);
    if (
      parsed.origin !== origin ||
      !['/api/proxy/m3u8-filter', '/api/proxy/m3u8'].includes(parsed.pathname)
    )
      break;
    const upstream = parsed.searchParams.get('url');
    if (!upstream || !/^https?:\/\//i.test(upstream)) break;
    url = upstream;
  }
  return url;
}

export async function canPlayDirectly(
  rawUrl: string,
  isHls: boolean,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 6000);
  const page = new URL(pageUrl);
  const playlists = new Set<string>();
  const assets = new Map<string, boolean>();
  const sampledOrigins = new Set<string>();
  const checkUrl = (value: string) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Unsupported protocol');
    if (page.protocol === 'https:' && url.protocol === 'http:')
      throw new Error('Mixed content');
    return url;
  };
  const request = async (url: string, playlist: boolean) => {
    checkUrl(url);
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      // A small GET tests actual media access; HEAD/OPTIONS often differ.
      ...(playlist ? {} : { headers: { Range: 'bytes=0-1023' } }),
    });
    try {
      if (!response.ok || response.type === 'opaque')
        throw new Error('Inaccessible media');
      checkUrl(response.url || url);
      if (!playlist) return { text: '', url: response.url || url };
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty playlist');
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2 * 1024 * 1024) throw new Error('Playlist too large');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (!text.trimStart().startsWith('#EXTM3U'))
        throw new Error('Invalid playlist');
      return { text, url: response.url || url };
    } finally {
      if (!response.body?.locked)
        await response.body?.cancel().catch(() => undefined);
    }
  };
  const visit = async (url: string, depth: number): Promise<void> => {
    checkUrl(url);
    if (playlists.has(url)) return;
    if (depth > 4 || playlists.size >= 12)
      throw new Error('Playlist probe limit');
    playlists.add(url);
    const result = await request(url, true);
    let variant = false;
    for (const raw of result.text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        variant = true;
        continue;
      }
      const uris = line.startsWith('#')
        ? Array.from(line.matchAll(/\bURI="([^"]+)"/g), (match) => match[1])
        : [line];
      for (const uri of uris) {
        const target = new URL(uri, result.url).href;
        checkUrl(target);
        if (
          variant ||
          /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/.test(line) ||
          /\.m3u8(?:$|[?#])/i.test(target)
        ) {
          await visit(target, depth + 1);
        } else {
          assets.set(target, /^#EXT-X-(?:KEY|SESSION-KEY|MAP):/.test(line));
        }
      }
      if (!line.startsWith('#')) variant = false;
    }
  };
  try {
    const url = new URL(rawUrl, page).href;
    if (isHls) {
      await visit(url, 0);
      if (!assets.size) return false;
      // Check every URL for mixed content; sample media access per origin.
      // Later per-resource failures are handled by the player's proxy fallback.
      let probes = 0;
      for (const [asset, required] of assets) {
        const origin = checkUrl(asset).origin;
        if (!required && sampledOrigins.has(origin)) continue;
        if (++probes > 32) return false;
        // Keys and initialization maps must be checked separately from media.
        if (!required) sampledOrigins.add(origin);
        if (sampledOrigins.size > 16) return false;
        await request(asset, false);
      }
    } else {
      await request(url, false);
    }
    return !controller.signal.aborted;
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
