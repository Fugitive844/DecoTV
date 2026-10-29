/* eslint-disable no-console */
import { refreshLiveSources } from '@/lib/live-refresh';
import {
  getTranslationWorker,
  isTranslationBackgroundSupported,
  translationKv,
} from '@/lib/translation/store';
import { repairIndexes } from '@/lib/translation/store-core.mjs';

const LIVE_DUE_SCAN_MS = 60_000;

const globalBackground = globalThis as typeof globalThis & {
  __decotvBackgroundStarted?: boolean;
};

// 进程级单例：热重载、多个入口重复调用也只启动一次。
export function startBackgroundTasks(): void {
  if (globalBackground.__decotvBackgroundStarted) return;
  globalBackground.__decotvBackgroundStarted = true;
  if (!isTranslationBackgroundSupported()) {
    console.log('[background] 无数据库模式，不启动直播调度与翻译任务');
    return;
  }

  // 每分钟只调度到期的启用源；健康源按 1 小时周期，失败源按冷却阶梯。
  let scanning = false;
  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      await refreshLiveSources({ due: true });
    } catch (error) {
      console.error('[background] 直播到期扫描失败:', error);
    } finally {
      scanning = false;
    }
  };
  setTimeout(() => {
    void scan();
    setInterval(() => void scan(), LIVE_DUE_SCAN_MS).unref?.();
  }, LIVE_DUE_SCAN_MS).unref?.();

  // 翻译工作器：先修复待处理索引，再进入串行循环。
  setTimeout(() => {
    void repairIndexes(translationKv)
      .catch((error) => console.error('[background] 翻译索引修复失败:', error))
      .finally(() => void getTranslationWorker().start());
  }, 10_000).unref?.();
}
