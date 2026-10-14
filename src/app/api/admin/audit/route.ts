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
 * GET /api/admin/audit                         -> 所有用户及其审计条数（含已删除但有审计数据的用户）
 * GET /api/admin/audit?[username=x&]type=play  -> 播放审计（不传 username 为全部用户）
 * GET /api/admin/audit?[username=x&]type=search&offset=0&limit=50 -> 搜索审计分页（同上）
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

    if (type === 'play') {
      // 不传 username 时返回全部用户的播放审计，按最近观看时间倒序
      const names = username ? [username] : await db.getAuditUsers();
      const groups = await Promise.all(
        names.map(async (name) =>
          (await db.getPlayAudits(name)).map((entry) => ({
            ...entry,
            username: name,
          })),
        ),
      );
      const items = groups
        .flat()
        .sort((a, b) => (b.last_play_time || 0) - (a.last_play_time || 0));
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
      if (username) {
        const result = await db.getSearchAudits(username, offset, limit);
        return NextResponse.json(
          {
            total: result.total,
            items: result.items.map((entry) => ({ ...entry, username })),
          },
          { headers: NO_STORE },
        );
      }

      // 全部用户：每个用户各取前 offset+limit 条，合并按时间倒序后再分页
      const names = await db.getAuditUsers();
      const results = await Promise.all(
        names.map(async (name) => {
          const result = await db.getSearchAudits(name, 0, offset + limit);
          return {
            total: result.total,
            items: result.items.map((entry) => ({ ...entry, username: name })),
          };
        }),
      );
      const total = results.reduce((sum, result) => sum + result.total, 0);
      const items = results
        .flatMap((result) => result.items)
        .sort((a, b) => b.time - a.time)
        .slice(offset, offset + limit);
      return NextResponse.json({ total, items }, { headers: NO_STORE });
    }

    if (type) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const [auditUsers, config] = await Promise.all([
      db.getAuditUsers(),
      getConfig(),
    ]);
    const existing = new Set(
      config.UserConfig.Users.map((user) => user.username),
    );
    if (process.env.USERNAME) existing.add(process.env.USERNAME);
    const audited = new Set(auditUsers);

    // 列出所有现有用户（包括还没有审计数据的）以及已删除但仍有审计数据的用户
    const names = Array.from(new Set([...existing, ...auditUsers])).sort(
      (a, b) => a.localeCompare(b),
    );
    const users = await Promise.all(
      names.map(async (name) => {
        if (!audited.has(name)) {
          return {
            username: name,
            playCount: 0,
            searchCount: 0,
            deleted: false,
          };
        }
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
  } catch (error) {
    console.error('获取审计日志失败', error);
    return NextResponse.json(
      { error: '获取审计日志失败' },
      { status: 500, headers: NO_STORE },
    );
  }
}
