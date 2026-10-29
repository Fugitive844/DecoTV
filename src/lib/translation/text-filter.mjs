// 只收集完全不含汉字的频道分类名／频道名；含任意汉字（包括日文汉字）即跳过。
// 没有任何字母的文本（日期、纯数字、符号）不需要翻译，也不收集。
const HAN = /\p{Script=Han}/u;
const LETTER = /\p{L}/u;

/** @param {unknown} text */
export function hasHanCharacter(text) {
  return typeof text === 'string' && HAN.test(text);
}

/** @param {unknown} text */
export function isTranslationCandidate(text) {
  return typeof text === 'string' && LETTER.test(text) && !HAN.test(text);
}

/**
 * 从频道缓存收集候选原文（原样作为 key，不做大小写或后缀归一化），去重。
 * @param {{ channels?: { name?: string, group?: string }[] } | null | undefined} record
 */
export function collectCandidateTexts(record) {
  const texts = new Set();
  for (const channel of record?.channels || []) {
    if (isTranslationCandidate(channel.name)) texts.add(channel.name);
    if (isTranslationCandidate(channel.group)) texts.add(channel.group);
  }
  return Array.from(texts);
}

/** 展示：`原名（中文译名）`。 @param {string} original @param {string} translation */
export function formatTranslatedName(original, translation) {
  return `${original}（${translation}）`;
}
