/**
 * OpenAI 兼容 Chat Completions 批量翻译协议：请求构造、外层校验（接口级错误）
 * 与内容校验（内容级错误）。纯函数。
 */
import { URL } from 'node:url';

export const MAX_SOURCE_TEXT_LENGTH = 200;
export const MAX_TRANSLATION_LENGTH = 200;

export const SYSTEM_PROMPT = [
  '你是直播频道名称翻译器。把用户给出的每个频道名或频道分类名翻译成简体中文。',
  '保留品牌、地区、数字、清晰度（如 HD、4K、FHD）等信息；不要编造，不要输出解释。',
  '如果某项无需翻译（如纯品牌缩写、纯数字、已是通用写法），needsTranslation 设为 false，translation 为空字符串。',
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

/**
 * @param {{ baseUrl: string, model: string }} config
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
          items: items.map((item) => ({ id: item.id, text: item.text })),
        }),
      },
    ],
    response_format: { type: 'json_object' },
    stream: false,
    temperature: 0.2,
    max_tokens: Math.min(8192, 256 + items.length * 80),
  };
  // 默认关闭深度思考：DeepSeek 默认开启，需显式关闭。
  if (isDeepSeekBaseUrl(config.baseUrl)) body.thinking = { type: 'disabled' };
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
export function parseTranslationContent(content, idToText, truncated = false) {
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
    } else if (!item.needsTranslation) {
      result = { kind: 'no_need' };
    } else if (
      typeof item.translation !== 'string' ||
      !item.translation.trim()
    ) {
      result = { kind: 'fail', error: '需要翻译但译文为空' };
    } else if (item.translation.trim().length > MAX_TRANSLATION_LENGTH) {
      result = { kind: 'fail', error: '译文过长' };
    } else {
      result = { kind: 'success', translation: item.translation.trim() };
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
