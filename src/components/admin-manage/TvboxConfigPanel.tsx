/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState } from 'react';

import {
  AlertModal,
  showError,
  showSuccess,
  useAlertModal,
} from './admin-shared';

export default function TvboxConfigPanel() {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  // TVBox 配置相关状态
  const [tvboxFormat, setTvboxFormat] = useState<'json' | 'base64'>('json');
  const [tvboxMode, setTvboxMode] = useState<
    'standard' | 'safe' | 'yingshicang' | 'fast'
  >('fast');
  const [tvboxRegion, setTvboxRegion] = useState<'domestic' | 'international'>(
    'domestic',
  );
  const [tvboxJarMode, setTvboxJarMode] = useState<'proxy' | 'remote'>('proxy');
  const [tvboxAccessKey, setTvboxAccessKey] = useState('');
  const [tvboxDoubanEnabled, setTvboxDoubanEnabled] = useState(true);
  const [diagnosisResult, setDiagnosisResult] = useState<any>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  // JAR 状态监控相关状态
  const [jarStatus, setJarStatus] = useState<any>(null);
  const [isRefreshingJar, setIsRefreshingJar] = useState(false);
  const [isCheckingJar, setIsCheckingJar] = useState(false);

  // TVBox 配置相关函数
  const getTvboxConfigUrl = () => {
    // 优先使用显式配置的公网基址，避免出现 0.0.0.0、localhost 等不可用地址
    const envBase = (process.env.NEXT_PUBLIC_SITE_BASE || '')
      .trim()
      .replace(/\/$/, '');
    let baseUrl = envBase;
    if (!baseUrl) {
      if (typeof window !== 'undefined') {
        baseUrl = window.location.origin;
      } else {
        baseUrl = '';
      }
    }
    const params = new URLSearchParams({
      format: tvboxFormat,
      region: tvboxRegion,
    });
    if (tvboxMode !== 'standard') params.set('mode', tvboxMode);
    if (tvboxJarMode === 'remote') params.set('jar', 'remote');
    if (!tvboxDoubanEnabled) params.set('douban', 'off');
    return `${baseUrl}/api/tvbox/config?${params.toString()}`;
  };

  const getTvboxConfigUrlWithParam = (key: string, value: string) => {
    const url = getTvboxConfigUrl();
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  };

  const handleTvboxCopy = async () => {
    try {
      const url = getTvboxConfigUrl();
      await navigator.clipboard.writeText(url);
      showSuccess('复制成功！订阅地址已复制到剪贴板', showAlert);
    } catch {
      showError('复制失败，请手动复制地址', showAlert);
    }
  };

  // 连通性体检功能
  const handleDiagnosis = async () => {
    setIsDiagnosing(true);
    try {
      const response = await fetch('/api/tvbox/diagnose');
      const result = await response.json();
      setDiagnosisResult(result);

      if (result.pass) {
        showAlert({
          type: 'success',
          title: '🟢 配置健康检查通过',
          message: '配置可正常访问，JSON格式有效，连通性良好',
          timer: 3000,
        });
      } else {
        const issues = result.issues.join('；');
        showAlert({
          type: 'error',
          title: '🔴 配置健康检查失败',
          message: `发现问题：${issues}`,
        });
      }
    } catch (error) {
      showAlert({
        type: 'error',
        title: '体检失败',
        message: error instanceof Error ? error.message : '网络错误',
      });
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleTvboxTest = async () => {
    try {
      const url = getTvboxConfigUrl();
      const response = await fetch(url);
      if (response.ok) {
        showSuccess('配置测试成功！订阅地址可正常访问', showAlert);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      showError(
        `配置测试失败: ${err instanceof Error ? err.message : '网络错误'}`,
        showAlert,
      );
    }
  };

  // JAR 状态相关函数
  const handleCheckJarStatus = async () => {
    setIsCheckingJar(true);
    try {
      const response = await fetch('/api/tvbox/spider-status');
      const result = await response.json();
      setJarStatus(result);

      if (result.success && result.fresh_status.success) {
        showAlert({
          type: 'success',
          title: '🟢 JAR 状态正常',
          message: `源: ${result.fresh_status.source
            .split('/')
            .pop()}, 大小: ${Math.round(result.fresh_status.size / 1024)}KB`,
          timer: 3000,
        });
      } else {
        showAlert({
          type: 'warning',
          title: '⚠️ JAR 状态异常',
          message: result.fresh_status.is_fallback
            ? '正在使用内置备用JAR'
            : '远程JAR获取失败',
        });
      }
    } catch (error) {
      showAlert({
        type: 'error',
        title: 'JAR 状态检查失败',
        message: error instanceof Error ? error.message : '网络错误',
      });
    } finally {
      setIsCheckingJar(false);
    }
  };

  const handleRefreshJar = async () => {
    setIsRefreshingJar(true);
    try {
      const response = await fetch('/api/tvbox/spider-status', {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        setJarStatus(result);
        if (result.jar_status.success) {
          showAlert({
            type: 'success',
            title: '🎉 JAR 刷新成功',
            message: `已获取新的JAR文件，尝试了 ${result.jar_status.tried_sources} 个源`,
            timer: 3000,
          });
        } else {
          showAlert({
            type: 'warning',
            title: '⚠️ JAR 刷新完成',
            message: '远程源暂时不可用，正在使用内置备用JAR',
          });
        }
      } else {
        throw new Error(result.error || 'JAR 刷新失败');
      }
    } catch (error) {
      showAlert({
        type: 'error',
        title: 'JAR 刷新失败',
        message: error instanceof Error ? error.message : '网络错误',
      });
    } finally {
      setIsRefreshingJar(false);
    }
  };

  return (
    <>
      <div className='space-y-6 p-2 sm:p-4'>
        {/* 顶部：订阅链接生成器 (核心功能) */}
        <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
          <div className='p-5 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
            <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
              <span className='text-xl'>🔗</span> 订阅链接生成器
            </h3>
            <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
              支持标准 TVBox、猫影视、EasyBox 等主流播放器
            </p>
          </div>

          <div className='p-5 space-y-6'>
            {/* 链接输入框区域 */}
            <div className='flex flex-col sm:flex-row gap-3'>
              <div className='relative grow'>
                <input
                  type='text'
                  readOnly
                  className='w-full pl-4 pr-10 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono text-sm'
                  value={getTvboxConfigUrl()}
                />
                <div className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400'>
                  <svg
                    className='w-5 h-5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1'
                    />
                  </svg>
                </div>
              </div>
              <div className='flex gap-2 shrink-0'>
                <button
                  onClick={handleTvboxCopy}
                  className='flex-1 sm:flex-none px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all shadow-sm hover:shadow-md font-medium flex items-center justify-center gap-2'
                >
                  <svg
                    className='w-4 h-4'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3'
                    />
                  </svg>
                  复制
                </button>
                <button
                  onClick={handleTvboxTest}
                  className='flex-1 sm:flex-none px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all shadow-sm hover:shadow-md font-medium flex items-center justify-center gap-2'
                >
                  <svg
                    className='w-4 h-4'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z'
                    />
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    />
                  </svg>
                  测试
                </button>
              </div>
            </div>

            <div className='grid grid-cols-1 lg:grid-cols-12 gap-6'>
              {/* 左侧：格式选择 */}
              <div className='lg:col-span-4 space-y-3'>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                  <span className='w-1 h-4 bg-blue-500 rounded-full'></span>
                  输出格式
                </label>
                <div className='grid grid-cols-2 gap-3'>
                  {[
                    { value: 'json', label: 'JSON', icon: '{}' },
                    { value: 'base64', label: 'Base64', icon: 'B64' },
                  ].map((fmt) => (
                    <label
                      key={fmt.value}
                      className={`cursor-pointer relative flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                        tvboxFormat === fmt.value
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <input
                        type='radio'
                        name='tvboxFormat'
                        value={fmt.value}
                        checked={tvboxFormat === fmt.value}
                        onChange={(e) =>
                          setTvboxFormat(e.target.value as 'json' | 'base64')
                        }
                        className='sr-only'
                      />
                      <span className='text-lg font-bold font-mono mb-1'>
                        {fmt.icon}
                      </span>
                      <span className='text-xs font-medium'>{fmt.label}</span>
                      {tvboxFormat === fmt.value && (
                        <div className='absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full'></div>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* 右侧：模式选择 */}
              <div className='lg:col-span-8 space-y-3'>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                  <span className='w-1 h-4 bg-purple-500 rounded-full'></span>
                  配置模式
                </label>
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                  {[
                    {
                      id: 'standard',
                      name: '标准模式',
                      desc: '完整功能，兼容性好',
                      icon: '📱',
                    },
                    {
                      id: 'yingshicang',
                      name: '影视仓优化',
                      desc: '修复JAR兼容问题',
                      icon: '🔥',
                      highlight: true,
                    },
                    {
                      id: 'fast',
                      name: '快速切换',
                      desc: '优化SSL与卡顿',
                      icon: '⚡',
                      highlight: true,
                    },
                    {
                      id: 'safe',
                      name: '兼容模式',
                      desc: '仅基础字段，极简',
                      icon: '🛡️',
                    },
                  ].map((mode) => (
                    <label
                      key={mode.id}
                      className={`cursor-pointer relative flex items-start p-3 rounded-xl border transition-all ${
                        tvboxMode === mode.id
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 ring-1 ring-purple-500'
                          : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 bg-white dark:bg-gray-800'
                      }`}
                    >
                      <input
                        type='radio'
                        name='tvboxMode'
                        value={mode.id}
                        checked={tvboxMode === mode.id}
                        onChange={(e) => setTvboxMode(e.target.value as any)}
                        className='sr-only'
                      />
                      <div className='text-2xl mr-3 mt-1'>{mode.icon}</div>
                      <div className='flex-1 min-w-0'>
                        <div
                          className={`text-sm font-semibold ${
                            tvboxMode === mode.id
                              ? 'text-purple-700 dark:text-purple-300'
                              : 'text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          {mode.name}
                        </div>
                        <div className='text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate'>
                          {mode.desc}
                        </div>
                      </div>
                      {tvboxMode === mode.id && (
                        <div className='absolute top-3 right-3 text-purple-500'>
                          <svg
                            className='w-5 h-5'
                            fill='currentColor'
                            viewBox='0 0 20 20'
                          >
                            <path
                              fillRule='evenodd'
                              d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                              clipRule='evenodd'
                            />
                          </svg>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className='mt-5 grid grid-cols-1 xl:grid-cols-3 gap-4'>
              <div className='space-y-2'>
                <label className='text-xs font-semibold text-gray-600 dark:text-gray-400'>
                  JAR 读取方式
                </label>
                <div className='grid grid-cols-2 gap-2'>
                  {[
                    { value: 'proxy', label: '同源代理' },
                    { value: 'remote', label: '远程直连' },
                  ].map((item) => (
                    <label
                      key={item.value}
                      className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-xs font-medium transition-colors ${
                        tvboxJarMode === item.value
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      <input
                        type='radio'
                        name='tvboxJarMode'
                        value={item.value}
                        checked={tvboxJarMode === item.value}
                        onChange={(e) =>
                          setTvboxJarMode(e.target.value as 'proxy' | 'remote')
                        }
                        className='sr-only'
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className='space-y-2'>
                <label className='text-xs font-semibold text-gray-600 dark:text-gray-400'>
                  客户端地区
                </label>
                <div className='grid grid-cols-2 gap-2'>
                  {[
                    { value: 'domestic', label: '国内优先' },
                    { value: 'international', label: '国际优先' },
                  ].map((item) => (
                    <label
                      key={item.value}
                      className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-xs font-medium transition-colors ${
                        tvboxRegion === item.value
                          ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-sky-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      <input
                        type='radio'
                        name='tvboxRegion'
                        value={item.value}
                        checked={tvboxRegion === item.value}
                        onChange={(e) =>
                          setTvboxRegion(
                            e.target.value as 'domestic' | 'international',
                          )
                        }
                        className='sr-only'
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className='space-y-2'>
                <label className='text-xs font-semibold text-gray-600 dark:text-gray-400'>
                  豆瓣导航
                </label>
                <label className='flex h-9 cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'>
                  <span>{tvboxDoubanEnabled ? '已开启' : '已关闭'}</span>
                  <input
                    type='checkbox'
                    checked={tvboxDoubanEnabled}
                    onChange={(e) => setTvboxDoubanEnabled(e.target.checked)}
                    className='h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500'
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* 中部：成人内容过滤 (保持原有风格但微调) */}
        <div className='bg-linear-to-br from-pink-50 to-rose-50 dark:from-pink-900/10 dark:to-rose-900/10 rounded-xl border border-pink-100 dark:border-pink-800/30 p-1'>
          <div className='bg-white/50 dark:bg-gray-800/50 rounded-lg p-4 backdrop-blur-sm'>
            <div className='flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4'>
              <div className='flex items-center gap-3'>
                <div className='w-10 h-10 rounded-full bg-linear-to-br from-pink-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-pink-500/30'>
                  🔒
                </div>
                <div>
                  <h4 className='text-sm font-bold text-gray-900 dark:text-gray-100'>
                    成人内容过滤
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400'>
                    默认过滤；后台关闭过滤后，凭访问秘钥放开
                  </p>
                </div>
              </div>
              <a
                href='https://github.com/Fugitive844/DecoTV/blob/main/docs/%E6%88%90%E4%BA%BA%E5%86%85%E5%AE%B9%E8%BF%87%E6%BB%A4%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md'
                target='_blank'
                rel='noopener noreferrer'
                className='text-xs text-pink-600 dark:text-pink-400 hover:underline flex items-center gap-1'
              >
                查看完整指南{' '}
                <svg
                  className='w-3 h-3'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth='2'
                    d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                  />
                </svg>
              </a>
            </div>

            <input
              type='text'
              value={tvboxAccessKey}
              onChange={(e) => setTvboxAccessKey(e.target.value)}
              placeholder='完整内容模式需要的访问秘钥（DK 开头）'
              className='w-full mb-3 px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100'
            />

            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(getTvboxConfigUrl());
                  showSuccess(
                    '已复制家庭安全模式链接（默认过滤成人内容）',
                    showAlert,
                  );
                }}
                className='group flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-green-400 dark:hover:border-green-600 hover:shadow-sm transition-all'
              >
                <div className='flex items-center gap-3'>
                  <span className='text-xl bg-green-100 dark:bg-green-900/30 p-1.5 rounded-md'>
                    🏠
                  </span>
                  <div className='text-left'>
                    <div className='text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'>
                      家庭安全模式
                    </div>
                    <div className='text-xs text-gray-500 dark:text-gray-400'>
                      过滤所有成人内容
                    </div>
                  </div>
                </div>
                <span className='text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-500'>
                  默认
                </span>
              </button>

              <button
                onClick={() => {
                  const accessKey = tvboxAccessKey.trim();
                  if (!accessKey) {
                    showError('请先填写访问秘钥', showAlert);
                    return;
                  }
                  navigator.clipboard.writeText(
                    getTvboxConfigUrlWithParam('ak', accessKey),
                  );
                  showSuccess(
                    '已复制完整内容模式链接（需在站点配置中关闭成人内容过滤才生效）',
                    showAlert,
                  );
                }}
                className='group flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-rose-400 dark:hover:border-rose-600 hover:shadow-sm transition-all'
              >
                <div className='flex items-center gap-3'>
                  <span className='text-xl bg-rose-100 dark:bg-rose-900/30 p-1.5 rounded-md'>
                    🔓
                  </span>
                  <div className='text-left'>
                    <div className='text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors'>
                      完整内容模式
                    </div>
                    <div className='text-xs text-gray-500 dark:text-gray-400'>
                      需关闭过滤并带有效访问秘钥
                    </div>
                  </div>
                </div>
                <span className='text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-500'>
                  ?ak=秘钥
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* 底部：诊断与工具箱 */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          {/* 连通性体检 */}
          <div className='bg-gray-50 dark:bg-gray-900/30 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col'>
            <div className='flex items-center justify-between mb-4'>
              <h4 className='text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                🩺 连通性体检
              </h4>
              <button
                onClick={handleDiagnosis}
                disabled={isDiagnosing}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                  isDiagnosing
                    ? 'bg-gray-200 text-gray-500'
                    : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                {isDiagnosing ? '检测中...' : '开始检测'}
              </button>
            </div>

            <div className='flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 min-h-20'>
              {diagnosisResult ? (
                <div className='flex items-start gap-3'>
                  <div
                    className={`mt-0.5 ${
                      diagnosisResult.pass ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    {diagnosisResult.pass ? (
                      <svg
                        className='w-5 h-5'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                    ) : (
                      <svg
                        className='w-5 h-5'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                    )}
                  </div>
                  <div className='flex-1'>
                    <div
                      className={`text-sm font-medium ${
                        diagnosisResult.pass
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {diagnosisResult.pass ? '配置接口正常' : '配置接口异常'}
                    </div>
                    <div className='text-xs text-gray-500 mt-1 space-y-0.5'>
                      <div>状态码: {diagnosisResult.status}</div>
                      <div>类型: {diagnosisResult.contentType}</div>
                      {diagnosisResult.issues?.length > 0 && (
                        <div className='text-red-500 mt-1'>
                          {diagnosisResult.issues[0]}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className='h-full flex items-center justify-center text-xs text-gray-400'>
                  点击检测按钮检查接口连通性
                </div>
              )}
            </div>
          </div>

          {/* JAR 状态监控 */}
          <div className='bg-gray-50 dark:bg-gray-900/30 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col'>
            <div className='flex items-center justify-between mb-4'>
              <h4 className='text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                📦 JAR 状态
              </h4>
              <div className='flex gap-2'>
                <button
                  onClick={handleCheckJarStatus}
                  disabled={isCheckingJar}
                  className='text-xs px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors'
                  title='检查状态'
                >
                  {isCheckingJar ? '...' : '🔍'}
                </button>
                <button
                  onClick={handleRefreshJar}
                  disabled={isRefreshingJar}
                  className='text-xs px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-orange-600'
                  title='强制刷新'
                >
                  {isRefreshingJar ? '...' : '🔄'}
                </button>
              </div>
            </div>

            <div className='flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 min-h-20'>
              {jarStatus ? (
                <div className='flex items-start gap-3'>
                  <div
                    className={`mt-0.5 ${
                      jarStatus.fresh_status?.success
                        ? 'text-green-500'
                        : 'text-yellow-500'
                    }`}
                  >
                    {jarStatus.fresh_status?.success ? '🟢' : '🟡'}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>
                      {jarStatus.fresh_status?.source?.split('/').pop() ||
                        '未知源'}
                    </div>
                    <div className='text-xs text-gray-500 mt-1 flex gap-2'>
                      <span>
                        {jarStatus.fresh_status?.size
                          ? Math.round(jarStatus.fresh_status.size / 1024) +
                            'KB'
                          : '-'}
                      </span>
                      <span className='truncate max-w-20'>
                        {jarStatus.fresh_status?.md5?.substring(0, 6)}
                        ...
                      </span>
                    </div>
                    {jarStatus.fresh_status?.is_fallback && (
                      <div className='text-xs text-yellow-600 mt-1'>
                        ⚠️ 使用备用源
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className='h-full flex items-center justify-center text-xs text-gray-400'>
                  暂无状态数据
                </div>
              )}
            </div>

            <div className='mt-3 grid grid-cols-2 gap-2'>
              <button
                onClick={() =>
                  window.open('/api/tvbox/jar-diagnostic', '_blank')
                }
                className='px-2 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors text-center'
              >
                🔬 深度诊断
              </button>
              <button
                onClick={() => window.open('/api/tvbox/jar-test', '_blank')}
                className='px-2 py-1.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-xs font-medium hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors text-center'
              >
                ⚡ 快速测试
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </>
  );
}
