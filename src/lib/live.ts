import { createHash } from 'crypto';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import type {
  LiveCacheSource,
  LiveChannelCacheRecord,
  LiveChannelData,
} from '@/lib/live-cache.types';
import {
  createLiveChannelCache,
  normalizeLiveRefreshConcurrency,
} from '@/lib/live-cache-manager.mjs';
import {
  isLiveCoolingDown,
  type LiveScheduleState,
  markLiveAttempt,
  markLiveFailure,
  markLiveSuccess,
  normalizeLiveSchedule,
} from '@/lib/live-schedule.mjs';

const defaultUA = 'AptvPlayer/1.4.10';

export type LiveChannels = LiveChannelCacheRecord;
const LIVE_FETCH_TIMEOUT_MS = 30_000;

export function getLiveSourceFingerprint(source: LiveCacheSource): string {
  return createHash('sha256')
    .update(
      JSON.stringify([source.url, source.ua || defaultUA, source.epg || '']),
    )
    .digest('hex');
}

// 前台请求在无成功缓存时最多等待的时间（含排队），超时后后台继续抓取。
const LIVE_CLIENT_WAIT_MS = 5_000;

export class LiveChannelsUnavailableError extends Error {
  constructor(message = '频道暂不可用，后台正在重试') {
    super(message);
    this.name = 'LiveChannelsUnavailableError';
  }
}

const scheduleKey = (key: string) => `live:sched:${encodeURIComponent(key)}`;

export async function getLiveSchedule(
  source: LiveCacheSource,
): Promise<LiveScheduleState> {
  const fingerprint = getLiveSourceFingerprint(source);
  try {
    const raw = await db.kvGet(scheduleKey(source.key));
    return normalizeLiveSchedule(raw ? JSON.parse(raw) : null, fingerprint);
  } catch {
    return normalizeLiveSchedule(null, fingerprint);
  }
}

export async function getLiveSchedules(
  sources: LiveCacheSource[],
): Promise<Map<string, LiveScheduleState>> {
  const result = new Map<string, LiveScheduleState>();
  if (sources.length === 0) return result;
  let raws: (string | null)[] = [];
  try {
    raws = await db.kvMGet(sources.map((source) => scheduleKey(source.key)));
  } catch {
    raws = [];
  }
  sources.forEach((source, index) => {
    let parsed: unknown = null;
    try {
      parsed = raws[index] ? JSON.parse(raws[index] as string) : null;
    } catch {
      parsed = null;
    }
    result.set(
      source.key,
      normalizeLiveSchedule(parsed, getLiveSourceFingerprint(source)),
    );
  });
  return result;
}

async function updateLiveSchedule(
  source: LiveCacheSource,
  update: (state: LiveScheduleState) => LiveScheduleState,
): Promise<void> {
  const state = update(await getLiveSchedule(source));
  await db.kvSet(scheduleKey(source.key), JSON.stringify(state));
}

export async function deleteLiveSchedule(key: string): Promise<void> {
  await db.kvDel([scheduleKey(key)]);
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const globalLiveCache = globalThis as typeof globalThis & {
  __decotvLiveChannelCache?: ReturnType<typeof createLiveChannelCache>;
};

const channelCache = (globalLiveCache.__decotvLiveChannelCache ??=
  createLiveChannelCache({
    storage: {
      get: (key) => db.getLiveChannelCache(key),
      set: (key, cache) => db.setLiveChannelCache(key, cache),
      delete: (key) => db.deleteLiveChannelCache(key),
    },
    fetchSource: fetchLiveChannelData,
    fingerprint: getLiveSourceFingerprint,
    concurrency: normalizeLiveRefreshConcurrency(
      process.env.LIVE_SOURCE_REFRESH_CONCURRENCY,
    ),
    hooks: {
      onStart: (source) =>
        updateLiveSchedule(source, (state) =>
          markLiveAttempt(state, Date.now()),
        ),
      onSuccess: async (source, record, epgError) => {
        await updateLiveSchedule(source, (state) =>
          markLiveSuccess(state, Date.now(), epgError),
        );
        // 抓取成功后异步收集待翻译原文，不阻塞缓存提交。
        void import('@/lib/translation/store')
          .then(({ collectChannelTexts }) => collectChannelTexts(record))
          // eslint-disable-next-line no-console
          .catch((error) => console.error('收集翻译原文失败:', error));
      },
      onFailure: (source, error) =>
        updateLiveSchedule(source, (state) =>
          markLiveFailure(state, Date.now(), errorText(error)),
        ),
    },
  }));

export function getLiveRefreshConcurrency(): number {
  return channelCache.concurrency;
}

export async function deleteCachedLiveChannels(key: string): Promise<void> {
  await channelCache.delete(key);
  await deleteLiveSchedule(key).catch(() => undefined);
}

async function findEnabledLiveSource(key: string) {
  const config = await getConfig();
  const liveInfo = config.LiveConfig?.find(
    (live) => live.key === key && !live.disabled,
  );
  return liveInfo ? { ...liveInfo } : null;
}

// 只读成功缓存，不触发抓取（节目单、管理页使用）。
export async function getCachedLiveChannels(
  key: string,
): Promise<LiveChannels | null> {
  const liveInfo = await findEnabledLiveSource(key);
  if (!liveInfo) return null;
  return channelCache.peek(liveInfo);
}

export async function peekLiveChannels(
  source: LiveCacheSource,
): Promise<LiveChannels | null> {
  return channelCache.peek({ ...source });
}

/**
 * 前台频道请求：有成功缓存立即返回（无论多旧）；无缓存时冷却期内立即暂不可用，
 * 否则以优先级加入或复用抓取任务，最多等待 5 秒（含排队），超时后台继续。
 * 返回 null 表示源不存在或已禁用。
 */
export async function getLiveChannelsForClient(
  key: string,
): Promise<LiveChannels | null> {
  const liveInfo = await findEnabledLiveSource(key);
  if (!liveInfo) return null;
  const cached = await channelCache.peek(liveInfo);
  if (cached) return cached;
  if (
    !channelCache.isRefreshing(liveInfo) &&
    isLiveCoolingDown(await getLiveSchedule(liveInfo), Date.now())
  )
    throw new LiveChannelsUnavailableError();
  const task = channelCache.refresh(liveInfo, { priority: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new LiveChannelsUnavailableError()),
          LIVE_CLIENT_WAIT_MS,
        );
      }),
    ]);
  } catch {
    // 等待超时或抓取失败：后台任务继续，前端收到暂不可用。
    task.catch(() => undefined);
    throw new LiveChannelsUnavailableError();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 普通刷新遵守失败冷却；force 为显式强制刷新（仍受并发限制并复用进行中任务）。
 */
export async function refreshLiveChannels(
  liveInfo: LiveCacheSource,
  options: { force?: boolean } = { force: true },
): Promise<number> {
  if (
    !options.force &&
    !channelCache.isRefreshing(liveInfo) &&
    isLiveCoolingDown(await getLiveSchedule(liveInfo), Date.now())
  )
    throw new Error('直播源处于失败冷却期');
  const cache = await channelCache.refresh({ ...liveInfo });
  return cache.channelNumber;
}

export function isLiveSourceRefreshing(source: LiveCacheSource): boolean {
  return channelCache.isRefreshing({ ...source });
}

async function fetchLiveChannelData(
  liveInfo: LiveCacheSource,
  previous: LiveChannelCacheRecord | null,
): Promise<LiveChannelData & { epgError?: string }> {
  const ua = liveInfo.ua || defaultUA;
  const response = await fetch(liveInfo.url, {
    headers: {
      'User-Agent': ua,
    },
    signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`直播源 HTTP ${response.status}，保留旧缓存`);
  const data = await response.text();
  const result = parseM3U(liveInfo.key, data);
  if (result.channels.length === 0)
    throw new Error('直播源没有有效频道，保留旧缓存');
  const epgUrl = liveInfo.epg || result.tvgUrl;
  const epgs = await parseEpg(
    epgUrl,
    liveInfo.ua || defaultUA,
    result.channels.map((channel) => channel.tvgId).filter((tvgId) => tvgId),
  );
  return {
    channelNumber: result.channels.length,
    channels: result.channels,
    epgUrl: epgUrl,
    epgs: epgs ?? previous?.epgs ?? {},
    epgError: epgUrl && !epgs ? 'EPG 获取失败，保留上次节目单' : '',
  };
}

async function parseEpg(
  epgUrl: string,
  ua: string,
  tvgIds: string[],
): Promise<{
  [key: string]: {
    start: string;
    end: string;
    title: string;
  }[];
} | null> {
  if (!epgUrl) {
    return {};
  }

  const normalizeEpgKey = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, '');
  const tvgKeyMap = new Map(
    tvgIds
      .filter((tvgId) => tvgId && tvgId.trim())
      .map((tvgId) => [normalizeEpgKey(tvgId), tvgId]),
  );
  const getXmlAttr = (line: string, name: string) => {
    const match = line.match(new RegExp(`${name}=["']([^"']*)["']`));
    return match ? match[1] : '';
  };
  const result: {
    [key: string]: { start: string; end: string; title: string }[];
  } = {};

  try {
    const response = await fetch(epgUrl, {
      headers: {
        'User-Agent': ua,
      },
      signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }

    // 使用 ReadableStream 逐行处理，避免将整个文件加载到内存
    const reader = response.body?.getReader();
    if (!reader) {
      return null;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentTvgId = '';
    let currentResultKey = '';
    let currentProgram: { start: string; end: string; title: string } | null =
      null;
    let shouldSkipCurrentProgram = false;
    let hasTvRoot = false;

    const handleLine = (line: string) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      if (/<tv(?:\s|>)/.test(trimmedLine)) hasTvRoot = true;

      // 解析 <programme> 标签
      if (trimmedLine.startsWith('<programme')) {
        currentTvgId = getXmlAttr(trimmedLine, 'channel');
        currentResultKey = tvgKeyMap.get(normalizeEpgKey(currentTvgId)) || '';
        const start = getXmlAttr(trimmedLine, 'start');
        const end = getXmlAttr(trimmedLine, 'stop');

        if (currentTvgId && start && end) {
          currentProgram = { start, end, title: '' };
          shouldSkipCurrentProgram = !currentResultKey;
        }
        return;
      }

      // 解析 <title> 标签 - 只有在需要解析当前节目时才处理
      if (
        trimmedLine.startsWith('<title') &&
        currentProgram &&
        !shouldSkipCurrentProgram
      ) {
        const titleMatch = trimmedLine.match(
          /<title(?:\s+[^>]*)?>(.*?)<\/title>/,
        );
        if (titleMatch && currentProgram && currentResultKey) {
          currentProgram.title = titleMatch[1];
          if (!result[currentResultKey]) {
            result[currentResultKey] = [];
          }
          result[currentResultKey].push({ ...currentProgram });
          currentProgram = null;
        }
        return;
      }

      if (trimmedLine === '</programme>') {
        currentProgram = null;
        currentTvgId = '';
        currentResultKey = '';
        shouldSkipCurrentProgram = false;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // 保留最后一行（可能不完整）
      buffer = lines.pop() || '';

      // 处理完整的行
      for (const line of lines) {
        handleLine(line);
      }
    }

    if (buffer.trim()) {
      handleLine(buffer);
    }
    if (!hasTvRoot) return null;
  } catch {
    // 节目单失败时由调用方继续保留上次成功节目单。
    return null;
  }

  return result;
}

/**
 * 解析M3U文件内容，提取频道信息
 * @param m3uContent M3U文件的内容字符串
 * @returns 频道信息数组
 */
function parseM3U(
  sourceKey: string,
  m3uContent: string,
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    tvgName?: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const channels: {
    id: string;
    tvgId: string;
    tvgName?: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[] = [];

  const lines = m3uContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let tvgUrl = '';
  let channelIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检查是否是 #EXTM3U 行，提取 tvg-url
    if (line.startsWith('#EXTM3U')) {
      // 支持两种格式：x-tvg-url 和 url-tvg
      const tvgUrlMatch = line.match(
        /(?:x-tvg-url|url-tvg)\s*=\s*["']([^"']*)["']/i,
      );
      tvgUrl = tvgUrlMatch ? tvgUrlMatch[1].split(',')[0].trim() : '';
      continue;
    }

    // 检查是否是 #EXTINF 行
    if (line.startsWith('#EXTINF:')) {
      // 提取 tvg-id
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';

      // 提取 tvg-name
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
      const tvgName = tvgNameMatch ? tvgNameMatch[1] : '';

      // 提取 tvg-logo
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const logo = tvgLogoMatch ? tvgLogoMatch[1] : '';

      // 提取 group-title
      const groupTitleMatch = line.match(/group-title="([^"]*)"/);
      const group = groupTitleMatch ? groupTitleMatch[1] : '无分组';

      // 提取标题（#EXTINF 行最后的逗号后面的内容）
      const titleMatch = line.match(/,([^,]*)$/);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // 优先使用 tvg-name，如果没有则使用标题
      const name = title || tvgName || tvgId || '';
      const resolvedTvgId = tvgId || tvgName || title;

      // 检查下一行是否是URL
      if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
        const url = lines[i + 1];

        // 只有当有名称和URL时才添加到结果中
        if (name && url) {
          channels.push({
            id: `${sourceKey}-${channelIndex}`,
            tvgId: resolvedTvgId,
            tvgName,
            name,
            logo,
            group,
            url,
          });
          channelIndex++;
        }

        // 跳过下一行，因为已经处理了
        i++;
      }
    }
  }

  return { tvgUrl, channels };
}

// utils/urlResolver.js
export function resolveUrl(baseUrl: string, relativePath: string) {
  try {
    // 如果已经是完整的 URL，直接返回
    if (
      relativePath.startsWith('http://') ||
      relativePath.startsWith('https://')
    ) {
      return relativePath;
    }

    // 如果是协议相对路径 (//example.com/path)
    if (relativePath.startsWith('//')) {
      const baseUrlObj = new URL(baseUrl);
      return `${baseUrlObj.protocol}${relativePath}`;
    }

    // 使用 URL 构造函数处理相对路径
    const baseUrlObj = new URL(baseUrl);
    const resolvedUrl = new URL(relativePath, baseUrlObj);
    return resolvedUrl.href;
  } catch {
    // 降级处理
    return fallbackUrlResolve(baseUrl, relativePath);
  }
}

function fallbackUrlResolve(baseUrl: string, relativePath: string) {
  // 移除 baseUrl 末尾的文件名，保留目录路径
  let base = baseUrl;
  if (!base.endsWith('/')) {
    base = base.substring(0, base.lastIndexOf('/') + 1);
  }

  // 处理不同类型的相对路径
  if (relativePath.startsWith('/')) {
    // 绝对路径 (/path/to/file)
    const urlObj = new URL(base);
    return `${urlObj.protocol}//${urlObj.host}${relativePath}`;
  } else if (relativePath.startsWith('../')) {
    // 上级目录相对路径 (../path/to/file)
    const segments = base.split('/').filter((s) => s);
    const relativeSegments = relativePath.split('/').filter((s) => s);

    for (const segment of relativeSegments) {
      if (segment === '..') {
        segments.pop();
      } else if (segment !== '.') {
        segments.push(segment);
      }
    }

    const urlObj = new URL(base);
    return `${urlObj.protocol}//${urlObj.host}/${segments.join('/')}`;
  } else {
    // 当前目录相对路径 (file.ts 或 ./file.ts)
    const cleanRelative = relativePath.startsWith('./')
      ? relativePath.slice(2)
      : relativePath;
    return base + cleanRelative;
  }
}

// 获取 M3U8 的基础 URL
export function getBaseUrl(m3u8Url: string) {
  try {
    const url = new URL(m3u8Url);
    // 如果 URL 以 .m3u8 结尾，移除文件名
    if (url.pathname.endsWith('.m3u8')) {
      url.pathname = url.pathname.substring(
        0,
        url.pathname.lastIndexOf('/') + 1,
      );
    } else if (!url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    return url.protocol + '//' + url.host + url.pathname;
  } catch {
    return m3u8Url.endsWith('/') ? m3u8Url : m3u8Url + '/';
  }
}
