import { NextResponse } from 'next/server';

import { getPoster } from '@/lib/poster-proxy';

export const runtime = 'nodejs';

// 保留 OrionTV 兼容入口；只有显式传 w 时才生成缩略图。
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get('url')?.trim();
  if (!target || target.length > 8192) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }
  const requestedWidth = Number(params.get('w'));
  const width =
    Number.isFinite(requestedWidth) && requestedWidth > 0
      ? Math.min(1024, Math.max(64, Math.round(requestedWidth)))
      : undefined;
  try {
    const image = await getPoster(target, width);
    return new Response(new Uint8Array(image.body), {
      headers: {
        'Content-Type': image.type,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Image request failed';
    return NextResponse.json(
      { error: message },
      {
        status: message === 'Image proxy busy' ? 503 : 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
