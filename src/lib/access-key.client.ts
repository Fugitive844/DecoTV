'use client';

// 访问秘钥按设备保存在浏览器本地，请求搜索、源浏览器相关接口时作为 URL 参数 ak 带上。
const STORAGE_KEY = 'decotvAccessKey';
export const ACCESS_KEY_CHANGED_EVENT = 'decotv:access-key-changed';
export const ACCESS_KEY_HINT = '需要搜索更多精彩内容，请联系站长获取秘钥';

export function getAccessKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAccessKey(value: string) {
  try {
    const key = value.trim();
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式等不可写时忽略。
  }
  window.dispatchEvent(new Event(ACCESS_KEY_CHANGED_EVENT));
}

/** 有秘钥时在相对或绝对地址后追加 ak 参数。 */
export function withAccessKey(url: string): string {
  const key = getAccessKey();
  if (!key) return url;
  return `${url}${url.includes('?') ? '&' : '?'}ak=${encodeURIComponent(key)}`;
}

/** 校验秘钥是否有效（停用或不存在均为无效）。 */
export async function verifyAccessKey(value: string): Promise<boolean> {
  const response = await fetch(
    `/api/access-key/verify?ak=${encodeURIComponent(value.trim())}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`校验失败 (${response.status})`);
  const data = (await response.json()) as { valid?: boolean };
  return data.valid === true;
}
