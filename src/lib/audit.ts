import { PlayAuditEntry, PlayRecord, SearchAuditEntry } from './types';

// 每个用户最多保留的搜索审计条数
export const SEARCH_AUDIT_LIMIT = 5000;

// 审计数据使用独立前缀，避免被 u:{user}:* 的删除逻辑波及
export const AUDIT_USERS_KEY = 'audit:users';

export function playAuditKey(userName: string): string {
  return `audit:play:${userName}`;
}

export function searchAuditKey(userName: string): string {
  return `audit:search:${userName}`;
}

/**
 * 合并播放审计记录：同一 source+id 只保留一条，保留首次观看时间，其余字段以最新记录为准。
 */
export function buildPlayAuditEntry(
  key: string,
  record: PlayRecord,
  previous: PlayAuditEntry | null,
  now = Date.now(),
): PlayAuditEntry {
  const separator = key.indexOf('+');
  const source = separator >= 0 ? key.slice(0, separator) : key;
  const id = separator >= 0 ? key.slice(separator + 1) : '';
  const lastPlayTime = record.save_time || now;

  return {
    ...record,
    key,
    source,
    id,
    first_play_time: previous?.first_play_time || lastPlayTime,
    last_play_time: lastPlayTime,
  };
}

export function buildSearchAuditEntry(
  keyword: string,
  now = Date.now(),
): SearchAuditEntry {
  return { keyword, time: now };
}

// upstash 等客户端可能已自动反序列化 JSON
export function parseAuditValue<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

export function sortPlayAudits(entries: PlayAuditEntry[]): PlayAuditEntry[] {
  return entries.sort((a, b) => b.last_play_time - a.last_play_time);
}
