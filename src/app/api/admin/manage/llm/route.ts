import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

import { jsonNoStore, requireAdmin } from '@/lib/admin-auth';
import { buildChatCompletionsUrl } from '@/lib/translation/protocol.mjs';
import { translationKv as kv } from '@/lib/translation/store';
import {
  deleteLlmConfig,
  getActiveLlmId,
  getLlmConfig,
  getLlmStats,
  getQuota,
  listLlmConfigs,
  saveLlmConfig,
  setActiveLlmId,
  setQuota,
} from '@/lib/translation/store-core.mjs';

export const runtime = 'nodejs';

// 只返回脱敏状态，密钥不出现在任何响应中。
function maskKey(apiKey: string) {
  if (!apiKey) return '';
  return apiKey.length <= 8
    ? '****'
    : `${apiKey.slice(0, 3)}****${apiKey.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const [configs, activeId] = await Promise.all([
    listLlmConfigs(kv),
    getActiveLlmId(kv),
  ]);
  const items = await Promise.all(
    configs.map(async (config) => ({
      id: config.id,
      name: config.name,
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: !!config.apiKey,
      apiKeyMasked: maskKey(config.apiKey),
      active: config.id === activeId,
      quota: await getQuota(kv, config.id),
      stats: await getLlmStats(kv, config.id),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })),
  );
  return jsonNoStore({
    items,
    activeId,
    defaults: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  });
}

function validateFields(body: Record<string, unknown>, partial: boolean) {
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const baseUrl =
    typeof body.baseUrl === 'string' ? body.baseUrl.trim() : undefined;
  const model = typeof body.model === 'string' ? body.model.trim() : undefined;
  if (!partial && (!name || !baseUrl || !model))
    throw new Error('名称、baseUrl 和模型 ID 不能为空');
  if (name !== undefined && !name) throw new Error('名称不能为空');
  if (model !== undefined && !model) throw new Error('模型 ID 不能为空');
  if (baseUrl !== undefined) buildChatCompletionsUrl(baseUrl);
  return { name, baseUrl, model };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action;
    const id = typeof body.id === 'string' ? body.id : '';
    const now = Date.now();
    switch (action) {
      case 'add': {
        const fields = validateFields(body, false);
        const config = {
          id: randomUUID(),
          name: fields.name as string,
          baseUrl: fields.baseUrl as string,
          model: fields.model as string,
          apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : '',
          createdAt: now,
          updatedAt: now,
        };
        await saveLlmConfig(kv, config, true);
        return jsonNoStore({ ok: true, id: config.id });
      }
      case 'edit': {
        const current = await getLlmConfig(kv, id);
        if (!current)
          return jsonNoStore({ error: '配置不存在' }, { status: 404 });
        const fields = validateFields(body, true);
        // 空密钥表示保留旧值；替换需提交新值，清空使用 clear_key。
        const apiKey =
          typeof body.apiKey === 'string' && body.apiKey.trim()
            ? body.apiKey.trim()
            : current.apiKey;
        await saveLlmConfig(
          kv,
          {
            ...current,
            name: fields.name ?? current.name,
            baseUrl: fields.baseUrl ?? current.baseUrl,
            model: fields.model ?? current.model,
            apiKey,
            updatedAt: now,
          },
          false,
        );
        return jsonNoStore({ ok: true });
      }
      case 'clear_key': {
        const current = await getLlmConfig(kv, id);
        if (!current)
          return jsonNoStore({ error: '配置不存在' }, { status: 404 });
        await saveLlmConfig(
          kv,
          { ...current, apiKey: '', updatedAt: now },
          false,
        );
        return jsonNoStore({ ok: true });
      }
      case 'activate': {
        if (!(await getLlmConfig(kv, id)))
          return jsonNoStore({ error: '配置不存在' }, { status: 404 });
        await setActiveLlmId(kv, id);
        return jsonNoStore({ ok: true });
      }
      case 'deactivate': {
        await setActiveLlmId(kv, null);
        return jsonNoStore({ ok: true });
      }
      case 'set_quota': {
        if (!(await getLlmConfig(kv, id)))
          return jsonNoStore({ error: '配置不存在' }, { status: 404 });
        const quota = await setQuota(kv, id, body.quota);
        return jsonNoStore({ ok: true, quota });
      }
      case 'delete': {
        await deleteLlmConfig(kv, id);
        return jsonNoStore({ ok: true });
      }
      default:
        return jsonNoStore({ error: '未知操作' }, { status: 400 });
    }
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 400 },
    );
  }
}
