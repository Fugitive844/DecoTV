/* eslint-disable no-console */

'use client';

import { ArrowLeft, Bot, Languages, Menu, Tv, Video, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

import LiveSourceDetail from '@/components/admin-manage/LiveSourceDetail';
import LlmConfigPanel from '@/components/admin-manage/LlmConfigPanel';
import {
  LiveSourceConfig,
  VideoSourceConfig,
} from '@/components/admin-manage/SourcePanels';
import TranslationPanel from '@/components/admin-manage/TranslationPanel';
import PageLayout from '@/components/PageLayout';

type Tab = 'llm' | 'video' | 'live' | 'translations';

const MENU: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'llm', label: '大模型配置', icon: <Bot size={18} /> },
  { key: 'video', label: '视频源管理', icon: <Video size={18} /> },
  { key: 'live', label: '直播源管理', icon: <Tv size={18} /> },
  { key: 'translations', label: '翻译缓存', icon: <Languages size={18} /> },
];
const LOCAL_CONFIG_KEY = 'decotv_admin_config';

function ManagePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const tab: Tab = MENU.some((item) => item.key === tabParam)
    ? (tabParam as Tab)
    : 'llm';
  const liveKey = searchParams.get('live');
  const [menuOpen, setMenuOpen] = useState(false);
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [storageMode, setStorageMode] = useState<'cloud' | 'local'>('cloud');
  const [error, setError] = useState('');

  const navigate = useCallback(
    (next: Tab, live?: string) => {
      const params = new URLSearchParams({ tab: next });
      if (live) params.set('live', live);
      router.push(`/admin/manage?${params.toString()}`);
      setMenuOpen(false);
    },
    [router],
  );

  // 源管理沿用原管理面板的配置读取与本地模式同步方式。
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/config', { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) {
        window.location.href = `/login?redirect=${encodeURIComponent('/admin/manage')}`;
        return;
      }
      if (!response.ok) throw new Error(data.error || '获取配置失败');
      const mode = data.storageMode || 'cloud';
      setStorageMode(mode);
      let finalConfig = data.Config as AdminConfig;
      if (mode === 'local') {
        try {
          const stored = localStorage.getItem(LOCAL_CONFIG_KEY);
          if (stored) finalConfig = JSON.parse(stored) as AdminConfig;
        } catch (e) {
          console.error('读取本地配置失败:', e);
        }
      }
      setConfig(finalConfig);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取配置失败');
    }
  }, []);

  useEffect(() => {
    if (tab === 'video' || tab === 'live') void fetchConfig();
  }, [tab, fetchConfig]);

  useEffect(() => {
    if (storageMode !== 'local' || !config) return;
    try {
      localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.error('保存本地配置失败:', e);
    }
    void fetch('/api/admin/config/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }).catch(() => undefined);
  }, [config, storageMode]);

  const refreshConfig = useCallback(async () => {
    await fetchConfig();
    router.refresh();
  }, [fetchConfig, router]);
  const updateConfig = useCallback(
    (updater: (prev: AdminConfig | null) => AdminConfig | null) =>
      setConfig(updater),
    [],
  );

  const current = MENU.find((item) => item.key === tab) || MENU[0];
  const backgroundHint =
    storageMode === 'local' && (tab === 'llm' || tab === 'translations');

  return (
    <PageLayout activePath='/admin'>
      <div className='mx-auto flex w-full max-w-[1600px] gap-4 px-4 py-4 md:px-6'>
        {menuOpen && (
          <div
            className='fixed inset-0 z-30 bg-black/40 md:hidden'
            onClick={() => setMenuOpen(false)}
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 transform bg-white p-3 shadow-lg transition-transform dark:bg-gray-900 md:static md:z-auto md:translate-x-0 md:rounded-xl md:bg-white/80 md:shadow-sm md:dark:bg-gray-800/50 ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className='mb-3 flex items-center justify-between px-2'>
            <a
              href='/admin'
              className='inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            >
              <ArrowLeft size={14} /> 返回管理面板
            </a>
            <button
              className='md:hidden'
              onClick={() => setMenuOpen(false)}
              aria-label='收起菜单'
            >
              <X size={18} />
            </button>
          </div>
          <nav className='space-y-1'>
            {MENU.map((item) => (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  tab === item.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className='min-w-0 flex-1'>
          <div className='mb-4 flex items-center gap-2'>
            <button
              className='rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 md:hidden'
              onClick={() => setMenuOpen(true)}
              aria-label='打开菜单'
            >
              <Menu size={20} />
            </button>
            <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              {current.label}
            </h1>
          </div>
          {backgroundHint && (
            <p className='mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'>
              当前为无数据库模式：无法跨重启持久化，后台翻译任务不会运行。
            </p>
          )}
          {error && (tab === 'video' || tab === 'live') && (
            <p className='mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300'>
              {error}
            </p>
          )}

          {tab === 'llm' && <LlmConfigPanel />}
          {tab === 'translations' && <TranslationPanel />}
          {tab === 'video' && (
            <div className='rounded-xl bg-white/80 p-4 shadow-sm dark:bg-gray-800/50 md:p-6'>
              <VideoSourceConfig
                config={config}
                refreshConfig={refreshConfig}
                storageMode={storageMode}
                updateConfig={updateConfig}
              />
            </div>
          )}
          {tab === 'live' &&
            (liveKey ? (
              <LiveSourceDetail
                sourceKey={liveKey}
                onBack={() => navigate('live')}
              />
            ) : (
              <div className='rounded-xl bg-white/80 p-4 shadow-sm dark:bg-gray-800/50 md:p-6'>
                <LiveSourceConfig
                  config={config}
                  refreshConfig={refreshConfig}
                  storageMode={storageMode}
                  updateConfig={updateConfig}
                  onOpenDetail={
                    storageMode === 'cloud'
                      ? (key) => navigate('live', key)
                      : undefined
                  }
                />
              </div>
            ))}
        </main>
      </div>
    </PageLayout>
  );
}

export default function ManagePage() {
  return (
    <Suspense>
      <ManagePageClient />
    </Suspense>
  );
}
