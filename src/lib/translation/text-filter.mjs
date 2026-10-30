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

// 清晰度、地区限制、播出说明、圆圈标记等技术标注，翻译时必须原样保留。
const TAG_PATTERNS = [
  /\(\s*\d{3,4}\s*[pi]\s*\)/gi,
  /\[[^\]\n]{1,40}\]/g,
  /[Ⓐ-ⓩ]/g,
  /(?<![\p{L}\p{N}])(?:4K|8K|UHD|FHD|HD|SD)(?![\p{L}\p{N}])/giu,
];
// 译文已用中文表达清晰度时视为保留，避免重复追加。
const QUALITY_WORDS = /高清|超清|标清|蓝光/;

const compact = (/** @type {string} */ value) =>
  value.replace(/\s+/g, '').toLowerCase();

/**
 * 把原文里有、译文里漏掉的技术标注按原样追加到译文末尾（幂等）。
 * @param {string} original @param {string} translation
 */
export function restoreTechnicalTags(original, translation) {
  const target = compact(translation);
  /** @type {string[]} */
  const missing = [];
  for (const pattern of TAG_PATTERNS)
    for (const match of String(original).match(pattern) || []) {
      const tag = match.trim();
      if (target.includes(compact(tag))) continue;
      if (/^(?:UHD|FHD|HD|SD)$/i.test(tag) && QUALITY_WORDS.test(translation))
        continue;
      if (!missing.some((item) => compact(item) === compact(tag)))
        missing.push(tag);
    }
  return missing.length ? `${translation} ${missing.join(' ')}` : translation;
}

/**
 * 译文必须含中文且与原文不同才算真正翻译；否则不拼接展示，避免出现「原名（原名）」。
 * @param {string} original @param {string} translation
 */
export function isMeaningfulTranslation(original, translation) {
  return (
    typeof translation === 'string' &&
    HAN.test(translation) &&
    compact(translation) !== compact(String(original))
  );
}

/** 展示：`原名（中文译名）`；旧译文漏掉的标注在展示时补回。 @param {string} original @param {string} translation */
export function formatTranslatedName(original, translation) {
  return `${original}（${restoreTechnicalTags(original, translation)}）`;
}
