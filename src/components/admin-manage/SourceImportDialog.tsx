/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { buttonStyles } from './admin-shared';

type SourceType = 'video' | 'live';
type ImportMode = 'overwrite' | 'skip' | 'smart' | 'ask';
type Decision = 'overwrite' | 'skip' | 'smart';

const MODE_OPTIONS: { value: ImportMode; label: string; hint: string }[] = [
  {
    value: 'smart',
    label: '智能',
    hint: '更新来源字段，保留人工修改；直播源保留本地排序和启停',
  },
  {
    value: 'overwrite',
    label: '强制覆盖',
    hint: '用导入提供的字段覆盖，并清除这些字段的人工修改',
  },
  { value: 'skip', label: '跳过', hint: '已存在的 key 整条保留，只新增' },
  {
    value: 'ask',
    label: '冲突逐项选择',
    hint: '先预览冲突，逐项选择覆盖、跳过或智能',
  },
];
const DECISION_LABEL: Record<Decision, string> = {
  smart: '智能',
  overwrite: '覆盖',
  skip: '跳过',
};

interface Preview {
  added: { key: string; incoming: Record<string, any> }[];
  conflicts: {
    key: string;
    changes: string[];
    existing: Record<string, any>;
    incoming: Record<string, any>;
    overriddenFields: string[];
  }[];
  unchanged: string[];
  fingerprint: string;
}

async function post(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/manage/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

// 导入四种模式：先预览（不写入），取消不保存；提交时服务端重新核对指纹。
export default function SourceImportDialog({
  type,
  onClose,
  onDone,
}: {
  type: SourceType;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<ImportMode>('smart');
  const [data, setData] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const title = type === 'video' ? '导入视频源' : '导入直播源';

  const undecided = useMemo(
    () =>
      (preview?.conflicts || []).filter((item) => !decisions[item.key]).length,
    [preview, decisions],
  );

  const readFile = async (file: File) => {
    setError('');
    setPreview(null);
    setResult('');
    try {
      setData(JSON.parse(await file.text()));
      setFileName(file.name);
    } catch {
      setData(null);
      setError('文件不是合法的 JSON');
    }
  };

  const runPreview = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await post({ action: 'preview', type, data });
      setPreview(response);
      setDecisions({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '预览失败');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const response = await post({
        action: 'commit',
        type,
        data,
        mode,
        decisions,
        fingerprint: preview.fingerprint,
      });
      const s = response.summary || {};
      setResult(
        `导入完成：新增 ${s.added || 0}，更新 ${s.updated || 0}，跳过 ${
          s.skipped || 0
        }，无变化 ${s.unchanged || 0}${
          response.refreshing
            ? `；${response.refreshing} 个直播源后台抓取中`
            : ''
        }`,
      );
      setPreview(null);
      await onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : '导入失败';
      setError(message);
      // 配置在预览后变化：要求重新预览，不用旧预览覆盖新修改。
      if (message.includes('重新预览')) setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const applyRest = (decision: Decision) =>
    setDecisions((prev) => {
      const next = { ...prev };
      preview?.conflicts.forEach((item) => {
        if (!next[item.key]) next[item.key] = decision;
      });
      return next;
    });

  const formatValue = (value: unknown) =>
    value === undefined || value === '' ? '—' : String(value);

  return createPortal(
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
      <div className='flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl dark:bg-gray-800'>
        <div className='flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
          <button
            onClick={onClose}
            className='text-gray-500 hover:text-gray-700 dark:text-gray-400'
            aria-label='关闭'
          >
            <X size={20} />
          </button>
        </div>
        <div className='flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm'>
          <label className='flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/50'>
            <Upload size={16} />
            <span>
              {fileName || '选择 JSON 文件（数组、配置格式或 key 映射）'}
            </span>
            <input
              type='file'
              accept='.json,application/json'
              className='hidden'
              onChange={(e) =>
                e.target.files?.[0] && readFile(e.target.files[0])
              }
            />
          </label>

          <div className='grid gap-2 sm:grid-cols-2'>
            {MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-lg border px-3 py-2 ${
                  mode === option.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <input
                  type='radio'
                  className='mr-2'
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                />
                <span className='font-medium text-gray-900 dark:text-gray-100'>
                  {option.label}
                </span>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  {option.hint}
                </p>
              </label>
            ))}
          </div>
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            按 key 判断是否同一条；导入文件中不存在的已有源不会被删除。
          </p>

          {preview && (
            <div className='space-y-3'>
              <div className='flex flex-wrap gap-3 text-gray-700 dark:text-gray-300'>
                <span>新增 {preview.added.length}</span>
                <span>冲突 {preview.conflicts.length}</span>
                <span>无变化 {preview.unchanged.length}</span>
              </div>
              {mode === 'ask' && preview.conflicts.length > 0 && (
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-gray-600 dark:text-gray-400'>
                    剩余 {undecided} 项统一：
                  </span>
                  {(['smart', 'overwrite', 'skip'] as Decision[]).map((d) => (
                    <button
                      key={d}
                      className={buttonStyles.secondarySmall}
                      onClick={() => applyRest(d)}
                    >
                      {DECISION_LABEL[d]}
                    </button>
                  ))}
                </div>
              )}
              {preview.conflicts.length > 0 && (
                <div className='overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700'>
                  <table className='min-w-full text-xs'>
                    <thead className='bg-gray-50 dark:bg-gray-900/40'>
                      <tr>
                        <th className='px-3 py-2 text-left'>key</th>
                        <th className='px-3 py-2 text-left'>
                          变化字段（现有 → 导入）
                        </th>
                        {mode === 'ask' && (
                          <th className='px-3 py-2 text-left'>处理</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                      {preview.conflicts.map((item) => (
                        <tr key={item.key}>
                          <td className='px-3 py-2 align-top font-mono'>
                            {item.key}
                          </td>
                          <td className='px-3 py-2'>
                            {item.changes.map((field) => (
                              <div key={field} className='break-all'>
                                <span className='font-medium'>{field}</span>
                                {item.overriddenFields.includes(field) && (
                                  <span className='ml-1 rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'>
                                    已人工修改
                                  </span>
                                )}
                                ：{formatValue(item.existing[field])} →{' '}
                                {formatValue(item.incoming[field])}
                              </div>
                            ))}
                          </td>
                          {mode === 'ask' && (
                            <td className='px-3 py-2 align-top'>
                              <select
                                value={decisions[item.key] || ''}
                                onChange={(e) =>
                                  setDecisions((prev) => ({
                                    ...prev,
                                    [item.key]: e.target.value as Decision,
                                  }))
                                }
                                className='rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700'
                              >
                                <option value=''>请选择</option>
                                <option value='smart'>智能</option>
                                <option value='overwrite'>覆盖</option>
                                <option value='skip'>跳过</option>
                              </select>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {error && (
            <p className='rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/20 dark:text-red-300'>
              {error}
            </p>
          )}
          {result && (
            <p className='rounded-lg bg-green-50 px-3 py-2 text-green-700 dark:bg-green-900/20 dark:text-green-300'>
              {result}
            </p>
          )}
        </div>
        <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700'>
          <button onClick={onClose} className={buttonStyles.secondary}>
            {result ? '关闭' : '取消'}
          </button>
          {!preview ? (
            <button
              onClick={runPreview}
              disabled={!data || busy}
              className={
                !data || busy ? buttonStyles.disabled : buttonStyles.primary
              }
            >
              {busy ? '处理中…' : '预览'}
            </button>
          ) : (
            <button
              onClick={commit}
              disabled={busy || (mode === 'ask' && undecided > 0)}
              className={
                busy || (mode === 'ask' && undecided > 0)
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }
            >
              {busy ? '提交中…' : '确认导入'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
