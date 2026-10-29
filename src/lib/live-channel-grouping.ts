interface ChannelLine {
  id: string;
  name: string;
  group: string;
  url: string;
}

// 保留清晰度、地区、+ 等名称信息，只兼容大小写、空格和连字符差异。
export function getLiveChannelKey(channel: ChannelLine): string {
  const name = channel.name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s-]+/g, '');
  return JSON.stringify([channel.group, name || channel.id]);
}

export function mergeLiveChannels<T extends ChannelLine>(
  channels: T[],
): (T & { lines: T[] })[] {
  const entries = new Map<string, T & { lines: T[] }>();
  const urls = new Map<string, Set<string>>();

  for (const channel of channels) {
    const key = getLiveChannelKey(channel);
    const entry = entries.get(key);
    if (!entry) {
      entries.set(key, { ...channel, lines: [channel] });
      urls.set(key, new Set([channel.url]));
    } else if (!urls.get(key)?.has(channel.url)) {
      entry.lines.push(channel);
      urls.get(key)?.add(channel.url);
    }
  }

  return Array.from(entries.values());
}
