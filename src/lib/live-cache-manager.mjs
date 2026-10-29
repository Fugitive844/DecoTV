/** @typedef {import('./live-cache.types').LiveCacheSource} LiveCacheSource */
/** @typedef {import('./live-cache.types').LiveChannelData} LiveChannelData */
/** @typedef {import('./live-cache.types').LiveChannelCacheRecord} LiveChannelCacheRecord */

export function normalizeLiveRefreshConcurrency(value) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 16 ? limit : 4;
}

/** @param {unknown} value @returns {value is LiveChannelCacheRecord} */
function isCacheRecord(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    value.version === 1 &&
    typeof value.sourceFingerprint === 'string' &&
    Number.isFinite(value.fetchedAt) &&
    value.fetchedAt > 0 &&
    isChannelData(value)
  );
}

/** @param {LiveChannelData} value */
function isChannelData(value) {
  return (
    !!value &&
    Array.isArray(value.channels) &&
    value.channels.length > 0 &&
    value.channelNumber === value.channels.length &&
    value.channels.every(
      (channel) =>
        channel &&
        typeof channel.id === 'string' &&
        typeof channel.name === 'string' &&
        typeof channel.url === 'string' &&
        channel.url.trim().length > 0,
    ) &&
    typeof value.epgUrl === 'string' &&
    !!value.epgs &&
    typeof value.epgs === 'object'
  );
}

/**
 * 无网络/框架依赖，数据库仅保存完整的最后成功版本；所有入口共用同一个并发队列。
 * @param {{
 *   storage: {
 *     get: (key: string) => Promise<LiveChannelCacheRecord | null>,
 *     set: (key: string, value: LiveChannelCacheRecord) => Promise<void>,
 *     delete: (key: string) => Promise<void>
 *   },
 *   fetchSource: (source: LiveCacheSource, previous: LiveChannelCacheRecord | null) => Promise<LiveChannelData>,
 *   fingerprint: (source: LiveCacheSource) => string,
 *   concurrency?: number,
 *   now?: () => number
 * }} options
 */
export function createLiveChannelCache(options) {
  const concurrency = normalizeLiveRefreshConcurrency(options.concurrency);
  const now = options.now || Date.now;
  /** @type {Map<string, LiveChannelCacheRecord>} */
  const memory = new Map();
  /** @type {Map<string, number>} */
  const generations = new Map();
  /** @type {Map<string, string>} */
  const signatures = new Map();
  /** @type {Map<string, Promise<LiveChannelCacheRecord>>} */
  const pending = new Map();
  /** @type {Map<string, Promise<LiveChannelCacheRecord | null>>} */
  const reads = new Map();
  /** @type {Map<string, Promise<void>>} */
  const writes = new Map();
  /** @type {Array<() => void>} */
  const queue = [];
  let active = 0;

  const drain = () => {
    while (active < concurrency && queue.length > 0) queue.shift()?.();
  };
  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  const run = (task) =>
    new Promise((resolve, reject) => {
      queue.push(() => {
        active++;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            drain();
          });
      });
      drain();
    });

  /** @param {string} key @param {() => Promise<void>} task */
  const mutate = (key, task) => {
    const previous = writes.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(task);
    writes.set(key, operation);
    const cleanup = () => {
      if (writes.get(key) === operation) writes.delete(key);
    };
    operation.then(cleanup, cleanup);
    return operation;
  };

  /** @param {LiveCacheSource} source */
  const track = (source) => {
    const signature = options.fingerprint(source);
    if (
      signatures.has(source.key) &&
      signatures.get(source.key) !== signature
    ) {
      generations.set(source.key, (generations.get(source.key) || 0) + 1);
      memory.delete(source.key);
    }
    signatures.set(source.key, signature);
    return { signature, generation: generations.get(source.key) || 0 };
  };
  /** @param {string} key @param {string} signature @param {number} generation */
  const isCurrent = (key, signature, generation) =>
    (generations.get(key) || 0) === generation &&
    signatures.get(key) === signature;

  /** @param {LiveCacheSource} source @param {string} signature @param {number} generation */
  const read = async (source, signature, generation) => {
    const cached = memory.get(source.key);
    if (cached?.sourceFingerprint === signature) return cached;
    const readKey = JSON.stringify([source.key, signature, generation]);
    let operation = reads.get(readKey);
    if (!operation) {
      operation = (async () => {
        const stored = await options.storage.get(source.key);
        if (
          !isCurrent(source.key, signature, generation) ||
          !isCacheRecord(stored) ||
          stored.sourceFingerprint !== signature
        )
          return null;
        const newer = memory.get(source.key);
        if (
          newer?.sourceFingerprint === signature &&
          newer.fetchedAt >= stored.fetchedAt
        )
          return newer;
        memory.set(source.key, stored);
        return stored;
      })();
      reads.set(readKey, operation);
      const cleanup = () => {
        if (reads.get(readKey) === operation) reads.delete(readKey);
      };
      operation.then(cleanup, cleanup);
    }
    return operation;
  };

  /** @param {LiveCacheSource} source @returns {Promise<LiveChannelCacheRecord>} */
  const refresh = (source) => {
    const { signature, generation } = track(source);
    const requestKey = JSON.stringify([source.key, signature, generation]);
    const existing = pending.get(requestKey);
    if (existing) return existing;
    const operation = run(async () => {
      if (!isCurrent(source.key, signature, generation))
        throw new Error('直播源已变更');
      const previous = await read(source, signature, generation);
      const data = await options.fetchSource(source, previous);
      if (!isChannelData(data))
        throw new Error('直播源没有有效频道，保留旧缓存');
      /** @type {LiveChannelCacheRecord} */
      const record = {
        ...data,
        version: 1,
        sourceFingerprint: signature,
        fetchedAt: now(),
      };
      await mutate(source.key, async () => {
        if (!isCurrent(source.key, signature, generation))
          throw new Error('直播源已变更');
        await options.storage.set(source.key, record);
        if (!isCurrent(source.key, signature, generation))
          throw new Error('直播源已变更');
        memory.set(source.key, record);
      });
      return record;
    });
    pending.set(requestKey, operation);
    const cleanup = () => {
      if (pending.get(requestKey) === operation) pending.delete(requestKey);
    };
    operation.then(cleanup, cleanup);
    return operation;
  };

  return {
    concurrency,
    refresh,
    /** @param {LiveCacheSource} source */
    async get(source) {
      const { signature, generation } = track(source);
      const stored = await read(source, signature, generation);
      return stored || refresh(source);
    },
    /** @param {string} key */
    async delete(key) {
      generations.set(key, (generations.get(key) || 0) + 1);
      signatures.delete(key);
      memory.delete(key);
      await mutate(key, () => options.storage.delete(key));
    },
  };
}
