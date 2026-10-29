import { NextRequest } from 'next/server';

import { jsonNoStore, requireAdmin } from '@/lib/admin-auth';
import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { getConfig } from '@/lib/config';
import { refreshLiveSources } from '@/lib/live-refresh';
import { sortLiveSources } from '@/lib/live-source-options';
import {
  applyImport,
  importFingerprint,
  parseImportData,
  previewImport,
} from '@/lib/source-merge.mjs';

export const runtime = 'nodejs';

type SourceType = 'video' | 'live';

// 导入：先预览（不写入），再带预览指纹提交；指纹不一致说明期间配置被修改，需要重新预览。
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  if (auth.isLocalMode)
    return jsonNoStore(
      { error: '无数据库模式不支持服务端导入，请使用原管理面板' },
      { status: 400 },
    );
  try {
    const body = (await request.json()) as {
      action?: 'preview' | 'commit';
      type?: SourceType;
      data?: unknown;
      mode?: 'overwrite' | 'skip' | 'smart' | 'ask';
      decisions?: Record<string, 'overwrite' | 'skip' | 'smart'>;
      fingerprint?: string;
    };
    const type: SourceType = body.type === 'live' ? 'live' : 'video';
    const items = parseImportData(type, body.data);
    if (items.length === 0)
      return jsonNoStore({ error: '导入内容为空' }, { status: 400 });
    const config = await getConfig();
    const list = (
      type === 'video' ? config.SourceConfig : config.LiveConfig || []
    ) as Record<string, unknown>[];

    if (body.action === 'preview')
      return jsonNoStore({ ok: true, ...previewImport(type, list, items) });

    if (body.action !== 'commit')
      return jsonNoStore({ error: '未知操作' }, { status: 400 });
    if (body.fingerprint !== importFingerprint(list, items))
      return jsonNoStore(
        { error: '预览后配置已发生变化，请重新预览确认' },
        { status: 409 },
      );
    const { list: merged, summary } = applyImport(
      type,
      list,
      items,
      body.mode || 'smart',
      body.decisions || {},
      'custom',
    );

    if (type === 'video') {
      config.SourceConfig = merged as typeof config.SourceConfig;
      await persistAdminConfigMutation(config);
      return jsonNoStore({ ok: true, summary });
    }

    const before = new Map(
      (config.LiveConfig || []).map((source) => [
        source.key,
        JSON.stringify([source.url, source.ua, source.epg]),
      ]),
    );
    config.LiveConfig = sortLiveSources(
      merged as NonNullable<typeof config.LiveConfig>,
    );
    await persistAdminConfigMutation(config);
    // 新增或来源地址变化的直播源在后台抓取，不阻塞提交；旧指纹缓存自动失效。
    const changed = config.LiveConfig.filter(
      (source) =>
        before.get(source.key) !==
        JSON.stringify([source.url, source.ua, source.epg]),
    ).map((source) => source.key);
    if (changed.length > 0)
      void refreshLiveSources({ keys: changed, force: true }).catch(
        () => undefined,
      );
    return jsonNoStore({ ok: true, summary, refreshing: changed.length });
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : '导入失败' },
      { status: 400 },
    );
  }
}
