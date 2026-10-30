import { NextRequest } from 'next/server';

import { accessKeyKv as kv, getAccessKeyValidator } from '@/lib/access-key';
import {
  createAccessKeys,
  deleteAccessKeys,
  isEmptyKeyEnabled,
  listAccessKeys,
  setEmptyKeyEnabled,
  updateAccessKeys,
} from '@/lib/access-key/store-core.mjs';
import {
  jsonNoStore,
  paginate,
  parsePaging,
  requireAdmin,
} from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const { page, pageSize } = parsePaging(searchParams);
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const enabled = searchParams.get('enabled') || '';
  const all = await listAccessKeys(kv);
  const filtered = all.filter(
    (item) =>
      (!q ||
        item.key.toLowerCase().includes(q) ||
        item.remark.toLowerCase().includes(q)) &&
      (!enabled || String(item.enabled) === enabled),
  );
  return jsonNoStore({
    ...paginate(filtered, page, pageSize),
    counts: {
      all: all.length,
      enabled: all.filter((item) => item.enabled).length,
    },
    emptyKeyEnabled: await isEmptyKeyEnabled(kv),
  });
}

const toKeys = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const now = Date.now();
    switch (body.action) {
      case 'generate': {
        const items = await createAccessKeys(
          kv,
          Number(body.count),
          String(body.remark || ''),
          now,
        );
        return jsonNoStore({ ok: true, items });
      }
      case 'toggle': {
        if (typeof body.enabled !== 'boolean')
          return jsonNoStore({ error: '缺少启用状态' }, { status: 400 });
        const result = await updateAccessKeys(
          kv,
          toKeys(body.keys),
          { enabled: body.enabled },
          now,
        );
        // 停用立即生效，不等校验缓存过期。
        getAccessKeyValidator().invalidate();
        return jsonNoStore({ ok: true, ...result });
      }
      case 'edit_remark': {
        const result = await updateAccessKeys(
          kv,
          toKeys(body.keys),
          { remark: String(body.remark || '') },
          now,
        );
        return jsonNoStore({ ok: true, ...result });
      }
      case 'toggle_empty': {
        // 空秘钥：启用后不填秘钥的用户也能看到（仍需总开关关闭过滤）。
        await setEmptyKeyEnabled(kv, body.enabled === true);
        getAccessKeyValidator().invalidate();
        return jsonNoStore({
          ok: true,
          emptyKeyEnabled: body.enabled === true,
        });
      }
      case 'delete': {
        const deleted = await deleteAccessKeys(kv, toKeys(body.keys));
        getAccessKeyValidator().invalidate();
        return jsonNoStore({ ok: true, deleted });
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
