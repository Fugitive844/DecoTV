/* eslint-disable no-console */
import { db } from '@/lib/db';
import type { LiveChannelCacheRecord } from '@/lib/live-cache.types';

import { enqueueTexts, getTranslationMap } from './store-core.mjs';
import { postStreamingCompletion } from './stream-transport.mjs';
import { collectCandidateTexts } from './text-filter.mjs';
import { createTranslationWorker } from './worker.mjs';

// DbManager 实现了 store-core 需要的通用键值原语。
export const translationKv = db;

const STORAGE_TYPE = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

// 无数据库模式无法跨重启持久化，也没有跨实例原子性，不启动后台翻译任务。
export function isTranslationBackgroundSupported(): boolean {
  return STORAGE_TYPE !== 'localstorage';
}

const globalTranslation = globalThis as typeof globalThis & {
  __decotvTranslationWorker?: ReturnType<typeof createTranslationWorker>;
};

async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  return { status: response.status, text: await response.text() };
}

export function getTranslationWorker() {
  return (globalTranslation.__decotvTranslationWorker ??=
    createTranslationWorker({
      kv: translationKv,
      httpPost,
      httpPostStream: postStreamingCompletion,
      // 日志不输出密钥或响应正文。
      log: (message, error) =>
        console.warn(
          `[translation] ${message}`,
          error instanceof Error ? error.message : '',
        ),
    }));
}

// 抓取成功后收集没有任何汉字的频道名／分类名，只在不存在时入库。
export async function collectChannelTexts(
  record: Pick<LiveChannelCacheRecord, 'channels'>,
): Promise<number> {
  if (!isTranslationBackgroundSupported()) return 0;
  const texts = collectCandidateTexts(record);
  if (texts.length === 0) return 0;
  return enqueueTexts(translationKv, texts, Date.now());
}

// 响应路径只读翻译缓存；读取失败返回空映射（显示原名），不触发模型调用。
export async function readTranslations(
  texts: string[],
): Promise<Map<string, string>> {
  if (texts.length === 0) return new Map();
  try {
    return await getTranslationMap(translationKv, texts);
  } catch (error) {
    console.error('读取翻译缓存失败:', error);
    return new Map();
  }
}
