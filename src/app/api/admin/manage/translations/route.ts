import { NextRequest } from 'next/server';

import {
  jsonNoStore,
  paginate,
  parsePaging,
  requireAdmin,
} from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import { peekLiveChannels } from '@/lib/live';
import { manualProgressKey } from '@/lib/translation/manual-progress.mjs';
import { SYSTEM_PROMPT } from '@/lib/translation/protocol.mjs';
import {
  collectChannelTexts,
  getTranslationWorker,
  isTranslationBackgroundSupported,
  translationKv as kv,
} from '@/lib/translation/store';
import {
  batchUpdateItems,
  editItem,
  getActiveLlmId,
  getManualTranslationJob,
  getTranslationPrompt,
  getWorkerState,
  isAutomaticTranslationEnabled,
  listAllItems,
  rekeyItem,
  resetItem,
  setAutomaticTranslationEnabled,
  setTranslationPrompt,
} from '@/lib/translation/store-core.mjs';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);

  if (searchParams.get('view') === 'status') {
    const [worker, activeId, automaticEnabled, manualJob, prompt] =
      await Promise.all([
        getWorkerState(kv),
        getActiveLlmId(kv),
        isAutomaticTranslationEnabled(kv),
        getManualTranslationJob(kv),
        getTranslationPrompt(kv),
      ]);
    return jsonNoStore({
      backgroundSupported: isTranslationBackgroundSupported(),
      worker,
      activeId,
      automaticEnabled,
      systemPrompt: prompt || SYSTEM_PROMPT,
      defaultSystemPrompt: SYSTEM_PROMPT,
      manualTask: manualJob
        ? {
            total: manualJob.texts?.length ?? 100,
            completed: manualJob.completed,
            nextBatch: manualJob.texts === null,
          }
        : null,
    });
  }

  const { page, pageSize } = parsePaging(searchParams);
  const all = await listAllItems(kv);
  const counts: Record<string, number> = {};
  all.forEach((item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
  });
  const filtered = filterItems(all, {
    q: searchParams.get('q') || '',
    status: searchParams.get('status') || '',
    needs: searchParams.get('needs') || '',
  }).sort(
    (a, b) =>
      b.updatedAt - a.updatedAt ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
  return jsonNoStore({ ...paginate(filtered, page, pageSize), counts });
}

interface ItemFilter {
  q?: string;
  status?: string;
  needs?: string;
}

// 列表查询与「全选筛选结果」批量修改共用同一套筛选条件。
function filterItems<
  T extends {
    text: string;
    translation: string;
    status: string;
    needsTranslation: string;
  },
>(items: T[], filter: ItemFilter) {
  const q = (filter.q || '').trim().toLowerCase();
  return items.filter(
    (item) =>
      (!q ||
        item.text.toLowerCase().includes(q) ||
        item.translation.toLowerCase().includes(q)) &&
      (!filter.status || item.status === filter.status) &&
      (!filter.needs || item.needsTranslation === filter.needs),
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const text = typeof body.text === 'string' ? body.text : '';
    const now = Date.now();
    switch (body.action) {
      case 'edit': {
        const needsTranslation =
          body.needsTranslation === 'no' ? 'no' : ('yes' as const);
        const item = await editItem(
          kv,
          text,
          { translation: body.translation, needsTranslation },
          now,
        );
        return jsonNoStore({ ok: true, item });
      }
      case 'rekey': {
        const item = await rekeyItem(kv, text, body.newText, now);
        return jsonNoStore({ ok: true, item });
      }
      case 'reset': {
        const item = await resetItem(kv, text, now);
        getTranslationWorker().wake();
        return jsonNoStore({ ok: true, item });
      }
      case 'translate_once': {
        if (body.stream === true) return streamManualTranslation(request, text);
        const item = await getTranslationWorker().translateOnce(text);
        return jsonNoStore({ ok: true, item });
      }
      case 'collect_history': {
        const config = await getConfig();
        let sources = 0;
        let created = 0;
        for (const source of config.LiveConfig || []) {
          const cache = await peekLiveChannels(source);
          if (!cache) continue;
          sources++;
          created += await collectChannelTexts(cache);
        }
        getTranslationWorker().wake();
        return jsonNoStore({ ok: true, sources, created });
      }
      case 'batch_update': {
        // texts：勾选的记录；filter：按当前筛选条件选中全部结果。
        let texts: string[] = [];
        if (Array.isArray(body.texts)) texts = body.texts.map(String);
        else if (body.filter && typeof body.filter === 'object')
          texts = filterItems(
            await listAllItems(kv),
            body.filter as ItemFilter,
          ).map((item) => item.text);
        if (texts.length === 0)
          return jsonNoStore({ error: '没有选中任何记录' }, { status: 400 });
        const needs = ['unknown', 'yes', 'no'].includes(
          String(body.needsTranslation),
        )
          ? (body.needsTranslation as 'unknown' | 'yes' | 'no')
          : undefined;
        const status =
          typeof body.status === 'string' && body.status
            ? body.status
            : undefined;
        const result = await batchUpdateItems(
          kv,
          texts,
          { needsTranslation: needs, status },
          now,
        );
        getTranslationWorker().wake();
        return jsonNoStore({ ok: true, total: texts.length, ...result });
      }
      case 'run_now': {
        if (!isTranslationBackgroundSupported())
          throw new Error('无数据库模式，不支持后台手动翻译');
        const job = await getTranslationWorker().requestManualTranslation();
        if (body.stream === true)
          return streamQueuedTranslation(request, job.id);
        return jsonNoStore({ ok: true, queued: true });
      }
      case 'set_automatic': {
        if (!isTranslationBackgroundSupported())
          throw new Error('无数据库模式，不支持后台自动翻译');
        if (typeof body.enabled !== 'boolean')
          throw new Error('自动翻译开关必须为布尔值');
        await setAutomaticTranslationEnabled(kv, body.enabled);
        getTranslationWorker().wake();
        return jsonNoStore({ ok: true, automaticEnabled: body.enabled });
      }
      case 'set_prompt': {
        if (body.useDefault === true) await setTranslationPrompt(kv, null);
        else {
          if (typeof body.prompt !== 'string') throw new Error('请填写提示词');
          await setTranslationPrompt(kv, body.prompt);
        }
        return jsonNoStore({ ok: true });
      }
      case 'translate_batch': {
        if (!isTranslationBackgroundSupported())
          throw new Error('无数据库模式，不支持后台手动翻译');
        let texts: string[] = [];
        if (Array.isArray(body.texts)) texts = body.texts.map(String);
        else if (body.filter && typeof body.filter === 'object')
          texts = filterItems(
            await listAllItems(kv),
            body.filter as ItemFilter,
          ).map((item) => item.text);
        const job =
          await getTranslationWorker().requestManualTranslation(texts);
        if (body.stream === true)
          return streamQueuedTranslation(request, job.id);
        return jsonNoStore({
          ok: true,
          queued: true,
          total: job.texts?.length ?? 0,
        });
      }
      default:
        return jsonNoStore({ error: '未知操作' }, { status: 400 });
    }
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 400 },
    );
  }
}

// POST + SSE avoids putting source text in a URL; the existing admin check runs first.
function streamManualTranslation(request: NextRequest, text: string) {
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  request.signal.addEventListener('abort', disconnect, { once: true });
  if (request.signal.aborted) disconnect();
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (closed || abort.signal.aborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
          disconnect();
        }
      };
      const heartbeat = setInterval(() => send({ type: 'ping' }), 15_000);
      try {
        send({ type: 'status', message: '后端已收到手动翻译请求' });
        const item = await getTranslationWorker().translateOnce(text, {
          onEvent: send,
          signal: abort.signal,
        });
        send({ type: 'complete', item, message: '翻译完成，结果已保存' });
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : '手动翻译失败',
        });
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener('abort', disconnect);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      disconnect();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

// The browser receives SSE only; journal polling stays on the server and never reloads the cache table.
function streamQueuedTranslation(request: NextRequest, id: string) {
  let closed = false;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let close: () => void = () => {};
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        request.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          /* response was already cancelled */
        }
      };
      request.signal.addEventListener('abort', close, { once: true });
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          close();
        }
      };
      send({ type: 'status', message: '手动任务已入队，等待后台串行处理…' });
      let ticks = 0;
      const poll = async () => {
        if (closed) return;
        try {
          const raw = await kv.kvGet(manualProgressKey(id));
          const snapshot = raw ? JSON.parse(raw) : null;
          for (const entry of snapshot?.events || []) {
            if (closed || entry.seq <= cursor) continue;
            cursor = entry.seq;
            send(entry.event);
            if (
              entry.event.type === 'complete' ||
              entry.event.type === 'error'
            ) {
              close();
              return;
            }
          }
          if (++ticks % 40 === 0) send({ type: 'ping' });
          if (ticks > 2400) {
            send({
              type: 'error',
              message: '进度连接已超时，后台任务仍继续，请手动刷新确认',
            });
            close();
            return;
          }
          if (!closed) timer = setTimeout(() => void poll(), 300);
        } catch {
          send({
            type: 'error',
            message: '读取任务进度失败，请手动刷新确认后台结果',
          });
          close();
        }
      };
      if (request.signal.aborted) close();
      else void poll();
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
