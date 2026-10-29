'use client';

import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { buttonStyles } from './admin-shared';
import { formatTime, Pager, SearchBox, useJson } from './manage-ui';

interface Detail {
  source: {
    key: string;
    name: string;
    url: string;
    ua?: string;
    epg?: string;
    sortOrder?: number;
    disabled?: boolean;
    from: string;
  };
  schedule?: {
    lastAttemptAt: number;
    lastSuccessAt: number;
    consecutiveFailures: number;
    nextAttemptAt: number;
    lastError: string;
    lastEpgError: string;
  };
  refreshing: boolean;
  cache: {
    fetchedAt: number;
    channelNumber: number;
    groupCount: number;
    epgUrl: string;
    epgChannelCount: number;
  } | null;
}
interface GroupRow {
  group: string;
  display: string;
  count: number;
}
interface ChannelRow {
  id: string;
  name: string;
  displayName: string;
  group: string;
  displayGroup: string;
  url: string;
  logo: string;
  tvgId: string;
}
interface Page<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

// 直播源详情：配置与调度状态；分类和频道只读（以抓取结果为准，译文仅展示时附加）。
export default function LiveSourceDetail({
  sourceKey,
  onBack,
}: {
  sourceKey: string;
  onBack: () => void;
}) {
  const base = `/api/admin/manage/live?key=${encodeURIComponent(sourceKey)}`;
  const detail = useJson<Detail>(`${base}&view=detail`);
  const [tab, setTab] = useState<'groups' | 'channels'>('groups');
  const [group, setGroup] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const listUrl =
    tab === 'groups'
      ? `${base}&view=groups&q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`
      : `${base}&view=channels&q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}${
          group === null ? '' : `&group=${encodeURIComponent(group)}`
        }`;
  const list = useJson<Page<GroupRow & ChannelRow>>(listUrl);

  useEffect(() => setPage(1), [tab, group, q, pageSize]);

  const forceRefresh = useCallback(async () => {
    setRefreshing(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/manage/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refresh',
          keys: [sourceKey],
          force: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '刷新失败');
      setMessage(
        data.result?.failed
          ? '抓取失败，已保留最后成功缓存，见下方错误'
          : '抓取完成',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '刷新失败');
    } finally {
      setRefreshing(false);
      detail.reload();
      list.reload();
    }
  }, [sourceKey, detail, list]);

  const d = detail.data;
  const s = d?.schedule;
  const row = (label: string, value: React.ReactNode) => (
    <div className='flex gap-2 py-1'>
      <span className='w-28 shrink-0 text-gray-500 dark:text-gray-400'>
        {label}
      </span>
      <span className='min-w-0 break-all text-gray-900 dark:text-gray-100'>
        {value}
      </span>
    </div>
  );

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <button
          onClick={onBack}
          className={`${buttonStyles.secondarySmall} inline-flex items-center gap-1`}
        >
          <ArrowLeft size={14} /> 返回列表
        </button>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
          {d?.source.name || sourceKey}
        </h2>
        <button
          onClick={forceRefresh}
          disabled={refreshing}
          className={`${refreshing ? buttonStyles.disabledSmall : buttonStyles.primarySmall} inline-flex items-center gap-1`}
          title='强制刷新跳过失败冷却，仍受并发限制'
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '抓取中…' : '强制刷新'}
        </button>
        {message && (
          <span className='text-sm text-gray-600 dark:text-gray-300'>
            {message}
          </span>
        )}
      </div>

      {detail.error && <p className='text-sm text-red-600'>{detail.error}</p>}
      {d && (
        <div className='grid gap-4 rounded-xl bg-white/80 p-4 text-sm shadow-sm dark:bg-gray-800/50 md:grid-cols-2'>
          <div>
            {row('key', <span className='font-mono'>{d.source.key}</span>)}
            {row('M3U 地址', d.source.url)}
            {row('UA', d.source.ua || '默认')}
            {row('EPG 地址', d.source.epg || d.cache?.epgUrl || '—')}
            {row('排序值', d.source.sortOrder ?? 1000)}
            {row('状态', d.source.disabled ? '已禁用' : '启用')}
            {row(
              '来源',
              d.source.from === 'config' ? '配置文件／订阅' : '自定义',
            )}
          </div>
          <div>
            {row(
              '频道数',
              d.cache
                ? `${d.cache.channelNumber}（${d.cache.groupCount} 个分类）`
                : '暂无成功缓存',
            )}
            {row(
              '最后成功抓取',
              formatTime(d.cache?.fetchedAt || s?.lastSuccessAt),
            )}
            {row('最后尝试', formatTime(s?.lastAttemptAt))}
            {row('连续失败', s?.consecutiveFailures ?? 0)}
            {row(
              '下次重试',
              d.refreshing ? '抓取中' : formatTime(s?.nextAttemptAt),
            )}
            {row('最近错误', s?.lastError || '—')}
            {row('EPG 错误', s?.lastEpgError || '—')}
          </div>
        </div>
      )}

      <div className='rounded-xl bg-white/80 p-4 shadow-sm dark:bg-gray-800/50'>
        <div className='mb-3 flex flex-wrap items-center gap-2'>
          {(['groups', 'channels'] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setTab(value);
                if (value === 'groups') setGroup(null);
              }}
              className={
                tab === value
                  ? buttonStyles.primarySmall
                  : buttonStyles.secondarySmall
              }
            >
              {value === 'groups' ? '频道分类' : '频道列表'}
            </button>
          ))}
          {tab === 'channels' && group !== null && (
            <span className='rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'>
              分类：{group}
              <button className='ml-1' onClick={() => setGroup(null)}>
                ×
              </button>
            </span>
          )}
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder={tab === 'groups' ? '搜索分类' : '搜索频道名或分类'}
          />
          <span className='text-xs text-gray-500 dark:text-gray-400'>
            只读：分类与频道以抓取结果为准
          </span>
        </div>
        {list.error && <p className='text-sm text-red-600'>{list.error}</p>}
        <div className='overflow-x-auto'>
          {tab === 'groups' ? (
            <table className='w-full min-w-[40rem] text-sm'>
              <thead className='whitespace-nowrap bg-gray-50 text-left text-gray-600 dark:bg-gray-900/40 dark:text-gray-300'>
                <tr>
                  <th className='px-3 py-2'>分类原名</th>
                  <th className='px-3 py-2'>展示名称</th>
                  <th className='px-3 py-2 text-right'>频道数</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {(list.data?.items || []).map((item) => (
                  <tr key={item.group}>
                    <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                      {item.group}
                    </td>
                    <td className='px-3 py-2 text-gray-700 dark:text-gray-300'>
                      {item.display}
                    </td>
                    <td className='px-3 py-2 text-right'>{item.count}</td>
                    <td className='px-3 py-2 text-right'>
                      <button
                        className={buttonStyles.secondarySmall}
                        onClick={() => {
                          setGroup(item.group);
                          setTab('channels');
                        }}
                      >
                        查看频道
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className='w-full min-w-[40rem] text-sm'>
              <thead className='whitespace-nowrap bg-gray-50 text-left text-gray-600 dark:bg-gray-900/40 dark:text-gray-300'>
                <tr>
                  <th className='px-3 py-2'>原频道名</th>
                  <th className='px-3 py-2'>展示名称</th>
                  <th className='px-3 py-2'>分类</th>
                  <th className='px-3 py-2'>tvg-id</th>
                  <th className='px-3 py-2'>播放地址</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {(list.data?.items || []).map((item) => (
                  <tr key={item.id}>
                    <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                      {item.name}
                    </td>
                    <td className='px-3 py-2 text-gray-700 dark:text-gray-300'>
                      {item.displayName}
                    </td>
                    <td className='px-3 py-2 text-gray-700 dark:text-gray-300'>
                      {item.displayGroup}
                    </td>
                    <td className='px-3 py-2 font-mono text-xs'>
                      {item.tvgId || '—'}
                    </td>
                    <td
                      className='max-w-xs truncate px-3 py-2 text-xs text-gray-500'
                      title={item.url}
                    >
                      {item.url}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!list.loading && list.data?.items.length === 0 && (
            <p className='py-6 text-center text-sm text-gray-500'>
              {d?.cache ? '没有匹配的结果' : '暂无成功抓取的频道'}
            </p>
          )}
        </div>
        {list.data && (
          <Pager
            total={list.data.total}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        )}
      </div>
    </div>
  );
}
