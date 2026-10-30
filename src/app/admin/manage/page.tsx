/* eslint-disable no-console */
'use client';

import {
  ArrowLeft,
  Bot,
  Cloud,
  Database,
  FileText,
  FolderOpen,
  KeyRound,
  Languages,
  Menu,
  MessageSquareText,
  Package,
  RotateCcw,
  Settings,
  ShieldCheck,
  Tv,
  Users,
  Video,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

import AccessKeyPanel from '@/components/admin-manage/AccessKeyPanel';
import { buttonStyles } from '@/components/admin-manage/admin-shared';
import LiveSourceDetail from '@/components/admin-manage/LiveSourceDetail';
import LlmConfigPanel from '@/components/admin-manage/LlmConfigPanel';
import {
  LiveSourceConfig,
  VideoSourceConfig,
} from '@/components/admin-manage/SourcePanels';
import TranslationPanel from '@/components/admin-manage/TranslationPanel';
import PageLayout from '@/components/PageLayout';

const SiteConfigPanel = dynamic(() =>
  import('@/components/admin-manage/ConfigPanels').then(
    (m) => m.SiteConfigComponent,
  ),
);
const UserConfigPanel = dynamic(() =>
  import('@/components/admin-manage/ConfigPanels').then((m) => m.UserConfig),
);
const ConfigFilePanel = dynamic(() =>
  import('@/components/admin-manage/ConfigPanels').then(
    (m) => m.ConfigFileComponent,
  ),
);
const CategoryConfigPanel = dynamic(() =>
  import('@/components/admin-manage/ConfigPanels').then(
    (m) => m.CategoryConfig,
  ),
);
const DanmuConfigPanel = dynamic(() =>
  import('@/components/admin-manage/ConfigPanels').then(
    (m) => m.DanmuConfigComponent,
  ),
);
const PrivateLibraryPanel = dynamic(() =>
  import('@/components/admin-manage/ConfigPanels').then(
    (m) => m.PrivateLibraryConfigPanel,
  ),
);
const TvboxConfigPanel = dynamic(
  () => import('@/components/admin-manage/TvboxConfigPanel'),
);
const ResetConfigPanel = dynamic(
  () => import('@/components/admin-manage/ResetConfigPanel'),
);
const PanSouConfigPanel = dynamic(
  () => import('@/components/PanSouConfigPanel'),
  { ssr: false },
);
const DataMigration = dynamic(() => import('@/components/DataMigration'));
const AuditLogPanel = dynamic(() => import('@/components/AuditLogPanel'));

type Tab =
  | 'access-keys'
  | 'site'
  | 'users'
  | 'config-file'
  | 'video'
  | 'live'
  | 'llm'
  | 'translations'
  | 'tvbox'
  | 'danmu'
  | 'pansou'
  | 'private-library'
  | 'categories'
  | 'migration'
  | 'audit'
  | 'reset';
const MENU: {
  key: Tab;
  label: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
}[] = [
  { key: 'site', label: '站点配置', icon: <Settings size={18} /> },
  { key: 'users', label: '用户配置', icon: <Users size={18} /> },
  {
    key: 'config-file',
    label: '配置文件',
    icon: <FileText size={18} />,
    ownerOnly: true,
  },
  { key: 'video', label: '视频源管理', icon: <Video size={18} /> },
  { key: 'live', label: '直播源管理', icon: <Tv size={18} /> },
  { key: 'llm', label: '大模型配置', icon: <Bot size={18} /> },
  { key: 'translations', label: '翻译缓存', icon: <Languages size={18} /> },
  { key: 'access-keys', label: '访问秘钥', icon: <KeyRound size={18} /> },
  { key: 'tvbox', label: 'TVBox 配置', icon: <Package size={18} /> },
  { key: 'danmu', label: '弹幕配置', icon: <MessageSquareText size={18} /> },
  { key: 'pansou', label: 'PanSou 配置', icon: <Cloud size={18} /> },
  { key: 'private-library', label: '私人影库配置', icon: <Video size={18} /> },
  { key: 'categories', label: '分类配置', icon: <FolderOpen size={18} /> },
  {
    key: 'migration',
    label: '数据迁移',
    icon: <Database size={18} />,
    ownerOnly: true,
  },
  {
    key: 'audit',
    label: '审计日志',
    icon: <ShieldCheck size={18} />,
    ownerOnly: true,
  },
  {
    key: 'reset',
    label: '重置配置',
    icon: <RotateCcw size={18} />,
    ownerOnly: true,
  },
];
const LOCAL_CONFIG_KEY = 'decotv_admin_config';

function ManagePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const current = MENU.find((item) => item.key === requested) || MENU[0];
  const tab = current.key;
  const liveKey = searchParams.get('live');
  const [menuOpen, setMenuOpen] = useState(false);
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [storageMode, setStorageMode] = useState<'cloud' | 'local'>('cloud');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const navigate = useCallback(
    (next: Tab, live?: string) => {
      const params = new URLSearchParams({ tab: next });
      if (live) params.set('live', live);
      router.push(`/admin/manage?${params.toString()}`, { scroll: false });
      setMenuOpen(false);
    },
    [router],
  );

  // Load configuration and role once; menu changes do not refresh the page or translation list.
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/config', { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) {
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (!response.ok) throw new Error(data.error || '获取配置失败');
      if (data.Role !== 'owner' && data.Role !== 'admin')
        throw new Error('没有管理权限');
      const mode = data.storageMode || 'cloud';
      setStorageMode(mode);
      let finalConfig = data.Config as AdminConfig;
      if (mode === 'local') {
        try {
          const stored = localStorage.getItem(LOCAL_CONFIG_KEY);
          if (stored) finalConfig = JSON.parse(stored) as AdminConfig;
        } catch (err) {
          console.error('读取本地配置失败:', err);
        }
      }
      setConfig(finalConfig);
      setRole(data.Role);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取配置失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (storageMode !== 'local' || !config) return;
    try {
      localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
    } catch (err) {
      console.error('保存本地配置失败:', err);
    }
    void fetch('/api/admin/config/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }).catch(() => undefined);
  }, [config, storageMode]);

  const updateConfig = useCallback(
    (updater: (prev: AdminConfig | null) => AdminConfig | null) =>
      setConfig(updater),
    [],
  );
  const props = { config, refreshConfig: fetchConfig };
  const sourceProps = { ...props, storageMode, updateConfig };
  const allowed = role !== null && (!current.ownerOnly || role === 'owner');

  const renderPanel = () => {
    switch (tab) {
      case 'access-keys':
        return <AccessKeyPanel />;
      case 'site':
        return (
          <SiteConfigPanel {...props} canManageApkDownload={role === 'owner'} />
        );
      case 'users':
        return (
          <UserConfigPanel {...props} role={role} storageMode={storageMode} />
        );
      case 'config-file':
        return <ConfigFilePanel {...sourceProps} />;
      case 'categories':
        return <CategoryConfigPanel {...props} />;
      case 'danmu':
        return <DanmuConfigPanel {...props} />;
      case 'private-library':
        return <PrivateLibraryPanel {...props} />;
      case 'pansou':
        return <PanSouConfigPanel {...props} />;
      case 'tvbox':
        return <TvboxConfigPanel />;
      case 'migration':
        return <DataMigration onRefreshConfig={fetchConfig} />;
      case 'audit':
        return <AuditLogPanel />;
      case 'reset':
        return <ResetConfigPanel refreshConfig={fetchConfig} />;
      case 'video':
        return <VideoSourceConfig {...sourceProps} />;
      case 'live':
        return liveKey ? (
          <LiveSourceDetail
            sourceKey={liveKey}
            onBack={() => navigate('live')}
          />
        ) : (
          <LiveSourceConfig
            {...sourceProps}
            onOpenDetail={
              storageMode === 'cloud'
                ? (key) => navigate('live', key)
                : undefined
            }
          />
        );
      case 'llm':
        return <LlmConfigPanel />;
      case 'translations':
        return <TranslationPanel />;
    }
  };

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
          id='admin-navigation'
          className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 overflow-y-auto bg-white p-3 shadow-lg transition-transform dark:bg-gray-900 md:sticky md:top-4 md:z-auto md:max-h-[calc(100dvh-2rem)] md:self-start md:rounded-xl md:bg-white/80 md:shadow-sm md:dark:bg-gray-800/50 ${menuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        >
          <div className='mb-3 flex items-center justify-between px-2'>
            <Link
              href='/'
              className='inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            >
              <ArrowLeft size={14} /> 返回首页
            </Link>
            <button
              className='md:hidden'
              onClick={() => setMenuOpen(false)}
              aria-label='收起菜单'
            >
              <X size={18} />
            </button>
          </div>
          <h1 className='mb-3 px-2 text-lg font-semibold text-gray-900 dark:text-gray-100'>
            管理中心
          </h1>
          <nav aria-label='管理中心配置菜单' className='space-y-1'>
            {MENU.filter((item) => !item.ownerOnly || role === 'owner').map(
              (item) => (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  aria-current={tab === item.key ? 'page' : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${tab === item.key ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'}`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ),
            )}
          </nav>
        </aside>
        <main className='min-w-0 flex-1'>
          <div className='mb-4 flex items-center gap-2'>
            <button
              className='rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 md:hidden'
              onClick={() => setMenuOpen(true)}
              aria-label='打开配置菜单'
              aria-expanded={menuOpen}
              aria-controls='admin-navigation'
            >
              <Menu size={20} />
            </button>
            <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              {current.label}
            </h2>
          </div>
          {storageMode === 'local' && (
            <p className='mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'>
              当前为本地存储模式：配置保存在浏览器中，清除浏览器数据后将丢失；后台翻译任务不会运行。
            </p>
          )}
          {loading ? (
            <p role='status' className='p-4 text-sm text-gray-500'>
              正在加载管理配置…
            </p>
          ) : error ? (
            <div
              role='alert'
              className='space-y-3 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300'
            >
              <p>{error}</p>
              <button
                onClick={() => {
                  setLoading(true);
                  void fetchConfig();
                }}
                className={buttonStyles.secondarySmall}
              >
                重试
              </button>
            </div>
          ) : !allowed ? (
            <p role='alert' className='p-4 text-sm text-red-600'>
              此配置仅站长可访问。
            </p>
          ) : (
            <div
              key={tab}
              className='rounded-xl bg-white/80 p-4 shadow-sm dark:bg-gray-800/50 md:p-6'
            >
              {renderPanel()}
            </div>
          )}
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
