import { NextRequest } from 'next/server';

import {
  jsonNoStore,
  paginate,
  parsePaging,
  requireAdmin,
} from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import {
  getLiveSchedules,
  isLiveSourceRefreshing,
  peekLiveChannels,
} from '@/lib/live';
import { refreshLiveSources } from '@/lib/live-refresh';
import { sortLiveSources } from '@/lib/live-source-options';
import { translateTexts } from '@/lib/translation/display';
import { formatTranslatedName } from '@/lib/translation/text-filter.mjs';

export const runtime = 'nodejs';

const display = (text: string, translations: Map<string, string>) => {
  const translation = translations.get(text);
  return translation ? formatTranslatedName(text, translation) : text;
};

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') || 'sources';
  const config = await getConfig();
  const sources = sortLiveSources(config.LiveConfig || []);

  if (view === 'sources') {
    const schedules = await getLiveSchedules(sources);
    return jsonNoStore({
      items: sources.map((source) => ({
        ...source,
        schedule: schedules.get(source.key),
        refreshing: isLiveSourceRefreshing(source),
      })),
    });
  }

  const key = searchParams.get('key') || '';
  const source = sources.find((item) => item.key === key);
  if (!source) return jsonNoStore({ error: '直播源不存在' }, { status: 404 });
  const cache = await peekLiveChannels(source);
  const channels = cache?.channels || [];

  if (view === 'detail') {
    const schedules = await getLiveSchedules([source]);
    const groups = new Set(channels.map((channel) => channel.group));
    return jsonNoStore({
      source,
      schedule: schedules.get(source.key),
      refreshing: isLiveSourceRefreshing(source),
      cache: cache
        ? {
            fetchedAt: cache.fetchedAt,
            channelNumber: cache.channelNumber,
            groupCount: groups.size,
            epgUrl: cache.epgUrl,
            epgChannelCount: Object.keys(cache.epgs || {}).length,
          }
        : null,
    });
  }

  // 分类与频道只读：以抓取结果为唯一来源，译文仅在响应中附加。
  if (view === 'groups') {
    const counts = new Map<string, number>();
    channels.forEach((channel) =>
      counts.set(channel.group, (counts.get(channel.group) || 0) + 1),
    );
    const translations = await translateTexts(Array.from(counts.keys()));
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const items = Array.from(counts.entries())
      .map(([group, count]) => ({
        group,
        display: display(group, translations),
        count,
      }))
      .filter((item) => !q || item.display.toLowerCase().includes(q));
    const { page, pageSize } = parsePaging(searchParams);
    return jsonNoStore(paginate(items, page, pageSize));
  }

  if (view === 'channels') {
    const group = searchParams.get('group');
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const scoped =
      group === null ? channels : channels.filter((c) => c.group === group);
    const translations = await translateTexts(
      Array.from(new Set(scoped.flatMap((c) => [c.name, c.group]))),
    );
    const items = scoped
      .map((channel) => ({
        ...channel,
        displayName: display(channel.name, translations),
        displayGroup: display(channel.group, translations),
      }))
      .filter(
        (item) =>
          !q ||
          item.displayName.toLowerCase().includes(q) ||
          item.displayGroup.toLowerCase().includes(q),
      );
    const { page, pageSize } = parsePaging(searchParams);
    return jsonNoStore(paginate(items, page, pageSize));
  }

  return jsonNoStore({ error: '未知视图' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      action?: string;
      keys?: string[];
      force?: boolean;
    };
    if (body.action !== 'refresh')
      return jsonNoStore({ error: '未知操作' }, { status: 400 });
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : undefined;
    // 强制刷新跳过冷却，仍受并发限制并复用进行中任务；普通刷新遵守冷却。
    const operation = refreshLiveSources({ keys, force: body.force !== false });
    if (keys && keys.length <= 3) {
      const result = await operation;
      return jsonNoStore({ ok: true, accepted: true, finished: true, result });
    }
    void operation.catch(() => undefined);
    return jsonNoStore({ ok: true, accepted: true, finished: false });
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 400 },
    );
  }
}
