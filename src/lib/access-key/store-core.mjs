/**
 * 访问秘钥：站长批量生成，可启用停用，一个秘钥可供任意多人使用。
 * 只依赖通用键值原语（Kvrocks／内存实现），纯逻辑便于 node:test 测试。
 */
import { randomBytes } from 'node:crypto';

const KEY = {
  item: (/** @type {string} */ key) => `ak:item:${key}`,
  all: 'ak:all',
  // 空秘钥：启用后不带秘钥（或秘钥无效）的请求也视为通过。
  empty: 'ak:empty',
};
export const ACCESS_KEY_STORE_KEYS = KEY;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY_PATTERN = /^DK[A-Z2-7]{20}$/;
export const MAX_GENERATE_COUNT = 100;
export const MAX_REMARK_LENGTH = 100;

/**
 * @typedef {{
 *   key: string,
 *   remark: string,
 *   enabled: boolean,
 *   createdAt: number,
 *   updatedAt: number,
 *   lastUsedAt: number
 * }} AccessKeyItem
 */

/** 秘钥格式：DK + 20 位 base32（约 100 位随机），无法暴力枚举。 */
export function generateKeyString(random = randomBytes) {
  const bytes = random(20);
  let out = 'DK';
  for (let i = 0; i < 20; i++) out += BASE32[bytes[i] & 31];
  return out;
}

/** 用户输入去空白、转大写；格式不对直接视为无效，不查库。 @param {unknown} value */
export function normalizeAccessKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim().toUpperCase();
  return KEY_PATTERN.test(key) ? key : '';
}

const parse = (/** @type {string | null} */ raw) => {
  if (!raw) return null;
  try {
    return /** @type {AccessKeyItem} */ (JSON.parse(raw));
  } catch {
    return null;
  }
};

/** @param {import('../translation/store-core.mjs').Kv} kv @param {string} key */
export async function getAccessKey(kv, key) {
  const normalized = normalizeAccessKey(key);
  return normalized ? parse(await kv.kvGet(KEY.item(normalized))) : null;
}

/** 按创建时间倒序返回全部秘钥。 @param {import('../translation/store-core.mjs').Kv} kv */
export async function listAccessKeys(kv) {
  const keys = await kv.zRangeAll(KEY.all);
  if (keys.length === 0) return [];
  const raws = await kv.kvMGet(keys.map(KEY.item));
  return /** @type {AccessKeyItem[]} */ (raws.map(parse).filter(Boolean)).sort(
    (a, b) => b.createdAt - a.createdAt || (a.key < b.key ? -1 : 1),
  );
}

/**
 * @param {import('../translation/store-core.mjs').Kv} kv
 * @param {number} count @param {string} remark @param {number} now
 */
export async function createAccessKeys(
  kv,
  count,
  remark,
  now,
  random = randomBytes,
) {
  const total = Math.floor(Number(count));
  if (!Number.isFinite(total) || total < 1 || total > MAX_GENERATE_COUNT)
    throw new Error(`生成数量须为 1-${MAX_GENERATE_COUNT}`);
  const note = String(remark || '')
    .trim()
    .slice(0, MAX_REMARK_LENGTH);
  /** @type {AccessKeyItem[]} */
  const created = [];
  while (created.length < total) {
    const key = generateKeyString(random);
    /** @type {AccessKeyItem} */
    const item = {
      key,
      remark: note,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: 0,
    };
    // NX 防止极小概率的重复覆盖已有秘钥。
    if (!(await kv.kvSet(KEY.item(key), JSON.stringify(item), { nx: true })))
      continue;
    await kv.zAdd(KEY.all, now, key);
    created.push(item);
  }
  return created;
}

/**
 * 批量修改启用状态或备注；不存在的秘钥计入 skipped。
 * @param {import('../translation/store-core.mjs').Kv} kv
 * @param {string[]} keys
 * @param {{ enabled?: boolean, remark?: string }} patch
 * @param {number} now
 */
export async function updateAccessKeys(kv, keys, patch, now) {
  let updated = 0;
  let skipped = 0;
  for (const key of new Set(keys.map(normalizeAccessKey))) {
    if (!key) {
      skipped++;
      continue;
    }
    // 比较并写入，避免覆盖并发写入的 lastUsedAt。
    for (let attempt = 0; attempt < 5; attempt++) {
      const raw = await kv.kvGet(KEY.item(key));
      const item = parse(raw);
      if (!item) {
        skipped++;
        break;
      }
      const next = { ...item, updatedAt: now };
      if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (typeof patch.remark === 'string')
        next.remark = patch.remark.trim().slice(0, MAX_REMARK_LENGTH);
      if (await kv.kvCompareAndSet(KEY.item(key), raw, JSON.stringify(next))) {
        updated++;
        break;
      }
    }
  }
  return { updated, skipped };
}

/** @param {import('../translation/store-core.mjs').Kv} kv @param {string[]} keys */
export async function deleteAccessKeys(kv, keys) {
  const list = [...new Set(keys.map(normalizeAccessKey))].filter(Boolean);
  if (list.length === 0) return 0;
  await kv.kvDel(list.map(KEY.item));
  await kv.zRem(KEY.all, list);
  return list.length;
}

/** @param {import('../translation/store-core.mjs').Kv} kv */
export async function isEmptyKeyEnabled(kv) {
  return (await kv.kvGet(KEY.empty)) === '1';
}

/** @param {import('../translation/store-core.mjs').Kv} kv @param {boolean} enabled */
export async function setEmptyKeyEnabled(kv, enabled) {
  if (enabled) await kv.kvSet(KEY.empty, '1');
  else await kv.kvDel([KEY.empty]);
}

/**
 * 校验器：结果在进程内缓存 ttlMs；有效使用时按 touchIntervalMs 节流记录 lastUsedAt。
 * 管理端改动后调用 invalidate() 立即生效。
 * @param {import('../translation/store-core.mjs').Kv} kv
 * @param {{ now?: () => number, ttlMs?: number, touchIntervalMs?: number }} [options]
 */
export function createAccessKeyValidator(kv, options = {}) {
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs ?? 30_000;
  const touchIntervalMs = options.touchIntervalMs ?? 10 * 60_000;
  /** @type {Map<string, { valid: boolean, at: number }>} */
  const cache = new Map();

  /** @param {string} key */
  const touch = async (key) => {
    const raw = await kv.kvGet(KEY.item(key));
    const item = parse(raw);
    if (!item || now() - (item.lastUsedAt || 0) < touchIntervalMs) return;
    await kv.kvCompareAndSet(
      KEY.item(key),
      raw,
      JSON.stringify({ ...item, lastUsedAt: now() }),
    );
  };

  /** @type {{ enabled: boolean, at: number } | null} */
  let emptyCache = null;
  const emptyEnabled = async () => {
    if (emptyCache && now() - emptyCache.at < ttlMs) return emptyCache.enabled;
    const enabled = await isEmptyKeyEnabled(kv);
    emptyCache = { enabled, at: now() };
    return enabled;
  };

  /** 只校验这个秘钥本身（登录页、设置页提示用）。 @param {unknown} value */
  const validateKey = async (value) => {
    const key = normalizeAccessKey(value);
    if (!key) return false;
    const cached = cache.get(key);
    if (cached && now() - cached.at < ttlMs) return cached.valid;
    const item = parse(await kv.kvGet(KEY.item(key)));
    const valid = Boolean(item?.enabled);
    if (cache.size > 5000) cache.clear();
    cache.set(key, { valid, at: now() });
    if (valid) void touch(key).catch(() => undefined);
    return valid;
  };

  return {
    validateKey,
    /** 请求是否放行：秘钥有效，或已启用空秘钥。 @param {unknown} value */
    async validate(value) {
      return (await validateKey(value)) || (await emptyEnabled());
    },
    invalidate() {
      cache.clear();
      emptyCache = null;
    },
  };
}

/**
 * 成人内容展示判定：后台总开关关闭过滤，且请求带有效访问秘钥。
 * @param {{ disableYellowFilter?: boolean, keyValid: boolean }} input
 */
export function shouldShowAdult({ disableYellowFilter, keyValid }) {
  return disableYellowFilter === true && keyValid;
}
