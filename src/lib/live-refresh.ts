import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { getConfig } from '@/lib/config';
import {
  getLiveRefreshConcurrency,
  getLiveSourceFingerprint,
  refreshLiveChannels,
} from '@/lib/live';

interface LiveRefreshResult {
  total: number;
  refreshed: number;
  failed: number;
  concurrency: number;
}

const refreshState = globalThis as typeof globalThis & {
  __decotvLiveRefresh?: Promise<LiveRefreshResult>;
};

// 定时、后台手动刷新复用同一轮任务；实际抓取共享 live.ts 的全局限流队列。
export function refreshAllLiveChannels(): Promise<LiveRefreshResult> {
  if (refreshState.__decotvLiveRefresh) return refreshState.__decotvLiveRefresh;
  const operation = refreshAll();
  refreshState.__decotvLiveRefresh = operation;
  const cleanup = () => {
    if (refreshState.__decotvLiveRefresh === operation)
      delete refreshState.__decotvLiveRefresh;
  };
  void operation.then(cleanup, cleanup);
  return operation;
}

async function refreshAll(): Promise<LiveRefreshResult> {
  const config = await getConfig();
  const sources = (config.LiveConfig || [])
    .filter((source) => !source.disabled)
    .map((source) => ({ ...source }));
  const updates = new Map<
    string,
    { fingerprint: string; channelNumber: number }
  >();
  let failed = 0;
  await Promise.all(
    sources.map(async (source) => {
      try {
        const channelNumber = await refreshLiveChannels(source);
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
