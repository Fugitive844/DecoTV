/**
 * 批量翻译工作器：每站并发 1，与直播抓取队列分开。
 * 每轮最多认领 100 条；满 100 条立即继续，不足 100 条（含 0 条）或本轮中止后休眠 2 分钟。
 */
import process from 'node:process';
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from 'node:timers';
import {
  buildChatCompletionsUrl,
  buildTranslationRequestBody,
  isThinkingEnabled,
  MAX_SOURCE_TEXT_LENGTH,
  parseChatCompletionResponse,
  parseTranslationContent,
  TranslationTransportError,
} from './protocol.mjs';
import {
  claimBatch,
  commitClaimed,
  consumeQuota,
  failurePatch,
  getActiveLlmId,
  getItem,
  getLlmConfig,
  MAX_FAIL_COUNT,
  recordLlmCall,
  releaseClaimed,
  STATUS,
  STORE_KEYS,
  setWorkerState,
  updateItem,
} from './store-core.mjs';
import { isTranslationCandidate } from './text-filter.mjs';

export class TranslationDbWriteError extends Error {}

/**
 * @param {{
 *   kv: import('./store-core.mjs').Kv,
 *   sharedFile: { lookup(texts: string[]): Promise<Map<string, { translation: string, needsTranslation: boolean }>>, append(entries: { text: string, translation: string, needsTranslation: boolean }[]): Promise<boolean> },
 *   httpPost: (url: string, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<{ status: number, text: string }>,
 *   now?: () => number,
 *   sleep?: (ms: number, signal?: { wake: Promise<void> }) => Promise<void>,
 *   newRequestId?: () => string,
 *   log?: (message: string, error?: unknown) => void,
 *   batchSize?: number,
 *   idleMs?: number,
 *   leaseMs?: number,
 *   transportRetryDelays?: number[],
 *   contentRetryDelayMs?: number,
 *   requestTimeoutMs?: number,
 *   lockMs?: number,
 *   ownerId?: string
 * }} deps
 */
export function createTranslationWorker(deps) {
  const kv = deps.kv;
  const now = deps.now || Date.now;
  const batchSize = deps.batchSize ?? 100;
  const idleMs = deps.idleMs ?? 120_000;
  const leaseMs = deps.leaseMs ?? 15 * 60_000;
  const transportRetryDelays = deps.transportRetryDelays ?? [2_000, 5_000];
  const contentRetryDelayMs = deps.contentRetryDelayMs ?? 120_000;
  const requestTimeoutMs = deps.requestTimeoutMs ?? 60_000;
  // 锁有效期短、运行期间定时续期：长请求不丢锁，进程重启后新实例也能很快接手。
  const lockMs = deps.lockMs ?? 90_000;
  const ownerId =
    deps.ownerId || `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const log = deps.log || (() => {});
  const newRequestId =
    deps.newRequestId ||
    (() => `${now()}-${Math.random().toString(36).slice(2, 12)}`);

  let wakeResolve = () => {};
  let wakePromise = Promise.resolve();
  const resetWake = () => {
    wakePromise = new Promise((resolve) => {
      wakeResolve = resolve;
    });
  };
  resetWake();
  const timerSleep = (/** @type {number} */ ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      void wakePromise.then(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  const sleep = deps.sleep || timerSleep;
  // 管理接口与后台任务可能是不同的模块实例，唤醒信号经数据库传递：
  // 空闲休眠期间每 3 秒检查一次唤醒标记。
  let lastWakeSeen = 0;
  const readWake = async () =>
    Number(await kv.kvGet(STORE_KEYS.workerWake).catch(() => null)) || 0;
  const idleSleep =
    deps.sleep ||
    (async (/** @type {number} */ ms) => {
      const end = now() + ms;
      while (running && now() < end) {
        await timerSleep(Math.min(3_000, end - now()));
        const wake = await readWake();
        if (wake > lastWakeSeen) {
          lastWakeSeen = wake;
          return;
        }
      }
    });

  // 站内模型请求串行执行器：自动批次与手动单行共用，不并发。
  /** @type {Promise<unknown>} */
  let serial = Promise.resolve();
  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  const exclusive = (task) => {
    const run = serial.then(task, task);
    serial = run.catch(() => undefined);
    return run;
  };

  /** @param {{ baseUrl: string, model: string, apiKey: string }} config @param {{ id: string, text: string }[]} items */
  const callModel = async (config, items) => {
    const url = buildChatCompletionsUrl(config.baseUrl);
    const body = JSON.stringify(buildTranslationRequestBody(config, items));
    let response;
    try {
      response = await deps.httpPost(
        url,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body,
        // 深度思考需要更长时间生成。
        isThinkingEnabled(config)
          ? Math.max(requestTimeoutMs, 180_000)
          : requestTimeoutMs,
      );
    } catch (error) {
      const message =
        /** @type {Error} */ (error)?.name === 'TimeoutError'
          ? '模型接口请求超时'
          : `模型接口连接失败：${/** @type {Error} */ (error)?.message || error}`;
      throw new TranslationTransportError(message);
    }
    const outer = parseChatCompletionResponse(response.status, response.text);
    const idToText = new Map(items.map((item) => [item.id, item.text]));
    const mustTranslateIds = new Set(
      items.filter((item) => item.mustTranslate).map((item) => item.id),
    );
    return parseTranslationContent(
      outer.content,
      idToText,
      outer.truncated,
      mustTranslateIds,
    );
  };

  // 调用统计只用于后台展示，写入失败不能中断本轮或导致重复请求模型。
  const recordCall = async (
    /** @type {string} */ id,
    /** @type {{ kind: string, error?: string }} */ call,
  ) => {
    try {
      await recordLlmCall(kv, id, call, now());
    } catch (error) {
      log('记录模型调用统计失败', error);
    }
  };

  /** 写库失败优先重试落库，不重新请求模型。 */
  const commitWithRetry = async (
    /** @type {() => Promise<unknown>} */ write,
  ) => {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await write();
      } catch (error) {
        lastError = error;
        await sleep(500 * (attempt + 1));
      }
    }
    throw new TranslationDbWriteError(
      `保存翻译结果失败：${/** @type {Error} */ (lastError)?.message || lastError}`,
    );
  };

  /** @param {import('./store-core.mjs').TranslationItem} item @param {{ kind: string, translation?: string, error?: string }} result @param {'model' | 'shared'} source */
  const resultPatch = (item, result, source, at) => {
    if (result.kind === 'success')
      return () => ({
        status: STATUS.SUCCESS,
        translation: /** @type {string} */ (result.translation),
        needsTranslation: /** @type {'yes'} */ ('yes'),
        resultSource: source,
        lastError: '',
      });
    if (result.kind === 'no_need')
      return () => ({
        status: STATUS.NO_NEED,
        translation: '',
        needsTranslation: /** @type {'no'} */ ('no'),
        resultSource: source,
        lastError: '',
      });
    return (/** @type {any} */ current) =>
      failurePatch(
        current,
        result.error || '翻译失败',
        at,
        contentRetryDelayMs,
      );
  };

  /**
   * 执行一轮：返回认领数量与是否中止（无配置、额度不足、接口故障）。
   * @returns {Promise<{ claimed: number, aborted: boolean, reason?: string }>}
   */
  const runRound = async () => {
    const startedAt = now();
    const claimed = await claimBatch(kv, startedAt, batchSize, leaseMs);
    if (claimed.length === 0) {
      await setWorkerState(kv, { lastRoundAt: startedAt, lastClaimed: 0 });
      return { claimed: 0, aborted: false };
    }

    /** @type {typeof claimed} */
    let remaining = [];
    for (const item of claimed) {
      if (item.text.length > MAX_SOURCE_TEXT_LENGTH)
        await commitWithRetry(() =>
          commitClaimed(
            kv,
            item,
            () => ({
              status: STATUS.FAILED,
              failCount: MAX_FAIL_COUNT,
              lastError: '原文过长',
            }),
            now(),
          ),
        );
      else if (!isTranslationCandidate(item.text))
        // 规则收紧前入库的日期、纯数字等：直接标记无需翻译，不发给模型。
        await commitWithRetry(() =>
          commitClaimed(
            kv,
            item,
            () => ({
              status: STATUS.NO_NEED,
              needsTranslation: /** @type {'no'} */ ('no'),
              translation: '',
              lastError: '',
            }),
            now(),
          ),
        );
      else remaining.push(item);
    }

    // 共享文件命中直接导入，不消耗模型额度。
    const hits = await deps.sharedFile.lookup(
      remaining.map((item) => item.text),
    );
    let sharedHits = 0;
    for (const item of remaining) {
      const hit = hits.get(item.text);
      if (!hit) continue;
      const result = hit.needsTranslation
        ? { kind: 'success', translation: hit.translation }
        : { kind: 'no_need' };
      await commitWithRetry(() =>
        commitClaimed(
          kv,
          item,
          resultPatch(item, result, 'shared', now()),
          now(),
        ),
      );
      sharedHits++;
    }
    remaining = remaining.filter((item) => !hits.has(item.text));

    // 再次核对：已被人工修改或其他任务完成的记录不发送。
    const fresh = [];
    for (const item of remaining) {
      const current = await getItem(kv, item.text);
      if (current && current.version === item.version) fresh.push(item);
    }
    remaining = fresh;
    if (remaining.length === 0) {
      await setWorkerState(kv, {
        lastRoundAt: startedAt,
        lastClaimed: claimed.length,
        lastSharedHits: sharedHits,
      });
      return { claimed: claimed.length, aborted: false };
    }

    const activeId = await getActiveLlmId(kv);
    const config = activeId ? await getLlmConfig(kv, activeId) : null;
    if (!config || !config.apiKey) {
      await releaseClaimed(kv, remaining, now());
      await setWorkerState(kv, {
        lastRoundAt: startedAt,
        lastClaimed: claimed.length,
        lastSharedHits: sharedHits,
        lastStop: '未启用模型配置或缺少 API Key，待处理记录保留',
        lastStopAt: now(),
      });
      return { claimed: claimed.length, aborted: true, reason: 'no_config' };
    }

    // 管理员标记为需要翻译的原文要求模型必须翻译，不能再返回无需翻译。
    const requestItems = remaining.map((item, index) => ({
      id: String(index + 1),
      text: item.text,
      mustTranslate: item.needsTranslation === 'yes',
    }));
    let outcome = null;
    for (let attempt = 0; attempt <= transportRetryDelays.length; attempt++) {
      const quota = await consumeQuota(kv, config.id, newRequestId());
      if (!quota.allowed) {
        await releaseClaimed(kv, remaining, now());
        await setWorkerState(kv, {
          lastRoundAt: startedAt,
          lastClaimed: claimed.length,
          lastSharedHits: sharedHits,
          lastStop: `配置「${config.name}」自动调用额度不足`,
          lastStopAt: now(),
        });
        return { claimed: claimed.length, aborted: true, reason: 'quota' };
      }
      try {
        outcome = await exclusive(() => callModel(config, requestItems));
        await recordCall(config.id, { kind: 'auto' });
        break;
      } catch (error) {
        if (!(error instanceof TranslationTransportError)) throw error;
        await recordCall(config.id, { kind: 'auto', error: error.message });
        log(`模型接口错误（第 ${attempt + 1} 次）：${error.message}`);
        if (attempt < transportRetryDelays.length) {
          await sleep(transportRetryDelays[attempt]);
          continue;
        }
        // 接口级故障不计入词失败次数，保留记录等待下一轮。
        await releaseClaimed(kv, remaining, now());
        await setWorkerState(kv, {
          lastRoundAt: startedAt,
          lastClaimed: claimed.length,
          lastSharedHits: sharedHits,
          lastStop: `模型接口连续失败，本轮停止：${error.message}`,
          lastStopAt: now(),
        });
        return { claimed: claimed.length, aborted: true, reason: 'transport' };
      }
    }

    const finishedAt = now();
    /** @type {{ text: string, translation: string, needsTranslation: boolean }[]} */
    const shared = [];
    let succeeded = 0;
    let failed = 0;
    for (let index = 0; index < remaining.length; index++) {
      const item = remaining[index];
      const result = outcome?.results.get(String(index + 1)) || {
        kind: 'fail',
        error: '模型漏项',
      };
      const committed = await commitWithRetry(() =>
        commitClaimed(
          kv,
          item,
          resultPatch(item, result, 'model', finishedAt),
          finishedAt,
        ),
      );
      if (result.kind === 'fail') failed++;
      else {
        succeeded++;
        if (committed)
          shared.push({
            text: item.text,
            translation: result.kind === 'success' ? result.translation : '',
            needsTranslation: result.kind === 'success',
          });
      }
    }
    if (shared.length > 0) await deps.sharedFile.append(shared);
    await setWorkerState(kv, {
      lastRoundAt: startedAt,
      lastClaimed: claimed.length,
      lastSharedHits: sharedHits,
      lastSucceeded: succeeded,
      lastFailed: failed,
      lastProtocolErrors: (outcome?.protocolErrors || []).slice(0, 5),
      lastStop: '',
    });
    return { claimed: claimed.length, aborted: false };
  };

  // 多进程／重复启动时只有持锁进程执行循环；进程退出后锁按 lockMs 过期。
  const holdLock = async () => {
    if (
      await kv.kvSet(STORE_KEYS.workerLock, ownerId, { nx: true, px: lockMs })
    )
      return true;
    return kv.kvCompareAndSet(STORE_KEYS.workerLock, ownerId, ownerId, lockMs);
  };

  let running = false;
  /** @type {Promise<void> | null} */
  let loop = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let heartbeat = null;
  /** @type {Set<string>} */
  const manualInFlight = new Set();

  return {
    runRound,
    start() {
      if (loop) return loop;
      running = true;
      heartbeat = setInterval(
        () => {
          void kv
            .kvCompareAndSet(STORE_KEYS.workerLock, ownerId, ownerId, lockMs)
            .catch(() => undefined);
        },
        Math.max(1_000, Math.floor(lockMs / 3)),
      );
      heartbeat.unref?.();
      loop = (async () => {
        lastWakeSeen = await readWake();
        while (running) {
          let result = { claimed: 0, aborted: true };
          try {
            if (await holdLock()) {
              await setWorkerState(kv, { owner: ownerId, running: true });
              result = await runRound();
            }
          } catch (error) {
            log('翻译工作循环出错', error);
            await setWorkerState(kv, {
              lastStop: `工作循环出错：${/** @type {Error} */ (error)?.message || error}`,
              lastStopAt: now(),
            }).catch(() => {});
          }
          if (!running) break;
          if (result.claimed >= batchSize && !result.aborted) continue;
          await setWorkerState(kv, { sleepingUntil: now() + idleMs }).catch(
            () => {},
          );
          await idleSleep(idleMs);
          resetWake();
        }
      })();
      return loop;
    },
    stop() {
      running = false;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      wakeResolve();
    },
    /** 立即结束休眠，开始下一轮（例如收集历史后）。 */
    wake() {
      wakeResolve();
      void kv
        .kvSet(STORE_KEYS.workerWake, String(Date.now()))
        .catch(() => undefined);
    },
    /**
     * 任意行手动翻译一次：绕过且不扣自动额度，只发 1 次 HTTP，不自动重试。
     * @param {string} text
     */
    async translateOnce(text) {
      if (manualInFlight.has(text)) throw new Error('该行正在手动翻译，请稍候');
      const item = await getItem(kv, text);
      if (!item) throw new Error('翻译记录不存在');
      const activeId = await getActiveLlmId(kv);
      const config = activeId ? await getLlmConfig(kv, activeId) : null;
      if (!config || !config.apiKey)
        throw new Error('没有启用的模型配置，请先在「大模型配置」中启用');
      manualInFlight.add(text);
      try {
        let outcome;
        try {
          outcome = await exclusive(() =>
            callModel(config, [
              { id: '1', text, mustTranslate: item.needsTranslation === 'yes' },
            ]),
          );
          await recordCall(config.id, { kind: 'manual' });
        } catch (error) {
          const message =
            /** @type {Error} */ (error)?.message || String(error);
          await recordCall(config.id, { kind: 'manual', error: message });
          await updateItem(kv, text, (current) =>
            current
              ? {
                  ...current,
                  lastError: `手动翻译失败：${message}`,
                  updatedAt: now(),
                }
              : undefined,
          );
          throw new Error(`手动翻译失败：${message}`);
        }
        const result = outcome.results.get('1') || {
          kind: 'fail',
          error: '模型漏项',
        };
        if (result.kind === 'fail') {
          await updateItem(kv, text, (current) =>
            current
              ? {
                  ...current,
                  lastError: `手动翻译失败：${result.error}`,
                  updatedAt: now(),
                }
              : undefined,
          );
          throw new Error(`手动翻译失败：${result.error}`);
        }
        const at = now();
        const { item: updated } = await updateItem(kv, text, (current) =>
          current
            ? {
                ...current,
                status:
                  result.kind === 'success' ? STATUS.SUCCESS : STATUS.NO_NEED,
                translation:
                  result.kind === 'success' ? result.translation : '',
                needsTranslation: result.kind === 'success' ? 'yes' : 'no',
                resultSource: 'model',
                lastError: '',
                leaseUntil: 0,
                version: current.version + 1,
                updatedAt: at,
              }
            : undefined,
        );
        await deps.sharedFile.append([
          {
            text,
            translation: result.kind === 'success' ? result.translation : '',
            needsTranslation: result.kind === 'success',
          },
        ]);
        return updated;
      } finally {
        manualInFlight.delete(text);
      }
    },
  };
}
