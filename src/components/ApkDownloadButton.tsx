'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  Smartphone,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useId, useRef, useState } from 'react';

import {
  APK_CLIENT_PLAYBACK_NOTICE,
  APK_DOWNLOAD_HEADLINE,
  APK_WEB_PLAYBACK_NOTICE,
} from '@/lib/apk-download';

import { useSite } from './SiteProvider';

export default function ApkDownloadButton({
  compact = false,
  variant = 'button',
}: {
  compact?: boolean;
  variant?: 'button' | 'recommendation';
}) {
  const { apkDownloadUrl } = useSite();
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );
  const linkRef = useRef<HTMLInputElement>(null);
  const linkId = useId();
  if (!apkDownloadUrl) return null;

  const showDownload = () => {
    setCopyState('idle');
    setOpen(true);
  };

  const copyLink = async () => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(apkDownloadUrl);
        copied = true;
      }
    } catch {
      // Older browsers or denied clipboard permission can still use selection copy.
    }
    if (!copied) {
      try {
        linkRef.current?.focus();
        linkRef.current?.select();
        copied = document.execCommand('copy');
      } catch {
        // Leave the link selected for manual copying.
      }
    }
    setCopyState(copied ? 'copied' : 'failed');
  };

  return (
    <>
      {variant === 'recommendation' ? (
        <section
          aria-label='安卓客户端推荐'
          className='mt-6 rounded-2xl border border-purple-300/60 bg-linear-to-br from-purple-50/95 to-fuchsia-50/90 p-4 text-left shadow-sm dark:border-purple-500/30 dark:from-purple-950/70 dark:to-fuchsia-950/50'
        >
          <div className='flex items-start gap-2.5'>
            <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white'>
              <Smartphone className='h-5 w-5' aria-hidden='true' />
            </span>
            <div>
              <h2 className='text-sm font-bold text-purple-950 dark:text-purple-100'>
                {APK_DOWNLOAD_HEADLINE}
              </h2>
              <p className='mt-1 text-xs font-medium text-purple-700 dark:text-purple-300'>
                点播 · 直播 · 封面预览，优先直连
              </p>
            </div>
          </div>
          <p className='mt-3 text-xs leading-5 text-gray-600 dark:text-gray-300'>
            {APK_WEB_PLAYBACK_NOTICE}
          </p>
          <p className='mt-1 text-xs font-medium leading-5 text-purple-800 dark:text-purple-200'>
            {APK_CLIENT_PLAYBACK_NOTICE}
          </p>
          <div className='mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2'>
            <a
              href={apkDownloadUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-purple-600 px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-purple-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500'
            >
              <Download className='h-4 w-4' aria-hidden='true' />
              下载安卓客户端
            </a>
            <button
              type='button'
              onClick={showDownload}
              aria-haspopup='dialog'
              className='inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-purple-300 bg-white/80 px-2 py-2 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-purple-600 dark:bg-purple-950/50 dark:text-purple-200 dark:hover:bg-purple-900'
            >
              <QrCode className='h-4 w-4' aria-hidden='true' />
              扫码 / 复制链接
            </button>
          </div>
        </section>
      ) : (
        <button
          type='button'
          onClick={showDownload}
          className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-green-500/25 bg-green-50 px-3 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500 dark:bg-green-950/70 dark:text-green-300 dark:hover:bg-green-900 ${compact ? 'w-9 px-0 sm:w-auto sm:px-3' : ''}`}
          aria-label='APK 下载'
          aria-haspopup='dialog'
          title={`${APK_DOWNLOAD_HEADLINE}。${APK_WEB_PLAYBACK_NOTICE}`}
        >
          <Download className='h-4 w-4' aria-hidden='true' />
          <span className={compact ? 'hidden sm:inline' : ''}>APK 下载</span>
        </button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        className='relative z-[1100]'
      >
        <div className='fixed inset-0 bg-black/50' aria-hidden='true' />
        <div className='fixed inset-0 flex items-center justify-center overflow-y-auto p-4'>
          <DialogPanel className='relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900'>
            <button
              type='button'
              onClick={() => setOpen(false)}
              aria-label='关闭 APK 下载窗口'
              className='absolute right-3 top-3 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            >
              <X className='h-5 w-5' aria-hidden='true' />
            </button>
            <DialogTitle className='pr-8 text-xl font-semibold text-gray-900 dark:text-gray-100'>
              安卓客户端下载
            </DialogTitle>
            <div className='mt-4 rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/50'>
              <p className='text-sm font-semibold text-purple-900 dark:text-purple-200'>
                {APK_DOWNLOAD_HEADLINE}
              </p>
              <p className='mt-2 text-xs leading-5 text-gray-600 dark:text-gray-300'>
                {APK_WEB_PLAYBACK_NOTICE}
              </p>
              <p className='mt-1 text-xs font-medium leading-5 text-purple-800 dark:text-purple-200'>
                {APK_CLIENT_PLAYBACK_NOTICE}
              </p>
            </div>
            <p className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
              扫描二维码进入下载页，或打开、复制下方链接。
            </p>
            <div className='mx-auto my-5 w-fit rounded-xl bg-white p-3'>
              <QRCodeSVG
                value={apkDownloadUrl}
                size={208}
                level='M'
                marginSize={4}
                title='扫描进入 APK 下载页'
              />
            </div>
            <label
              htmlFor={linkId}
              className='text-sm font-medium text-gray-700 dark:text-gray-300'
            >
              下载页链接
            </label>
            <input
              ref={linkRef}
              id={linkId}
              readOnly
              value={apkDownloadUrl}
              onFocus={(event) => event.currentTarget.select()}
              className='mt-2 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
            />
            <div className='mt-4 grid grid-cols-2 gap-3'>
              <button
                type='button'
                onClick={() => void copyLink()}
                className='inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
              >
                {copyState === 'copied' ? (
                  <Check className='h-4 w-4' />
                ) : (
                  <Copy className='h-4 w-4' />
                )}
                {copyState === 'copied' ? '已复制' : '复制链接'}
              </button>
              <a
                href={apkDownloadUrl}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-green-700'
              >
                <ExternalLink className='h-4 w-4' />
                打开下载页
              </a>
            </div>
            <p
              role='status'
              className='mt-3 min-h-5 text-xs text-gray-500 dark:text-gray-400'
            >
              {copyState === 'failed'
                ? '自动复制失败，链接已选中，请长按或手动复制。'
                : copyState === 'copied'
                  ? '下载链接已复制。'
                  : ''}
            </p>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
