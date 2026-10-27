import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import {
  buildFilterProxyUrl,
  isSourceAdFilterDisabled,
  shouldUseServerSideEpisodeProxy,
} from '@/lib/episode-rewriter';
import { signM3U8ProxyRequest } from '@/lib/m3u8-proxy';
import { resolveExternalPlaybackUrl } from '@/lib/playback-url-resolver';
import { isLikelyHlsUrl } from '@/lib/player/hls-url';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authInfo?.username || (authResult.isLocalMode ? '__local__' : '');
  const { searchParams } = new URL(request.url);
  const rawUrl = (searchParams.get('url') || '').trim();
  const source = (searchParams.get('source') || '').trim();

  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  if (source && source !== 'private_library') {
    const apiSites = await getAvailableApiSites(username);
    if (!apiSites.some((site) => site.key === source)) {
      return NextResponse.json(
        { error: 'Source is not available for current user' },
        { status: 403 },
      );
    }
  }

  const resolution = await resolveExternalPlaybackUrl(rawUrl);
  let playbackUrl = resolution.resolvedUrl || rawUrl;
  let proxied = false;

  let proxyUrl: string | undefined;
  if (searchParams.get('browser') === '1' && source !== 'private_library') {
    const signature = signM3U8ProxyRequest(playbackUrl, resolution.referer);
    if (signature) {
      const proxy = new URL(
        resolution.mediaType === 'hls' || isLikelyHlsUrl(playbackUrl)
          ? '/api/proxy/m3u8-filter'
          : '/api/proxy/m3u8-asset',
        request.url,
      );
      proxy.searchParams.set('url', playbackUrl);
      proxy.searchParams.set('sig', signature);
      proxy.searchParams.set('forceMedia', '1');
      if (resolution.referer)
        proxy.searchParams.set('referer', resolution.referer);
      const config = await getConfig();
      if (isSourceAdFilterDisabled(config, source))
        proxy.searchParams.set('adfilter', 'false');
      // Relative URL keeps the browser on its own HTTPS origin behind Nginx.
      proxyUrl = proxy.pathname + proxy.search;
    }
  } else {
    try {
      const config = await getConfig();
      if (
        source !== 'private_library' &&
        isLikelyHlsUrl(playbackUrl) &&
        shouldUseServerSideEpisodeProxy(config, request) &&
        !isSourceAdFilterDisabled(config, source)
      ) {
        playbackUrl = buildFilterProxyUrl(
          request,
          playbackUrl,
          resolution.referer,
        );
        proxied = playbackUrl !== resolution.resolvedUrl;
      }
    } catch {
      // Keep the resolved direct URL when config lookup fails.
    }
  }

  return NextResponse.json(
    {
      ...resolution,
      playbackUrl,
      proxied,
      proxyUrl,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    },
  );
}
