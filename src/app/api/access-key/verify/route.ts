import { jsonNoStore } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// 兼容旧版客户端的校验调用：客户端不再校验秘钥，这里始终返回有效。
export async function GET() {
  return jsonNoStore({ valid: true });
}
