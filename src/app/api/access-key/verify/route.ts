import { NextRequest } from 'next/server';

import { getRequestAccessKey, isAccessKeyValid } from '@/lib/access-key';
import { jsonNoStore } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// 登录页、设置页填写访问秘钥时校验；免登录，只返回是否有效。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return jsonNoStore({
    valid: await isAccessKeyValid(getRequestAccessKey(searchParams), true),
  });
}
