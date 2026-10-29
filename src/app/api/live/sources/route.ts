/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { sortLiveSources } from '@/lib/live-source-options';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  console.log(request.url);
  try {
    const config = await getConfig();

    if (!config) {
      return NextResponse.json({ error: '配置未找到' }, { status: 404 });
    }

    // 过滤出所有非 disabled 的直播源
    // 导入覆盖信息只用于管理端，保持 APK 使用的字段不变。
    const liveSources = sortLiveSources(
      (config.LiveConfig || []).filter((source) => !source.disabled),
    ).map(
      ({ upstream: _upstream, overriddenFields: _overridden, ...source }) =>
        source,
    );

    return NextResponse.json({
      success: true,
      data: liveSources,
    });
  } catch (error) {
    console.error('获取直播源失败:', error);
    return NextResponse.json({ error: '获取直播源失败' }, { status: 500 });
  }
}
