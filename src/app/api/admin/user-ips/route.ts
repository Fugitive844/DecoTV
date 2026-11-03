import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getLatestUserIps, getUserIpHistory } from '@/lib/user-ip-history';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const auth = verifyApiAuth(request);
  if (!auth.isValid || !auth.username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.isLocalMode)
    return NextResponse.json({ latest: {}, items: [], total: 0 }, { headers });
  try {
    const config = await getConfig();
    const operator = config.UserConfig.Users.find(
      (user) => user.username === auth.username,
    );
    if (
      !auth.isOwner &&
      (!operator || operator.banned || operator.role !== 'admin')
    ) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }
    const permitted = config.UserConfig.Users.filter(
      (user) =>
        auth.isOwner || user.role === 'user' || user.username === auth.username,
    ).map((user) => user.username);
    if (auth.isOwner && !permitted.includes(auth.username))
      permitted.push(auth.username);
    const username = request.nextUrl.searchParams.get('username');
    if (username !== null) {
      if (!permitted.includes(username))
        return NextResponse.json({ error: '无权查看该用户' }, { status: 403 });
      const offset = Math.max(
        0,
        Number.parseInt(
          request.nextUrl.searchParams.get('offset') || '0',
          10,
        ) || 0,
      );
      return NextResponse.json(
        await getUserIpHistory(db, username, offset, 50),
        { headers },
      );
    }
    return NextResponse.json(
      { latest: await getLatestUserIps(db, permitted) },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: '读取用户 IP 失败' },
      { status: 500, headers },
    );
  }
}
