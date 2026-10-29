/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Download, Upload } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';
import {
  DEFAULT_LIVE_SOURCE_SORT_ORDER,
  getLiveSourceSortOrder,
  isValidLiveSourceSortOrder,
  type LiveSourceSearchGroups,
  matchesLiveSourceSearch,
  sortLiveSources,
} from '@/lib/live-source-options';

import type { ImportExportModalProps } from '@/components/ImportExportModal';
import LiveSourceSearch from '@/components/LiveSourceSearch';

const ImportExportModal = dynamic<ImportExportModalProps>(
  () => import('@/components/ImportExportModal').then((mod) => mod.default),
  { ssr: false },
);

import {
  AlertModal,
  buttonStyles,
  type DataSource,
  type LiveDataSource,
  showError,
  SortableTableRow,
  useAlertModal,
  useLoadingState,
} from './admin-shared';
import SourceImportDialog from './SourceImportDialog';
import VideoSourceEditDialog from './VideoSourceEditDialog';

// 视频源配置组件
export const VideoSourceConfig = ({
  config,
  refreshConfig,
  storageMode,
  updateConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  storageMode: 'cloud' | 'local';
  updateConfig: (
    updater: (prev: AdminConfig | null) => AdminConfig | null,
  ) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const { isLoading, withLoading } = useLoadingState();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceNameFilter, setSourceNameFilter] = useState('');
  const [adultFilter, setAdultFilter] = useState('all');
  const [enabledFilter, setEnabledFilter] = useState('all');
  const [validityFilter, setValidityFilter] = useState('all');
  const [adFilter, setAdFilter] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  // 批量操作相关状态
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(),
  );

  // 确认弹窗状态
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
  });

  // 有效性检测相关状态
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<
    Array<{
      key: string;
      name: string;
      status: 'valid' | 'no_results' | 'invalid' | 'validating';
      message: string;
      resultCount: number;
    }>
  >([]);
  const validationByKey = useMemo(
    () => new Map(validationResults.map((result) => [result.key, result])),
    [validationResults],
  );
  const hasSourceFilters =
    !!sourceNameFilter.trim() ||
    adultFilter !== 'all' ||
    enabledFilter !== 'all' ||
    validityFilter !== 'all' ||
    adFilter !== 'all';
  const filteredSources = useMemo(() => {
    const name = sourceNameFilter.trim().toLowerCase();
    return sources.filter((source) => {
      const status = validationByKey.get(source.key)?.status || 'unchecked';
      return (
        (!name || source.name.toLowerCase().includes(name)) &&
        (adultFilter === 'all' ||
          !!source.is_adult === (adultFilter === 'adult')) &&
        (enabledFilter === 'all' ||
          !source.disabled === (enabledFilter === 'enabled')) &&
        (validityFilter === 'all' || status === validityFilter) &&
        (adFilter === 'all' ||
          !source.disable_ad_filter === (adFilter === 'enabled'))
      );
    });
  }, [
    sources,
    sourceNameFilter,
    adultFilter,
    enabledFilter,
    validityFilter,
    adFilter,
    validationByKey,
  ]);
  const sourcePageCount = Math.max(1, Math.ceil(filteredSources.length / 50));
  const safeSourcePage = Math.min(sourcePage, sourcePageCount);
  const visibleSources = filteredSources.slice(
    (safeSourcePage - 1) * 50,
    safeSourcePage * 50,
  );
  const selectAll =
    filteredSources.length > 0 &&
    filteredSources.every((source) => selectedSources.has(source.key));
  const hiddenSelectedCount =
    selectedSources.size -
    filteredSources.filter((source) => selectedSources.has(source.key)).length;

  // 导入导出相关状态
  const [importExportModal, setImportExportModal] = useState<{
    isOpen: boolean;
    mode: 'import' | 'export' | 'result';
    result?: {
      success: number;
      failed: number;
      skipped: number;
      details: Array<{
        name: string;
        key: string;
        status: 'success' | 'failed' | 'skipped';
        reason?: string;
      }>;
    };
  }>({
    isOpen: false,
    mode: 'import',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
      // 重置选择状态
      setSelectedSources(new Set());
    }
  }, [config]);

  // 本地模式下直接更新配置
  const updateSourceConfigLocally = (
    action: string,
    payload: Record<string, any>,
  ) => {
    updateConfig((prev) => {
      if (!prev) return prev;
      const sources = [...(prev.SourceConfig || [])];

      switch (action) {
        case 'add': {
          const newSource: DataSource = {
            key: payload.key,
            name: payload.name,
            api: payload.api,
            detail: payload.detail || '',
            disabled: false,
            is_adult: payload.is_adult || false,
            from: 'custom',
          };
          sources.push(newSource);
          break;
        }
        case 'delete': {
          const idx = sources.findIndex((s) => s.key === payload.key);
          if (idx !== -1) sources.splice(idx, 1);
          break;
        }
        case 'enable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = false;
          break;
        }
        case 'disable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = true;
          break;
        }
        case 'update_adult': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.is_adult = payload.is_adult;
          break;
        }
        case 'sort': {
          if (payload.order && Array.isArray(payload.order)) {
            const orderMap = new Map(
              payload.order.map((key: string, idx: number) => [key, idx]),
            );
            sources.sort((a, b) => {
              const aIdx = orderMap.get(a.key) ?? 999;
              const bIdx = orderMap.get(b.key) ?? 999;
              return aIdx - bIdx;
            });
          }
          break;
        }
        case 'batch_enable': {
          payload.keys?.forEach((key: string) => {
            const source = sources.find((s) => s.key === key);
            if (source) source.disabled = false;
          });
          break;
        }
        case 'batch_disable': {
          payload.keys?.forEach((key: string) => {
            const source = sources.find((s) => s.key === key);
            if (source) source.disabled = true;
          });
          break;
        }
        case 'batch_delete': {
          payload.keys?.forEach((key: string) => {
            const idx = sources.findIndex((s) => s.key === key);
            if (idx !== -1) sources.splice(idx, 1);
          });
          break;
        }
      }

      return { ...prev, SourceConfig: sources };
    });
  };

  // 通用 API 请求
  const callSourceApi = async (body: Record<string, any>) => {
    // 本地模式：直接更新配置，不调用 API
    if (storageMode === 'local') {
      updateSourceConfigLocally(body.action, body);
      showAlert({
        type: 'success',
        title: '操作成功',
        message: '配置已保存到本地',
        timer: 2000,
      });
      return;
    }

    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));

        // 401 鉴权失败：保留表单，提示并引导重新登录
        if (resp.status === 401) {
          showError(
            data.error ||
              '登录已过期或未配置 AUTH_SECRET，请检查 Docker 环境变量后重新登录。',
            showAlert,
          );
          // 轻量跳转到登录页，避免多次点击无响应
          setTimeout(() => {
            window.location.href = '/login';
          }, 300);
          throw new Error('Unauthorized');
        }

        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleSource_${key}`, () =>
      callSourceApi({ action, key }),
    ).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleToggleAdult = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const newAdultStatus = !target.is_adult;

    withLoading(`toggleAdult_${key}`, () =>
      callSourceApi({
        action: 'update_adult',
        key,
        is_adult: newAdultStatus,
      }),
    ).catch(() => {
      console.error('切换成人标记失败', key);
    });
  };

  // 切换该源是否走 m3u8 广告过滤代理（disable_ad_filter=true 时该源直连上游，跳过过滤）
  const handleToggleAdFilter = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const newDisable = !target.disable_ad_filter;

    withLoading(`toggleAdFilter_${key}`, () =>
      callSourceApi({
        action: 'update_ad_filter',
        key,
        disable_ad_filter: newDisable,
      }),
    ).catch(() => {
      console.error('切换广告过滤豁免失败', key);
    });
  };

  const handleDelete = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;

    // 检查是否是系统预设源
    if (target.from === 'config') {
      showAlert({
        type: 'warning',
        title: '无法删除系统预设源',
        message:
          `❌ "${target.name}" 是系统预设源（from=config），无法直接删除。\n\n` +
          `💡 此源来自「配置文件」标签页中的 JSON 配置。\n\n` +
          `如需删除，请：\n` +
          `1. 前往「配置文件」标签页\n` +
          `2. 修改或清空配置文件内容\n` +
          `3. 保存后即可删除对应的系统预设源\n\n` +
          `⚠️ 只有手动添加的自定义源可以直接删除。`,
      });
      return;
    }

    withLoading(`deleteSource_${key}`, () =>
      callSourceApi({ action: 'delete', key }),
    ).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    withLoading('addSource', async () => {
      await callSourceApi({
        action: 'add',
        key: newSource.key,
        name: newSource.name,
        api: newSource.api,
        detail: newSource.detail,
        is_adult: newSource.is_adult || false,
      });
      setNewSource({
        name: '',
        key: '',
        api: '',
        detail: '',
        disabled: false,
        is_adult: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newSource);
    });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    setSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    withLoading('saveSourceOrder', () =>
      callSourceApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 批量标记/取消标记成人资源
  const handleBatchMarkAdult = async (markAsAdult: boolean) => {
    if (selectedSources.size === 0) {
      showAlert({
        type: 'warning',
        title: '请先选择要操作的视频源',
        message: '请选择至少一个视频源',
      });
      return;
    }

    const keys = Array.from(selectedSources);
    const loadingKey = markAsAdult
      ? 'batchSource_mark_adult'
      : 'batchSource_unmark_adult';

    try {
      await withLoading(loadingKey, async () => {
        // 逐个更新成人标记
        for (const key of keys) {
          await callSourceApi({
            action: 'update_adult',
            key,
            is_adult: markAsAdult,
          });
        }
      });

      showAlert({
        type: 'success',
        title: markAsAdult ? '批量标记成功' : '批量取消标记成功',
        message: `已${markAsAdult ? '标记' : '取消标记'} ${
          keys.length
        } 个视频源`,
        timer: 3000,
      });

      // 重置选择状态
      setSelectedSources(new Set());
    } catch (err) {
      showAlert({
        type: 'error',
        title: markAsAdult ? '批量标记失败' : '批量取消标记失败',
        message: err instanceof Error ? err.message : '操作失败',
      });
    }
  };

  const validationCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => validationCleanup.current?.(), []);

  // 有效性检测函数
  const handleValidateSources = async () => {
    if (!searchKeyword.trim()) {
      showAlert({
        type: 'warning',
        title: '请输入搜索关键词',
        message: '搜索关键词不能为空',
      });
      return;
    }

    await withLoading('validateSources', async () => {
      validationCleanup.current?.();
      setIsValidating(true);
      setValidationResults([]); // 清空之前的结果
      setShowValidationModal(false); // 立即关闭弹窗

      // 初始化所有视频源为检测中状态
      const initialResults = sources.map((source) => ({
        key: source.key,
        name: source.name,
        status: 'validating' as const,
        message: '检测中...',
        resultCount: 0,
      }));
      setValidationResults(initialResults);

      try {
        // 使用EventSource接收流式数据
        const eventSource = new EventSource(
          `/api/admin/source/validate?q=${encodeURIComponent(
            searchKeyword.trim(),
          )}`,
        );

        const sourceNames = new Map(
          sources.map((source) => [source.key, source.name]),
        );
        const pending = new Map<string, (typeof validationResults)[number]>();
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        const flushResults = () => {
          clearTimeout(flushTimer);
          flushTimer = undefined;
          if (!pending.size) return;
          const updates = new Map(pending);
          pending.clear();
          setValidationResults((previous) => {
            const keys = new Set(previous.map((result) => result.key));
            return [
              ...previous.map((result) => updates.get(result.key) || result),
              ...[...updates.values()].filter(
                (result) => !keys.has(result.key),
              ),
            ];
          });
        };
        const finish = () => {
          flushResults();
          clearTimeout(timeoutTimer);
          eventSource.close();
          validationCleanup.current = null;
          setIsValidating(false);
        };
        validationCleanup.current = () => {
          clearTimeout(flushTimer);
          clearTimeout(timeoutTimer);
          eventSource.close();
          pending.clear();
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case 'start':
                console.log(`开始检测 ${data.totalSources} 个视频源`);
                break;

              case 'ping':
                break;

              case 'source_result':
              case 'source_error':
                pending.set(data.source, {
                  key: data.source,
                  name: sourceNames.get(data.source) || data.source,
                  status: data.status,
                  message:
                    data.message ||
                    (data.status === 'valid'
                      ? '搜索正常'
                      : data.status === 'no_results'
                        ? '无法搜索到结果'
                        : '连接失败'),
                  resultCount:
                    typeof data.resultCount === 'number'
                      ? data.resultCount
                      : data.status === 'valid'
                        ? 1
                        : 0,
                });
                if (!flushTimer) flushTimer = setTimeout(flushResults, 200);
                break;

              case 'complete':
                console.log(
                  `检测完成，共检测 ${data.completedSources} 个视频源`,
                );
                finish();
                break;
            }
          } catch (error) {
            console.error('解析EventSource数据失败:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.error('EventSource错误:', error);
          finish();
          setValidationResults((previous) =>
            previous.filter((result) => result.status !== 'validating'),
          );
          showAlert({
            type: 'error',
            title: '验证失败',
            message: '连接错误，请重试',
          });
        };

        // 设置超时，防止长时间等待
        timeoutTimer = setTimeout(() => {
          if (eventSource.readyState !== EventSource.CLOSED) {
            finish();
            setValidationResults((previous) =>
              previous.filter((result) => result.status !== 'validating'),
            );
            showAlert({
              type: 'warning',
              title: '验证超时',
              message: '检测超时，请重试',
            });
          }
        }, 60000); // 60秒超时
      } catch (error) {
        setIsValidating(false);
        showAlert({
          type: 'error',
          title: '验证失败',
          message: error instanceof Error ? error.message : '未知错误',
        });
        throw error;
      }
    });
  };

  // 一键选中失效视频源（状态为 no_results 或 invalid）
  const handleSelectInvalidSources = useCallback(() => {
    const invalidKeys = validationResults
      .filter((r) => r.status === 'no_results' || r.status === 'invalid')
      .map((r) => r.key);

    if (invalidKeys.length === 0) {
      showAlert({
        type: 'warning',
        title: '没有失效的视频源',
        message: '当前没有检测到失效或无法搜索的视频源',
        timer: 3000,
      });
      return;
    }

    setSelectedSources(new Set(invalidKeys));
    showAlert({
      type: 'success',
      title: '已选中失效源',
      message: `已选中 ${invalidKeys.length} 个失效或无法搜索的视频源`,
      timer: 3000,
    });
  }, [validationResults, showAlert]);

  // 获取失效视频源数量
  const invalidSourceCount = useMemo(() => {
    return validationResults.filter(
      (r) => r.status === 'no_results' || r.status === 'invalid',
    ).length;
  }, [validationResults]);

  // 一键插入CSP模板
  const handleInsertCspTemplate = async () => {
    const cspTemplate = {
      name: 'CSP示例源（影视仓兼容）',
      key: `csp_demo_${Date.now()}`, // 使用时间戳避免重复key
      api: 'csp_AppYsV2',
      detail: JSON.stringify({
        jar: 'https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar;md5;a8b9c1d2e3f4',
        ext: 'https://raw.githubusercontent.com/FongMi/CatVodSpider/main/json/config.json',
        type: 3,
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
      }),
      disabled: false,
      from: 'config',
    };

    try {
      await withLoading('insertCspTemplate', async () => {
        await callSourceApi({
          action: 'add',
          key: cspTemplate.key,
          name: cspTemplate.name,
          api: cspTemplate.api,
          detail: cspTemplate.detail,
        });
      });

      showAlert({
        type: 'success',
        title: 'CSP模板插入成功',
        message: '已成功插入CSP示例源，可用于验证CSP/jar功能',
        timer: 3000,
      });
    } catch (err) {
      showAlert({
        type: 'error',
        title: 'CSP模板插入失败',
        message: err instanceof Error ? err.message : '插入失败',
      });
    }
  };

  // 导出视频源
  const handleExportSources = (exportFormat: 'array' | 'config' = 'array') => {
    try {
      // 获取要导出的源（如果有选中则导出选中的，否则导出全部）
      const sourcesToExport =
        selectedSources.size > 0
          ? sources.filter((s) => selectedSources.has(s.key))
          : sources;

      if (sourcesToExport.length === 0) {
        showAlert({
          type: 'warning',
          title: '没有可导出的视频源',
          message: '请先添加视频源或选择要导出的视频源',
        });
        return;
      }

      let exportData: any;
      let filename: string;
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

      if (exportFormat === 'config') {
        // 配置文件格式: { api_site: { key: { name, api, detail, is_adult } } }
        const apiSiteObj: Record<
          string,
          {
            name: string;
            api: string;
            detail?: string;
            is_adult?: boolean;
          }
        > = {};

        sourcesToExport.forEach((source) => {
          apiSiteObj[source.key] = {
            name: source.name,
            api: source.api,
          };
          if (source.detail) {
            apiSiteObj[source.key].detail = source.detail;
          }
          if (source.is_adult) {
            apiSiteObj[source.key].is_adult = source.is_adult;
          }
        });

        exportData = {
          api_site: apiSiteObj,
        };
        filename = `config_${timestamp}.json`;
      } else {
        // 数组格式（用于导入功能）
        exportData = sourcesToExport.map((source) => ({
          name: source.name,
          key: source.key,
          api: source.api,
          detail: source.detail || '',
          disabled: source.disabled || false,
          is_adult: source.is_adult || false,
        }));
        filename = `video_sources_${timestamp}.json`;
      }

      // 创建下载
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const formatText =
        exportFormat === 'config' ? '配置文件格式' : '数组格式';
      showAlert({
        type: 'success',
        title: '导出成功',
        message: `已导出 ${sourcesToExport.length} 个视频源（${formatText}）到 ${filename}`,
        timer: 3000,
      });

      // 关闭模态框
      setImportExportModal({ isOpen: false, mode: 'export' });
    } catch (err) {
      showAlert({
        type: 'error',
        title: '导出失败',
        message: err instanceof Error ? err.message : '未知错误',
      });
    }
  };

  // 导入视频源
  const handleImportSources = async (
    file: File,
    onProgress?: (current: number, total: number) => void,
  ) => {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (!Array.isArray(importData)) {
        throw new Error('JSON 格式错误：应为数组格式');
      }

      const result = {
        success: 0,
        failed: 0,
        skipped: 0,
        details: [] as Array<{
          name: string;
          key: string;
          status: 'success' | 'failed' | 'skipped';
          reason?: string;
        }>,
      };

      const total = importData.length;

      // 逐个导入，并更新进度
      for (let i = 0; i < importData.length; i++) {
        const item = importData[i];

        // 更新进度
        if (onProgress) {
          onProgress(i + 1, total);
        }
        try {
          // 验证必要字段
          if (!item.name || !item.key || !item.api) {
            result.failed++;
            result.details.push({
              name: item.name || '未知',
              key: item.key || '未知',
              status: 'failed',
              reason: '缺少必要字段（name、key 或 api）',
            });
            continue;
          }

          // 检查是否已存在
          const exists = sources.find((s) => s.key === item.key);
          if (exists) {
            result.skipped++;
            result.details.push({
              name: item.name,
              key: item.key,
              status: 'skipped',
              reason: '该 key 已存在，跳过导入',
            });
            continue;
          }

          // 导入
          await callSourceApi({
            action: 'add',
            key: item.key,
            name: item.name,
            api: item.api,
            detail: item.detail || '',
            is_adult: item.is_adult || false,
          });

          result.success++;
          result.details.push({
            name: item.name,
            key: item.key,
            status: 'success',
          });
        } catch (err) {
          result.failed++;
          result.details.push({
            name: item.name,
            key: item.key,
            status: 'failed',
            reason: err instanceof Error ? err.message : '导入失败',
          });
        }
      }

      // 显示结果
      setImportExportModal({
        isOpen: true,
        mode: 'result',
        result,
      });

      // 如果有成功导入的，刷新配置
      if (result.success > 0) {
        await refreshConfig();
      }
    } catch (err) {
      showAlert({
        type: 'error',
        title: '导入失败',
        message: err instanceof Error ? err.message : '文件解析失败',
      });
      setImportExportModal({ isOpen: false, mode: 'import' });
    }

    return {
      success: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };
  };

  // 获取有效性状态显示
  const getValidationStatus = (sourceKey: string) => {
    const result = validationByKey.get(sourceKey);
    if (!result) return null;

    switch (result.status) {
      case 'validating':
        return {
          text: '检测中',
          className:
            'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
          icon: '⟳',
          message: result.message,
        };
      case 'valid':
        return {
          text: '有效',
          className:
            'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
          icon: '✓',
          message: result.message,
        };
      case 'no_results':
        return {
          text: '无法搜索',
          className:
            'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
          icon: '⚠',
          message: result.message,
        };
      case 'invalid':
        return {
          text: '无效',
          className:
            'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
          icon: '✗',
          message: result.message,
        };
      default:
        return null;
    }
  };

  // 可拖拽行封装 (dnd-kit)
  const renderRow = (source: DataSource) => (
    <SortableTableRow
      key={source.key}
      id={source.key}
      disabled={hasSourceFilters}
    >
      <td className='px-2 py-4 text-center'>
        <input
          type='checkbox'
          checked={selectedSources.has(source.key)}
          onChange={(e) => handleSelectSource(source.key, e.target.checked)}
          className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
        />
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
        <div className='flex items-center space-x-2'>
          <span>{source.name}</span>
          {!!source.overriddenFields?.length && (
            <span
              className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
              title={`已人工修改：${source.overriddenFields.join('、')}，订阅智能更新时保留`}
            >
              已改
            </span>
          )}
          {source.from === 'config' && (
            <span
              className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              title='系统预设源，不可删除'
            >
              预设
            </span>
          )}
        </div>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
        {source.key}
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
        title={source.api}
      >
        {source.api}
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
        title={source.detail || '-'}
      >
        {source.detail || '-'}
      </td>
      <td className='px-6 py-4 whitespace-nowrap max-w-4'>
        <span
          className={`px-2 py-1 text-xs rounded-full ${
            !source.disabled
              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
              : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
          }`}
        >
          {!source.disabled ? '启用中' : '已禁用'}
        </span>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-center'>
        <button
          onClick={() => handleToggleAdult(source.key)}
          disabled={isLoading(`toggleAdult_${source.key}`)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            source.is_adult
              ? 'bg-linear-to-r from-red-500 to-pink-500'
              : 'bg-gray-300 dark:bg-gray-600'
          } ${
            isLoading(`toggleAdult_${source.key}`)
              ? 'opacity-50 cursor-not-allowed'
              : 'cursor-pointer hover:opacity-80'
          }`}
          title={source.is_adult ? '成人资源' : '普通资源'}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              source.is_adult ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-center'>
        <button
          onClick={() => handleToggleAdFilter(source.key)}
          disabled={isLoading(`toggleAdFilter_${source.key}`)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            !source.disable_ad_filter
              ? buttonStyles.toggleOn
              : buttonStyles.toggleOff
          } ${
            isLoading(`toggleAdFilter_${source.key}`)
              ? 'opacity-50 cursor-not-allowed'
              : 'cursor-pointer hover:opacity-80'
          }`}
          title={
            source.disable_ad_filter
              ? '已豁免：该源直连上游，不删广告段'
              : '已启用：通过 m3u8 过滤代理删除广告段'
          }
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              !source.disable_ad_filter ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </td>
      <td className='px-6 py-4 whitespace-nowrap max-w-4'>
        {(() => {
          const status = getValidationStatus(source.key);
          if (!status) {
            return (
              <span className='px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-900/20 text-gray-600 dark:text-gray-400'>
                未检测
              </span>
            );
          }
          return (
            <span
              className={`px-2 py-1 text-xs rounded-full ${status.className}`}
              title={status.message}
            >
              {status.icon} {status.text}
            </span>
          );
        })()}
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
        <button
          onClick={() => handleToggleEnable(source.key)}
          disabled={isLoading(`toggleSource_${source.key}`)}
          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
            !source.disabled
              ? buttonStyles.roundedDanger
              : buttonStyles.roundedSuccess
          } transition-colors ${
            isLoading(`toggleSource_${source.key}`)
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        >
          {!source.disabled ? '禁用' : '启用'}
        </button>
        {storageMode === 'cloud' && (
          <button
            onClick={() => setEditingSource(source)}
            className={buttonStyles.roundedPrimary}
          >
            编辑
          </button>
        )}
        {source.from !== 'config' && (
          <button
            onClick={() => handleDelete(source.key)}
            disabled={isLoading(`deleteSource_${source.key}`)}
            className={`${buttonStyles.roundedSecondary} ${
              isLoading(`deleteSource_${source.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            删除
          </button>
        )}
      </td>
    </SortableTableRow>
  );

  // 全选/取消全选
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedSources((previous) => {
        const next = new Set(previous);
        filteredSources.forEach((source) => {
          if (checked) next.add(source.key);
          else next.delete(source.key);
        });
        return next;
      });
    },
    [filteredSources],
  );

  // 单个选择
  const handleSelectSource = useCallback((key: string, checked: boolean) => {
    setSelectedSources((prev) => {
      const newSelected = new Set(prev);
      if (checked) {
        newSelected.add(key);
      } else {
        newSelected.delete(key);
      }
      return newSelected;
    });
  }, []);

  // 批量操作
  const handleBatchOperation = async (
    action: 'batch_enable' | 'batch_disable' | 'batch_delete',
  ) => {
    if (selectedSources.size === 0) {
      showAlert({
        type: 'warning',
        title: '请先选择要操作的视频源',
        message: '请选择至少一个视频源',
      });
      return;
    }

    const keys = Array.from(selectedSources);
    let confirmMessage = '';
    let actionName = '';

    // 对于批量删除，检查哪些是可以删除的（from='custom'）
    if (action === 'batch_delete') {
      const deletableSources = sources.filter(
        (s) => selectedSources.has(s.key) && s.from === 'custom',
      );
      const undeletableSources = sources.filter(
        (s) => selectedSources.has(s.key) && s.from !== 'custom',
      );

      if (deletableSources.length === 0) {
        showAlert({
          type: 'warning',
          title: '无法删除',
          message:
            '❌ 选中的视频源都是系统预设源（from=config），无法删除。\n\n' +
            '💡 这些源来自「配置文件」标签页中的 JSON 配置。\n\n' +
            '如需删除，请：\n' +
            '1. 前往「配置文件」标签页\n' +
            '2. 修改或清空配置文件内容\n' +
            '3. 保存后即可删除对应的系统预设源\n\n' +
            '⚠️ 只有手动添加的自定义源可以直接删除。',
        });
        return;
      }

      if (undeletableSources.length > 0) {
        confirmMessage =
          `将删除 ${deletableSources.length} 个自定义源。\n\n` +
          `⚠️ 注意：以下 ${undeletableSources.length} 个系统预设源无法删除（需在配置文件中修改）：\n` +
          `${undeletableSources.map((s) => `• ${s.name}`).join('\n')}`;
      } else {
        confirmMessage = `确定要删除选中的 ${deletableSources.length} 个自定义视频源吗？\n\n此操作不可恢复！`;
      }
      actionName = '批量删除';
    } else {
      switch (action) {
        case 'batch_enable':
          confirmMessage = `确定要启用选中的 ${keys.length} 个视频源吗？`;
          actionName = '批量启用';
          break;
        case 'batch_disable':
          confirmMessage = `确定要禁用选中的 ${keys.length} 个视频源吗？`;
          actionName = '批量禁用';
          break;
      }
    }

    // 显示确认弹窗
    setConfirmModal({
      isOpen: true,
      title: '确认操作',
      message: confirmMessage,
      onConfirm: async () => {
        try {
          await withLoading(`batchSource_${action}`, () =>
            callSourceApi({ action, keys }),
          );

          // 对于删除操作，显示实际删除的数量
          if (action === 'batch_delete') {
            const deletableCount = sources.filter(
              (s) => selectedSources.has(s.key) && s.from === 'custom',
            ).length;
            const undeletableCount = sources.filter(
              (s) => selectedSources.has(s.key) && s.from !== 'custom',
            ).length;

            if (undeletableCount > 0) {
              showAlert({
                type: 'warning',
                title: `部分删除成功`,
                message:
                  `✅ 成功删除了 ${deletableCount} 个自定义视频源\n` +
                  `⚠️ 跳过了 ${undeletableCount} 个系统预设源\n\n` +
                  `💡 提示：系统预设源需要在「配置文件」中修改`,
                timer: 5000,
              });
            } else {
              showAlert({
                type: 'success',
                title: `${actionName}成功`,
                message: `✅ 成功删除了 ${deletableCount} 个自定义视频源`,
                timer: 2000,
              });
            }
          } else {
            showAlert({
              type: 'success',
              title: `${actionName}成功`,
              message: `${actionName}了 ${keys.length} 个视频源`,
              timer: 2000,
            });
          }

          // 重置选择状态
          setSelectedSources(new Set());
        } catch (err) {
          showAlert({
            type: 'error',
            title: `${actionName}失败`,
            message: err instanceof Error ? err.message : '操作失败',
          });
        }
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
      onCancel: () => {
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 说明提示区域 */}
      {sources.some((s) => s.from === 'config') && (
        <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
          <div className='flex items-start space-x-3'>
            <div className='shrink-0 mt-0.5'>
              <svg
                className='w-5 h-5 text-blue-600 dark:text-blue-400'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path
                  fillRule='evenodd'
                  d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z'
                  clipRule='evenodd'
                />
              </svg>
            </div>
            <div className='flex-1'>
              <h4 className='text-sm font-medium text-blue-900 dark:text-blue-200 mb-1'>
                💡 关于系统预设源
              </h4>
              <p className='text-xs text-blue-800 dark:text-blue-300'>
                标记为「预设」的视频源来自「配置文件」标签页，无法直接删除。如需删除，请在「配置文件」中修改或清空
                JSON 配置后保存。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 添加视频源表单 */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          视频源列表
        </h4>
        <div className='flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-2'>
          {/* 批量操作按钮 - 移动端显示在下一行，PC端显示在左侧 */}
          {selectedSources.size > 0 && (
            <>
              <div className='flex flex-wrap items-center gap-3 order-2 sm:order-1'>
                <span className='text-sm text-gray-600 dark:text-gray-400'>
                  <span className='sm:hidden'>已选 {selectedSources.size}</span>
                  <span className='hidden sm:inline'>
                    已选择 {selectedSources.size} 个视频源
                  </span>
                </span>
                <button
                  onClick={() => handleBatchOperation('batch_enable')}
                  disabled={isLoading('batchSource_batch_enable')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_batch_enable')
                      ? buttonStyles.disabled
                      : buttonStyles.success
                  }`}
                >
                  {isLoading('batchSource_batch_enable')
                    ? '启用中...'
                    : '批量启用'}
                </button>
                <button
                  onClick={() => handleBatchOperation('batch_disable')}
                  disabled={isLoading('batchSource_batch_disable')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_batch_disable')
                      ? buttonStyles.disabled
                      : buttonStyles.warning
                  }`}
                >
                  {isLoading('batchSource_batch_disable')
                    ? '禁用中...'
                    : '批量禁用'}
                </button>
                <button
                  onClick={() => handleBatchOperation('batch_delete')}
                  disabled={isLoading('batchSource_batch_delete')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_batch_delete')
                      ? buttonStyles.disabled
                      : buttonStyles.danger
                  }`}
                >
                  {isLoading('batchSource_batch_delete')
                    ? '删除中...'
                    : '批量删除'}
                </button>
                <button
                  onClick={() => handleBatchMarkAdult(true)}
                  disabled={isLoading('batchSource_mark_adult')}
                  className={`px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                    isLoading('batchSource_mark_adult')
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-linear-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white'
                  }`}
                  title='将选中的视频源标记为成人资源'
                >
                  <span className='text-base'>🔞</span>
                  {isLoading('batchSource_mark_adult')
                    ? '标记中...'
                    : '标记成人'}
                </button>
                <button
                  onClick={() => handleBatchMarkAdult(false)}
                  disabled={isLoading('batchSource_unmark_adult')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_unmark_adult')
                      ? buttonStyles.disabled
                      : buttonStyles.secondary
                  }`}
                  title='将选中的视频源标记为普通资源'
                >
                  {isLoading('batchSource_unmark_adult')
                    ? '取消中...'
                    : '取消标记'}
                </button>
              </div>
              <div className='hidden sm:block w-px h-6 bg-gray-300 dark:bg-gray-600 order-2'></div>
            </>
          )}
          <div className='flex items-center gap-2 order-1 sm:order-2'>
            <button
              onClick={() =>
                storageMode === 'cloud'
                  ? setShowSmartImport(true)
                  : setImportExportModal({ isOpen: true, mode: 'import' })
              }
              className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 bg-linear-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white'
              title='从 JSON 文件导入视频源（强制覆盖／跳过／智能／冲突逐项选择）'
            >
              <Upload className='w-4 h-4' />
              <span className='hidden sm:inline'>导入视频源</span>
              <span className='sm:hidden'>导入</span>
            </button>
            <button
              onClick={() =>
                setImportExportModal({ isOpen: true, mode: 'export' })
              }
              className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 bg-linear-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white'
              title={
                selectedSources.size > 0
                  ? `导出选中的 ${selectedSources.size} 个视频源`
                  : '导出所有视频源'
              }
            >
              <Download className='w-4 h-4' />
              <span className='hidden sm:inline'>
                {selectedSources.size > 0
                  ? `导出已选(${selectedSources.size})`
                  : '导出视频源'}
              </span>
              <span className='sm:hidden'>导出</span>
            </button>
            <button
              onClick={() => setShowValidationModal(true)}
              disabled={isValidating}
              className={`px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                isValidating ? buttonStyles.disabled : buttonStyles.primary
              }`}
            >
              {isValidating ? (
                <>
                  <div className='w-3 h-3 border border-white border-t-transparent rounded-full animate-spin'></div>
                  <span>检测中...</span>
                </>
              ) : (
                '有效性检测'
              )}
            </button>
            {/* 选中失效源按钮 - 只在有检测结果且存在失效源时显示 */}
            {!isValidating && invalidSourceCount > 0 && (
              <button
                onClick={handleSelectInvalidSources}
                className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1.5 bg-linear-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-sm hover:shadow-md'
                title={`一键选中 ${invalidSourceCount} 个失效或无法搜索的视频源`}
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
                    strokeWidth={2}
                    d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                <span className='hidden sm:inline'>
                  选中失效源({invalidSourceCount})
                </span>
                <span className='sm:hidden'>{invalidSourceCount}</span>
              </button>
            )}
            <button
              onClick={handleInsertCspTemplate}
              disabled={isLoading('insertCspTemplate')}
              className={`px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                isLoading('insertCspTemplate')
                  ? buttonStyles.disabled
                  : buttonStyles.roundedPurple.replace(
                      'inline-flex items-center px-3 py-1.5 rounded-full text-xs',
                      'px-3 py-1 text-sm rounded-lg',
                    )
              }`}
              title='一键插入CSP模板源，用于快速验证CSP/jar功能'
            >
              {isLoading('insertCspTemplate') ? (
                <>
                  <div className='w-3 h-3 border border-white border-t-transparent rounded-full animate-spin'></div>
                  <span>插入中...</span>
                </>
              ) : (
                '插入CSP模板'
              )}
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={
                showAddForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddForm ? '取消' : '添加视频源'}
            </button>
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newSource.name}
              onChange={(e) => {
                const name = e.target.value;
                setNewSource((prev) => ({
                  ...prev,
                  name,
                  // 智能检测:如果名称以 AV-、成人、伦理 等开头,自动标记为成人资源
                  is_adult:
                    /^(AV-|成人|伦理|福利|里番|R18)/i.test(name) ||
                    prev.is_adult,
                }));
              }}
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>

          {/* 成人资源标记 */}
          <div className='flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='flex items-center space-x-2'>
              <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                标记为成人资源
              </span>
              {newSource.is_adult && (
                <span className='px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'>
                  🔞 成人
                </span>
              )}
            </div>
            <button
              type='button'
              onClick={() =>
                setNewSource((prev) => ({ ...prev, is_adult: !prev.is_adult }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                newSource.is_adult
                  ? 'bg-linear-to-r from-red-500 to-pink-500'
                  : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  newSource.is_adult ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={
                !newSource.name ||
                !newSource.key ||
                !newSource.api ||
                isLoading('addSource')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newSource.name ||
                !newSource.key ||
                !newSource.api ||
                isLoading('addSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addSource') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      <div className='space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5'>
          <label className='space-y-1 text-sm text-gray-700 dark:text-gray-300'>
            <span>名称搜索</span>
            <input
              type='search'
              value={sourceNameFilter}
              placeholder='输入视频源名称'
              onChange={(e) => {
                setSourceNameFilter(e.target.value);
                setSourcePage(1);
                setSelectedSources(new Set());
              }}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800'
            />
          </label>
          <label className='space-y-1 text-sm text-gray-700 dark:text-gray-300'>
            <span>成人资源</span>
            <select
              value={adultFilter}
              onChange={(e) => {
                setAdultFilter(e.target.value);
                setSourcePage(1);
                setSelectedSources(new Set());
              }}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800'
            >
              <option value='all'>全部</option>
              <option value='adult'>成人</option>
              <option value='normal'>普通</option>
            </select>
          </label>
          <label className='space-y-1 text-sm text-gray-700 dark:text-gray-300'>
            <span>启用状态</span>
            <select
              value={enabledFilter}
              onChange={(e) => {
                setEnabledFilter(e.target.value);
                setSourcePage(1);
                setSelectedSources(new Set());
              }}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800'
            >
              <option value='all'>全部</option>
              <option value='enabled'>启用中</option>
              <option value='disabled'>已禁用</option>
            </select>
          </label>
          <label className='space-y-1 text-sm text-gray-700 dark:text-gray-300'>
            <span>有效性</span>
            <select
              value={validityFilter}
              onChange={(e) => {
                setValidityFilter(e.target.value);
                setSourcePage(1);
                setSelectedSources(new Set());
              }}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800'
            >
              <option value='all'>全部</option>
              <option value='unchecked'>未检测</option>
              <option value='validating'>检测中</option>
              <option value='valid'>有效</option>
              <option value='no_results'>无法搜索</option>
              <option value='invalid'>无效</option>
            </select>
          </label>
          <label className='space-y-1 text-sm text-gray-700 dark:text-gray-300'>
            <span>广告过滤</span>
            <select
              value={adFilter}
              onChange={(e) => {
                setAdFilter(e.target.value);
                setSourcePage(1);
                setSelectedSources(new Set());
              }}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800'
            >
              <option value='all'>全部</option>
              <option value='enabled'>已启用</option>
              <option value='disabled'>已豁免</option>
            </select>
          </label>
        </div>
        <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400'>
          <span>
            筛选出 {filteredSources.length} / {sources.length}{' '}
            个源；全选作用于全部筛选结果。有效性为本次页面检测结果，广告过滤以单源设置为准。
          </span>
          {hasSourceFilters && (
            <button
              type='button'
              className='text-blue-600 hover:underline dark:text-blue-400'
              onClick={() => {
                setSourceNameFilter('');
                setAdultFilter('all');
                setEnabledFilter('all');
                setValidityFilter('all');
                setAdFilter('all');
                setSourcePage(1);
                setSelectedSources(new Set());
              }}
            >
              清除筛选
            </button>
          )}
        </div>
        {hasSourceFilters && (
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            筛选期间暂停拖动排序；更改筛选条件会清除已选项。
          </p>
        )}
        {hiddenSelectedCount > 0 && (
          <p className='text-xs text-amber-700 dark:text-amber-400'>
            已选项中有 {hiddenSelectedCount}{' '}
            个不在当前筛选结果中，批量操作仍会作用于这些源。{' '}
            <button
              type='button'
              className='underline'
              onClick={() => setSelectedSources(new Set())}
            >
              清除全部选择
            </button>
          </p>
        )}
      </div>

      {/* 视频源表格 */}
      <div
        className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
        data-table='source-list'
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-8' />
                <th className='w-12 px-2 py-3 text-center'>
                  <input
                    type='checkbox'
                    checked={selectAll}
                    disabled={filteredSources.length === 0}
                    aria-label='选择全部筛选结果'
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                  />
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  API 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Detail 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  成人资源
                </th>
                <th
                  className='px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  title='关闭后该源将跳过 m3u8 广告过滤代理，直连上游'
                >
                  广告过滤
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  有效性
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={visibleSources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {visibleSources.map(renderRow)}
                {visibleSources.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className='px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400'
                    >
                      没有符合条件的视频源
                    </td>
                  </tr>
                )}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      <div className='flex items-center justify-end gap-3 text-sm'>
        <span>
          筛选出 {filteredSources.length} 个源，第 {safeSourcePage} /{' '}
          {sourcePageCount} 页（每页 50 个）
        </span>
        <button
          className={buttonStyles.secondary}
          disabled={safeSourcePage <= 1}
          onClick={() => setSourcePage(safeSourcePage - 1)}
        >
          上一页
        </button>
        <button
          className={buttonStyles.secondary}
          disabled={safeSourcePage >= sourcePageCount}
          onClick={() => setSourcePage(safeSourcePage + 1)}
        >
          下一页
        </button>
      </div>
      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveSourceOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 有效性检测弹窗 */}
      {showValidationModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50'
            onClick={() => setShowValidationModal(false)}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4'
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100 mb-4'>
                视频源有效性检测
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400 mb-4'>
                请输入检测用的搜索关键词
              </p>
              <div className='space-y-4'>
                <input
                  type='text'
                  placeholder='请输入搜索关键词'
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  onKeyPress={(e) =>
                    e.key === 'Enter' && handleValidateSources()
                  }
                />
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => setShowValidationModal(false)}
                    className='px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors'
                  >
                    取消
                  </button>
                  <button
                    onClick={handleValidateSources}
                    disabled={!searchKeyword.trim()}
                    className={`px-4 py-2 ${
                      !searchKeyword.trim()
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    开始检测
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
        onConfirm={alertModal.onConfirm}
        confirmText={alertModal.confirmText}
        cancelText={alertModal.cancelText}
      />

      {editingSource && (
        <VideoSourceEditDialog
          source={editingSource}
          onClose={() => setEditingSource(null)}
          onSaved={refreshConfig}
        />
      )}
      {showSmartImport && (
        <SourceImportDialog
          type='video'
          onClose={() => setShowSmartImport(false)}
          onDone={refreshConfig}
        />
      )}

      {/* 导入导出模态框 */}
      {importExportModal.isOpen && (
        <ImportExportModal
          isOpen={importExportModal.isOpen}
          mode={importExportModal.mode}
          onClose={() =>
            setImportExportModal({ isOpen: false, mode: 'import' })
          }
          onImport={handleImportSources}
          onExport={handleExportSources}
          result={importExportModal.result}
        />
      )}

      {/* 批量操作确认弹窗 */}
      {confirmModal.isOpen &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={confirmModal.onCancel}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-4'>
                  <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    {confirmModal.title}
                  </h3>
                  <button
                    onClick={confirmModal.onCancel}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-5 h-5'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <p className='text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line'>
                    {confirmModal.message}
                  </p>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={confirmModal.onCancel}
                    className={`px-4 py-2 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmModal.onConfirm}
                    disabled={
                      isLoading('batchSource_batch_enable') ||
                      isLoading('batchSource_batch_disable') ||
                      isLoading('batchSource_batch_delete')
                    }
                    className={`px-4 py-2 text-sm font-medium ${
                      isLoading('batchSource_batch_enable') ||
                      isLoading('batchSource_batch_disable') ||
                      isLoading('batchSource_batch_delete')
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading('batchSource_batch_enable') ||
                    isLoading('batchSource_batch_disable') ||
                    isLoading('batchSource_batch_delete')
                      ? '操作中...'
                      : '确认'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

// 直播源配置组件
export const LiveSourceConfig = ({
  config,
  refreshConfig,
  storageMode,
  updateConfig,
  onOpenDetail,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  storageMode: 'cloud' | 'local';
  updateConfig: (
    updater: (prev: AdminConfig | null) => AdminConfig | null,
  ) => void;
  onOpenDetail?: (key: string) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const [showSmartImport, setShowSmartImport] = useState(false);
  const { isLoading, withLoading } = useLoadingState();
  const [liveSources, setLiveSources] = useState<LiveDataSource[]>([]);
  const [searchGroups, setSearchGroups] = useState<LiveSourceSearchGroups>([
    [{ field: 'name', operator: 'contains', keyword: '' }],
  ]);
  const [selectedLiveKeys, setSelectedLiveKeys] = useState<Set<string>>(
    new Set(),
  );
  const [batchSortOrder, setBatchSortOrder] = useState(
    String(DEFAULT_LIVE_SOURCE_SORT_ORDER),
  );
  const [sortOrderDrafts, setSortOrderDrafts] = useState<Map<string, string>>(
    () => new Map(),
  );
  const filteredLiveSources = useMemo(
    () =>
      liveSources.filter((source) =>
        matchesLiveSourceSearch(source, searchGroups),
      ),
    [liveSources, searchGroups],
  );
  const selectedFilteredKeys = filteredLiveSources
    .filter((source) => selectedLiveKeys.has(source.key))
    .map((source) => source.key);
  const allFilteredSelected =
    filteredLiveSources.length > 0 &&
    selectedFilteredKeys.length === filteredLiveSources.length;
  const hasSearch = searchGroups.some((group) =>
    group.some((condition) => condition.keyword.trim()),
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLiveSource, setEditingLiveSource] =
    useState<LiveDataSource | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newLiveSource, setNewLiveSource] = useState<LiveDataSource>({
    name: '',
    key: '',
    url: '',
    ua: '',
    epg: '',
    sortOrder: DEFAULT_LIVE_SOURCE_SORT_ORDER,
    disabled: false,
    from: 'custom',
  });
  const [importExportModal, setImportExportModal] = useState<{
    isOpen: boolean;
    mode: 'import' | 'export' | 'result';
    result?: {
      success: number;
      failed: number;
      skipped: number;
      details: Array<{
        name: string;
        key: string;
        status: 'success' | 'failed' | 'skipped';
        reason?: string;
      }>;
    };
  }>({
    isOpen: false,
    mode: 'import',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.LiveConfig) {
      setLiveSources(sortLiveSources(config.LiveConfig));
      setSortOrderDrafts(new Map());
      setSelectedLiveKeys(new Set());
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 本地模式下直接更新配置
  const updateLiveConfigLocally = (
    action: string,
    payload: Record<string, any>,
  ) => {
    updateConfig((prev) => {
      if (!prev) return prev;
      const sources = [...(prev.LiveConfig || [])];

      switch (action) {
        case 'add': {
          const newSource: LiveDataSource = {
            key: payload.key,
            name: payload.name,
            url: payload.url,
            ua: payload.ua || '',
            epg: payload.epg || '',
            sortOrder: getLiveSourceSortOrder({ sortOrder: payload.sortOrder }),
            disabled: false,
            from: 'custom',
            channelNumber: 0,
          };
          sources.push(newSource);
          break;
        }
        case 'delete': {
          const idx = sources.findIndex((s) => s.key === payload.key);
          if (idx !== -1) sources.splice(idx, 1);
          break;
        }
        case 'enable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = false;
          break;
        }
        case 'disable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = true;
          break;
        }
        case 'edit':
        case 'update': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) {
            source.name = payload.name ?? source.name;
            source.url = payload.url ?? source.url;
            source.ua = payload.ua ?? source.ua;
            source.epg = payload.epg ?? source.epg;
            if (payload.sortOrder !== undefined)
              source.sortOrder = payload.sortOrder;
          }
          break;
        }
        case 'batch-sort': {
          const keys = new Set<string>(payload.keys);
          sources.forEach((source, index) => {
            if (keys.has(source.key))
              sources[index] = { ...source, sortOrder: payload.sortOrder };
          });
          break;
        }
        case 'sort': {
          if (payload.order && Array.isArray(payload.order)) {
            const orderMap = new Map<string, number>(
              payload.order.map((key: string, idx: number) => [key, idx]),
            );
            sources.sort((a, b) => {
              const aIdx = orderMap.get(a.key) ?? 999;
              const bIdx = orderMap.get(b.key) ?? 999;
              return aIdx - bIdx;
            });
          }
          break;
        }
      }

      return { ...prev, LiveConfig: sortLiveSources(sources) };
    });
  };

  // 通用 API 请求
  const callLiveSourceApi = async (
    body: Record<string, any>,
    options?: {
      skipRefresh?: boolean;
      skipLocalSuccessToast?: boolean;
    },
  ) => {
    // 本地模式：直接更新配置，不调用 API
    if (storageMode === 'local') {
      updateLiveConfigLocally(body.action, body);
      if (!options?.skipLocalSuccessToast) {
        showAlert({
          type: 'success',
          title: '操作成功',
          message: '配置已保存到本地',
          timer: 2000,
        });
      }
      return;
    }

    try {
      const resp = await fetch('/api/admin/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      if (!options?.skipRefresh) {
        await refreshConfig();
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = liveSources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleLiveSource_${key}`, () =>
      callLiveSourceApi({ action, key }),
    ).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    withLoading(`deleteLiveSource_${key}`, () =>
      callLiveSourceApi({ action: 'delete', key }),
    ).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  // 刷新直播源
  const handleRefreshLiveSources = async () => {
    if (isRefreshing) return;

    await withLoading('refreshLiveSources', async () => {
      setIsRefreshing(true);
      try {
        const response = await fetch('/api/admin/live/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `刷新失败: ${response.status}`);
        }

        // 刷新成功后重新获取配置
        await refreshConfig();
        showAlert({
          type: 'success',
          title: '刷新成功',
          message: '直播源已刷新',
          timer: 2000,
        });
      } catch (err) {
        showError(err instanceof Error ? err.message : '刷新失败', showAlert);
        throw err;
      } finally {
        setIsRefreshing(false);
      }
    });
  };

  const handleAddLiveSource = () => {
    if (!newLiveSource.name || !newLiveSource.key || !newLiveSource.url) return;
    withLoading('addLiveSource', async () => {
      await callLiveSourceApi({
        action: 'add',
        key: newLiveSource.key,
        name: newLiveSource.name,
        url: newLiveSource.url,
        ua: newLiveSource.ua,
        epg: newLiveSource.epg,
        sortOrder: newLiveSource.sortOrder,
      });
      setNewLiveSource({
        name: '',
        key: '',
        url: '',
        epg: '',
        ua: '',
        disabled: false,
        from: 'custom',
        sortOrder: DEFAULT_LIVE_SOURCE_SORT_ORDER,
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newLiveSource);
    });
  };

  const handleEditLiveSource = () => {
    if (!editingLiveSource || !editingLiveSource.name || !editingLiveSource.url)
      return;
    withLoading('editLiveSource', async () => {
      await callLiveSourceApi({
        action: 'edit',
        key: editingLiveSource.key,
        name: editingLiveSource.name,
        url: editingLiveSource.url,
        ua: editingLiveSource.ua,
        epg: editingLiveSource.epg,
      });
      setEditingLiveSource(null);
    }).catch(() => {
      console.error('操作失败', 'edit', editingLiveSource);
    });
  };

  const handleCancelEdit = () => {
    setEditingLiveSource(null);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (
      hasSearch ||
      isLoading('batchSortLiveSources') ||
      isLoading('saveLiveSourceOrder')
    )
      return;
    const oldIndex = liveSources.findIndex((s) => s.key === active.id);
    const newIndex = liveSources.findIndex((s) => s.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (
      getLiveSourceSortOrder(liveSources[oldIndex]) !==
      getLiveSourceSortOrder(liveSources[newIndex])
    ) {
      showAlert({
        type: 'warning',
        title: '排序值不同',
        message: '拖拽仅调整相同排序值的先后顺序。跨排序值调整请修改排序值。',
      });
      return;
    }
    setLiveSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = liveSources.map((s) => s.key);
    withLoading('saveLiveSourceOrder', () =>
      callLiveSourceApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  const handleSetSortOrder = (keys: string[], value: string) => {
    const sortOrder = Number(value);
    if (
      keys.length === 0 ||
      !value.trim() ||
      !isValidLiveSourceSortOrder(sortOrder)
    ) {
      showAlert({
        type: 'warning',
        title: '无法设置排序值',
        message: '请选择直播源，并输入有效的整数排序值。',
      });
      return;
    }
    if (orderChanged) {
      showAlert({
        type: 'warning',
        title: '请先保存拖拽排序',
        message: '保存当前拖拽顺序后，再设置排序值。',
      });
      return;
    }
    void withLoading('batchSortLiveSources', async () => {
      await callLiveSourceApi({ action: 'batch-sort', keys, sortOrder });
      showAlert({
        type: 'success',
        title: '排序值已保存',
        message: `已将 ${keys.length} 个直播源的排序值设置为 ${sortOrder}。`,
        timer: 2000,
      });
    }).catch(() => {
      // API 层已显示错误，保留选择和输入以便重试。
    });
  };

  const normalizeLiveImportData = (importData: unknown) => {
    if (Array.isArray(importData)) {
      return importData;
    }

    if (importData && typeof importData === 'object') {
      const record = importData as Record<string, unknown>;
      const liveMap =
        record.lives &&
        typeof record.lives === 'object' &&
        !Array.isArray(record.lives)
          ? (record.lives as Record<string, unknown>)
          : record;

      const items = Object.entries(liveMap)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([key, value]) => ({
          key,
          ...(value as Record<string, unknown>),
        }))
        .filter((item) => 'name' in item || 'url' in item);

      if (items.length > 0) {
        return items;
      }
    }

    throw new Error(
      'JSON 格式错误：请使用数组格式，或配置文件格式 {"lives": {...}}',
    );
  };

  const handleExportLiveSources = (
    exportFormat: 'array' | 'config' = 'array',
  ) => {
    try {
      if (liveSources.length === 0) {
        showAlert({
          type: 'warning',
          title: '没有可导出的直播源',
          message: '请先添加直播源后再导出',
        });
        return;
      }

      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      let exportData: any;
      let filename: string;

      if (exportFormat === 'config') {
        const lives: Record<
          string,
          {
            name: string;
            url: string;
            ua?: string;
            epg?: string;
            sortOrder?: number;
          }
        > = {};

        liveSources.forEach((source) => {
          const liveItem: {
            name: string;
            url: string;
            ua?: string;
            epg?: string;
            sortOrder?: number;
          } = {
            name: source.name,
            url: source.url,
            sortOrder: getLiveSourceSortOrder(source),
          };
          if (source.ua) {
            liveItem.ua = source.ua;
          }
          if (source.epg) {
            liveItem.epg = source.epg;
          }
          lives[source.key] = liveItem;
        });

        exportData = { lives };
        filename = `live_config_${timestamp}.json`;
      } else {
        exportData = liveSources.map((source) => ({
          name: source.name,
          key: source.key,
          url: source.url,
          epg: source.epg || '',
          ua: source.ua || '',
          disabled: source.disabled || false,
          sortOrder: getLiveSourceSortOrder(source),
        }));
        filename = `live_sources_${timestamp}.json`;
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      const formatText =
        exportFormat === 'config' ? '配置文件格式' : '数组格式';
      showAlert({
        type: 'success',
        title: '导出成功',
        message: `已导出 ${liveSources.length} 个直播源（${formatText}）到 ${filename}`,
        timer: 3000,
      });

      setImportExportModal({ isOpen: false, mode: 'export' });
    } catch (err) {
      showAlert({
        type: 'error',
        title: '导出失败',
        message: err instanceof Error ? err.message : '未知错误',
      });
    }
  };

  const handleImportLiveSources = async (
    file: File,
    onProgress?: (current: number, total: number) => void,
  ) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importItems = normalizeLiveImportData(parsed);

      if (importItems.length === 0) {
        throw new Error('文件中没有可导入的直播源数据');
      }

      const result = {
        success: 0,
        failed: 0,
        skipped: 0,
        details: [] as Array<{
          name: string;
          key: string;
          status: 'success' | 'failed' | 'skipped';
          reason?: string;
        }>,
      };

      const existingKeys = new Set(liveSources.map((source) => source.key));
      const total = importItems.length;

      for (let i = 0; i < importItems.length; i++) {
        const rawItem = importItems[i] as Record<string, unknown>;
        if (onProgress) {
          onProgress(i + 1, total);
        }

        const key = typeof rawItem.key === 'string' ? rawItem.key.trim() : '';
        const name =
          typeof rawItem.name === 'string' ? rawItem.name.trim() : '';
        const url = typeof rawItem.url === 'string' ? rawItem.url.trim() : '';
        const ua = typeof rawItem.ua === 'string' ? rawItem.ua.trim() : '';
        const epg = typeof rawItem.epg === 'string' ? rawItem.epg.trim() : '';

        if (
          rawItem.sortOrder !== undefined &&
          !isValidLiveSourceSortOrder(rawItem.sortOrder)
        ) {
          result.failed++;
          result.details.push({
            name: name || '未知',
            key: key || '未知',
            status: 'failed',
            reason: '排序值必须是安全整数',
          });
          continue;
        }
        const sortOrder = rawItem.sortOrder ?? DEFAULT_LIVE_SOURCE_SORT_ORDER;

        if (!name || !key || !url) {
          result.failed++;
          result.details.push({
            name: name || '未知',
            key: key || '未知',
            status: 'failed',
            reason: '缺少必要字段（name、key 或 url）',
          });
          continue;
        }

        if (existingKeys.has(key)) {
          result.skipped++;
          result.details.push({
            name,
            key,
            status: 'skipped',
            reason: '该 key 已存在，跳过导入',
          });
          continue;
        }

        try {
          await callLiveSourceApi(
            {
              action: 'add',
              key,
              name,
              url,
              ua,
              epg,
              sortOrder,
            },
            {
              skipRefresh: true,
              skipLocalSuccessToast: true,
            },
          );

          existingKeys.add(key);
          result.success++;
          result.details.push({
            name,
            key,
            status: 'success',
          });
        } catch (err) {
          result.failed++;
          result.details.push({
            name,
            key,
            status: 'failed',
            reason: err instanceof Error ? err.message : '导入失败',
          });
        }
      }

      setImportExportModal({
        isOpen: true,
        mode: 'result',
        result,
      });

      if (result.success > 0 && storageMode !== 'local') {
        await refreshConfig();
      }

      return result;
    } catch (err) {
      showAlert({
        type: 'error',
        title: '导入失败',
        message: err instanceof Error ? err.message : '文件解析失败',
      });
      setImportExportModal({ isOpen: false, mode: 'import' });
      return {
        success: 0,
        failed: 0,
        skipped: 0,
        details: [],
      };
    }
  };

  // 可拖拽行封装 (dnd-kit)
  const renderRow = (liveSource: LiveDataSource) => (
    <SortableTableRow
      key={liveSource.key}
      id={liveSource.key}
      disabled={
        hasSearch ||
        isLoading('batchSortLiveSources') ||
        isLoading('saveLiveSourceOrder')
      }
    >
      <td className='px-3 py-4'>
        <input
          type='checkbox'
          aria-label={`选择直播源 ${liveSource.name}`}
          checked={selectedLiveKeys.has(liveSource.key)}
          disabled={isLoading('batchSortLiveSources')}
          onChange={(event) => {
            const checked = event.target.checked;
            setSelectedLiveKeys((previous) => {
              const next = new Set(previous);
              if (checked) next.add(liveSource.key);
              else next.delete(liveSource.key);
              return next;
            });
          }}
          className='h-4 w-4 accent-green-600'
        />
      </td>
      <td className='px-3 py-4'>
        <div className='flex items-center gap-2'>
          <input
            type='number'
            step='1'
            aria-label={`${liveSource.name} 的排序值`}
            value={
              sortOrderDrafts.get(liveSource.key) ??
              getLiveSourceSortOrder(liveSource)
            }
            disabled={
              orderChanged ||
              isLoading('batchSortLiveSources') ||
              isLoading('saveLiveSourceOrder')
            }
            onChange={(event) =>
              setSortOrderDrafts((previous) =>
                new Map(previous).set(liveSource.key, event.target.value),
              )
            }
            className='w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
          <button
            type='button'
            disabled={
              orderChanged ||
              isLoading('batchSortLiveSources') ||
              isLoading('saveLiveSourceOrder') ||
              !sortOrderDrafts.has(liveSource.key) ||
              Number(sortOrderDrafts.get(liveSource.key)) ===
                getLiveSourceSortOrder(liveSource)
            }
            onClick={() =>
              handleSetSortOrder(
                [liveSource.key],
                sortOrderDrafts.get(liveSource.key) ?? '',
              )
            }
            className={`${buttonStyles.roundedPrimary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            保存
          </button>
        </div>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
        {liveSource.name}
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
        {liveSource.key}
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
        title={liveSource.url}
      >
        {liveSource.url}
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
        title={liveSource.epg || '-'}
      >
        {liveSource.epg || '-'}
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
        title={liveSource.ua || '-'}
      >
        {liveSource.ua || '-'}
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-center'>
        {liveSource.channelNumber && liveSource.channelNumber > 0
          ? liveSource.channelNumber
          : '-'}
      </td>
      <td className='px-6 py-4 whitespace-nowrap max-w-4'>
        <span
          className={`px-2 py-1 text-xs rounded-full ${
            !liveSource.disabled
              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
              : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
          }`}
        >
          {!liveSource.disabled ? '启用中' : '已禁用'}
        </span>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
        <button
          onClick={() => handleToggleEnable(liveSource.key)}
          disabled={isLoading(`toggleLiveSource_${liveSource.key}`)}
          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
            !liveSource.disabled
              ? buttonStyles.roundedDanger
              : buttonStyles.roundedSuccess
          } transition-colors ${
            isLoading(`toggleLiveSource_${liveSource.key}`)
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        >
          {!liveSource.disabled ? '禁用' : '启用'}
        </button>
        {onOpenDetail && (
          <button
            onClick={() => onOpenDetail(liveSource.key)}
            className={buttonStyles.roundedPrimary}
            title='查看抓取状态、频道分类与频道（只读）'
          >
            详情
          </button>
        )}
        {liveSource.from !== 'config' && (
          <>
            <button
              onClick={() => handleDelete(liveSource.key)}
              disabled={isLoading(`deleteLiveSource_${liveSource.key}`)}
              className={`${buttonStyles.roundedSecondary} ${
                isLoading(`deleteLiveSource_${liveSource.key}`)
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
            >
              删除
            </button>
          </>
        )}
      </td>
    </SortableTableRow>
  );

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加直播源表单 */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          直播源列表
        </h4>
        <div className='flex flex-wrap items-center gap-2'>
          <button
            onClick={() =>
              storageMode === 'cloud'
                ? setShowSmartImport(true)
                : setImportExportModal({ isOpen: true, mode: 'import' })
            }
            className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 bg-linear-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white'
            title='从 JSON 文件导入直播源（强制覆盖／跳过／智能／冲突逐项选择）'
          >
            <Upload className='w-4 h-4' />
            <span className='hidden sm:inline'>导入直播源</span>
            <span className='sm:hidden'>导入</span>
          </button>
          <button
            onClick={() =>
              setImportExportModal({ isOpen: true, mode: 'export' })
            }
            className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 bg-linear-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white'
            title='导出所有直播源'
          >
            <Download className='w-4 h-4' />
            <span className='hidden sm:inline'>导出直播源</span>
            <span className='sm:hidden'>导出</span>
          </button>
          <button
            onClick={handleRefreshLiveSources}
            disabled={isRefreshing || isLoading('refreshLiveSources')}
            className={`px-3 py-1.5 text-sm font-medium flex items-center space-x-2 ${
              isRefreshing || isLoading('refreshLiveSources')
                ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-lg'
                : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors'
            }`}
          >
            <span>
              {isRefreshing || isLoading('refreshLiveSources')
                ? '刷新中...'
                : '刷新直播源'}
            </span>
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={
              showAddForm ? buttonStyles.secondary : buttonStyles.success
            }
          >
            {showAddForm ? '取消' : '添加直播源'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newLiveSource.name}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newLiveSource.key}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='M3U 地址'
              value={newLiveSource.url}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, url: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='节目单地址（选填）'
              value={newLiveSource.epg}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, epg: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='自定义 UA（选填）'
              value={newLiveSource.ua}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, ua: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddLiveSource}
              disabled={
                !newLiveSource.name ||
                !newLiveSource.key ||
                !newLiveSource.url ||
                isLoading('addLiveSource')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newLiveSource.name ||
                !newLiveSource.key ||
                !newLiveSource.url ||
                isLoading('addLiveSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addLiveSource') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* 编辑直播源表单 */}
      {editingLiveSource && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='flex items-center justify-between'>
            <h5 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              编辑直播源: {editingLiveSource.name}
            </h5>
            <button
              onClick={handleCancelEdit}
              className='text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            >
              ✕
            </button>
          </div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                名称
              </label>
              <input
                type='text'
                value={editingLiveSource.name}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, name: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                Key (不可编辑)
              </label>
              <input
                type='text'
                value={editingLiveSource.key}
                disabled
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                M3U 地址
              </label>
              <input
                type='text'
                value={editingLiveSource.url}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, url: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                节目单地址（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.epg}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, epg: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                自定义 UA（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.ua}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, ua: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
          </div>
          <div className='flex justify-end space-x-2'>
            <button
              onClick={handleCancelEdit}
              className={buttonStyles.secondary}
            >
              取消
            </button>
            <button
              onClick={handleEditLiveSource}
              disabled={
                !editingLiveSource.name ||
                !editingLiveSource.url ||
                isLoading('editLiveSource')
              }
              className={`${
                !editingLiveSource.name ||
                !editingLiveSource.url ||
                isLoading('editLiveSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('editLiveSource') ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      <LiveSourceSearch
        groups={searchGroups}
        disabled={
          isLoading('batchSortLiveSources') || isLoading('saveLiveSourceOrder')
        }
        onChange={(groups) => {
          setSearchGroups(groups);
          setSelectedLiveKeys(new Set());
        }}
      />
      <div className='space-y-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-900'>
        <div className='flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200'>
          <span>
            匹配 {filteredLiveSources.length} / {liveSources.length} 个，已选{' '}
            {selectedFilteredKeys.length} 个
          </span>
          <button
            type='button'
            disabled={
              filteredLiveSources.length === 0 ||
              isLoading('batchSortLiveSources')
            }
            className={`${buttonStyles.roundedSecondary} disabled:opacity-50`}
            onClick={() =>
              setSelectedLiveKeys(
                allFilteredSelected
                  ? new Set()
                  : new Set(filteredLiveSources.map((source) => source.key)),
              )
            }
          >
            {allFilteredSelected ? '取消全选' : '全选搜索结果'}
          </button>
          <button
            type='button'
            className={buttonStyles.roundedSecondary}
            disabled={
              selectedFilteredKeys.length === 0 ||
              isLoading('batchSortLiveSources')
            }
            onClick={() => setSelectedLiveKeys(new Set())}
          >
            清空选择
          </button>
          <label className='flex items-center gap-2'>
            批量排序值
            <input
              type='number'
              step='1'
              aria-label='批量排序值'
              value={batchSortOrder}
              disabled={isLoading('batchSortLiveSources')}
              onChange={(event) => setBatchSortOrder(event.target.value)}
              className='w-28 rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800'
            />
          </label>
          <button
            type='button'
            disabled={
              selectedFilteredKeys.length === 0 ||
              orderChanged ||
              isLoading('batchSortLiveSources') ||
              isLoading('saveLiveSourceOrder')
            }
            onClick={() =>
              handleSetSortOrder(selectedFilteredKeys, batchSortOrder)
            }
            className={`${buttonStyles.roundedPrimary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isLoading('batchSortLiveSources')
              ? '保存中...'
              : `设置选中 ${selectedFilteredKeys.length} 个源`}
          </button>
        </div>
        <p className='text-xs text-gray-500 dark:text-gray-400'>
          排序值越小越靠前，未设置按 1000
          处理，相同值保持原顺序。拖拽可调整同值顺序，搜索时暂停拖拽；拖拽后请先保存排序。
        </p>
      </div>

      {/* 直播源表格 */}
      <div
        className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
        data-table='live-source-list'
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full whitespace-nowrap divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-8' />
                <th className='px-3 py-3'>
                  <input
                    type='checkbox'
                    aria-label='全选搜索结果中的直播源'
                    checked={allFilteredSelected}
                    ref={(element) => {
                      if (element)
                        element.indeterminate =
                          selectedFilteredKeys.length > 0 &&
                          !allFilteredSelected;
                    }}
                    disabled={
                      filteredLiveSources.length === 0 ||
                      isLoading('batchSortLiveSources')
                    }
                    onChange={(event) =>
                      setSelectedLiveKeys(
                        event.target.checked
                          ? new Set(
                              filteredLiveSources.map((source) => source.key),
                            )
                          : new Set(),
                      )
                    }
                    className='h-4 w-4 accent-green-600'
                  />
                </th>
                <th className='px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400'>
                  排序值
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  M3U 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  节目单地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  自定义 UA
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  频道数
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={filteredLiveSources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {filteredLiveSources.map(renderRow)}
                {filteredLiveSources.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className='px-6 py-8 text-center text-sm text-gray-500'
                    >
                      没有符合条件的直播源
                    </td>
                  </tr>
                )}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveLiveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveLiveSourceOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveLiveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

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

      {showSmartImport && (
        <SourceImportDialog
          type='live'
          onClose={() => setShowSmartImport(false)}
          onDone={refreshConfig}
        />
      )}

      {importExportModal.isOpen && (
        <ImportExportModal
          isOpen={importExportModal.isOpen}
          mode={importExportModal.mode}
          onClose={() =>
            setImportExportModal({ isOpen: false, mode: 'import' })
          }
          onImport={handleImportLiveSources}
          onExport={handleExportLiveSources}
          result={importExportModal.result}
          entityName='直播源'
          arrayFormatDescription='用于"直播源配置"卡片的导入功能,支持批量导入直播源'
          configFormatDescription='用于"配置文件"卡片,可直接粘贴到配置文件编辑器中的 lives 字段'
          configFormatExample='{"lives": {...}}'
          arrayFilenameHint='live_sources_YYYYMMDD_HHMMSS.json'
          configFilenameHint='live_config_YYYYMMDD_HHMMSS.json'
        />
      )}
    </div>
  );
};
