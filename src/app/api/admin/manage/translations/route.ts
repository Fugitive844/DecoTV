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
  getTranslationWorker,
  isTranslationBackgroundSupported,
  translationKv as kv,
} from '@/lib/translation/store';
import {
  batchUpdateItems,
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
    const [worker, activeId] = await Promise.all([
      getWorkerState(kv),
      getActiveLlmId(kv),
    ]);
    return jsonNoStore({
      backgroundSupported: isTranslationBackgroundSupported(),
      worker,
      activeId,
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
