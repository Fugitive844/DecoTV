/**
 * OpenAI 兼容 Chat Completions 批量翻译协议：请求构造、外层校验（接口级错误）
 * 与内容校验（内容级错误）。纯函数。
 */
import { URL } from 'node:url';

import { hasHanCharacter, restoreTechnicalTags } from './text-filter.mjs';

export const MAX_SOURCE_TEXT_LENGTH = 200;
export const MAX_TRANSLATION_LENGTH = 200;

export const SYSTEM_PROMPT = [
  '你是直播频道名称翻译器。把用户给出的每个频道名或频道分类名翻译成简体中文。',
  '规则：',
  '1. 只要名称里有任何可以翻译的词（普通词汇、国家／地区／城市名、语言名、节目类型如 News、Sports、Music、Movies、Kids、Religious 等），就必须翻译，needsTranslation 为 true；其中的品牌、台标缩写、数字原样保留在译文里。例："3ABN Russia" → "3ABN 俄罗斯"，"CBC News Network" → "CBC 新闻网"，"15+ Music" → "15+ 音乐"。',
  '2. 只有整个名称完全由品牌名、字母缩写或代号组成、没有任何可翻译的词时（如 "CNN"、"3sat"、"RTL"），needsTranslation 才为 false，translation 为空字符串。拿不准时按需要翻译处理。',
  '3. 输入项带 "mustTranslate": true 时必须翻译，needsTranslation 一律为 true，不能返回 false。',
  '4. 清晰度和各类标注必须原样保留在译文末尾，不得删除、翻译或改写，例如 (1080p)、(720p)、(576p)、HD、FHD、4K、[Geo-blocked]、[Not 24/7]、Ⓢ、Ⓖ、Ⓥ。例："CBC News Network (1080p)" → "CBC 新闻网 (1080p)"，"CT-N Live Stream 2 (360p) [Not 24/7]" → "CT-N 直播流 2 (360p) [Not 24/7]"。',
  '5. 不要编造内容，不要输出解释。',
  '只返回 JSON：{"items":[{"id":"1","needsTranslation":true,"translation":"新闻"}]}，每个输入 id 恰好对应一项。',
].join('\n');

/** 接口／传输错误：网络、超时、非 2xx、HTML、外层非标准结构。 */
export class TranslationTransportError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.name = 'TranslationTransportError';
    this.status = status;
  }
}

/** 根地址或包含 /v1 的地址，规范化后只追加一次 /chat/completions。 @param {string} baseUrl */
export function buildChatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed))
    throw new Error('baseUrl 必须以 http(s):// 开头');
  return /\/chat\/completions$/i.test(trimmed)
    ? trimmed
    : `${trimmed}/chat/completions`;
}

/** DeepSeek 扩展字段只发给 DeepSeek 主机。 @param {string} baseUrl */
export function isDeepSeekBaseUrl(baseUrl) {
  try {
    const host = new URL(
      buildChatCompletionsUrl(baseUrl),
    ).hostname.toLowerCase();
    return host === 'deepseek.com' || host.endsWith('.deepseek.com');
  } catch {
    return false;
  }
}

/** 深度思考默认开启；配置显式关闭时才关闭。 @param {{ thinking?: boolean }} config */
export function isThinkingEnabled(config) {
  return config.thinking !== false;
}

/**
 * @param {{ baseUrl: string, model: string, thinking?: boolean }} config
 * @param {{ id: string, text: string }[]} items
 */
export function buildTranslationRequestBody(config, items) {
  /** @type {Record<string, unknown>} */
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          items: items.map((item) =>
            item.mustTranslate
              ? { id: item.id, text: item.text, mustTranslate: true }
              : { id: item.id, text: item.text },
          ),
        }),
      },
    ],
    response_format: { type: 'json_object' },
    stream: false,
  };
  const thinking = isThinkingEnabled(config);
  if (thinking) {
    // 思考过程也占用输出额度；思考模式下 temperature 不生效，不发送。
    body.max_tokens = Math.min(32768, 4096 + items.length * 120);
  } else {
    body.temperature = 0.2;
    body.max_tokens = Math.min(8192, 256 + items.length * 80);
  }
  // thinking 是 DeepSeek 扩展字段，只发给 DeepSeek 主机。
  if (isDeepSeekBaseUrl(config.baseUrl))
    body.thinking = { type: thinking ? 'enabled' : 'disabled' };
  return body;
}

/**
 * 校验外层 Chat Completions 响应；失败抛出接口级错误。
 * @param {number} status @param {string} text
 * @returns {{ content: string, truncated: boolean }}
 */
export function parseChatCompletionResponse(status, text) {
  if (status < 200 || status >= 300) {
    let detail = '';
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message || parsed?.message || '';
    } catch {
      detail = '';
    }
    throw new TranslationTransportError(
      `模型接口 HTTP ${status}${detail ? `：${String(detail).slice(0, 200)}` : ''}`,
      status,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TranslationTransportError(
      /^\s*</.test(text)
        ? '模型接口返回了 HTML，非标准响应'
        : '模型接口返回非 JSON 响应',
      status,
    );
  }
  const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : null;
  const message = choice?.message;
  if (!choice || !message || typeof message !== 'object')
    throw new TranslationTransportError(
      '模型响应缺少 choices/message 结构',
      status,
    );
  if (
    message.content !== null &&
    message.content !== undefined &&
    typeof message.content !== 'string'
  )
    throw new TranslationTransportError(
      '模型响应 message.content 类型错误',
      status,
    );
  return {
    content: typeof message.content === 'string' ? message.content : '',
    truncated: choice.finish_reason === 'length',
  };
}

/**
 * 解析并校验 message.content（内容级）。服务端按 id 找回原文，不依赖顺序；未知 id 丢弃。
 * @param {string} content
 * @param {Map<string, string>} idToText
 * @returns {{
 *   results: Map<string, { kind: 'success', translation: string } | { kind: 'no_need' } | { kind: 'fail', error: string }>,
 *   protocolErrors: string[]
 * }}
 */
export function parseTranslationContent(
  content,
  idToText,
  truncated = false,
  mustTranslateIds = new Set(),
) {
  /** @type {Map<string, any>} */
  const results = new Map();
  /** @type {string[]} */
  const protocolErrors = [];
  const failAll = (/** @type {string} */ error) => {
    idToText.forEach((_, id) => results.set(id, { kind: 'fail', error }));
    return { results, protocolErrors: [error] };
  };
  const raw = String(content || '').trim();
  if (!raw) return failAll('模型返回空内容');
  const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return failAll(
      truncated ? '模型输出被截断，JSON 不完整' : '模型输出不是合法 JSON',
    );
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) return failAll('模型输出缺少 items 数组');

  /** @type {Map<string, any>} */
  const seen = new Map();
  const conflicted = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      protocolErrors.push('items 中存在非对象项');
      continue;
    }
    const id = typeof item.id === 'number' ? String(item.id) : item.id;
    if (typeof id !== 'string' || !idToText.has(id)) {
      protocolErrors.push(`未知 id：${String(item.id).slice(0, 40)}`);
      continue;
    }
    /** @type {any} */
    let result;
    if (typeof item.needsTranslation !== 'boolean') {
      result = { kind: 'fail', error: '缺少 needsTranslation 标记' };
    } else if (!item.needsTranslation && mustTranslateIds.has(id)) {
      result = { kind: 'fail', error: '已标记必须翻译，但模型返回无需翻译' };
    } else if (!item.needsTranslation) {
      result = { kind: 'no_need' };
    } else if (
      typeof item.translation !== 'string' ||
      !item.translation.trim()
    ) {
      result = { kind: 'fail', error: '需要翻译但译文为空' };
    } else if (!hasHanCharacter(item.translation)) {
      // 声称需要翻译却原样返回（没有任何中文）：视为没有翻译，不保存为成功。
      result = mustTranslateIds.has(id)
        ? { kind: 'fail', error: '已标记必须翻译，但译文没有中文' }
        : { kind: 'no_need' };
    } else if (item.translation.trim().length > MAX_TRANSLATION_LENGTH) {
      result = { kind: 'fail', error: '译文过长' };
    } else {
      // 模型漏掉的清晰度、地区限制等标注从原文补回。
      result = {
        kind: 'success',
        translation: restoreTechnicalTags(
          /** @type {string} */ (idToText.get(id)),
          item.translation.trim(),
        ),
      };
    }
    const previous = seen.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(result)) {
      conflicted.add(id);
      protocolErrors.push(`重复 id 且结果冲突：${id}`);
    }
    seen.set(id, result);
  }
  idToText.forEach((_, id) => {
    if (conflicted.has(id))
      results.set(id, { kind: 'fail', error: '重复 id 且结果冲突' });
    else if (seen.has(id)) results.set(id, seen.get(id));
    else
      results.set(id, {
        kind: 'fail',
        error: truncated ? '模型输出被截断，漏项' : '模型漏项',
      });
  });
  return { results, protocolErrors };
}
