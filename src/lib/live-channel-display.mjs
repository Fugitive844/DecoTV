/**
 * 只在响应时插入说明项，数据库保存的频道和原始 ID 不变。
 * @param {string} sourceKey
 * @param {import('./live-cache.types').LiveChannelCacheRecord} cache
 */
export function buildLiveChannelDisplayList(sourceKey, cache) {
  const first = cache.channels[0];
  if (!first) return [];
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(cache.fetchedAt));
  return [
    {
      id: `${sourceKey}-cache-info`,
      name: '上次服务器抓取源时间',
      tvgId: '',
      tvgName: '上次服务器抓取源时间',
      logo: '',
      group: `${time}（北京时间）`,
      url: first.url,
    },
    ...cache.channels,
  ];
}

/** @param {string} sourceKey @param {{ id?: string } | null | undefined} channel */
export function isLiveCacheInfoChannel(sourceKey, channel) {
  return channel?.id === `${sourceKey}-cache-info`;
}
