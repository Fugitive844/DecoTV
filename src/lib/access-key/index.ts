import { db } from '@/lib/db';

import { createAccessKeyValidator, shouldShowAdult } from './store-core.mjs';

// DbManager 实现了 store-core 需要的通用键值原语。
export const accessKeyKv = db;

const globalAccessKey = globalThis as typeof globalThis & {
  __decotvAccessKeyValidator?: ReturnType<typeof createAccessKeyValidator>;
};

export function getAccessKeyValidator() {
  return (globalAccessKey.__decotvAccessKeyValidator ??=
    createAccessKeyValidator(accessKeyKv));
}

/** 访问秘钥统一通过 URL 参数 ak 传递（Web、APK、TVBox 一致）。 */
export function getRequestAccessKey(searchParams: URLSearchParams): string {
  return searchParams.get('ak') || '';
}

/**
 * 请求是否放行：秘钥有效，或后台启用了空秘钥。
 * strict 为 true 时只校验秘钥本身（登录页、设置页提示用）。
 * 校验失败（数据库异常等）一律按无效处理。
 */
export async function isAccessKeyValid(
  value: string,
  strict = false,
): Promise<boolean> {
  try {
    const validator = getAccessKeyValidator();
    return strict
      ? await validator.validateKey(value)
      : await validator.validate(value);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('校验访问秘钥失败:', error);
    return false;
  }
}

/** 是否展示成人内容：后台总开关关闭过滤，且请求带有效访问秘钥。 */
export async function canShowAdult(
  searchParams: URLSearchParams,
  disableYellowFilter: boolean | undefined,
): Promise<boolean> {
  if (disableYellowFilter !== true) return false;
  return shouldShowAdult({
    disableYellowFilter,
    keyValid: await isAccessKeyValid(getRequestAccessKey(searchParams)),
  });
}
