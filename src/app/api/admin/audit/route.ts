/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;

function parseNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * GET /api/admin/audit                         -> 有审计数据的用户列表
 * GET /api/admin/audit?username=x&type=play    -> 该用户的播放审计
 * GET /api/admin/audit?username=x&type=search&offset=0&limit=50 -> 搜索审计分页
 *
 * 仅站长可访问。只读接口，不产生任何记录。
 */
export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);

  // 本地模式下记录保存在浏览器，服务端无审计数据
  if (authResult.isLocalMode) {
    return NextResponse.json(
      { storageMode: 'local', users: [] },
      { headers: NO_STORE },
    );
  }

  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authResult.isOwner) {
    return NextResponse.json(
      { error: '权限不足，只有站长可以查看审计日志' },
      { status: 403 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username')?.trim();
    const type = searchParams.get('type');

    if (!username) {
      const [auditUsers, config] = await Promise.all([
        db.getAuditUsers(),
        getConfig(),
      ]);
      const existing = new Set(
        config.UserConfig.Users.map((user) => user.username),
      );
      if (process.env.USERNAME) existing.add(process.env.USERNAME);

      const users = await Promise.all(
        auditUsers.sort().map(async (name) => {
          const [plays, searches] = await Promise.all([
            db.getPlayAudits(name),
            db.getSearchAudits(name, 0, 0),
          ]);
          return {
            username: name,
            playCount: plays.length,
            searchCount: searches.total,
            deleted: !existing.has(name),
          };
        }),
      );

      return NextResponse.json(
        { storageMode: 'cloud', users },
        { headers: NO_STORE },
      );
    }

    if (type === 'play') {
      const items = await db.getPlayAudits(username);
      return NextResponse.json(
        { total: items.length, items },
        { headers: NO_STORE },
      );
    }

    if (type === 'search') {
      const offset = parseNonNegativeInt(searchParams.get('offset'), 0);
      const limit = Math.min(
        parseNonNegativeInt(searchParams.get('limit'), DEFAULT_SEARCH_LIMIT),
        MAX_SEARCH_LIMIT,
      );
      const result = await db.getSearchAudits(username, offset, limit);
      return NextResponse.json(result, { headers: NO_STORE });
    }

    return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
  } catch (error) {
    console.error('获取审计日志失败', error);
    return NextResponse.json(
      { error: '获取审计日志失败' },
      { status: 500, headers: NO_STORE },
    );
  }
}
