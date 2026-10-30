'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  ACCESS_KEY_HINT,
  getAccessKey,
  setAccessKey,
} from '@/lib/access-key.client';

// 用户菜单「访问秘钥」弹窗：不校验，按设备保存在浏览器本地。
export default function AccessKeyDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const key = getAccessKey();
    setValue(key);
    setSaved(key);
  }, [isOpen]);

  const save = () => {
    const key = value.trim();
    setAccessKey(key);
    setSaved(key);
  };

  const clear = () => {
    setValue('');
    setAccessKey('');
    setSaved('');
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className='fixed inset-0 z-1000 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        className='w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex items-start justify-between gap-2'>
          <div>
            <h3 className='text-lg font-semibold text-gray-800 dark:text-gray-200'>
              访问秘钥
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              {ACCESS_KEY_HINT}
            </p>
          </div>
          <button onClick={onClose} aria-label='关闭'>
            <X className='h-5 w-5 text-gray-500' />
          </button>
        </div>
        <input
          type='text'
          autoComplete='off'
          spellCheck={false}
          placeholder='填写访问秘钥'
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
        <div className='flex items-center justify-between gap-2'>
          <span className='text-xs text-gray-500 dark:text-gray-400'>
            状态：{saved ? '已保存' : '未填写'}
          </span>
          <div className='flex gap-2'>
            <button
              type='button'
              onClick={clear}
              className='px-3 py-1 text-xs rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
            >
              清除
            </button>
            <button
              type='button'
              disabled={!value.trim()}
              onClick={save}
              className='px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
