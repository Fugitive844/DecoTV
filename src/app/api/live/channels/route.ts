import { NextRequest, NextResponse } from 'next/server';

import {
  getLiveChannelsForClient,
  LiveChannelsUnavailableError,
} from '@/lib/live';
import { buildLiveChannelDisplayList } from '@/lib/live-channel-display.mjs';
import { applyChannelTranslations } from '@/lib/translation/display';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源参数' }, { status: 400 });
    }

    const channelData = await getLiveChannelsForClient(sourceKey);

    if (!channelData) {
      return NextResponse.json({ error: '频道信息未找到' }, { status: 404 });
    }

    // 译文只在响应时拼装，不写回频道缓存。
    const data = await applyChannelTranslations(
      sourceKey,
      buildLiveChannelDisplayList(sourceKey, channelData),
    );
    return NextResponse.json({ success: true, data }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof LiveChannelsUnavailableError)
      return NextResponse.json(
        { error: error.message },
        { status: 503, headers: NO_STORE },
      );
    return NextResponse.json({ error: '获取频道信息失败' }, { status: 500 });
  }
}
