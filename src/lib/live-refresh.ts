import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { getConfig } from '@/lib/config';
import {
  getLiveRefreshConcurrency,
  getLiveSchedules,
  getLiveSourceFingerprint,
  isLiveSourceRefreshing,
  refreshLiveChannels,
} from '@/lib/live';
import { isLiveScheduleDue } from '@/lib/live-schedule.mjs';

export interface LiveRefreshResult {
  total: number;
  refreshed: number;
  failed: number;
  concurrency: number;
}

const refreshState = globalThis as typeof globalThis & {
  __decotvLiveRefresh?: Promise<LiveRefreshResult>;
};

// 后台手动“全部强制刷新”复用同一轮任务；实际抓取共享 live.ts 的全局限流队列。
export function refreshAllLiveChannels(): Promise<LiveRefreshResult> {
  if (refreshState.__decotvLiveRefresh) return refreshState.__decotvLiveRefresh;
  const operation = refreshLiveSources({ force: true });
  refreshState.__decotvLiveRefresh = operation;
  const cleanup = () => {
    if (refreshState.__decotvLiveRefresh === operation)
      delete refreshState.__decotvLiveRefresh;
  };
  void operation.then(cleanup, cleanup);
  return operation;
}

/**
 * due：只抓取到期源（每分钟扫描、每小时定时任务）；force：显式强制刷新，绕过冷却；
 * keys：限定源（单源／批量刷新）。
 */
export async function refreshLiveSources(
  options: { force?: boolean; due?: boolean; keys?: string[] } = {},
): Promise<LiveRefreshResult> {
  const config = await getConfig();
  const keySet = options.keys ? new Set(options.keys) : null;
  let sources = (config.LiveConfig || [])
    .filter((source) => !source.disabled && (!keySet || keySet.has(source.key)))
    .map((source) => ({ ...source }));
  if (options.due && !options.force) {
    const schedules = await getLiveSchedules(sources);
    const now = Date.now();
    sources = sources.filter((source) => {
      const schedule = schedules.get(source.key);
      return (
        !isLiveSourceRefreshing(source) &&
        (!schedule || isLiveScheduleDue(schedule, now))
      );
    });
  }
  const updates = new Map<
    string,
    { fingerprint: string; channelNumber: number }
  >();
  let failed = 0;
  await Promise.all(
    sources.map(async (source) => {
      try {
        const channelNumber = await refreshLiveChannels(source, {
          force: !!options.force,
        });
        updates.set(source.key, {
          fingerprint: getLiveSourceFingerprint(source),
          channelNumber,
        });
      } catch {
        failed++;
        // 抓取失败不覆盖频道数，不删除或替换最后成功缓存。
      }
    }),
  );

  // 网络操作完成后重新读取配置，避免把长时间抓取前的整份配置写回去。
  const latest = await getConfig();
  let changed = false;
  const liveConfig = (latest.LiveConfig || []).map((source) => {
    const update = updates.get(source.key);
    if (
      !update ||
      source.disabled ||
      getLiveSourceFingerprint(source) !== update.fingerprint ||
      source.channelNumber === update.channelNumber
    )
      return source;
    changed = true;
    return { ...source, channelNumber: update.channelNumber };
  });
  if (changed)
    await persistAdminConfigMutation({ ...latest, LiveConfig: liveConfig });
  return {
    total: sources.length,
    refreshed: updates.size,
    failed,
    concurrency: getLiveRefreshConcurrency(),
  };
}
