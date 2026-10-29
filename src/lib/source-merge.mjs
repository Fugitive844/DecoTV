/**
 * 视频源／直播源按 key 合并：导入四模式、订阅智能合并、人工覆盖与恢复。纯函数。
 *
 * 记录顶层字段始终是生效值（现有读取方无需改动）；
 * upstream 保存导入／订阅提供的来源值，overriddenFields 记录被管理员人工改过的来源字段。
 */
import { createHash } from 'node:crypto';

export const DEFAULT_LIVE_SORT_ORDER = 1000;

/** 来源字段：导入／订阅提供，人工修改后形成覆盖。 */
export const UPSTREAM_FIELDS = {
  video: ['name', 'api', 'detail', 'is_adult'],
  live: ['name', 'url', 'ua', 'epg'],
};
/** 本地字段：智能模式保留本地值，强制覆盖时仅在导入提供时替换。 */
export const LOCAL_FIELDS = {
  video: ['disabled', 'disable_ad_filter'],
  live: ['disabled', 'sortOrder'],
};
export const IMPORT_MODES = ['overwrite', 'skip', 'smart', 'ask'];

const clone = (/** @type {any} */ value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/** @param {'video'|'live'} type @param {any} raw */
function normalizeIncoming(type, raw, key) {
  /** @type {Record<string, any>} */
  const fields = {};
  const str = (/** @type {any} */ v) =>
    typeof v === 'string' ? v.trim() : undefined;
  if (type === 'video') {
    if (str(raw.name) !== undefined) fields.name = str(raw.name);
    if (str(raw.api) !== undefined) fields.api = str(raw.api);
    if (raw.detail !== undefined && raw.detail !== null)
      fields.detail = String(raw.detail).trim();
    if (raw.is_adult !== undefined) fields.is_adult = !!raw.is_adult;
    if (raw.disabled !== undefined) fields.disabled = !!raw.disabled;
    if (raw.disable_ad_filter !== undefined)
      fields.disable_ad_filter = !!raw.disable_ad_filter;
    if (!fields.name || !fields.api)
      throw new Error(`视频源 ${key} 缺少名称或接口地址`);
  } else {
    if (str(raw.name) !== undefined) fields.name = str(raw.name);
    if (str(raw.url) !== undefined) fields.url = str(raw.url);
    if (raw.ua !== undefined && raw.ua !== null)
      fields.ua = String(raw.ua).trim();
    if (raw.epg !== undefined && raw.epg !== null)
      fields.epg = String(raw.epg).trim();
    if (raw.disabled !== undefined) fields.disabled = !!raw.disabled;
    if (raw.sortOrder !== undefined && raw.sortOrder !== null) {
      const sort = Number(raw.sortOrder);
      if (!Number.isSafeInteger(sort))
        throw new Error(`直播源 ${key} 的排序值必须是整数`);
      fields.sortOrder = sort;
    }
    if (!fields.name || !fields.url)
      throw new Error(`直播源 ${key} 缺少名称或 M3U 地址`);
  }
  return fields;
}

/**
 * 解析导入数据：视频源支持数组或 {api_site:{key:{...}}}；直播源支持数组、{lives:{...}} 或 key 映射。
 * 同类型重复 key 明确报错。
 * @param {'video'|'live'} type @param {unknown} data
 * @returns {{ key: string, fields: Record<string, any> }[]}
 */
export function parseImportData(type, data) {
  /** @type {[string, any][]} */
  let entries;
  if (Array.isArray(data)) {
    entries = data.map((item, index) => {
      if (!item || typeof item !== 'object')
        throw new Error(`第 ${index + 1} 项不是对象`);
      return [String(item.key ?? '').trim(), item];
    });
  } else if (data && typeof data === 'object') {
    const obj = /** @type {Record<string, any>} */ (data);
    const map =
      type === 'video'
        ? obj.api_site
        : obj.lives && typeof obj.lives === 'object'
          ? obj.lives
          : obj;
    if (!map || typeof map !== 'object' || Array.isArray(map))
      throw new Error(
        type === 'video'
          ? '视频源导入需要数组或包含 api_site 的配置'
          : '直播源导入需要数组、lives 配置或 key 映射',
      );
    entries = Object.entries(map).map(([key, value]) => [key.trim(), value]);
  } else {
    throw new Error('导入内容必须是 JSON 数组或对象');
  }
  const seen = new Set();
  return entries.map(([key, value]) => {
    if (!key) throw new Error('存在缺少 key 的条目');
    if (seen.has(key)) throw new Error(`导入文件中 key 重复：${key}`);
    seen.add(key);
    if (!value || typeof value !== 'object')
      throw new Error(`条目 ${key} 格式错误`);
    return { key, fields: normalizeIncoming(type, value, key) };
  });
}

/** @param {'video'|'live'} type @param {Record<string, any>} fields @param {'config'|'custom'} origin */
function createRecord(type, key, fields, origin) {
  /** @type {Record<string, any>} */
  const upstream = {};
  UPSTREAM_FIELDS[type].forEach((field) => {
    if (fields[field] !== undefined) upstream[field] = fields[field];
  });
  if (type === 'video')
    return {
      key,
      name: fields.name,
      api: fields.api,
      detail: fields.detail,
      is_adult: !!fields.is_adult,
      from: origin,
      disabled: !!fields.disabled,
      ...(fields.disable_ad_filter !== undefined
        ? { disable_ad_filter: fields.disable_ad_filter }
        : {}),
      upstream,
    };
  return {
    key,
    name: fields.name,
    url: fields.url,
    ua: fields.ua,
    epg: fields.epg,
    sortOrder: fields.sortOrder ?? DEFAULT_LIVE_SORT_ORDER,
    channelNumber: 0,
    from: origin,
    disabled: !!fields.disabled,
    upstream,
  };
}

/**
 * 合并单条记录；不触碰 channelNumber、缓存和统计字段。
 * @param {'video'|'live'} type
 * @param {Record<string, any> | null | undefined} existing
 * @param {{ key: string, fields: Record<string, any> }} incoming
 * @param {'overwrite'|'skip'|'smart'} mode
 * @param {'config'|'custom'} origin 订阅／配置文件为 config，手动导入为 custom
 */
export function mergeSourceRecord(type, existing, incoming, mode, origin) {
  if (!existing)
    return createRecord(type, incoming.key, incoming.fields, origin);
  if (mode === 'skip') return existing;
  const record = clone(existing);
  const upstream = { ...(record.upstream || {}) };
  const overridden = new Set(record.overriddenFields || []);
  UPSTREAM_FIELDS[type].forEach((field) => {
    const value = incoming.fields[field];
    if (value === undefined) return;
    upstream[field] = value;
    if (mode === 'overwrite') {
      record[field] = value;
      overridden.delete(field);
    } else if (!overridden.has(field)) {
      record[field] = value;
    }
  });
  if (mode === 'overwrite')
    LOCAL_FIELDS[type].forEach((field) => {
      if (incoming.fields[field] !== undefined)
        record[field] = incoming.fields[field];
    });
  record.upstream = upstream;
  if (overridden.size > 0) record.overriddenFields = Array.from(overridden);
  else delete record.overriddenFields;
  if (origin === 'config') record.from = 'config';
  return record;
}

/**
 * 管理员单项编辑来源字段：记录覆盖关系，后续智能导入／订阅保留人工值。
 * @param {'video'|'live'} type @param {Record<string, any>} existing @param {Record<string, any>} patch
 */
export function applyManualEdit(type, existing, patch) {
  const record = clone(existing);
  const upstream = { ...(record.upstream || {}) };
  const overridden = new Set(record.overriddenFields || []);
  Object.entries(patch).forEach(([field, value]) => {
    if (value === undefined) return;
    if (UPSTREAM_FIELDS[type].includes(field)) {
      // 未设置与空字符串视为相同，避免表单回传空值被当成人工修改。
      if ((record[field] ?? '') === (value ?? '')) return;
      if (!(field in upstream)) upstream[field] = record[field];
      record[field] = value;
      if ((upstream[field] ?? '') === (value ?? '')) overridden.delete(field);
      else overridden.add(field);
    } else if (LOCAL_FIELDS[type].includes(field)) {
      record[field] = value;
    }
  });
  record.upstream = upstream;
  if (overridden.size > 0) record.overriddenFields = Array.from(overridden);
  else delete record.overriddenFields;
  return record;
}

/** 恢复来源值：fields 为空表示恢复全部被覆盖字段。 */
export function restoreUpstream(existing, fields) {
  const record = clone(existing);
  const upstream = record.upstream || {};
  const overridden = new Set(record.overriddenFields || []);
  (fields && fields.length ? fields : Array.from(overridden)).forEach(
    (/** @type {string} */ field) => {
      if (field in upstream) record[field] = upstream[field];
      overridden.delete(field);
    },
  );
  if (overridden.size > 0) record.overriddenFields = Array.from(overridden);
  else delete record.overriddenFields;
  return record;
}

/** @param {'video'|'live'} type @param {Record<string, any>} existing @param {Record<string, any>} fields */
function diffFields(type, existing, fields) {
  return [...UPSTREAM_FIELDS[type], ...LOCAL_FIELDS[type]].filter(
    (field) =>
      fields[field] !== undefined &&
      JSON.stringify(fields[field]) !== JSON.stringify(existing[field]),
  );
}

/** 预览指纹：只覆盖导入涉及的现有记录，提交时不一致则需要重新预览。 */
export function importFingerprint(list, items) {
  const keys = new Set(items.map((item) => item.key));
  const related = list
    .filter((record) => keys.has(record.key))
    .map((record) => [record.key, record]);
  return createHash('sha256')
    .update(JSON.stringify(related))
    .digest('hex')
    .slice(0, 24);
}

/**
 * @param {'video'|'live'} type @param {Record<string, any>[]} list
 * @param {{ key: string, fields: Record<string, any> }[]} items
 */
export function previewImport(type, list, items) {
  const byKey = new Map(list.map((record) => [record.key, record]));
  const added = [];
  const conflicts = [];
  const unchanged = [];
  for (const item of items) {
    const existing = byKey.get(item.key);
    if (!existing) {
      added.push({ key: item.key, incoming: item.fields });
      continue;
    }
    const changes = diffFields(type, existing, item.fields);
    if (changes.length === 0) unchanged.push(item.key);
    else
      conflicts.push({
        key: item.key,
        changes,
        existing,
        incoming: item.fields,
        overriddenFields: existing.overriddenFields || [],
      });
  }
  return {
    added,
    conflicts,
    unchanged,
    fingerprint: importFingerprint(list, items),
  };
}

/**
 * 提交导入。ask 模式需对每个冲突 key 给出 overwrite/skip/smart；导入文件不存在的 key 不删除。
 * @param {'video'|'live'} type @param {Record<string, any>[]} list
 * @param {{ key: string, fields: Record<string, any> }[]} items
 * @param {'overwrite'|'skip'|'smart'|'ask'} mode
 * @param {Record<string, 'overwrite'|'skip'|'smart'>} [decisions]
 * @param {'config'|'custom'} [origin]
 */
export function applyImport(
  type,
  list,
  items,
  mode,
  decisions = {},
  origin = 'custom',
) {
  if (!IMPORT_MODES.includes(mode)) throw new Error('未知的导入模式');
  const result = list.map((record) => record);
  const indexByKey = new Map(
    result.map((record, index) => [record.key, index]),
  );
  const summary = { added: 0, updated: 0, skipped: 0, unchanged: 0 };
  for (const item of items) {
    const index = indexByKey.get(item.key);
    if (index === undefined) {
      result.push(createRecord(type, item.key, item.fields, origin));
      indexByKey.set(item.key, result.length - 1);
      summary.added++;
      continue;
    }
    const existing = result[index];
    let itemMode = mode;
    if (mode === 'ask') {
      if (diffFields(type, existing, item.fields).length === 0) {
        summary.unchanged++;
        continue;
      }
      itemMode = decisions[item.key];
      if (!['overwrite', 'skip', 'smart'].includes(itemMode))
        throw new Error(`冲突项 ${item.key} 未选择处理方式`);
    }
    if (itemMode === 'skip') {
      summary.skipped++;
      continue;
    }
    const merged = mergeSourceRecord(
      type,
      existing,
      item,
      /** @type {'overwrite'|'smart'} */ (itemMode),
      origin,
    );
    if (JSON.stringify(merged) === JSON.stringify(existing))
      summary.unchanged++;
    else summary.updated++;
    result[index] = merged;
  }
  return { list: result, summary };
}
