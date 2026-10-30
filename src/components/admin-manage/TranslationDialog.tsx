'use client';

import { X } from 'lucide-react';
import { ComponentRef, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createSseParser } from '@/lib/translation/sse.mjs';

import { buttonStyles } from './admin-shared';

export interface TranslationItem {
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

interface TranslationEvent {
  type: string;
  message?: string;
  model?: string;
  messages?: { role: string; content: string }[];
  delta?: string;
  item?: TranslationItem;
}

export default function TranslationDialog({
  text,
  onComplete,
  onClose,
  body,
}: {
  text: string;
  body?: Record<string, unknown>;
  onComplete: (item: TranslationItem) => void;
  onClose: () => void;
}) {
  const dialog = useRef<ComponentRef<'dialog'>>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<string[]>([]);
  const [request, setRequest] = useState<TranslationEvent | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [content, setContent] = useState('');
  const [result, setResult] = useState<TranslationItem | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    const abort = new AbortController();
    // Defer the request so React Strict Mode's discarded effect cannot call the model.
    const timer = setTimeout(() => {
      void (async () => {
        let terminal = false;
        const response = await fetch('/api/admin/manage/translations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            ...(body || { action: 'translate_once', text }),
            stream: true,
          }),
          signal: abort.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `请求失败：${response.status}`);
        }
        if (
          !response.body ||
          !response.headers.get('content-type')?.includes('text/event-stream')
        )
          throw new Error('服务器未返回翻译进度流');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser((data: string) => {
          if (abort.signal.aborted || terminal) return;
          const event = JSON.parse(data) as TranslationEvent;
          const message = event.message;
          if (event.type === 'status' && message)
            setProgress((prev) => [...prev, message]);
          if (event.type === 'request') {
            setRequest(event);
            setReasoning('');
            setContent('');
          }
          if (event.type === 'reasoning')
            setReasoning((prev) => prev + (event.delta || ''));
          if (event.type === 'content')
            setContent((prev) => prev + (event.delta || ''));
          if (event.type === 'error') {
            terminal = true;
            setError(event.message || '翻译失败');
          }
          if (event.type === 'complete') {
            if (!event.item && !body) throw new Error('翻译完成事件缺少结果');
            terminal = true;
            if (event.item) setResult(event.item);
            setProgress((prev) => [
              ...prev,
              event.message || '翻译完成，结果已保存',
            ]);
            if (event.item) onComplete(event.item);
          }
        });
        try {
          while (!terminal) {
            const { value, done } = await reader.read();
            if (done) break;
            parser.push(decoder.decode(value, { stream: true }));
          }
          parser.push(decoder.decode());
          parser.finish();
          if (!terminal)
            throw new Error('进度连接已中断，请手动刷新确认结果；不会自动重试');
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      })()
        .catch((err: unknown) => {
          if (!abort.signal.aborted)
            setError(err instanceof Error ? err.message : '翻译失败');
        })
        .finally(() => {
          if (!abort.signal.aborted) setRunning(false);
        });
    }, 0);
    const element = dialog.current;
    return () => {
      clearTimeout(timer);
      abort.abort();
      element?.close();
    };
  }, [text, onComplete, body]);

  return createPortal(
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby='translation-dialog-title'
      className='fixed inset-0 m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/50 dark:bg-gray-800 dark:text-gray-100'
    >
      <div className='flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700'>
        <h3 id='translation-dialog-title' className='font-semibold'>
          手动翻译 · {running ? '进行中' : error ? '失败' : '已完成'}
        </h3>
        <button
          onClick={onClose}
          aria-label={running ? '停止等待并关闭' : '关闭'}
        >
          <X size={20} />
        </button>
      </div>
      <div className='space-y-3 px-5 py-4 text-sm'>
        <div className='rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20'>
          <p className='mb-1 text-xs text-blue-600 dark:text-blue-300'>
            后端 → 大模型{request?.model ? ` · ${request.model}` : ''}
          </p>
          <p className='break-all'>{text}</p>
          {request && (
            <details className='mt-2 text-xs'>
              <summary className='cursor-pointer'>查看请求对话</summary>
              {request.messages?.map((message, index) => (
                <div key={index} className='mt-2'>
                  <b>{message.role}</b>
                  <pre className='whitespace-pre-wrap break-all'>
                    {message.content}
                  </pre>
                </div>
              ))}
            </details>
          )}
        </div>
        <div className='rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50'>
          <p className='mb-1 text-xs text-purple-600 dark:text-purple-300'>
            大模型 · 深度思考
          </p>
          <pre className='max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans'>
            {reasoning ||
              (running
                ? '等待模型返回思考内容…'
                : '模型接口未返回可展示的思考内容')}
          </pre>
        </div>
        <div className='rounded-lg bg-green-50 p-3 dark:bg-green-900/20'>
          <p className='mb-1 text-xs text-green-700 dark:text-green-300'>
            大模型 → 后端
          </p>
          <pre className='max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-sans'>
            {content || (running ? '等待回复…' : '无回复内容')}
          </pre>
          {result && (
            <p className='mt-2 font-medium'>
              {result.needsTranslation === 'no'
                ? '无需翻译'
                : `译文：${result.translation}`}
            </p>
          )}
        </div>
        <div
          role='status'
          className='space-y-1 text-xs text-gray-500 dark:text-gray-400'
        >
          {progress.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
        {error && (
          <p role='alert' className='text-red-600 dark:text-red-400'>
            {error}
          </p>
        )}
        {running && (
          <p className='text-xs text-gray-500'>
            {body
              ? '关闭仅停止显示，后台批量任务会继续；完成后可手动刷新查看结果。'
              : '关闭会停止等待并尝试取消请求；已保存的结果不受影响，可手动刷新确认。'}
          </p>
        )}
      </div>
      <div className='flex justify-end border-t border-gray-200 px-5 py-3 dark:border-gray-700'>
        <button onClick={onClose} className={buttonStyles.secondary}>
          {running ? '停止等待并关闭' : '关闭'}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
