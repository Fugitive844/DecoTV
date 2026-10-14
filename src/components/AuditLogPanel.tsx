'use client';

import { Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { PlayAuditEntry, SearchAuditEntry } from '@/lib/types';

interface AuditUserSummary {
  username: string;
  playCount: number;
  searchCount: number;
  deleted: boolean;
}

// 接口返回的每条审计都带上所属用户名，便于“全部用户”视图展示
type WithUser<T> = T & { username?: string };

const SEARCH_PAGE_SIZE = 50;
const ALL_USERS = '';

function formatDateTime(timestamp: number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// 审计回放链接：播放页识别 audit=1 后不保存任何播放进度
function buildReplayUrl(entry: PlayAuditEntry): string {
  const params = new URLSearchParams({
    source: entry.source,
    id: entry.id,
    title: entry.title,
    audit: '1',
    auditEp: String(entry.index || 1),
    auditTime: String(entry.play_time || 0),
  });
  if (entry.year) params.set('year', entry.year);
  if (entry.search_title) params.set('stitle', entry.search_title);
  return `/play?${params.toString()}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `请求失败: ${response.status}`);
  }
  return data as T;
}

const AuditLogPanel = () => {
  const [users, setUsers] = useState<AuditUserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState(ALL_USERS);
  const [view, setView] = useState<'play' | 'search'>('play');
  const [plays, setPlays] = useState<WithUser<PlayAuditEntry>[]>([]);
  const [searches, setSearches] = useState<WithUser<SearchAuditEntry>[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson<{
        storageMode?: string;
        users: AuditUserSummary[];
      }>('/api/admin/audit');
      setIsLocalMode(data.storageMode === 'local');
      setUsers(data.users || []);
      // 选中的用户已不在列表中时回到全部用户
      setSelectedUser((current) =>
        data.users?.some((user) => user.username === current)
          ? current
          : ALL_USERS,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(
    async (username: string, type: 'play' | 'search', offset = 0) => {
      setLoading(true);
      setError('');
      // 不传 username 表示查询全部用户
      const base = username
        ? `/api/admin/audit?username=${encodeURIComponent(username)}&`
        : '/api/admin/audit?';
      try {
        if (type === 'play') {
          const data = await fetchJson<{ items: WithUser<PlayAuditEntry>[] }>(
            `${base}type=play`,
          );
          setPlays(data.items || []);
        } else {
          const data = await fetchJson<{
            total: number;
            items: WithUser<SearchAuditEntry>[];
          }>(`${base}type=search&offset=${offset}&limit=${SEARCH_PAGE_SIZE}`);
          setSearchTotal(data.total || 0);
          setSearches((current) =>
            offset === 0
              ? data.items || []
              : [...current, ...(data.items || [])],
          );
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    loadDetail(selectedUser, view);
  }, [selectedUser, view, loadDetail]);

  const refresh = () => {
    loadUsers();
    loadDetail(selectedUser, view);
  };

  if (isLocalMode) {
    return (
      <p className='text-sm text-gray-600 dark:text-gray-400'>
        审计日志需要数据库存储模式（Kvrocks / Redis /
        Upstash）。本地存储模式下记录保存在用户浏览器中，服务端无法审计。
      </p>
    );
  }

  const showUserColumn = selectedUser === ALL_USERS;
  const totalPlays = users.reduce((sum, user) => sum + user.playCount, 0);
  const totalSearches = users.reduce((sum, user) => sum + user.searchCount, 0);

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded-lg transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
    }`;

  return (
    <div className='space-y-4'>
      <p className='text-sm text-gray-600 dark:text-gray-400'>
        记录所有用户的搜索与播放行为，用户删除自己的历史或账号被删除时，审计日志仍保留。
        同一用户同一视频只保留一条播放审计并随观看更新。“继续播放”为审计回放，不会产生任何记录。
      </p>

      <div className='flex flex-wrap items-center gap-2'>
        <select
          value={selectedUser}
          onChange={(event) => setSelectedUser(event.target.value)}
          className='min-w-0 max-w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
        >
          <option value={ALL_USERS}>
            全部用户 · 播放 {totalPlays} · 搜索 {totalSearches}
          </option>
          {users.map((user) => (
            <option key={user.username} value={user.username}>
              {user.username}
              {user.deleted ? '（已删除）' : ''} · 播放 {user.playCount} · 搜索{' '}
              {user.searchCount}
            </option>
          ))}
        </select>
        <button
          className={tabClass(view === 'play')}
          onClick={() => setView('play')}
        >
          播放记录
        </button>
        <button
          className={tabClass(view === 'search')}
          onClick={() => setView('search')}
        >
          搜索记录
        </button>
        <button
          onClick={refresh}
          disabled={loading}
          className='inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50'
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
      )}

      {view === 'play' && (
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-auto'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr className='text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                {showUserColumn && (
                  <th className='px-3 py-2 whitespace-nowrap'>用户</th>
                )}
                <th className='px-3 py-2'>标题</th>
                <th className='px-3 py-2'>来源</th>
                <th className='px-3 py-2 whitespace-nowrap'>集数</th>
                <th className='px-3 py-2 whitespace-nowrap'>进度</th>
                <th className='px-3 py-2 whitespace-nowrap'>首次观看</th>
                <th className='px-3 py-2 whitespace-nowrap'>最近观看</th>
                <th className='px-3 py-2'>操作</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 dark:divide-gray-700 text-gray-900 dark:text-gray-100'>
              {plays.length === 0 && (
                <tr>
                  <td
                    colSpan={showUserColumn ? 8 : 7}
                    className='px-3 py-4 text-center text-gray-500 dark:text-gray-400'
                  >
                    {loading ? '加载中...' : '暂无播放审计'}
                  </td>
                </tr>
              )}
              {plays.map((entry) => (
                <tr
                  key={`${entry.username || ''}/${entry.key}`}
                  className='hover:bg-gray-50 dark:hover:bg-gray-800'
                >
                  {showUserColumn && (
                    <td className='px-3 py-2 whitespace-nowrap'>
                      {entry.username}
                    </td>
                  )}
                  <td
                    className='px-3 py-2 max-w-60 truncate'
                    title={entry.title}
                  >
                    {entry.title}
                    {entry.year ? (
                      <span className='ml-1 text-gray-500 dark:text-gray-400'>
                        ({entry.year})
                      </span>
                    ) : null}
                  </td>
                  <td className='px-3 py-2 whitespace-nowrap'>
                    {entry.source_name}
                  </td>
                  <td className='px-3 py-2 whitespace-nowrap'>
                    {entry.index}/{entry.total_episodes}
                  </td>
                  <td className='px-3 py-2 whitespace-nowrap'>
                    {formatDuration(entry.play_time)} /{' '}
                    {formatDuration(entry.total_time)}
                  </td>
                  <td className='px-3 py-2 whitespace-nowrap'>
                    {formatDateTime(entry.first_play_time)}
                  </td>
                  <td className='px-3 py-2 whitespace-nowrap'>
                    {formatDateTime(entry.last_play_time)}
                  </td>
                  <td className='px-3 py-2'>
                    <a
                      href={buildReplayUrl(entry)}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors whitespace-nowrap'
                    >
                      <Play size={12} />
                      继续播放
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'search' && (
        <div className='space-y-2'>
          <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-auto'>
            <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm'>
              <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
                <tr className='text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                  <th className='px-3 py-2 whitespace-nowrap'>搜索时间</th>
                  {showUserColumn && (
                    <th className='px-3 py-2 whitespace-nowrap'>用户</th>
                  )}
                  <th className='px-3 py-2'>关键词</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700 text-gray-900 dark:text-gray-100'>
                {searches.length === 0 && (
                  <tr>
                    <td
                      colSpan={showUserColumn ? 3 : 2}
                      className='px-3 py-4 text-center text-gray-500 dark:text-gray-400'
                    >
                      {loading ? '加载中...' : '暂无搜索审计'}
                    </td>
                  </tr>
                )}
                {searches.map((entry, index) => (
                  <tr
                    key={`${entry.username || ''}-${entry.time}-${index}`}
                    className='hover:bg-gray-50 dark:hover:bg-gray-800'
                  >
                    <td className='px-3 py-2 whitespace-nowrap'>
                      {formatDateTime(entry.time)}
                    </td>
                    {showUserColumn && (
                      <td className='px-3 py-2 whitespace-nowrap'>
                        {entry.username}
                      </td>
                    )}
                    <td className='px-3 py-2 break-all'>{entry.keyword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
            <span>
              已显示 {searches.length} / {searchTotal} 条（每个用户保留最近 5000
              条）
            </span>
            {searches.length < searchTotal && (
              <button
                onClick={() =>
                  loadDetail(selectedUser, 'search', searches.length)
                }
                disabled={loading}
                className='px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50'
              >
                加载更多
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogPanel;
