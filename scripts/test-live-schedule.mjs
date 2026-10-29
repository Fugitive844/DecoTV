import assert from 'node:assert/strict';
import test from 'node:test';

import { createLiveChannelCache } from '../src/lib/live-cache-manager.mjs';
import {
  getLiveRetryDelay,
  isLiveCoolingDown,
  isLiveScheduleDue,
  markLiveAttempt,
  markLiveFailure,
  markLiveSuccess,
  normalizeLiveSchedule,
} from '../src/lib/live-schedule.mjs';

const MIN = 60_000;
const channels = (n = 1) => ({
  channelNumber: n,
  channels: Array.from({ length: n }, (_, i) => ({
    id: `s-${i}`,
    tvgId: '',
    name: `C${i}`,
    logo: '',
    group: 'G',
    url: `http://x/${i}`,
  })),
  epgUrl: '',
  epgs: {},
});

test('失败冷却阶梯 1/5/15/60 分钟，之后保持 60；成功清零并按 1 小时刷新', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 9].map(getLiveRetryDelay),
    [1, 5, 15, 60, 60, 60].map((m) => m * MIN),
  );
  let state = normalizeLiveSchedule(null, 'fp');
  assert.equal(isLiveScheduleDue(state, 0), true, '新源立即到期');
  state = markLiveFailure(markLiveAttempt(state, 0), 0, '网络错误');
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(isLiveCoolingDown(state, 30_000), true);
  assert.equal(isLiveScheduleDue(state, 30_000), false);
  assert.equal(isLiveScheduleDue(state, MIN), true);
  state = markLiveFailure(state, MIN, 'x');
  assert.equal(state.nextAttemptAt, MIN + 5 * MIN);
  state = markLiveSuccess(state, 10 * MIN, 'EPG 获取失败');
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.nextAttemptAt, 70 * MIN);
  assert.equal(state.lastEpgError, 'EPG 获取失败');
  assert.equal(isLiveCoolingDown(state, 11 * MIN), false);
});

test('重启恢复持久化状态；配置指纹变化后重新开始调度', () => {
  const saved = JSON.parse(
    JSON.stringify(markLiveFailure(normalizeLiveSchedule(null, 'fp'), 0, 'e')),
  );
  assert.equal(normalizeLiveSchedule(saved, 'fp').consecutiveFailures, 1);
  const changed = normalizeLiveSchedule(saved, 'fp2');
  assert.equal(changed.consecutiveFailures, 0);
  assert.equal(changed.nextAttemptAt, 0);
});

test('进行中占用到期后释放，进程退出不会永远卡住', () => {
  const state = markLiveAttempt(normalizeLiveSchedule(null, 'fp'), 0);
  assert.equal(isLiveScheduleDue(state, MIN), false);
  assert.equal(isLiveScheduleDue(state, 6 * MIN), true);
});

function controlledCache(concurrency = 1, hooks = {}) {
  const order = [];
  const gates = new Map();
  const cache = createLiveChannelCache({
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    },
    fingerprint: (source) => source.url,
    concurrency,
    hooks,
    fetchSource: (source) => {
      order.push(source.key);
      return new Promise((resolve, reject) =>
        gates.set(source.key, { resolve, reject }),
      );
    },
  });
  const finish = async (key, ok = true) => {
    while (!gates.has(key)) await new Promise((r) => setTimeout(r, 1));
    const gate = gates.get(key);
    gates.delete(key);
    if (ok) gate.resolve(channels());
    else gate.reject(new Error('fail'));
    await new Promise((r) => setTimeout(r, 2));
  };
  return { cache, order, finish };
}
const src = (key) => ({ key, name: key, url: `http://${key}` });

test('前台无缓存任务优先；连续 3 个优先任务后放行 1 个普通任务', async () => {
  const { cache, order, finish } = controlledCache(1);
  const all = [cache.refresh(src('busy'))];
  ['n1', 'n2'].forEach((key) => all.push(cache.refresh(src(key))));
  ['p1', 'p2', 'p3', 'p4'].forEach((key) =>
    all.push(cache.refresh(src(key), { priority: true })),
  );
  for (const key of ['busy', 'p1', 'p2', 'p3', 'n1', 'p4', 'n2'])
    await finish(key);
  await Promise.all(all);
  assert.deepEqual(order, ['busy', 'p1', 'p2', 'p3', 'n1', 'p4', 'n2']);
});

test('已排队的普通任务被前台访问提升优先级并复用同一任务', async () => {
  const { cache, order, finish } = controlledCache(1);
  const busy = cache.refresh(src('busy'));
  const normal = cache.refresh(src('a'));
  const other = cache.refresh(src('b'));
  const promoted = cache.refresh(src('b'), { priority: true });
  assert.equal(promoted, other, '同源同配置复用一个任务');
  await finish('busy');
  await finish('b');
  await finish('a');
  await Promise.all([busy, normal, other]);
  assert.deepEqual(order, ['busy', 'b', 'a']);
});

test('抓取钩子记录开始、成功、失败；钩子异常不影响抓取结果', async () => {
  const events = [];
  const { cache, finish } = controlledCache(2, {
    onStart: (s) => events.push(`start:${s.key}`),
    onSuccess: (s) => {
      events.push(`ok:${s.key}`);
      throw new Error('钩子错误');
    },
    onFailure: (s) => events.push(`fail:${s.key}`),
  });
  const ok = cache.refresh(src('a'));
  const bad = cache.refresh(src('b'));
  await finish('a');
  await finish('b', false);
  assert.equal((await ok).channelNumber, 1);
  await assert.rejects(bad);
  assert.deepEqual(events.sort(), ['fail:b', 'ok:a', 'start:a', 'start:b']);
  assert.equal(await cache.peek(src('b')), null, 'peek 不触发抓取');
});
