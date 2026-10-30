import { canShowAdult } from '@/lib/access-key';

/**
 * 是否过滤成人内容。只有后台总开关关闭过滤、且请求 URL 带有效访问秘钥 ak 时才放开；
 * 旧的 adult=1、filter=off 等参数不再单独生效。
 */
export async function resolveAdultFilter(
  searchParams: URLSearchParams,
  disableYellowFilter: boolean | undefined,
): Promise<boolean> {
  return !(await canShowAdult(searchParams, disableYellowFilter));
}
