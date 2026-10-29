'use client';

import { RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { buttonStyles, type DataSource } from './admin-shared';

const FIELD_LABEL: Record<string, string> = {
  name: '名称',
  api: '接口地址',
  detail: '详情地址',
  is_adult: '成人资源',
};

async function callSource(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `请求失败：${response.status}`);
}

// 单项编辑视频源：key 不可改；来源字段人工修改后形成覆盖，可一键恢复订阅值。
export default function VideoSourceEditDialog({
  source,
  onClose,
  onSaved,
}: {
  source: DataSource;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState({
    name: source.name,
    api: source.api,
    detail: source.detail || '',
    is_adult: !!source.is_adult,
    disable_ad_filter: !!source.disable_ad_filter,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overridden = source.overriddenFields || [];

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await callSource(body);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';
  const badge = (field: string) =>
    overridden.includes(field) ? (
      <span
        className='ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
        title={`来源值：${String(source.upstream?.[field as 'name'] ?? '—')}`}
      >
        已人工修改
      </span>
    ) : null;

  return createPortal(
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
      <div className='w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-800'>
        <div className='flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            编辑视频源
          </h3>
          <button
            onClick={onClose}
            aria-label='关闭'
            className='text-gray-500 dark:text-gray-400'
          >
            <X size={20} />
          </button>
        </div>
        <div className='space-y-3 px-5 py-4 text-sm'>
          <div className='text-gray-600 dark:text-gray-400'>
            key：<span className='font-mono'>{source.key}</span>
            <span className='ml-2 text-xs'>
              （{source.from === 'config' ? '配置文件／订阅' : '自定义'}）
            </span>
          </div>
          {(['name', 'api', 'detail'] as const).map((field) => (
            <label key={field} className='block'>
              <span className='mb-1 flex items-center text-gray-700 dark:text-gray-300'>
                {FIELD_LABEL[field]}
                {badge(field)}
              </span>
              <input
                className={input}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            </label>
          ))}
          <label className='flex items-center gap-2 text-gray-700 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={form.is_adult}
              onChange={(e) => setForm({ ...form, is_adult: e.target.checked })}
            />
            成人资源{badge('is_adult')}
          </label>
          <label className='flex items-center gap-2 text-gray-700 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={form.disable_ad_filter}
              onChange={(e) =>
                setForm({ ...form, disable_ad_filter: e.target.checked })
              }
            />
            不走去广告过滤
          </label>
          {overridden.length > 0 && (
            <button
              disabled={busy}
              onClick={() =>
                run({ action: 'restore_upstream', key: source.key })
              }
              className={`${buttonStyles.warningSmall} inline-flex items-center gap-1`}
            >
              <RotateCcw size={14} />
              恢复全部订阅值（
              {overridden.map((f) => FIELD_LABEL[f] || f).join('、')}）
            </button>
          )}
          {error && (
            <p className='rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/20 dark:text-red-300'>
              {error}
            </p>
          )}
        </div>
        <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700'>
          <button onClick={onClose} className={buttonStyles.secondary}>
            取消
          </button>
          <button
            disabled={busy || !form.name.trim() || !form.api.trim()}
            onClick={() => run({ action: 'edit', key: source.key, ...form })}
            className={
              busy || !form.name.trim() || !form.api.trim()
                ? buttonStyles.disabled
                : buttonStyles.success
            }
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
