'use client';

import { RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { buttonStyles } from './admin-shared';

// 读取管理接口；URL 变化或 reload 时重新请求，失败给出明确错误。
export function useJson<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    fetch(url, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          throw new Error('登录已过期');
        }
        if (!response.ok)
          throw new Error(body.error || `请求失败：${response.status}`);
        if (!cancelled) {
          setData(body as T);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, token]);
  const reload = useCallback(() => setToken((value) => value + 1), []);
  return { data, error, loading, reload, setData };
}

export async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

export function QueryButton({
  onQuery,
  loading = false,
}: {
  onQuery: () => void | Promise<void>;
  loading?: boolean;
}) {
  return (
    <button
      type='button'
      onClick={() => void onQuery()}
      disabled={loading}
      className={`${loading ? buttonStyles.disabledSmall : buttonStyles.secondarySmall} inline-flex items-center gap-1`}
      title='重新查询当前列表数据'
    >
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      {loading ? '查询中…' : '查询 / 刷新'}
    </button>
  );
}

export function formatTime(value?: number | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

// 输入停顿 300ms 后再查询，避免每个字符都请求。
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), 300);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);
  return (
    <label className='relative min-w-[12rem] flex-1 sm:max-w-xs'>
      <Search
        size={14}
        className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400'
      />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className='w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
      />
    </label>
  );
}

export function Pager({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className='mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-300'>
      <span>共 {total} 条</span>
      <div className='flex items-center gap-2'>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className='rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700'
        >
          {[20, 50, 100].map((size) => (
            <option key={size} value={size}>
              每页 {size}
            </option>
          ))}
        </select>
        <button
          className={
            page <= 1 ? buttonStyles.disabledSmall : buttonStyles.secondarySmall
          }
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          上一页
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className={
            page >= pages
              ? buttonStyles.disabledSmall
              : buttonStyles.secondarySmall
          }
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'info';
  children: React.ReactNode;
}) {
  const style =
    kind === 'error'
      ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
      : kind === 'success'
        ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
        : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300';
  return <p className={`rounded-lg px-3 py-2 text-sm ${style}`}>{children}</p>;
}
