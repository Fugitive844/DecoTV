/**
 * 集成测试：在真实 Kvrocks 上验证 Lua 比较写入、额度原子扣减、并发认领与重连后持久化。
 *   KVROCKS_TEST_URL=redis://:密码@127.0.0.1:16380 node --test scripts/test-storage-kvrocks.mjs
 * 所有键带 itest: 前缀，结束后清理，不触碰业务数据。
 */
import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import { createClient } from 'redis';

import { COMPARE_AND_SET_SCRIPT } from '../src/lib/kv-scripts.mjs';
import {
  claimBatch,
  consumeQuota,
  enqueueTexts,
  getItem,
  getQuota,
  saveLlmConfig,
  setQuota,
} from '../src/lib/translation/store-core.mjs';

const url = process.env.KVROCKS_TEST_URL;
const PREFIX = `itest:${Date.now()}:`;

function createKv(client) {
  const k = (key) => PREFIX + key;
  return {
    kvGet: (key) => client.get(k(key)),
    kvMGet: async (keys) => (keys.length ? client.mGet(keys.map(k)) : []),
    kvSet: async (key, value, options = {}) =>
      (await client.set(k(key), value, {
        ...(options.nx ? { NX: true } : {}),
        ...(options.px ? { PX: options.px } : {}),
      })) === 'OK',
    kvDel: async (keys) => {
      if (keys.length) await client.del(keys.map(k));
    },
    kvCompareAndSet: async (key, expected, value, px) =>
      Number(
        await client.eval(COMPARE_AND_SET_SCRIPT, {
          keys: [k(key)],
          arguments: [
            expected === null ? '1' : '0',
            expected ?? '',
            value === null ? '1' : '0',
            value ?? '',
            px ? String(px) : '',
          ],
        }),
      ) === 1,
    zAdd: (key, score, member) => client.zAdd(k(key), { score, value: member }),
    zRem: async (key, members) => {
      if (members.length) await client.zRem(k(key), members);
    },
    zRangeByScore: (key, min, max, limit) =>
      client.zRangeByScore(k(key), min, max, {
        LIMIT: { offset: 0, count: limit },
      }),
    zRangeAll: (key) => client.zRange(k(key), 0, -1),
  };
}

test('Kvrocks 集成', { skip: !url && '未设置 KVROCKS_TEST_URL' }, async (t) => {
  const client = createClient({ url });
  await client.connect();
  const kv = createKv(client);
  t.after(async () => {
    const keys = await client.keys(`${PREFIX}*`);
    if (keys.length) await client.del(keys);
    await client.quit();
  });

  await t.test(
    'Lua 比较写入：不存在才写、值匹配才改、可删除、PX 过期',
    async () => {
      assert.equal(await kv.kvCompareAndSet('cas', null, 'a'), true);
      assert.equal(await kv.kvCompareAndSet('cas', null, 'b'), false);
      assert.equal(await kv.kvCompareAndSet('cas', 'x', 'b'), false);
      assert.equal(await kv.kvCompareAndSet('cas', 'a', 'b'), true);
      assert.equal(await kv.kvGet('cas'), 'b');
      assert.equal(await kv.kvCompareAndSet('cas', 'b', null), true);
      assert.equal(await kv.kvGet('cas'), null);
      assert.equal(await kv.kvCompareAndSet('lock', null, 'me', 200), true);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(await kv.kvGet('lock'), null);
    },
  );

  await t.test('额度并发扣减：余额 5，30 个并发请求只放行 5 个', async () => {
    await saveLlmConfig(
      kv,
      {
        id: 'q',
        name: 'q',
        baseUrl: 'http://x',
        model: 'm',
        apiKey: 'k',
        createdAt: 1,
        updatedAt: 1,
      },
      true,
    );
    assert.equal(await getQuota(kv, 'q'), 0);
    await setQuota(kv, 'q', 5);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        consumeQuota(kv, 'q', `${PREFIX}r${i}`),
      ),
    );
    assert.equal(results.filter((r) => r.allowed).length, 5);
    assert.equal(await getQuota(kv, 'q'), 0);
  });

  await t.test('两个认领者并发，同一记录只被认领一次', async () => {
    await enqueueTexts(
      kv,
      Array.from({ length: 50 }, (_, i) => `T${i}`),
      0,
    );
    const [a, b] = await Promise.all([
      claimBatch(kv, 10, 100, 60_000),
      claimBatch(kv, 10, 100, 60_000),
    ]);
    const texts = [...a, ...b].map((item) => item.text);
    assert.equal(texts.length, 50);
    assert.equal(new Set(texts).size, 50);
  });

  await t.test('重新连接后数据仍在（持久化）', async () => {
    const other = createClient({ url });
    await other.connect();
    const kv2 = createKv(other);
    assert.equal((await getItem(kv2, 'T1')).status, 'processing');
    await other.quit();
  });
});
