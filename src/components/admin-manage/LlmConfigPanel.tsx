'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { buttonStyles } from './admin-shared';
import { formatTime, Notice, postJson, useJson } from './manage-ui';

interface LlmItem {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  active: boolean;
  quota: number;
  stats: {
    autoCalls: number;
    manualCalls: number;
    lastError: string;
    lastErrorAt: number;
    lastManualError: string;
    lastSuccessAt: number;
  };
  updatedAt: number;
}
interface LlmList {
  items: LlmItem[];
  activeId: string | null;
  defaults: { baseUrl: string; model: string };
}

const API = '/api/admin/manage/llm';

const quotaText = (quota: number) =>
  quota === -1 ? '不限' : quota === 0 ? '0（禁止自动调用）' : String(quota);

export default function LlmConfigPanel() {
  const list = useJson<LlmList>(API);
  const [editing, setEditing] = useState<Partial<LlmItem> | null>(null);
  const [form, setForm] = useState({
    name: '',
    baseUrl: '',
    model: '',
    apiKey: '',
  });
  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    kind: 'error' | 'success';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await postJson(API, body);
      setMessage({ kind: 'success', text: success });
      list.reload();
      return true;
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '操作失败',
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (item?: LlmItem) => {
    setEditing(item || {});
    setForm({
      name: item?.name || 'DeepSeek Flash',
      baseUrl: item?.baseUrl || list.data?.defaults.baseUrl || '',
      model: item?.model || list.data?.defaults.model || '',
      apiKey: '',
    });
  };

  const save = async () => {
    const ok = await act(
      editing?.id
        ? { action: 'edit', id: editing.id, ...form }
        : { action: 'add', ...form },
      editing?.id ? '配置已保存' : '配置已新增，初始自动调用额度为 0',
    );
    if (ok) setEditing(null);
  };

  const input =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-gray-600 dark:text-gray-400'>
          OpenAI 兼容 Chat Completions
          接口；任意时刻最多启用一个配置，额度各自独立。
          <br />
          额度：-1 不限，0
          禁止新的自动调用，正整数按实际请求次数扣减；手动单行翻译不扣额度。
        </p>
        <button
          onClick={() => openEditor()}
          className={`${buttonStyles.success} inline-flex items-center gap-1`}
        >
          <Plus size={16} /> 新增配置
        </button>
      </div>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {list.error && <Notice kind='error'>{list.error}</Notice>}

      <div className='grid gap-3'>
        {(list.data?.items || []).map((item) => (
          <div
            key={item.id}
            className={`rounded-xl border p-4 text-sm shadow-sm ${
              item.active
                ? 'border-green-500 bg-green-50/60 dark:bg-green-900/10'
                : 'border-gray-200 bg-white/80 dark:border-gray-700 dark:bg-gray-800/50'
            }`}
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex items-center gap-2'>
                <span className='font-semibold text-gray-900 dark:text-gray-100'>
                  {item.name}
                </span>
                {item.active && (
                  <span className='rounded bg-green-600 px-1.5 py-0.5 text-xs text-white'>
                    已启用
                  </span>
                )}
              </div>
              <div className='flex flex-wrap gap-2'>
                {item.active ? (
                  <button
                    disabled={busy}
                    className={buttonStyles.warningSmall}
                    onClick={() =>
                      act({ action: 'deactivate' }, '已停用，已有译文继续展示')
                    }
                  >
                    停用
                  </button>
                ) : (
                  <button
                    disabled={busy}
                    className={buttonStyles.successSmall}
                    onClick={() =>
                      act(
                        { action: 'activate', id: item.id },
                        `已启用「${item.name}」，其他配置同步停用`,
                      )
                    }
                  >
                    启用
                  </button>
                )}
                <button
                  className={buttonStyles.primarySmall}
                  onClick={() => openEditor(item)}
                >
                  编辑
                </button>
                {item.hasApiKey && (
                  <button
                    disabled={busy}
                    className={buttonStyles.secondarySmall}
                    onClick={() =>
                      window.confirm('确定清空该配置的 API Key？') &&
                      act(
                        { action: 'clear_key', id: item.id },
                        'API Key 已清空',
                      )
                    }
                  >
                    清空密钥
                  </button>
                )}
                <button
                  disabled={busy}
                  className={buttonStyles.dangerSmall}
                  onClick={() =>
                    window.confirm(
                      `确定删除配置「${item.name}」？翻译缓存不受影响。`,
                    ) && act({ action: 'delete', id: item.id }, '配置已删除')
                  }
                >
                  删除
                </button>
              </div>
            </div>
            <div className='mt-3 grid gap-1 text-gray-700 dark:text-gray-300 md:grid-cols-2'>
              <span>baseUrl：{item.baseUrl}</span>
              <span>模型 ID：{item.model}</span>
              <span>
                API Key：{item.hasApiKey ? item.apiKeyMasked : '未设置'}
              </span>
              <span>
                调用次数：自动 {item.stats.autoCalls}，手动{' '}
                {item.stats.manualCalls}
              </span>
              <span>最近成功：{formatTime(item.stats.lastSuccessAt)}</span>
              <span>更新时间：{formatTime(item.updatedAt)}</span>
            </div>
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              <span className='text-gray-700 dark:text-gray-300'>
                剩余自动调用额度：<b>{quotaText(item.quota)}</b>
              </span>
              <input
                className='w-28 rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700'
                placeholder='-1 / 0 / N'
                value={quotaDraft[item.id] ?? ''}
                onChange={(e) =>
                  setQuotaDraft({ ...quotaDraft, [item.id]: e.target.value })
                }
              />
              <button
                disabled={busy || !(quotaDraft[item.id] ?? '').trim()}
                className={buttonStyles.primarySmall}
                onClick={async () => {
                  if (
                    await act(
                      {
                        action: 'set_quota',
                        id: item.id,
                        quota: Number(quotaDraft[item.id]),
                      },
                      '额度已更新',
                    )
                  )
                    setQuotaDraft({ ...quotaDraft, [item.id]: '' });
                }}
              >
                设置额度
              </button>
            </div>
            {item.stats.lastError && (
              <p className='mt-2 text-xs text-red-600 dark:text-red-400'>
                最近自动调用错误（{formatTime(item.stats.lastErrorAt)}）：
                {item.stats.lastError}
              </p>
            )}
            {item.stats.lastManualError && (
              <p className='mt-1 text-xs text-amber-600 dark:text-amber-400'>
                最近手动调用错误：{item.stats.lastManualError}
              </p>
            )}
          </div>
        ))}
        {!list.loading && list.data?.items.length === 0 && (
          <p className='py-8 text-center text-sm text-gray-500'>
            还没有模型配置。新增后需要启用并设置额度才会自动翻译。
          </p>
        )}
      </div>

      {editing &&
        createPortal(
          <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
            <div className='w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-800'>
              <div className='flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  {editing.id ? '编辑模型配置' : '新增模型配置'}
                </h3>
                <button onClick={() => setEditing(null)} aria-label='关闭'>
                  <X size={20} className='text-gray-500' />
                </button>
              </div>
              <div className='space-y-3 px-5 py-4 text-sm'>
                {(
                  [
                    ['name', '配置名称'],
                    ['baseUrl', 'baseUrl（根地址或包含 /v1）'],
                    ['model', '模型 ID'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className='block'>
                    <span className='mb-1 block text-gray-700 dark:text-gray-300'>
                      {label}
                    </span>
                    <input
                      className={input}
                      value={form[field]}
                      onChange={(e) =>
                        setForm({ ...form, [field]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label className='block'>
                  <span className='mb-1 block text-gray-700 dark:text-gray-300'>
                    API Key{editing.id ? '（留空表示保留原密钥）' : ''}
                  </span>
                  <input
                    type='password'
                    autoComplete='off'
                    className={input}
                    value={form.apiKey}
                    onChange={(e) =>
                      setForm({ ...form, apiKey: e.target.value })
                    }
                  />
                </label>
                <p className='text-xs text-gray-500'>
                  默认关闭深度思考（DeepSeek 自动附带 thinking:
                  disabled）。密钥仅保存在服务端，列表脱敏显示。
                </p>
              </div>
              <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700'>
                <button
                  onClick={() => setEditing(null)}
                  className={buttonStyles.secondary}
                >
                  取消
                </button>
                <button
                  disabled={busy}
                  onClick={save}
                  className={
                    busy ? buttonStyles.disabled : buttonStyles.success
                  }
                >
                  保存
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
