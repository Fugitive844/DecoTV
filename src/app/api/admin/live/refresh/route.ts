/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { refreshAllLiveChannels } from '@/lib/live-refresh';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 权限检查
    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      // 管理员
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const result = await refreshAllLiveChannels();

    return NextResponse.json({
      success: true,
      message:
        result.failed > 0
          ? `刷新完成：${result.refreshed} 个成功，${result.failed} 个失败，失败源保留旧缓存`
          : '直播源刷新成功',
      data: result,
    });
  } catch (error) {
    console.error('直播源刷新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 500 },
    );
  }
}
