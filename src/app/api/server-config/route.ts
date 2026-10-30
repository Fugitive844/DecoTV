/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { resolveAdultFilter } from '@/lib/adult-filter';
import { normalizeApkDownloadUrl } from '@/lib/apk-download';
import { getAuthMode, isPublicAdminAllowed } from '@/lib/auth-mode';
import { getConfig } from '@/lib/config';
import { CURRENT_VERSION } from '@/lib/version';
import {
  buildResolutionFilterFromSearchParams,
  formatResolutionLabel,
} from '@/lib/video-quality';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  console.log('server-config called: ', request.url);

  const { searchParams } = new URL(request.url);
  const config = await getConfig();

  const resolutionFilter = buildResolutionFilterFromSearchParams(searchParams);
  // 总开关关闭过滤且 URL 带有效访问秘钥 ak 时才不过滤；字段名保持不变（APK 依赖）。
  const adultFilterEnabled = await resolveAdultFilter(
    searchParams,
    config.SiteConfig.DisableYellowFilter,
  );

  const result = {
    ApkDownloadUrl:
      normalizeApkDownloadUrl(config.SiteConfig.ApkDownloadUrl) || '',
    SiteName: config.SiteConfig.SiteName,
    StorageType: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    AuthMode: getAuthMode(),
    PublicAllowAdmin: isPublicAdminAllowed(),
    Version: CURRENT_VERSION,
    EnableRegistration: config.UserConfig.RegistrationEnabled,
    // 🔒 成人内容过滤状态（新增）
    AdultFilterEnabled: adultFilterEnabled,
    // 🖼️ 登录页面背景图
    LoginBackground:
      config.SiteConfig.LoginBackground ||
      'https://pan.yyds.nyc.mn/background.png',
    PrivateLibraryEnabled: Boolean(
      config.PrivateLibraryConfig?.connectors?.some((item) => item.enabled),
    ),
    SearchResultLoadMode:
      config.SiteConfig.SearchResultLoadMode === 'pagination'
        ? 'pagination'
        : 'infinite',
    MinResolution: resolutionFilter.minLevel
      ? formatResolutionLabel(resolutionFilter.minLevel)
      : '',
    ResolutionFilterStrict: resolutionFilter.strict,
    // 提供说明信息
    AdultFilterInfo: {
      enabled: adultFilterEnabled,
      source: searchParams.get('ak') ? 'access_key' : 'global_config',
      message: adultFilterEnabled
        ? '成人内容过滤已启用（家庭安全模式）'
        : '成人内容过滤已禁用（完整内容模式）',
    },
  };
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
