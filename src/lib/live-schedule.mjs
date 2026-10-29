/**
 * 直播源抓取调度状态（持久化到数据库）。纯函数，无框架依赖。
 * 失败冷却阶梯 1、5、15、60 分钟，之后保持 60 分钟；成功后清零并按 1 小时正常刷新。
 */

const MINUTE = 60_000;
export const LIVE_RETRY_LADDER_MS = [1, 5, 15, 60].map((m) => m * MINUTE);
export const LIVE_HEALTHY_INTERVAL_MS = 60 * MINUTE;
// 进行中占用的最长时间（M3U、EPG 各 30 秒 + 排队）；进程退出后到期自动释放。
export const LIVE_RUNNING_LEASE_MS = 5 * MINUTE;

/**
 * @typedef {{
 *   fingerprint: string,
 *   lastAttemptAt: number,
 *   lastSuccessAt: number,
 *   consecutiveFailures: number,
 *   nextAttemptAt: number,
 *   lastError: string,
 *   lastEpgError: string,
 *   runningUntil: number
 * }} LiveScheduleState
 */

/** @param {string} fingerprint @returns {LiveScheduleState} */
export function createLiveSchedule(fingerprint) {
  return {
    fingerprint,
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    consecutiveFailures: 0,
    nextAttemptAt: 0,
    lastError: '',
    lastEpgError: '',
    runningUntil: 0,
  };
}

/**
 * 配置指纹变化（地址、UA、EPG 修改）后重新开始调度，立即到期。
 * @param {unknown} raw @param {string} fingerprint @returns {LiveScheduleState}
 */
export function normalizeLiveSchedule(raw, fingerprint) {
  if (!raw || typeof raw !== 'object') return createLiveSchedule(fingerprint);
  const value = /** @type {Record<string, unknown>} */ (raw);
  if (value.fingerprint !== fingerprint) return createLiveSchedule(fingerprint);
  const num = (/** @type {unknown} */ v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  return {
    fingerprint,
    lastAttemptAt: num(value.lastAttemptAt),
    lastSuccessAt: num(value.lastSuccessAt),
    consecutiveFailures: Math.floor(num(value.consecutiveFailures)),
    nextAttemptAt: num(value.nextAttemptAt),
    lastError: typeof value.lastError === 'string' ? value.lastError : '',
    lastEpgError:
      typeof value.lastEpgError === 'string' ? value.lastEpgError : '',
    runningUntil: num(value.runningUntil),
  };
}

/** @param {number} failures 连续失败次数（≥1） */
export function getLiveRetryDelay(failures) {
  const index = Math.min(Math.max(failures, 1), LIVE_RETRY_LADDER_MS.length);
  return LIVE_RETRY_LADDER_MS[index - 1];
}

/** @param {LiveScheduleState} state @param {number} now @returns {LiveScheduleState} */
export function markLiveAttempt(state, now) {
  return {
    ...state,
    lastAttemptAt: now,
    runningUntil: now + LIVE_RUNNING_LEASE_MS,
  };
}

/** @param {LiveScheduleState} state @param {number} now @param {string} [epgError] @returns {LiveScheduleState} */
export function markLiveSuccess(state, now, epgError = '') {
  return {
    ...state,
    lastSuccessAt: now,
    consecutiveFailures: 0,
    nextAttemptAt: now + LIVE_HEALTHY_INTERVAL_MS,
    lastError: '',
    lastEpgError: epgError,
    runningUntil: 0,
  };
}

/** @param {LiveScheduleState} state @param {number} now @param {string} error @returns {LiveScheduleState} */
export function markLiveFailure(state, now, error) {
  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    ...state,
    consecutiveFailures,
    nextAttemptAt: now + getLiveRetryDelay(consecutiveFailures),
    lastError: String(error || '未知错误').slice(0, 500),
    runningUntil: 0,
  };
}

/** 到期且不在进行中占用期内。 @param {LiveScheduleState} state @param {number} now */
export function isLiveScheduleDue(state, now) {
  return state.nextAttemptAt <= now && state.runningUntil <= now;
}

/** 失败冷却期内：前台和普通刷新都不能绕过。 @param {LiveScheduleState} state @param {number} now */
export function isLiveCoolingDown(state, now) {
  return state.consecutiveFailures > 0 && state.nextAttemptAt > now;
}
