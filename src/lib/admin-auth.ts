import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export type AdminAuthResult =
  | { ok: true; username: string; isOwner: boolean; isLocalMode: boolean }
  | { ok: false; response: NextResponse };

// 管理区接口统一的服务端权限校验：站长或未被封禁的管理员。
export async function requireAdmin(
  request: NextRequest,
  options: { ownerOnly?: boolean } = {},
): Promise<AdminAuthResult> {
  const auth = verifyApiAuth(request);
  if (!auth.isValid)
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  if (auth.isOwner || auth.username === process.env.USERNAME)
    return {
      ok: true,
      username: auth.username || '',
      isOwner: true,
      isLocalMode: auth.isLocalMode,
    };
  if (options.ownerOnly)
    return {
      ok: false,
      response: NextResponse.json({ error: '仅站长可操作' }, { status: 401 }),
    };
  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (item) => item.username === auth.username,
  );
  if (!user || user.role !== 'admin' || user.banned)
    return {
      ok: false,
      response: NextResponse.json({ error: '权限不足' }, { status: 401 }),
    };
  return {
    ok: true,
    username: auth.username || '',
    isOwner: false,
    isLocalMode: auth.isLocalMode,
  };
}

export function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, {
    status: init.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function parsePaging(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const requested = Number(searchParams.get('pageSize')) || 50;
  const pageSize = [20, 50, 100].includes(requested) ? requested : 50;
  return { page, pageSize };
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { total, page, pageSize, items: items.slice(start, start + pageSize) };
}
