'use client';

import { createContext, ReactNode, useContext } from 'react';

import { normalizeApkDownloadUrl } from '@/lib/apk-download';

const SiteContext = createContext<{
  siteName: string;
  announcement?: string;
  apkDownloadUrl?: string;
}>({
  // 默认值
  siteName: 'DecoTV',
  announcement:
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
});

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName,
  announcement,
  apkDownloadUrl,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
  apkDownloadUrl?: string;
}) {
  return (
    <SiteContext.Provider
      value={{
        siteName,
        announcement,
        apkDownloadUrl: normalizeApkDownloadUrl(apkDownloadUrl) || '',
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}
