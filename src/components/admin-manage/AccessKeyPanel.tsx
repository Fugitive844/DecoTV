'use client';

import { Copy, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { buttonStyles } from './admin-shared';
import {
  formatTime,
  Notice,
  Pager,
  postJson,
  SearchBox,
  useJson,
} from './manage-ui';

interface KeyItem {
  key: string;
  remark: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}
interface ListResponse {
  items: KeyItem[];
  total: number;
  counts: { all: number; enabled: number };
  emptyKeyEnabled: boolean;
}

const API = '/api/admin/manage/access-keys';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function AccessKeyPanel() {
  const [q, setQ] = useState('');
  const [enabled, setEnabled] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const list = useJson<ListResponse>(
    `${API}?q=${encodeURIComponent(q)}&enabled=${enabled}&page=${page}&pageSize=${pageSize}`,
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ count: '10', remark: '' });
  const [created, setCreated] = useState<KeyItem[] | null>(null);

  useEffect(() => setPage(1), [q, enabled, pageSize]);
  useEffect(() => setSelected(new Set()), [q, enabled, page, pageSize]);

  const items = list.data?.items || [];
  const pageAllSelected =
    items.length > 0 && items.every((item) => selected.has(item.key));

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await postJson(API, body);
      setMessage({
        kind: 'success',
        text: success.replace('{updated}', String(data.updated ?? '')),
      });
      list.reload();
      return data;
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '操作失败',
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const batch = async (action: 'enable' | 'disable' | 'delete') => {
    const keys = Array.from(selected);
    if (keys.length === 0) return;
    if (
      action === 'delete' &&
      !window.confirm(
        `确定删除选中的 ${keys.length} 个秘钥？使用它们的用户将立即失效。`,
      )
    )
      return;
    const ok =
      action === 'delete'
        ? await act({ action: 'delete', keys }, `已删除 ${keys.length} 个秘钥`)
        : await act(
            { action: 'toggle', keys, enabled: action === 'enable' },
            `已${action === 'enable' ? '启用' : '停用'} {updated} 个秘钥`,
          );
    if (ok) setSelected(new Set());
  };

  const generate = async () => {
    const data = await act(
      { action: 'generate', count: Number(form.count), remark: form.remark },
      `已生成 ${form.count} 个秘钥`,
    );
    if (data) {
      setGenerating(false);
      setCreated(data.items as KeyItem[]);
    }
  };

  const emptyEnabled = list.data?.emptyKeyEnabled === true;
  const input =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

  return (
    <div className='space-y-4'>
      <div className='rounded-xl bg-white/80 p-4 text-sm text-gray-600 shadow-sm dark:bg-gray-800/50 dark:text-gray-400'>
        成人内容需要同时满足：站点设置中关闭「成人内容过滤」，且请求带有效访问秘钥（URL
        参数 ak）。一个秘钥可以给任意多人使用；停用或删除后立即失效。
      </div>

      <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 bg-white/80 p-4 text-sm dark:border-gray-600 dark:bg-gray-800/50'>
        <div>
          <div className='font-semibold text-gray-900 dark:text-gray-100'>
            空秘钥（不填秘钥也可访问）
            <span
              className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                emptyEnabled
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {emptyEnabled ? '已启用' : '已停用'}
            </span>
          </div>
          <p className='mt-1 text-xs text-gray-500'>
            启用后，没有填写秘钥（或秘钥无效）的用户也能看到成人内容，仍需总开关关闭过滤。
          </p>
        </div>
        <button
          disabled={busy || !list.data}
          className={
            emptyEnabled ? buttonStyles.warningSmall : buttonStyles.successSmall
          }
          onClick={() =>
            act(
              { action: 'toggle_empty', enabled: !emptyEnabled },
              emptyEnabled ? '空秘钥已停用' : '空秘钥已启用',
            )
          }
        >
          {emptyEnabled ? '停用' : '启用'}
        </button>
      </div>

      <div className='rounded-xl bg-white/80 p-4 shadow-sm dark:bg-gray-800/50'>
        <div className='flex flex-wrap items-center gap-2'>
          <SearchBox value={q} onChange={setQ} placeholder='搜索秘钥或备注' />
          <select
            value={enabled}
            onChange={(e) => setEnabled(e.target.value)}
            className='rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700'
          >
            <option value=''>全部状态</option>
            <option value='true'>已启用</option>
            <option value='false'>已停用</option>
          </select>
          <span className='text-sm text-gray-500'>
            共 {list.data?.counts.all ?? 0} 个，启用{' '}
            {list.data?.counts.enabled ?? 0} 个
          </span>
          <button
            onClick={() => setGenerating(true)}
            className={`${buttonStyles.success} ml-auto inline-flex items-center gap-1`}
          >
            <Plus size={16} /> 生成秘钥
          </button>
        </div>

        <div className='mt-3 flex flex-wrap items-center gap-2 text-sm'>
          <span className='text-gray-600 dark:text-gray-300'>
            已选 {selected.size} 个
          </span>
          {(['enable', 'disable', 'delete'] as const).map((action) => (
            <button
              key={action}
              disabled={busy || selected.size === 0}
              onClick={() => batch(action)}
              className={
                selected.size === 0
                  ? buttonStyles.disabledSmall
                  : action === 'enable'
                    ? buttonStyles.successSmall
                    : action === 'disable'
                      ? buttonStyles.warningSmall
                      : buttonStyles.dangerSmall
              }
            >
              {action === 'enable'
                ? '批量启用'
                : action === 'disable'
                  ? '批量停用'
                  : '批量删除'}
            </button>
          ))}
        </div>

        {message && (
          <div className='mt-3'>
            <Notice kind={message.kind}>{message.text}</Notice>
          </div>
        )}
        {list.error && (
          <div className='mt-3'>
            <Notice kind='error'>{list.error}</Notice>
          </div>
        )}

        <div className='mt-3 overflow-x-auto'>
          <table className='w-full min-w-[720px] text-sm'>
            <thead>
              <tr className='border-b border-gray-200 text-left text-gray-600 dark:border-gray-700 dark:text-gray-300'>
                <th className='w-8 px-2 py-2'>
                  <input
                    type='checkbox'
                    checked={pageAllSelected}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(items.map((item) => item.key))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th className='whitespace-nowrap px-2 py-2'>秘钥</th>
                <th className='whitespace-nowrap px-2 py-2'>备注</th>
                <th className='whitespace-nowrap px-2 py-2'>状态</th>
                <th className='whitespace-nowrap px-2 py-2'>创建时间</th>
                <th className='whitespace-nowrap px-2 py-2'>最近使用</th>
                <th className='whitespace-nowrap px-2 py-2 text-right'>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.key}
                  className='border-b border-gray-100 dark:border-gray-800'
                >
                  <td className='px-2 py-2'>
                    <input
                      type='checkbox'
                      checked={selected.has(item.key)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(item.key);
                          else next.delete(item.key);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className='px-2 py-2 font-mono text-gray-900 dark:text-gray-100'>
                    {item.key}
                  </td>
                  <td className='px-2 py-2 text-gray-700 dark:text-gray-300'>
                    {item.remark || '—'}
                  </td>
                  <td className='px-2 py-2'>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        item.enabled
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {item.enabled ? '已启用' : '已停用'}
                    </span>
                  </td>
                  <td className='whitespace-nowrap px-2 py-2 text-gray-600 dark:text-gray-400'>
                    {formatTime(item.createdAt)}
                  </td>
                  <td className='whitespace-nowrap px-2 py-2 text-gray-600 dark:text-gray-400'>
                    {formatTime(item.lastUsedAt)}
                  </td>
                  <td className='whitespace-nowrap px-2 py-2 text-right'>
                    <div className='inline-flex gap-1'>
                      <button
                        className={`${buttonStyles.secondarySmall} inline-flex items-center gap-1`}
                        onClick={async () =>
                          setMessage(
                            (await copyText(item.key))
                              ? { kind: 'success', text: '已复制' }
                              : {
                                  kind: 'error',
                                  text: '复制失败，请手动选择复制',
                                },
                          )
                        }
                      >
                        <Copy size={12} /> 复制
                      </button>
                      <button
                        disabled={busy}
                        className={buttonStyles.primarySmall}
                        onClick={() => {
                          const remark = window.prompt('修改备注', item.remark);
                          if (remark !== null)
                            void act(
                              {
                                action: 'edit_remark',
                                keys: [item.key],
                                remark,
                              },
                              '备注已保存',
                            );
                        }}
                      >
                        备注
                      </button>
                      <button
                        disabled={busy}
                        className={
                          item.enabled
                            ? buttonStyles.warningSmall
                            : buttonStyles.successSmall
                        }
                        onClick={() =>
                          act(
                            {
                              action: 'toggle',
                              keys: [item.key],
                              enabled: !item.enabled,
                            },
                            item.enabled ? '已停用' : '已启用',
                          )
                        }
                      >
                        {item.enabled ? '停用' : '启用'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className='py-8 text-center text-gray-500'>
                    还没有秘钥，点击「生成秘钥」批量创建。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          total={list.data?.total || 0}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </div>

      {generating &&
        createPortal(
          <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
            <div className='w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-gray-800'>
              <div className='flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  生成秘钥
                </h3>
                <button onClick={() => setGenerating(false)} aria-label='关闭'>
                  <X size={20} className='text-gray-500' />
                </button>
              </div>
              <div className='space-y-3 px-5 py-4 text-sm'>
                <label className='block'>
                  <span className='mb-1 block text-gray-700 dark:text-gray-300'>
                    数量（1-100）
                  </span>
                  <input
                    type='number'
                    min={1}
                    max={100}
                    className={input}
                    value={form.count}
                    onChange={(e) =>
                      setForm({ ...form, count: e.target.value })
                    }
                  />
                </label>
                <label className='block'>
                  <span className='mb-1 block text-gray-700 dark:text-gray-300'>
                    备注（选填，例如发给谁）
                  </span>
                  <input
                    className={input}
                    value={form.remark}
                    onChange={(e) =>
                      setForm({ ...form, remark: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700'>
                <button
                  onClick={() => setGenerating(false)}
                  className={buttonStyles.secondary}
                >
                  取消
                </button>
                <button
                  disabled={busy}
                  onClick={generate}
                  className={
                    busy ? buttonStyles.disabled : buttonStyles.success
                  }
                >
                  生成
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {created &&
        createPortal(
          <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
            <div className='w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-gray-800'>
              <div className='flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  新生成的秘钥（{created.length} 个）
                </h3>
                <button onClick={() => setCreated(null)} aria-label='关闭'>
                  <X size={20} className='text-gray-500' />
                </button>
              </div>
              <textarea
                readOnly
                className='m-5 h-56 w-[calc(100%-2.5rem)] rounded-lg border border-gray-300 bg-gray-50 p-2 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'
                value={created.map((item) => item.key).join('\n')}
              />
              <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700'>
                <button
                  className={buttonStyles.primary}
                  onClick={async () =>
                    setMessage(
                      (await copyText(
                        created.map((item) => item.key).join('\n'),
                      ))
                        ? { kind: 'success', text: '已复制全部新秘钥' }
                        : { kind: 'error', text: '复制失败，请手动选择复制' },
                    )
                  }
                >
                  复制全部
                </button>
                <button
                  onClick={() => setCreated(null)}
                  className={buttonStyles.secondary}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
