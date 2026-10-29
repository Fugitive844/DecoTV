import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  buildLiveChannelDisplayList,
  isLiveCacheInfoChannel,
} from '../src/lib/live-channel-display.mjs';

import {
  createLiveChannelCache,
  normalizeLiveRefreshConcurrency,
} from '../src/lib/live-cache-manager.mjs';

const source = (key = 'main', url = 'https://example.invalid/live.m3u') => ({
  key,
  name: key,
  url,
});
const data = (line = 'old') => ({
  channelNumber: 1,
  channels: [
    {
      id: 'main-0',
      tvgId: 'cctv1',
      name: 'CCTV-1',
      logo: '',
      group: '央视',
      url: `https://example.invalid/${line}.m3u8`,
    },
  ],
  epgUrl: '',
  epgs: {},
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const database = () => {
  const records = new Map();
  return {
    records,
    async get(key) {
      return records.has(key) ? clone(records.get(key)) : null;
    },
    async set(key, value) {
      records.set(key, clone(value));
    },
    async delete(key) {
      records.delete(key);
    },
  };
};
const manager = (storage, extra = {}) =>
  createLiveChannelCache({
    storage,
    fingerprint: (item) =>
      JSON.stringify([item.url, item.ua || '', item.epg || '']),
    fetchSource: async () => data(),
    ...extra,
  });

test('重建缓存管理器后从数据库读取，不访问上游，也不按时间过期', async () => {
  const storage = database();
  let fetched = 0;
  const first = manager(storage, {
    now: () => 1000,
    fetchSource: async () => {
      fetched++;
      return data();
    },
  });
  const original = await first.get(source());
  const restarted = manager(storage, {
    now: () => 9_000_000_000_000,
    fetchSource: async () => {
      throw new Error('upstream offline');
    },
  });
  assert.deepEqual(await restarted.get(source()), original);
  assert.equal(fetched, 1);
  assert.equal(original.fetchedAt, 1000);
});

test('刷新网络失败后旧缓存和成功抓取时间保持不变', async () => {
  const storage = database();
  let offline = false;
  const cache = manager(storage, {
    now: () => (offline ? 2000 : 1000),
    fetchSource: async () => {
      if (offline) throw new Error('offline');
      return data();
    },
  });
  const old = await cache.get(source());
  offline = true;
  await assert.rejects(cache.refresh(source()), /offline/);
  assert.deepEqual(await cache.get(source()), old);
  assert.deepEqual(await storage.get('main'), old);
});

test('上游返回空列表不得替换数据库中的成功版本', async () => {
  const storage = database();
  let empty = false;
  const cache = manager(storage, {
    fetchSource: async () =>
      empty ? { ...data(), channels: [], channelNumber: 0 } : data(),
  });
  const old = await cache.get(source());
  empty = true;
  await assert.rejects(cache.refresh(source()), /没有有效频道/);
  assert.deepEqual(await storage.get('main'), old);
});

test('后台刷新仍在等待网络时，用户读取立即返回旧缓存', async () => {
  const storage = database();
  const gate = deferred();
  const started = deferred();
  let refresh = false;
  const cache = manager(storage, {
    fetchSource: async () => {
      if (!refresh) return data();
      started.resolve();
      await gate.promise;
      return data('new');
    },
  });
  const old = await cache.get(source());
  refresh = true;
  const pending = cache.refresh(source());
  await started.promise;
  const read = await Promise.race([
    cache.get(source()),
    delay(200).then(() => {
      throw new Error('cached read blocked by refresh');
    }),
  ]);
  assert.deepEqual(read, old);
  gate.resolve();
  await pending;
  assert.equal(
    (await cache.get(source())).channels[0].url,
    data('new').channels[0].url,
  );
});

test('同一源同时被定时、手动、按需刷新时只抓取一次', async () => {
  const storage = database();
  const gate = deferred();
  let calls = 0;
  const cache = manager(storage, {
    fetchSource: async () => {
      calls++;
      await gate.promise;
      return data();
    },
  });
  const a = cache.refresh(source());
  const b = cache.refresh(source());
  const c = cache.get(source());
  assert.equal(a, b);
  gate.resolve();
  await Promise.all([a, b, c]);
  assert.equal(calls, 1);
});

test('不同入口共用并发上限，任务失败后释放队列槽位', async () => {
  const storage = database();
  let active = 0,
    maximum = 0;
  const cache = manager(storage, {
    concurrency: 2,
    fetchSource: async (item) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await delay(8);
        if (item.key === 'bad') throw new Error('offline');
        return data(item.key);
      } finally {
        active--;
      }
    },
  });
  const results = await Promise.allSettled(
    ['a', 'b', 'bad', 'c', 'd', 'e', 'f', 'g'].map((key, index) =>
      index % 2 ? cache.get(source(key)) : cache.refresh(source(key)),
    ),
  );
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 7);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
});

test('数据库写入失败时不得发布新缓存或改变成功时间', async () => {
  const storage = database();
  let fail = false;
  const write = storage.set;
  storage.set = async (key, record) => {
    if (fail) throw new Error('database offline');
    await write(key, record);
  };
  let clock = 1000;
  const cache = manager(storage, {
    now: () => clock,
    fetchSource: async () => data(String(clock)),
  });
  const old = await cache.get(source());
  fail = true;
  clock = 2000;
  await assert.rejects(cache.refresh(source()), /database offline/);
  assert.deepEqual(await cache.get(source()), old);
  assert.deepEqual(await storage.get('main'), old);
  fail = false;
  await cache.refresh(source());
  assert.equal((await cache.get(source())).fetchedAt, 2000);
});

for (const phase of ['network', 'database']) {
  test(`删除源时使正在进行的${phase}任务失效，不得写回已删除缓存`, async () => {
    const storage = database();
    const started = deferred();
    const gate = deferred();
    if (phase === 'database') {
      const write = storage.set;
      storage.set = async (key, record) => {
        started.resolve();
        await gate.promise;
        await write(key, record);
      };
    }
    const cache = manager(storage, {
      fetchSource: async () => {
        if (phase === 'network') {
          started.resolve();
          await gate.promise;
        }
        return data();
      },
    });
    const pending = cache.refresh(source());
    const rejected = assert.rejects(pending, /直播源已变更/);
    await started.promise;
    const removed = cache.delete('main');
    gate.resolve();
    await Promise.all([removed, rejected]);
    assert.equal(await storage.get('main'), null);
  });
}

test('修改源地址后，旧请求晚到也不得覆盖新配置的缓存', async () => {
  const storage = database();
  const gate = deferred();
  const started = deferred();
  const cache = manager(storage, {
    concurrency: 2,
    fetchSource: async (item) => {
      if (item.url.endsWith('/old')) {
        started.resolve();
        await gate.promise;
        return data('old');
      }
      return data('new');
    },
  });
  const old = cache.refresh(source('main', 'https://example.invalid/old'));
  const rejected = assert.rejects(old, /直播源已变更/);
  await started.promise;
  const latest = await cache.refresh(
    source('main', 'https://example.invalid/new'),
  );
  gate.resolve();
  await rejected;
  assert.deepEqual(await storage.get('main'), latest);
});

test('损坏的数据库缓存按未命中处理，不阻断首次抓取', async () => {
  const storage = database();
  storage.records.set('main', { channels: [], fetchedAt: 'bad' });
  const cache = manager(storage);
  const result = await cache.get(source());
  assert.equal(result.version, 1);
  assert.equal(result.channels.length, 1);
});

test('默认并发为 4，非法设置回退默认，允许范围 1 至 16', () => {
  for (const value of [undefined, null, '', 0, -1, 17, 'invalid', 1.5])
    assert.equal(normalizeLiveRefreshConcurrency(value), 4);
  for (const value of [1, '2', 4, 16])
    assert.equal(normalizeLiveRefreshConcurrency(value), Number(value));
});

test('接口第一条为时间说明频道，复用真实第一频道地址且不修改缓存', async () => {
  const storage = database();
  const cache = manager(storage, {
    now: () => Date.parse('2026-10-29T10:20:30Z'),
  });
  const original = await cache.get(source());
  const response = buildLiveChannelDisplayList('main', original);
  assert.equal(response.length, original.channels.length + 1);
  assert.equal(response[0].name, '上次服务器抓取源时间');
  assert.equal(response[0].group, '2026-10-29 18:20:30（北京时间）');
  assert.equal(response[0].url, original.channels[0].url);
  assert.equal(isLiveCacheInfoChannel('main', response[0]), true);
  assert.equal(isLiveCacheInfoChannel('main', response[1]), false);
  assert.deepEqual(Object.keys(response[0]).sort(), [
    'group',
    'id',
    'logo',
    'name',
    'tvgId',
    'tvgName',
    'url',
  ]);
  assert.deepEqual(response.slice(1), original.channels);
  assert.equal(original.channelNumber, 1);
  assert.equal((await storage.get('main')).channels.length, 1);
});
