import { isLiveCacheInfoChannel } from '@/lib/live-channel-display.mjs';

import { readTranslations } from './store';
import {
  formatTranslatedName,
  isTranslationCandidate,
} from './text-filter.mjs';

interface DisplayChannel {
  id: string;
  name: string;
  group: string;
}

/**
 * 生成响应副本：有成功译文的频道名和分类显示为 `原名（中文译名）`；
 * 其余字段（ID、tvgId、tvgName、地址、台标、顺序）不变，缓存不被修改。
 */
export async function applyChannelTranslations<T extends DisplayChannel>(
  sourceKey: string,
  channels: T[],
): Promise<T[]> {
  const texts = new Set<string>();
  for (const channel of channels) {
    if (isLiveCacheInfoChannel(sourceKey, channel)) continue;
    if (isTranslationCandidate(channel.name)) texts.add(channel.name);
    if (isTranslationCandidate(channel.group)) texts.add(channel.group);
  }
  const translations = await readTranslations(Array.from(texts));
  if (translations.size === 0) return channels;
  return channels.map((channel) => {
    if (isLiveCacheInfoChannel(sourceKey, channel)) return channel;
    const name = translations.get(channel.name);
    const group = translations.get(channel.group);
    if (!name && !group) return channel;
    return {
      ...channel,
      name: name ? formatTranslatedName(channel.name, name) : channel.name,
      group: group ? formatTranslatedName(channel.group, group) : channel.group,
    };
  });
}

export async function translateTexts(
  texts: string[],
): Promise<Map<string, string>> {
  return readTranslations(texts.filter((text) => isTranslationCandidate(text)));
}
