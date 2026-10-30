/**
 * 批量翻译工作器：每站并发 1，与直播抓取队列分开。
 * 每轮最多认领 100 条；满 100 条立即继续，不足 100 条（含 0 条）或本轮中止后休眠 2 分钟。
 */
import process from 'node:process';
import { createManualProgress } from './manual-progress.mjs';
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
  getManualTranslationJob,
  getWorkerState,
  getTranslationPrompt,
  isAutomaticTranslationEnabled,
  MAX_FAIL_COUNT,
  recordLlmCall,
  queueManualTranslationJob,
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
 *   httpPost: (url: string, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<{ status: number, text: string }>,
 *   httpPostStream?: (url: string, headers: Record<string, string>, body: string, timeoutMs: number, onEvent: (event: any) => void, signal?: AbortSignal) => Promise<{ content: string, truncated: boolean }>,
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

  /** @param {{ baseUrl: string, model: string, apiKey: string }} config @param {{ id: string, text: string }[]} items @param {{ onEvent?: (event: any) => void, signal?: AbortSignal }} [options] */
  const callModel = async (config, items, options = {}) => {
    const url = buildChatCompletionsUrl(config.baseUrl);
    const systemPrompt = await getTranslationPrompt(kv);
    const streaming = !!options.onEvent && !!deps.httpPostStream;
    const requestBody = buildTranslationRequestBody(
      { ...config, systemPrompt },
      items,
      {
        stream: streaming,
        thinking: !!options.onEvent,
      },
    );
    const body = JSON.stringify(requestBody);
    options.signal?.throwIfAborted();
    options.onEvent?.({
      type: 'request',
      model: config.model,
      messages: requestBody.messages,
    });
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
    if (streaming) {
      try {
        const outer = await deps.httpPostStream(
          url,
          headers,
          body,
          Math.max(requestTimeoutMs, 180_000),
          options.onEvent,
          options.signal,
        );
        return parseTranslationContent(
          outer.content,
          new Map(items.map((item) => [item.id, item.text])),
          outer.truncated,
          new Set(
            items.filter((item) => item.mustTranslate).map((item) => item.id),
          ),
        );
      } catch (error) {
        throw new TranslationTransportError(
          options.signal?.aborted
            ? '手动翻译已取消'
            : String(error?.message || '模型流式请求失败').replaceAll(
                config.apiKey,
                '[已隐藏]',
              ),
        );
      }
    }
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

  /** @param {import('./store-core.mjs').TranslationItem} item @param {{ kind: string, translation?: string, error?: string }} result @param {'model'} source */
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
   * @returns {Promise<{ claimed: number, aborted: boolean, reason?: string, succeeded?: number, failed?: number }>}
   */
  const runRound = async ({ manual = false, onEvent, signal } = {}) => {
    if (!manual && !(await isAutomaticTranslationEnabled(kv)))
      return { claimed: 0, aborted: true, reason: 'disabled' };
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
    const retryDelays = manual ? [] : transportRetryDelays;
    const callKind = manual ? 'manual' : 'auto';
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (!manual && !(await isAutomaticTranslationEnabled(kv))) {
        await releaseClaimed(kv, remaining, now());
        return { claimed: claimed.length, aborted: true, reason: 'disabled' };
      }
      const quota = manual
        ? { allowed: true }
        : await consumeQuota(kv, config.id, newRequestId());
      if (!quota.allowed) {
        await releaseClaimed(kv, remaining, now());
        await setWorkerState(kv, {
          lastRoundAt: startedAt,
          lastClaimed: claimed.length,
          lastStop: `配置「${config.name}」自动调用额度不足`,
          lastStopAt: now(),
        });
        return { claimed: claimed.length, aborted: true, reason: 'quota' };
      }
      try {
        outcome = await exclusive(() =>
          callModel(config, requestItems, { onEvent, signal }),
        );
        await recordCall(config.id, { kind: callKind });
        break;
      } catch (error) {
        if (!(error instanceof TranslationTransportError)) throw error;
        await recordCall(config.id, { kind: callKind, error: error.message });
        log(`模型接口错误（第 ${attempt + 1} 次）：${error.message}`);
        if (attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]);
          continue;
        }
        // 接口级故障不计入词失败次数，保留记录等待下一轮。
        await releaseClaimed(kv, remaining, now());
        await setWorkerState(kv, {
          lastRoundAt: startedAt,
          lastClaimed: claimed.length,
          lastStop: manual
            ? `手动翻译接口失败，本轮停止：${error.message}`
            : `模型接口连续失败，本轮停止：${error.message}`,
          lastStopAt: now(),
        });
        return { claimed: claimed.length, aborted: true, reason: 'transport' };
      }
    }

    const finishedAt = now();
    let succeeded = 0;
    let failed = 0;
    for (let index = 0; index < remaining.length; index++) {
      const item = remaining[index];
      const result = outcome?.results.get(String(index + 1)) || {
        kind: 'fail',
        error: '模型漏项',
      };
      await commitWithRetry(() =>
        commitClaimed(
          kv,
          item,
          resultPatch(item, result, 'model', finishedAt),
          finishedAt,
        ),
      );
      if (result.kind === 'fail') failed++;
      else succeeded++;
    }
    await setWorkerState(kv, {
      lastRoundAt: startedAt,
      lastClaimed: claimed.length,
      lastSucceeded: succeeded,
      lastFailed: failed,
      lastProtocolErrors: (outcome?.protocolErrors || []).slice(0, 5),
      lastStop: '',
    });
    return { claimed: claimed.length, aborted: false, succeeded, failed };
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

  /** 手动选中项允许重新翻译终态；失败保留原结果，不自动重试。 */
  const translateSelectedBatch = async (texts, options = {}) => {
    const items = (
      await Promise.all(texts.map((text) => getItem(kv, text)))
    ).filter(Boolean);
    const activeId = await getActiveLlmId(kv);
    const config = activeId ? await getLlmConfig(kv, activeId) : null;
    if (!config || !config.apiKey)
      throw new Error('没有启用的模型配置，请先在「大模型配置」中启用');
    if (!items.length)
      return { succeeded: 0, failed: texts.length, aborted: false };
    let outcome;
    let transportError = '';
    try {
      outcome = await exclusive(() =>
        callModel(
          config,
          items.map((item, index) => ({
            id: String(index + 1),
            text: item.text,
            mustTranslate: item.needsTranslation === 'yes',
          })),
          options,
        ),
      );
      await recordCall(config.id, { kind: 'manual' });
    } catch (error) {
      if (!(error instanceof TranslationTransportError)) throw error;
      transportError = error.message;
      await recordCall(config.id, { kind: 'manual', error: transportError });
    }
    let succeeded = 0;
    let failed = texts.length - items.length;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const result = outcome?.results.get(String(index + 1)) || {
        kind: 'fail',
        error: transportError || '模型漏项',
      };
      const changed = await commitWithRetry(() =>
        commitClaimed(
          kv,
          item,
          result.kind === 'fail'
            ? () => ({ lastError: `手动翻译失败：${result.error}` })
            : resultPatch(item, result, 'model', now()),
          now(),
        ),
      );
      if (changed && result.kind !== 'fail') succeeded++;
      else failed++;
    }
    return {
      succeeded,
      failed,
      aborted: !!transportError,
      error: transportError,
    };
  };

  /** 每次只执行手动任务的一批，下一批仍由同一个持锁工作循环处理。 */
  const runManualJobInner = async (job, onEvent) => {
    await setWorkerState(kv, { sleepingUntil: 0, lastManualError: '' });
    if (job.texts === null) {
      const result = await runRound({ manual: true, onEvent });
      await setWorkerState(kv, {
        lastManualTotal: result.claimed,
        lastManualCompleted: result.aborted ? 0 : result.claimed,
        lastManualSucceeded: result.succeeded ?? 0,
        lastManualFailed: result.failed ?? 0,
        lastManualError: result.aborted
          ? `本轮未完成（${result.reason}），请检查模型配置或接口后手动重试`
          : '',
        lastManualAt: now(),
      });
      await kv.kvCompareAndSet(STORE_KEYS.manualJob, JSON.stringify(job), null);
      return result;
    }
    const texts = job.texts.slice(job.completed, job.completed + batchSize);
    const result = await translateSelectedBatch(texts, { onEvent });
    const next = {
      ...job,
      completed: job.completed + texts.length,
      succeeded: job.succeeded + result.succeeded,
      failed: job.failed + result.failed,
    };
    const done = result.aborted || next.completed >= job.texts.length;
    await setWorkerState(kv, {
      lastManualTotal: job.texts.length,
      lastManualCompleted: next.completed,
      lastManualSucceeded: next.succeeded,
      lastManualFailed: next.failed,
      lastManualError: result.aborted ? result.error || '手动任务已中止' : '',
      lastManualAt: now(),
    });
    await kv.kvCompareAndSet(
      STORE_KEYS.manualJob,
      JSON.stringify(job),
      done ? null : JSON.stringify(next),
    );
    return { claimed: texts.length, aborted: result.aborted };
  };

  const runManualJob = async (job) => {
    const progress = await createManualProgress(kv, job.id);
    progress.emit({
      type: 'status',
      message: `后台正在处理第 ${Math.floor(job.completed / batchSize) + 1} 批（每批最多 ${batchSize} 条）`,
    });
    try {
      const result = await runManualJobInner(job, progress.emit);
      const state = await getWorkerState(kv);
      const summary = `已处理 ${state.lastManualCompleted || 0} / ${state.lastManualTotal || 0} 条，成功 ${state.lastManualSucceeded || 0}，失败 ${state.lastManualFailed || 0}`;
      if (result.aborted)
        progress.emit({
          type: 'error',
          message: state.lastManualError || '手动翻译已中止',
        });
      else if (!(await getManualTranslationJob(kv)))
        progress.emit({ type: 'complete', message: summary });
      else progress.emit({ type: 'status', message: summary });
      return result;
    } catch (error) {
      progress.emit({
        type: 'error',
        message: error?.message || '手动翻译失败',
      });
      throw error;
    } finally {
      await progress.flush();
    }
  };

  const wake = () => {
    wakeResolve();
    void kv
      .kvSet(STORE_KEYS.workerWake, String(Date.now()))
      .catch(() => undefined);
  };

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
          let ownsLock = false;
          try {
            if (await holdLock()) {
              ownsLock = true;
              await setWorkerState(kv, { owner: ownerId, running: true });
              const manualJob = await getManualTranslationJob(kv);
              if (manualJob) {
                try {
                  result = await runManualJob(manualJob);
                } catch (error) {
                  // 手动请求不能因下一次扫描而自动重复；明确记录中止并等待再次手动提交。
                  await kv.kvCompareAndSet(
                    STORE_KEYS.manualJob,
                    JSON.stringify(manualJob),
                    null,
                  );
                  await setWorkerState(kv, {
                    lastManualError: `${/** @type {Error} */ (error)?.message || error}`,
                    lastManualAt: now(),
                  });
                  throw error;
                }
              } else if (await isAutomaticTranslationEnabled(kv)) {
                result = await runRound();
              }
            }
          } catch (error) {
            log('翻译工作循环出错', error);
            await setWorkerState(kv, {
              lastStop: `工作循环出错：${/** @type {Error} */ (error)?.message || error}`,
              lastStopAt: now(),
            }).catch(() => {});
          }
          if (!running) break;
          if (ownsLock && (await getManualTranslationJob(kv))) continue;
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
    wake,
    /**
     * 入队后立即返回，模型请求由后台持锁进程串行执行。
     * @param {string[] | null} [texts]
     */
    async requestManualTranslation(texts = null) {
      const activeId = await getActiveLlmId(kv);
      const config = activeId ? await getLlmConfig(kv, activeId) : null;
      if (!config || !config.apiKey)
        throw new Error('没有启用的模型配置，请先在「大模型配置」中启用');
      const job = await queueManualTranslationJob(
        kv,
        texts,
        newRequestId(),
        now(),
      );
      wake();
      return job;
    },
    /**
     * 任意行手动翻译一次：绕过且不扣自动额度，只发 1 次 HTTP，不自动重试。
     * @param {string} text
     * @param {{ onEvent?: (event: any) => void, signal?: AbortSignal }} [options]
     */
    async translateOnce(text, options = {}) {
      options.signal?.throwIfAborted();
      if (manualInFlight.has(text)) throw new Error('该行正在手动翻译，请稍候');
      const item = await getItem(kv, text);
      if (!item) throw new Error('翻译记录不存在');
      const activeId = await getActiveLlmId(kv);
      const config = activeId ? await getLlmConfig(kv, activeId) : null;
      if (!config || !config.apiKey)
        throw new Error('没有启用的模型配置，请先在「大模型配置」中启用');
      if (manualInFlight.has(text)) throw new Error('该行正在手动翻译，请稍候');
      manualInFlight.add(text);
      try {
        options.onEvent?.({
          type: 'status',
          message: '已排队，等待当前模型请求结束…',
        });
        let outcome;
        try {
          outcome = await exclusive(() =>
            callModel(
              config,
              [
                {
                  id: '1',
                  text,
                  mustTranslate: item.needsTranslation === 'yes',
                },
              ],
              options,
            ),
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
        options.onEvent?.({
          type: 'status',
          message: '模型回复校验通过，正在保存译文…',
        });
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
        if (!updated) throw new Error('翻译记录已被移除，结果未保存');
        return updated;
      } finally {
        manualInFlight.delete(text);
      }
    },
  };
}
