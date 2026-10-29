/**
 * 翻译缓存、模型配置与调用额度的持久化逻辑，只依赖通用键值原语（Kvrocks／内存实现）。
 * 原子性依靠 kvCompareAndSet；集合索引（zset）可由 repairIndexes 自愈。
 */
import { Buffer } from 'node:buffer';

export const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  RETRY_WAIT: 'retry_wait',
  SUCCESS: 'success',
  NO_NEED: 'no_need',
  FAILED: 'failed',
};
export const MAX_FAIL_COUNT = 3;
const ACTIVE_STATUSES = new Set([
  STATUS.PENDING,
  STATUS.PROCESSING,
  STATUS.RETRY_WAIT,
]);

const KEY = {
  item: (/** @type {string} */ id) => `tr:item:${id}`,
  all: 'tr:all',
  due: 'tr:due',
  cfg: (/** @type {string} */ id) => `llm:cfg:${id}`,
  cfgs: 'llm:cfgs',
  active: 'llm:active',
  quota: (/** @type {string} */ id) => `llm:quota:${id}`,
  req: (/** @type {string} */ rid) => `llm:req:${rid}`,
  stats: (/** @type {string} */ id) => `llm:stats:${id}`,
  workerState: 'tr:worker:state',
  workerLock: 'tr:worker:lock',
};
export const STORE_KEYS = KEY;

/**
 * @typedef {{
 *   kvGet(key: string): Promise<string | null>,
 *   kvMGet(keys: string[]): Promise<(string | null)[]>,
 *   kvSet(key: string, value: string, options?: { nx?: boolean, px?: number }): Promise<boolean>,
 *   kvDel(keys: string[]): Promise<void>,
 *   kvCompareAndSet(key: string, expected: string | null, value: string | null, px?: number): Promise<boolean>,
 *   zAdd(key: string, score: number, member: string): Promise<void>,
 *   zRem(key: string, members: string[]): Promise<void>,
 *   zRangeByScore(key: string, min: number, max: number, limit: number): Promise<string[]>,
 *   zRangeAll(key: string): Promise<string[]>
 * }} Kv
 */

/**
 * @typedef {{
 *   text: string,
 *   translation: string,
 *   needsTranslation: 'unknown' | 'yes' | 'no',
 *   status: string,
 *   failCount: number,
 *   lastError: string,
 *   nextAttemptAt: number,
 *   leaseUntil: number,
 *   version: number,
 *   resultSource: '' | 'model' | 'manual' | 'shared',
 *   createdAt: number,
 *   updatedAt: number
 * }} TranslationItem
 */

/** 原文无损编码为 key。 @param {string} text */
export function encodeTextId(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}
/** @param {string} id */
export function decodeTextId(id) {
  return Buffer.from(id, 'base64url').toString('utf8');
}

/** @param {string} raw */
function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @param {string} text @param {number} now @returns {TranslationItem} */
export function newItem(text, now) {
  return {
    text,
    translation: '',
    needsTranslation: 'unknown',
    status: STATUS.PENDING,
    failCount: 0,
    lastError: '',
    nextAttemptAt: now,
    leaseUntil: 0,
    version: 1,
    resultSource: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** @param {Kv} kv @param {string} id @param {TranslationItem | null} item */
async function syncDue(kv, id, item) {
  if (!item || !ACTIVE_STATUSES.has(item.status)) {
    await kv.zRem(KEY.due, [id]);
    return;
  }
  await kv.zAdd(
    KEY.due,
    item.status === STATUS.PROCESSING ? item.leaseUntil : item.nextAttemptAt,
    id,
  );
}

/**
 * CAS 更新一条记录。mutator 返回 undefined 表示不修改。
 * @param {Kv} kv @param {string} text
 * @param {(current: TranslationItem | null) => TranslationItem | null | undefined} mutator
 * @returns {Promise<{ changed: boolean, item: TranslationItem | null }>}
 */
export async function updateItem(kv, text, mutator) {
  const id = encodeTextId(text);
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = await kv.kvGet(KEY.item(id));
    const current = parseJson(raw);
    const next = mutator(current);
    if (next === undefined) return { changed: false, item: current };
    const ok = await kv.kvCompareAndSet(
      KEY.item(id),
      raw,
      next === null ? null : JSON.stringify(next),
    );
    if (!ok) continue;
    if (next && !current) await kv.zAdd(KEY.all, next.createdAt, id);
    if (!next) await kv.zRem(KEY.all, [id]);
    await syncDue(kv, id, next);
    return { changed: true, item: next };
  }
  throw new Error('翻译记录并发冲突，稍后重试');
}

/** @param {Kv} kv @param {string} text */
export async function getItem(kv, text) {
  return parseJson(await kv.kvGet(KEY.item(encodeTextId(text))));
}

/**
 * 入队：仅为不存在的原文创建待翻译记录，不覆盖已有状态。
 * @param {Kv} kv @param {string[]} texts @param {number} now
 */
export async function enqueueTexts(kv, texts, now) {
  const unique = Array.from(new Set(texts));
  let created = 0;
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const raws = await kv.kvMGet(
      chunk.map((text) => KEY.item(encodeTextId(text))),
    );
    for (let j = 0; j < chunk.length; j++) {
      if (raws[j]) continue;
      const result = await updateItem(kv, chunk[j], (current) =>
        current ? undefined : newItem(chunk[j], now),
      );
      if (result.changed) created++;
    }
  }
  return created;
}

/**
 * 响应路径批量读取成功译文。
 * @param {Kv} kv @param {string[]} texts @returns {Promise<Map<string, string>>}
 */
export async function getTranslationMap(kv, texts) {
  const unique = Array.from(new Set(texts));
  const map = new Map();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const raws = await kv.kvMGet(
      chunk.map((text) => KEY.item(encodeTextId(text))),
    );
    raws.forEach((raw, index) => {
      const item = parseJson(raw);
      if (item?.status === STATUS.SUCCESS && item.translation)
        map.set(chunk[index], item.translation);
    });
  }
  return map;
}

/**
 * 认领到期记录（最多 limit 条）：置为处理中并设置租约；过期租约可回收。
 * @param {Kv} kv @param {number} now @param {number} limit @param {number} leaseMs
 * @returns {Promise<TranslationItem[]>}
 */
export async function claimBatch(kv, now, limit, leaseMs) {
  /** @type {TranslationItem[]} */
  const claimed = [];
  const visited = new Set();
  for (let round = 0; round < 5 && claimed.length < limit; round++) {
    const ids = (await kv.zRangeByScore(KEY.due, 0, now, limit * 2)).filter(
      (id) => !visited.has(id),
    );
    if (ids.length === 0) break;
    for (const id of ids) {
      if (claimed.length >= limit) break;
      visited.add(id);
      const text = decodeTextId(id);
      const result = await updateItem(kv, text, (current) => {
        if (!current) return undefined;
        const claimable =
          ((current.status === STATUS.PENDING ||
            current.status === STATUS.RETRY_WAIT) &&
            current.nextAttemptAt <= now) ||
          (current.status === STATUS.PROCESSING && current.leaseUntil <= now);
        if (!claimable || current.failCount >= MAX_FAIL_COUNT) return undefined;
        return {
          ...current,
          status: STATUS.PROCESSING,
          leaseUntil: now + leaseMs,
          version: current.version + 1,
        };
      });
      if (result.changed && result.item) claimed.push(result.item);
      else {
        // 终态或不存在的残留索引直接移除；未到期的保留。
        const item = result.item;
        if (
          !item ||
          !ACTIVE_STATUSES.has(item.status) ||
          item.failCount >= MAX_FAIL_COUNT
        )
          await kv.zRem(KEY.due, [id]);
      }
    }
  }
  return claimed;
}

/**
 * 以认领时的版本提交结果：版本不符（人工已修改或被重置）时放弃，人工结果优先。
 * @param {Kv} kv @param {TranslationItem} claimed
 * @param {(current: TranslationItem) => Partial<TranslationItem>} patch
 */
export async function commitClaimed(kv, claimed, patch, now) {
  const result = await updateItem(kv, claimed.text, (current) => {
    if (!current || current.version !== claimed.version) return undefined;
    return {
      ...current,
      ...patch(current),
      leaseUntil: 0,
      version: current.version + 1,
      updatedAt: now,
    };
  });
  return result.changed;
}

/** 释放未执行的认领（无启用配置、额度不足、接口故障），不增加失败次数。 */
export async function releaseClaimed(kv, claimed, now, nextAttemptAt = now) {
  for (const item of claimed)
    await commitClaimed(
      kv,
      item,
      (current) => ({
        status: current.failCount > 0 ? STATUS.RETRY_WAIT : STATUS.PENDING,
        nextAttemptAt,
      }),
      now,
    );
}

/** 内容级失败：失败次数 +1，满 3 次标记失败；否则至少两分钟后再进入候选。 */
export function failurePatch(current, error, now, retryDelayMs) {
  const failCount = current.failCount + 1;
  return {
    failCount,
    status: failCount >= MAX_FAIL_COUNT ? STATUS.FAILED : STATUS.RETRY_WAIT,
    nextAttemptAt: now + retryDelayMs,
    lastError: String(error).slice(0, 300),
  };
}

/** 人工编辑：保存有效译文即成功；标记无需翻译即终态；拒绝矛盾状态。 */
export async function editItem(
  kv,
  text,
  { translation, needsTranslation },
  now,
) {
  const value = typeof translation === 'string' ? translation.trim() : '';
  if (needsTranslation === 'no' && value)
    throw new Error('标记无需翻译时译文应为空');
  if (needsTranslation !== 'no' && !value)
    throw new Error('需要翻译时译文不能为空');
  const result = await updateItem(kv, text, (current) => {
    if (!current) return undefined;
    return {
      ...current,
      translation: needsTranslation === 'no' ? '' : value,
      needsTranslation: needsTranslation === 'no' ? 'no' : 'yes',
      status: needsTranslation === 'no' ? STATUS.NO_NEED : STATUS.SUCCESS,
      resultSource: 'manual',
      lastError: '',
      leaseUntil: 0,
      version: current.version + 1,
      updatedAt: now,
    };
  });
  if (!result.item) throw new Error('翻译记录不存在');
  return result.item;
}

/** 重置失败次数并重新排队（显式操作）。 */
export async function resetItem(kv, text, now) {
  const result = await updateItem(kv, text, (current) => {
    if (!current) return undefined;
    return {
      ...current,
      status: STATUS.PENDING,
      failCount: 0,
      lastError: '',
      nextAttemptAt: now,
      leaseUntil: 0,
      version: current.version + 1,
      updatedAt: now,
    };
  });
  if (!result.item) throw new Error('翻译记录不存在');
  return result.item;
}

/** 修改原文 = 迁移缓存 key：新 key 已存在时拒绝，不静默覆盖。 */
export async function rekeyItem(kv, oldText, newText, now) {
  const target = String(newText || '');
  if (!target.trim()) throw new Error('原文不能为空');
  if (target === oldText) return getItem(kv, oldText);
  const source = await getItem(kv, oldText);
  if (!source) throw new Error('翻译记录不存在');
  const created = await updateItem(kv, target, (current) => {
    if (current) return undefined;
    return {
      ...source,
      text: target,
      leaseUntil: 0,
      status:
        source.status === STATUS.PROCESSING ? STATUS.PENDING : source.status,
      version: 1,
      updatedAt: now,
    };
  });
  if (!created.changed) throw new Error('目标原文已有翻译记录，不能覆盖');
  await updateItem(kv, oldText, (current) => (current ? null : undefined));
  return created.item;
}

export async function deleteItem(kv, text) {
  await updateItem(kv, text, (current) => (current ? null : undefined));
}

/** 读取全部记录（管理列表查询）。 @param {Kv} kv @returns {Promise<TranslationItem[]>} */
export async function listAllItems(kv) {
  const ids = await kv.zRangeAll(KEY.all);
  /** @type {TranslationItem[]} */
  const items = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const raws = await kv.kvMGet(chunk.map((id) => KEY.item(id)));
    raws.forEach((raw) => {
      const item = parseJson(raw);
      if (item) items.push(item);
    });
  }
  return items;
}

/** 修复索引：待处理记录重新进入到期集合（进程在 CAS 与索引更新之间退出时）。 */
export async function repairIndexes(kv) {
  const items = await listAllItems(kv);
  for (const item of items) await syncDue(kv, encodeTextId(item.text), item);
  return items.length;
}

// ---------------- 模型配置与额度 ----------------

/**
 * @typedef {{
 *   id: string, name: string, baseUrl: string, model: string, apiKey: string,
 *   createdAt: number, updatedAt: number
 * }} LlmConfig
 */

/** @param {Kv} kv @returns {Promise<LlmConfig[]>} */
export async function listLlmConfigs(kv) {
  const ids = await kv.zRangeAll(KEY.cfgs);
  if (ids.length === 0) return [];
  const raws = await kv.kvMGet(ids.map((id) => KEY.cfg(id)));
  return raws.map(parseJson).filter(Boolean);
}

/** @param {Kv} kv @param {string} id @returns {Promise<LlmConfig | null>} */
export async function getLlmConfig(kv, id) {
  return parseJson(await kv.kvGet(KEY.cfg(id)));
}

/** @param {Kv} kv @param {LlmConfig} config */
export async function saveLlmConfig(kv, config, isNew) {
  await kv.kvSet(KEY.cfg(config.id), JSON.stringify(config));
  if (isNew) {
    await kv.zAdd(KEY.cfgs, config.createdAt, config.id);
    // 新配置初始额度为 0；仅在不存在时写入，避免覆盖。
    await kv.kvSet(KEY.quota(config.id), '0', { nx: true });
  }
}

export async function deleteLlmConfig(kv, id) {
  await kv.kvCompareAndSet(KEY.active, id, null);
  await kv.zRem(KEY.cfgs, [id]);
  await kv.kvDel([KEY.cfg(id), KEY.quota(id), KEY.stats(id)]);
}

export async function getActiveLlmId(kv) {
  return (await kv.kvGet(KEY.active)) || null;
}

/** 单 key 切换，任意时刻最多一个启用项；null 表示全部停用。 */
export async function setActiveLlmId(kv, id) {
  if (id) await kv.kvSet(KEY.active, id);
  else await kv.kvDel([KEY.active]);
}

/** @returns {Promise<number>} -1 不限，0 禁止，N 剩余次数 */
export async function getQuota(kv, id) {
  const value = Number(await kv.kvGet(KEY.quota(id)));
  return Number.isInteger(value) && value >= -1 ? value : 0;
}

export async function setQuota(kv, id, quota) {
  const value = Number(quota);
  if (!Number.isInteger(value) || value < -1)
    throw new Error('额度必须是 -1、0 或正整数');
  await kv.kvSet(KEY.quota(id), String(value));
  return value;
}

/**
 * 发送前原子扣减自动调用额度，requestId 保证同一次请求只扣一次。
 * @returns {Promise<{ allowed: boolean, remaining: number }>}
 */
export async function consumeQuota(kv, id, requestId) {
  const reqKey = KEY.req(requestId);
  if (!(await kv.kvSet(reqKey, 'pending', { nx: true, px: 86_400_000 }))) {
    const previous = await kv.kvGet(reqKey);
    return { allowed: previous === '1', remaining: await getQuota(kv, id) };
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = await kv.kvGet(KEY.quota(id));
    const value = Number(raw ?? 0);
    if (value === -1) {
      await kv.kvSet(reqKey, '1', { px: 86_400_000 });
      return { allowed: true, remaining: -1 };
    }
    if (!Number.isInteger(value) || value <= 0) {
      await kv.kvSet(reqKey, '0', { px: 86_400_000 });
      return { allowed: false, remaining: 0 };
    }
    if (await kv.kvCompareAndSet(KEY.quota(id), raw, String(value - 1))) {
      await kv.kvSet(reqKey, '1', { px: 86_400_000 });
      return { allowed: true, remaining: value - 1 };
    }
  }
  await kv.kvSet(reqKey, '0', { px: 86_400_000 });
  return { allowed: false, remaining: await getQuota(kv, id) };
}

/**
 * @typedef {{ autoCalls: number, manualCalls: number, lastError: string, lastErrorAt: number, lastManualError: string, lastSuccessAt: number }} LlmStats
 */
/** @returns {Promise<LlmStats>} */
export async function getLlmStats(kv, id) {
  return {
    autoCalls: 0,
    manualCalls: 0,
    lastError: '',
    lastErrorAt: 0,
    lastManualError: '',
    lastSuccessAt: 0,
    ...(parseJson(await kv.kvGet(KEY.stats(id))) || {}),
  };
}

/** 记录一次实际 HTTP 调用。 */
export async function recordLlmCall(kv, id, { kind, error }, now) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = await kv.kvGet(KEY.stats(id));
    const stats = {
      autoCalls: 0,
      manualCalls: 0,
      lastError: '',
      lastErrorAt: 0,
      lastManualError: '',
      lastSuccessAt: 0,
      ...(parseJson(raw) || {}),
    };
    if (kind === 'manual') stats.manualCalls++;
    else stats.autoCalls++;
    if (error) {
      if (kind === 'manual')
        stats.lastManualError = String(error).slice(0, 300);
      else {
        stats.lastError = String(error).slice(0, 300);
        stats.lastErrorAt = now;
      }
    } else {
      stats.lastSuccessAt = now;
      if (kind !== 'manual') stats.lastError = '';
    }
    if (await kv.kvCompareAndSet(KEY.stats(id), raw, JSON.stringify(stats)))
      return;
  }
}

export async function getWorkerState(kv) {
  return parseJson(await kv.kvGet(KEY.workerState)) || {};
}

export async function setWorkerState(kv, patch) {
  const current = await getWorkerState(kv);
  await kv.kvSet(KEY.workerState, JSON.stringify({ ...current, ...patch }));
}
