import { NextRequest } from 'next/server';

import {
  jsonNoStore,
  paginate,
  parsePaging,
  requireAdmin,
} from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import { peekLiveChannels } from '@/lib/live';
import {
  collectChannelTexts,
  getSharedTranslationFile,
  getTranslationWorker,
  isTranslationBackgroundSupported,
  translationKv as kv,
} from '@/lib/translation/store';
import {
  editItem,
  getActiveLlmId,
  getWorkerState,
  listAllItems,
  rekeyItem,
  resetItem,
} from '@/lib/translation/store-core.mjs';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);

  if (searchParams.get('view') === 'status') {
    const [worker, shared, activeId] = await Promise.all([
      getWorkerState(kv),
      getSharedTranslationFile().status(),
      getActiveLlmId(kv),
    ]);
    return jsonNoStore({
      backgroundSupported: isTranslationBackgroundSupported(),
      worker,
      shared,
      activeId,
    });
  }

  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const status = searchParams.get('status') || '';
  const needs = searchParams.get('needs') || '';
  const { page, pageSize } = parsePaging(searchParams);
  const all = await listAllItems(kv);
  const counts: Record<string, number> = {};
  all.forEach((item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
  });
  const filtered = all
    .filter(
      (item) =>
        (!q ||
          item.text.toLowerCase().includes(q) ||
          item.translation.toLowerCase().includes(q)) &&
        (!status || item.status === status) &&
        (!needs || item.needsTranslation === needs),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return jsonNoStore({ ...paginate(filtered, page, pageSize), counts });
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
        await getSharedTranslationFile().append([
          {
            text: item.text,
            translation: item.translation,
            needsTranslation: item.status === 'success',
          },
        ]);
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
      case 'run_now': {
        getTranslationWorker().wake();
        return jsonNoStore({ ok: true });
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
