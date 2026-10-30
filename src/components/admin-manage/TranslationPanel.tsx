'use client';

import { Languages, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { buttonStyles } from './admin-shared';
import {
  formatTime,
  Notice,
  Pager,
  postJson,
  QueryButton,
  SearchBox,
  useJson,
} from './manage-ui';

interface Item {
  text: string;
  translation: string;
  needsTranslation: 'unknown' | 'yes' | 'no';
  status: string;
  failCount: number;
  lastError: string;
  nextAttemptAt: number;
  resultSource: string;
  updatedAt: number;
}
interface ListResponse {
  total: number;
  items: Item[];
  counts: Record<string, number>;
}
interface StatusResponse {
  backgroundSupported: boolean;
  activeId: string | null;
  automaticEnabled: boolean;
  systemPrompt: string;
  defaultSystemPrompt: string;
  manualTask: { total: number; completed: number; nextBatch: boolean } | null;
  worker: {
    lastRoundAt?: number;
    lastClaimed?: number;
    lastSucceeded?: number;
    lastFailed?: number;
    lastStop?: string;
    lastStopAt?: number;
    sleepingUntil?: number;
    lastProtocolErrors?: string[];
    lastManualTotal?: number;
    lastManualCompleted?: number;
    lastManualSucceeded?: number;
    lastManualFailed?: number;
    lastManualError?: string;
  };
}

const API = '/api/admin/manage/translations';
const STATUS_LABEL: Record<string, string> = {
  pending: '待翻译',
  processing: '处理中',
  retry_wait: '待重试',
  success: '成功',
  no_need: '无需翻译',
  failed: '失败（已停止自动重试）',
};
const STATUS_STYLE: Record<string, string> = {
  success:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  no_need: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  retry_wait:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  processing:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};
const NEEDS_LABEL = { unknown: '未知', yes: '是', no: '否' };
const BATCH_STATUS_LABEL: Record<string, string> = {
  pending: '待翻译（清零失败并重新排队）',
  no_need: '无需翻译',
  success: '成功（仅限已有译文）',
  failed: '失败（停止自动翻译）',
};
const SOURCE_LABEL: Record<string, string> = {
  model: '模型',
  manual: '人工',
  shared: '共享文件（旧）',
  '': '—',
};

function getErrorMessage(item: Item) {
  if (item.status === 'failed')
    return `已停止自动重试（累计失败 ${item.failCount} 次）`;
  return item.lastError || '—';
}

export default function TranslationPanel() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [needs, setNeeds] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const list = useJson<ListResponse>(
    `${API}?q=${encodeURIComponent(q)}&status=${status}&needs=${needs}&page=${page}&pageSize=${pageSize}`,
  );
  const state = useJson<StatusResponse>(`${API}?view=status`);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState({ text: '', translation: '', needs: 'yes' });
  const [busyRow, setBusyRow] = useState('');
  const [message, setMessage] = useState<{
    kind: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);

  // 批量选择：勾选的原文，或「全部筛选结果」（由服务端按同一筛选条件选中）。
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [batchNeeds, setBatchNeeds] = useState('');
  const [batchStatus, setBatchStatus] = useState('');
  const [prompt, setPrompt] = useState('');

  const savedPrompt = state.data?.systemPrompt;
  useEffect(() => {
    if (savedPrompt !== undefined) setPrompt(savedPrompt);
  }, [savedPrompt]);

  const reloadList = list.reload;
  const reloadState = state.reload;
  const manualPending = !!state.data?.manualTask;
  useEffect(() => {
    if (!manualPending) return;
    const timer = setInterval(() => {
      reloadList();
      reloadState();
    }, 3000);
    return () => clearInterval(timer);
  }, [manualPending, reloadList, reloadState]);

  useEffect(() => setPage(1), [q, status, needs, pageSize]);
  useEffect(() => {
    setSelected(new Set());
    setAllFiltered(false);
  }, [q, status, needs]);

  const pageTexts = (list.data?.items || []).map((item) => item.text);
  const pageAllSelected =
    pageTexts.length > 0 && pageTexts.every((text) => selected.has(text));
  const selectedCount = allFiltered ? list.data?.total || 0 : selected.size;
  const toggleRow = (text: string, checked: boolean) => {
    setAllFiltered(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(text);
      else next.delete(text);
      return next;
    });
  };
  const togglePage = (checked: boolean) => {
    setAllFiltered(false);
    setSelected((prev) => {
      const next = new Set(prev);
      pageTexts.forEach((text) =>
        checked ? next.add(text) : next.delete(text),
      );
      return next;
    });
  };
  const applyBatch = async () => {
    const target = allFiltered
      ? `全部筛选结果 ${selectedCount} 条`
      : `选中的 ${selectedCount} 条`;
    const changes = [
      batchNeeds &&
        `需要翻译改为「${NEEDS_LABEL[batchNeeds as keyof typeof NEEDS_LABEL]}」`,
      batchStatus && `状态改为「${BATCH_STATUS_LABEL[batchStatus]}」`,
    ]
      .filter(Boolean)
      .join('，');
    if (!window.confirm(`确定把${target}${changes}？`)) return;
    const ok = await act(
      {
        action: 'batch_update',
        ...(allFiltered
          ? { filter: { q, status, needs } }
          : { texts: Array.from(selected) }),
        needsTranslation: batchNeeds || undefined,
        status: batchStatus || undefined,
      },
      '批量修改完成：已更新 {updated} 条，跳过 {skipped} 条（不适用）',
    );
    if (ok) {
      setSelected(new Set());
      setAllFiltered(false);
    }
  };

  const translateSelection = async () => {
    const ok = await act(
      {
        action: 'translate_batch',
        ...(allFiltered
          ? { filter: { q, status, needs } }
          : { texts: Array.from(selected) }),
      },
      '已提交 {total} 条手动翻译，每批最多 100 条，不受自动额度限制',
    );
    if (ok) {
      setSelected(new Set());
      setAllFiltered(false);
    }
  };

  const act = async (
    body: Record<string, unknown>,
    success: string,
    row = '',
  ) => {
    setBusyRow(row || '__global__');
    setMessage(null);
    try {
      const data = await postJson(API, body);
      setMessage({
        kind: 'success',
        text: success
          .replace('{created}', String(data.created ?? 0))
          .replace('{updated}', String(data.updated ?? 0))
          .replace('{total}', String(data.total ?? 0))
          .replace('{skipped}', String(data.skipped ?? 0)),
      });
      list.reload();
      state.reload();
      return true;
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '操作失败',
      });
      return false;
    } finally {
      setBusyRow('');
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (form.text !== editing.text) {
      if (
        !(await act(
          { action: 'rekey', text: editing.text, newText: form.text },
          '原文已修改',
        ))
      )
        return;
    }
    if (
      await act(
        {
          action: 'edit',
          text: form.text,
          translation: form.needs === 'no' ? '' : form.translation,
          needsTranslation: form.needs,
        },
        '已保存，立即生效',
      )
    )
      setEditing(null);
  };

  const s = state.data;
  const counts = list.data?.counts || {};

  return (
    <div className='space-y-4'>
      <div className='rounded-xl bg-white/80 p-4 text-sm shadow-sm dark:bg-gray-800/50'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap gap-x-4 gap-y-1 text-gray-700 dark:text-gray-300'>
            {Object.entries(STATUS_LABEL).map(([key, label]) => (
              <span key={key}>
                {label} {counts[key] || 0}
              </span>
            ))}
          </div>
          <div className='flex flex-wrap gap-2'>
            <button
              disabled={!!busyRow}
              className={`${buttonStyles.primarySmall} inline-flex items-center gap-1`}
              onClick={() =>
                act(
                  { action: 'collect_history' },
                  '已扫描现有频道缓存，新增 {created} 条待翻译原文',
                )
              }
              title='扫描已有频道缓存，补入缺失的原文'
            >
              <Languages size={14} /> 收集历史原文
            </button>
            <button
              disabled={!!busyRow || manualPending || !s?.backgroundSupported}
              className={`${buttonStyles.secondarySmall} inline-flex items-center gap-1`}
              title='手动处理下一批待翻译记录，最多 100 条，不检查或扣减自动额度，不自动重试'
              onClick={() =>
                act(
                  { action: 'run_now' },
                  '已提交手动翻译一轮，最多 100 条，不扣自动额度',
                )
              }
            >
              <RefreshCw size={14} /> 手动执行一轮
            </button>
          </div>
        </div>
        {s && (
          <div className='mt-3 grid gap-1 text-xs text-gray-600 dark:text-gray-400 md:grid-cols-2'>
            <span>
              自动翻译：
              {s.backgroundSupported
                ? s.automaticEnabled
                  ? '已开启（每轮最多 100 条，不足则休眠 2 分钟）'
                  : '已关闭（新词只入库，等待手动执行）'
                : '无数据库模式，不运行'}
            </span>
            <span>
              启用模型：{s.activeId ? '已启用' : '未启用（只展示已有译文）'}
            </span>
            <span>
              上一轮：{formatTime(s.worker.lastRoundAt)}，取{' '}
              {s.worker.lastClaimed ?? 0} 条，成功 {s.worker.lastSucceeded ?? 0}
              ，失败 {s.worker.lastFailed ?? 0}
            </span>
            <span>
              下次自动扫描：
              {s.automaticEnabled
                ? formatTime(s.worker.sleepingUntil)
                : '已关闭'}
            </span>
            {s.manualTask && (
              <span className='text-blue-600 md:col-span-2'>
                {s.manualTask.nextBatch
                  ? '手动一轮已排队或正在执行（最多 100 条）'
                  : `手动批量翻译中：已处理 ${s.manualTask.completed} / ${s.manualTask.total} 条`}
              </span>
            )}
            {!s.manualTask && s.worker.lastManualTotal !== undefined && (
              <span className='md:col-span-2'>
                最近手动批量：已处理 {s.worker.lastManualCompleted} /{' '}
                {s.worker.lastManualTotal} 条， 成功{' '}
                {s.worker.lastManualSucceeded}，失败或未更新{' '}
                {s.worker.lastManualFailed}
              </span>
            )}
            {s.worker.lastManualError && (
              <span className='text-red-600 md:col-span-2'>
                手动任务中止：{s.worker.lastManualError}
              </span>
            )}
            {s.worker.lastStop && (
              <span className='text-amber-600 md:col-span-2'>
                最近中止（{formatTime(s.worker.lastStopAt)}）：
                {s.worker.lastStop}
              </span>
            )}
            {!!s.worker.lastProtocolErrors?.length && (
              <span className='text-amber-600 md:col-span-2'>
                最近格式问题：{s.worker.lastProtocolErrors.join('；')}
              </span>
            )}
          </div>
        )}
        <label className='mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
          <input
            type='checkbox'
            checked={s?.automaticEnabled ?? false}
            disabled={!!busyRow || !s?.backgroundSupported}
            onChange={(event) => {
              const enabled = event.target.checked;
              void act(
                { action: 'set_automatic', enabled },
                enabled
                  ? '已开启自动扫描翻译，自动调用受额度限制'
                  : '已关闭自动翻译，新词只入库；正在执行的请求完成后停止后续自动调用',
              );
            }}
          />
          自动扫描并翻译
          <span className='text-xs text-gray-500'>
            默认关闭；手动执行与所选批量翻译不受自动额度限制。
          </span>
        </label>
      </div>

      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {state.error && <Notice kind='error'>{state.error}</Notice>}

      <details className='rounded-xl bg-white/80 p-4 shadow-sm dark:bg-gray-800/50'>
        <summary className='cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200'>
          翻译提示词（可编辑）
        </summary>
        <p className='mt-3 text-xs text-gray-500'>
          默认使用当前内置提示词，保存后用于后续所有翻译请求。请保留
          items、id、needsTranslation、translation 的 JSON 返回格式。
        </p>
        <textarea
          aria-label='翻译系统提示词'
          rows={12}
          maxLength={20000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={!s || !!busyRow}
          className='mt-3 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
        />
        <div className='mt-2 flex gap-2'>
          <button
            className={buttonStyles.primarySmall}
            disabled={
              !!busyRow || !prompt.trim() || prompt.trim() === s?.systemPrompt
            }
            onClick={() =>
              act(
                { action: 'set_prompt', prompt },
                '翻译提示词已保存，后续请求使用新提示词',
              )
            }
          >
            保存提示词
          </button>
          <button
            className={buttonStyles.secondarySmall}
            disabled={!!busyRow || !s}
            onClick={async () => {
              if (
                await act(
                  { action: 'set_prompt', useDefault: true },
                  '已恢复默认翻译提示词',
                )
              )
                setPrompt(s?.defaultSystemPrompt || '');
            }}
          >
            恢复默认
          </button>
        </div>
      </details>

      <div className='rounded-xl bg-white/80 p-4 shadow-sm dark:bg-gray-800/50'>
        <div className='mb-3 flex flex-wrap items-center gap-2'>
          <SearchBox value={q} onChange={setQ} placeholder='搜索原文或译文' />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className='rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700'
          >
            <option value=''>全部状态</option>
            {Object.entries(STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={needs}
            onChange={(e) => setNeeds(e.target.value)}
            className='rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700'
          >
            <option value=''>是否需翻译：全部</option>
            <option value='unknown'>未知</option>
            <option value='yes'>是</option>
            <option value='no'>否</option>
          </select>
          <QueryButton
            loading={list.loading || state.loading}
            onQuery={() => {
              list.reload();
              state.reload();
            }}
          />
        </div>
        <div className='mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-300'>
          <span className='font-medium'>
            {allFiltered
              ? `已选全部筛选结果 ${selectedCount} 条`
              : `已选 ${selectedCount} 条`}
          </span>
          <button
            className={buttonStyles.secondarySmall}
            onClick={() => {
              setSelected(new Set());
              setAllFiltered(true);
            }}
            disabled={!list.data?.total}
            title='按当前搜索和筛选条件选中所有页的结果'
          >
            全选筛选结果（{list.data?.total ?? 0}）
          </button>
          <button
            className={buttonStyles.secondarySmall}
            onClick={() => {
              setSelected(new Set());
              setAllFiltered(false);
            }}
          >
            清空选择
          </button>
          <span className='mx-1 hidden h-5 w-px bg-gray-300 sm:inline-block dark:bg-gray-600' />
          <select
            value={batchNeeds}
            onChange={(e) => setBatchNeeds(e.target.value)}
            className='rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700'
          >
            <option value=''>需要翻译：不修改</option>
            <option value='yes'>需要翻译：是（强制翻译）</option>
            <option value='unknown'>需要翻译：未知</option>
            <option value='no'>需要翻译：否</option>
          </select>
          <select
            value={batchStatus}
            onChange={(e) => setBatchStatus(e.target.value)}
            className='rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700'
          >
            <option value=''>状态：不修改</option>
            {Object.entries(BATCH_STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                状态：{label}
              </option>
            ))}
          </select>
          <button
            className={
              !selectedCount || (!batchNeeds && !batchStatus) || !!busyRow
                ? buttonStyles.disabledSmall
                : buttonStyles.primarySmall
            }
            disabled={
              !selectedCount || (!batchNeeds && !batchStatus) || !!busyRow
            }
            onClick={applyBatch}
          >
            批量修改
          </button>
          <button
            className={
              !selectedCount || !!busyRow || manualPending
                ? buttonStyles.disabledSmall
                : buttonStyles.successSmall
            }
            disabled={
              !selectedCount ||
              !!busyRow ||
              manualPending ||
              !s?.backgroundSupported
            }
            title='仅翻译选中的记录；全选筛选结果时跨所有页执行。每批最多 100 条，不扣自动额度，不自动重试'
            onClick={translateSelection}
          >
            手动翻译所选（{selectedCount}）
          </button>
        </div>
        {list.error && <Notice kind='error'>{list.error}</Notice>}
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[52rem] text-sm'>
            <thead className='whitespace-nowrap bg-gray-50 text-left text-gray-600 dark:bg-gray-900/40 dark:text-gray-300'>
              <tr>
                <th className='px-3 py-2'>
                  <input
                    type='checkbox'
                    aria-label='选择本页'
                    checked={allFiltered || pageAllSelected}
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                </th>
                <th className='px-3 py-2'>原文</th>
                <th className='px-3 py-2'>译文</th>
                <th className='px-3 py-2'>需翻译</th>
                <th className='px-3 py-2'>状态</th>
                <th className='px-3 py-2'>失败次数</th>
                <th className='px-3 py-2'>来源</th>
                <th className='px-3 py-2'>最近错误</th>
                <th className='px-3 py-2'>更新时间</th>
                <th className='px-3 py-2 text-right'>操作</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
              {(list.data?.items || []).map((item) => (
                <tr key={item.text}>
                  <td className='px-3 py-2'>
                    <input
                      type='checkbox'
                      aria-label={`选择 ${item.text}`}
                      checked={allFiltered || selected.has(item.text)}
                      onChange={(e) => toggleRow(item.text, e.target.checked)}
                    />
                  </td>
                  <td className='max-w-[14rem] break-all px-3 py-2 text-gray-900 dark:text-gray-100'>
                    {item.text}
                  </td>
                  <td className='max-w-[12rem] break-all px-3 py-2 text-gray-700 dark:text-gray-300'>
                    {item.translation || '—'}
                  </td>
                  <td className='px-3 py-2'>
                    {NEEDS_LABEL[item.needsTranslation]}
                  </td>
                  <td className='px-3 py-2'>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[item.status] || ''}`}
                    >
                      {STATUS_LABEL[item.status] || item.status}
                    </span>
                  </td>
                  <td className='px-3 py-2 text-center'>{item.failCount}</td>
                  <td className='px-3 py-2'>
                    {SOURCE_LABEL[item.resultSource] ?? item.resultSource}
                  </td>
                  <td
                    className='max-w-[14rem] break-words px-3 py-2 text-xs text-red-600 dark:text-red-400'
                    title={
                      item.status === 'failed'
                        ? `${getErrorMessage(item)}\n最近失败原因：${item.lastError || '未记录'}`
                        : item.lastError
                    }
                  >
                    {getErrorMessage(item)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-2 text-xs'>
                    {formatTime(item.updatedAt)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-2 text-right'>
                    <div className='flex justify-end gap-1'>
                      <button
                        className={buttonStyles.primarySmall}
                        onClick={() => {
                          setEditing(item);
                          setForm({
                            text: item.text,
                            translation: item.translation,
                            needs:
                              item.needsTranslation === 'no' ? 'no' : 'yes',
                          });
                        }}
                      >
                        编辑
                      </button>
                      <button
                        disabled={!!busyRow}
                        className={
                          busyRow === item.text
                            ? buttonStyles.disabledSmall
                            : buttonStyles.successSmall
                        }
                        title='使用当前启用模型翻译一次，不受自动额度限制，不自动重试'
                        onClick={() =>
                          act(
                            { action: 'translate_once', text: item.text },
                            `「${item.text}」手动翻译完成`,
                            item.text,
                          )
                        }
                      >
                        {busyRow === item.text ? '翻译中…' : '翻译一次'}
                      </button>
                      {(item.failCount > 0 || item.status === 'failed') && (
                        <button
                          disabled={!!busyRow}
                          className={buttonStyles.warningSmall}
                          title='清零失败次数并重新排队，仍受自动额度和批量规则限制'
                          onClick={() =>
                            act(
                              { action: 'reset', text: item.text },
                              '已重置失败次数并重新排队',
                              item.text,
                            )
                          }
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.loading && list.data?.items.length === 0 && (
            <p className='py-6 text-center text-sm text-gray-500'>
              暂无翻译记录
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

      {editing &&
        createPortal(
          <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
            <div className='w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-800'>
              <div className='flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  编辑翻译
                </h3>
                <button onClick={() => setEditing(null)} aria-label='关闭'>
                  <X size={20} className='text-gray-500' />
                </button>
              </div>
              <div className='space-y-3 px-5 py-4 text-sm'>
                <label className='block'>
                  <span className='mb-1 block text-gray-700 dark:text-gray-300'>
                    原文（修改即迁移缓存 key，不会修改频道原名）
                  </span>
                  <input
                    className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700'
                    value={form.text}
                    onChange={(e) => setForm({ ...form, text: e.target.value })}
                  />
                </label>
                <div className='flex gap-4 text-gray-700 dark:text-gray-300'>
                  <label className='flex items-center gap-1'>
                    <input
                      type='radio'
                      checked={form.needs === 'yes'}
                      onChange={() => setForm({ ...form, needs: 'yes' })}
                    />
                    需要翻译
                  </label>
                  <label className='flex items-center gap-1'>
                    <input
                      type='radio'
                      checked={form.needs === 'no'}
                      onChange={() => setForm({ ...form, needs: 'no' })}
                    />
                    无需翻译（终态）
                  </label>
                </div>
                {form.needs === 'yes' && (
                  <label className='block'>
                    <span className='mb-1 block text-gray-700 dark:text-gray-300'>
                      译文（只填中文部分）
                    </span>
                    <input
                      className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700'
                      value={form.translation}
                      onChange={(e) =>
                        setForm({ ...form, translation: e.target.value })
                      }
                    />
                  </label>
                )}
              </div>
              <div className='flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700'>
                <button
                  onClick={() => setEditing(null)}
                  className={buttonStyles.secondary}
                >
                  取消
                </button>
                <button
                  disabled={
                    !!busyRow ||
                    !form.text.trim() ||
                    (form.needs === 'yes' && !form.translation.trim())
                  }
                  onClick={saveEdit}
                  className={
                    !!busyRow ||
                    !form.text.trim() ||
                    (form.needs === 'yes' && !form.translation.trim())
                      ? buttonStyles.disabled
                      : buttonStyles.success
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
