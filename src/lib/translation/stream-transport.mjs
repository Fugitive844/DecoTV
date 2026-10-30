import {
  parseChatCompletionResponse,
  TranslationTransportError,
} from './protocol.mjs';
import { createSseParser } from './sse.mjs';

/** Stream one model request; never retry a paid request automatically. */
export async function postStreamingCompletion(
  url,
  headers,
  body,
  timeoutMs,
  onEvent,
  signal,
  fetchImpl = fetch,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body,
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('text/event-stream')
  ) {
    const text = await response.text();
    const outer = parseChatCompletionResponse(response.status, text);
    const message = JSON.parse(text).choices[0].message;
    const reasoning = message.reasoning_content || message.reasoning;
    if (typeof reasoning === 'string')
      onEvent({ type: 'reasoning', delta: reasoning });
    if (outer.content) onEvent({ type: 'content', delta: outer.content });
    return outer;
  }
  if (!response.body) throw new TranslationTransportError('模型响应没有数据流');
  onEvent({ type: 'status', message: '模型已连接，等待思考与回复…' });
  let content = '';
  let size = 0;
  let truncated = false;
  let finished = false;
  let doneMarker = false;
  const parser = createSseParser((data) => {
    if (data.trim() === '[DONE]') {
      doneMarker = true;
      return;
    }
    if (doneMarker) return;
    let frame;
    try {
      frame = JSON.parse(data);
    } catch {
      throw new TranslationTransportError('模型返回非法流式 JSON');
    }
    if (frame.error)
      throw new TranslationTransportError(
        String(frame.error.message || '模型流式接口错误'),
      );
    const choice =
      frame.choices?.find((item) => item.index === 0) || frame.choices?.[0];
    if (!choice) return; // usage-only frame
    if (choice.finish_reason) {
      finished = true;
      truncated = choice.finish_reason === 'length';
    }
    const delta = choice.delta || {};
    for (const [key, type] of [
      ['reasoning_content', 'reasoning'],
      ['content', 'content'],
    ]) {
      const value =
        key === 'reasoning_content'
          ? (delta.reasoning_content ?? delta.reasoning)
          : delta[key];
      if (typeof value !== 'string' || !value) continue;
      size += value.length;
      if (size > 1_000_000)
        throw new TranslationTransportError('模型流式输出过长');
      if (type === 'content') content += value;
      onEvent({ type, delta: value });
    }
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (!doneMarker) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
    if (!finished && !doneMarker)
      throw new TranslationTransportError('模型数据流意外中断');
    return { content, truncated };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
