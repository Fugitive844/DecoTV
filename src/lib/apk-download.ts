export const APK_DOWNLOAD_HEADLINE = '推荐安卓客户端，观影更顺畅';
export const APK_WEB_PLAYBACK_NOTICE =
  '网页版受浏览器跨域和安全限制，部分点播、直播和封面资源需经服务器中转，可能加载较慢或失败。';
export const APK_CLIENT_PLAYBACK_NOTICE =
  '安卓客户端优先直连资源，减少中转等待，推荐下载体验。';

/** Empty disables the entry. Only HTTP(S) links may be opened or encoded. */
export function normalizeApkDownloadUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    trimmed.length > 2048 ||
    !/^https?:\/\//i.test(trimmed) ||
    Array.from(trimmed).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127;
    })
  )
    return null;
  try {
    const url = new URL(trimmed);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
