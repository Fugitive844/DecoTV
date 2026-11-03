'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { UserIpEntry } from '@/lib/ip-location.types';

import IpLocationCells, { IpLocationHeaders } from './IpLocationDisplay';

export function UserIpHistory({
  username,
  onClose,
}: {
  username: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<UserIpEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(
      `/api/admin/user-ips?username=${encodeURIComponent(username)}&offset=${offset}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '读取失败');
        return data;
      })
      .then((data) => {
        setItems((old) => (offset ? [...old, ...data.items] : data.items));
        setTotal(data.total);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [username, offset]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return createPortal(
    <div
      className='fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4'
      onClick={onClose}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-label={`${username} 的 IP 历史`}
        className='max-h-[85vh] w-full max-w-6xl overflow-auto rounded-xl bg-white p-5 text-gray-900 shadow-xl dark:bg-gray-800 dark:text-gray-100'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='mb-3 flex items-center justify-between gap-4'>
          <h3 className='min-w-0 break-all font-semibold'>
            {username} · IP 历史
          </h3>
          <button
            autoFocus
            onClick={onClose}
            className='shrink-0 whitespace-nowrap rounded px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700'
          >
            关闭
          </button>
        </div>
        <p className='mb-4 text-xs text-gray-500'>
          IP、国家/地区或运营商变化时记录一条，连续相同信息只更新最近出现时间。保留最近
          5000 条。
        </p>
        {error && (
          <p role='alert' className='text-red-500'>
            {error}
          </p>
        )}
        <div className='overflow-x-auto'>
          <table className='w-full text-left text-sm'>
            <thead>
              <tr>
                <IpLocationHeaders className='p-2' />
                <th className='whitespace-nowrap p-2'>首次出现</th>
                <th className='whitespace-nowrap p-2'>最近出现</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={`${item.firstSeen}-${index}`}
                  className='border-t border-gray-200 dark:border-gray-700'
                >
                  <IpLocationCells location={item} className='p-2' />
                  <td className='whitespace-nowrap p-2'>
                    {new Date(item.firstSeen).toLocaleString('zh-CN')}
                  </td>
                  <td className='whitespace-nowrap p-2'>
                    {new Date(item.lastSeen).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.length && !loading && !error && (
          <p className='py-5 text-center text-gray-500'>暂无 IP 历史</p>
        )}
        <div className='mt-4 flex items-center justify-between text-xs'>
          <span>
            {loading ? '加载中…' : `已显示 ${items.length} / ${total} 条`}
          </span>
          {items.length < total && (
            <button
              disabled={loading}
              onClick={() => setOffset(items.length)}
              className='rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50'
            >
              加载更多
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
