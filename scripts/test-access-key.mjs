import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createAccessKeys,
  createAccessKeyValidator,
  deleteAccessKeys,
  generateKeyString,
  listAccessKeys,
  normalizeAccessKey,
  setEmptyKeyEnabled,
  shouldShowAdult,
  updateAccessKeys,
} from '../src/lib/access-key/store-core.mjs';
import { createMemoryKv } from './test-helpers/memory-kv.mjs';

test('秘钥格式与规范化', () => {
  const key = generateKeyString();
  assert.match(key, /^DK[A-Z2-7]{20}$/);
  assert.equal(normalizeAccessKey(`  ${key.toLowerCase()} `), key);
  assert.equal(normalizeAccessKey('DK123'), '');
  assert.equal(normalizeAccessKey(undefined), '');
});

test('批量生成：唯一、默认启用、数量限制', async () => {
  const kv = createMemoryKv();
  const items = await createAccessKeys(kv, 20, ' 朋友 ', 100);
  assert.equal(new Set(items.map((i) => i.key)).size, 20);
  assert.ok(items.every((i) => i.enabled && i.remark === '朋友'));
  assert.equal((await listAccessKeys(kv)).length, 20);
  await assert.rejects(() => createAccessKeys(kv, 0, '', 1));
  await assert.rejects(() => createAccessKeys(kv, 101, '', 1));
});

test('碰撞时重试，不覆盖已有秘钥', async () => {
  const kv = createMemoryKv();
  let calls = 0;
  const random = (n) => Buffer.alloc(n, calls++ < 2 ? 0 : 1);
  const [first] = await createAccessKeys(kv, 1, 'a', 1, random);
  const [second] = await createAccessKeys(kv, 1, 'b', 2, random);
  assert.notEqual(first.key, second.key);
  assert.equal(
    (await listAccessKeys(kv)).find((i) => i.key === first.key).remark,
    'a',
  );
});

test('校验：启用有效，停用、删除、格式错误无效；invalidate 立即生效', async () => {
  const kv = createMemoryKv();
  let clock = 1000;
  const validator = createAccessKeyValidator(kv, { now: () => clock });
  const [item] = await createAccessKeys(kv, 1, '', 1);
  assert.equal(await validator.validate(item.key.toLowerCase()), true);
  assert.equal(await validator.validate('nope'), false);
  assert.equal(await validator.validate(''), false);

  await updateAccessKeys(kv, [item.key], { enabled: false }, 2);
  assert.equal(await validator.validate(item.key), true, '缓存期内仍为旧结果');
  validator.invalidate();
  assert.equal(await validator.validate(item.key), false);

  await updateAccessKeys(kv, [item.key], { enabled: true }, 3);
  clock += 31_000;
  assert.equal(await validator.validate(item.key), true, '缓存过期后重新读取');

  assert.equal(await deleteAccessKeys(kv, [item.key, 'bad']), 1);
  validator.invalidate();
  assert.equal(await validator.validate(item.key), false);
  assert.equal((await listAccessKeys(kv)).length, 0);
});

test('有效使用时节流记录最近使用时间', async () => {
  const kv = createMemoryKv();
  let clock = 1_000_000;
  const validator = createAccessKeyValidator(kv, {
    now: () => clock,
    ttlMs: 0,
  });
  const [item] = await createAccessKeys(kv, 1, '', 1);
  await validator.validate(item.key);
  await new Promise((r) => setTimeout(r, 0));
  const first = (await listAccessKeys(kv))[0].lastUsedAt;
  assert.equal(first, 1_000_000);
  clock += 60_000;
  await validator.validate(item.key);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    (await listAccessKeys(kv))[0].lastUsedAt,
    first,
    '10 分钟内不重复写',
  );
});

test('批量修改：备注与不存在的秘钥', async () => {
  const kv = createMemoryKv();
  const items = await createAccessKeys(kv, 2, '', 1);
  const result = await updateAccessKeys(
    kv,
    [...items.map((i) => i.key), 'DKAAAAAAAAAAAAAAAAAAAA', 'x'],
    { remark: '新备注' },
    5,
  );
  assert.deepEqual(result, { updated: 2, skipped: 2 });
  assert.ok((await listAccessKeys(kv)).every((i) => i.remark === '新备注'));
});

test('空秘钥：启用后不带或带无效秘钥也放行，validateKey 仍严格', async () => {
  const kv = createMemoryKv();
  const validator = createAccessKeyValidator(kv);
  assert.equal(await validator.validate(''), false);
  await setEmptyKeyEnabled(kv, true);
  validator.invalidate();
  assert.equal(await validator.validate(''), true);
  assert.equal(await validator.validate('wrong'), true);
  assert.equal(await validator.validateKey('wrong'), false);
  await setEmptyKeyEnabled(kv, false);
  validator.invalidate();
  assert.equal(await validator.validate(''), false);
});

test('判定矩阵：总开关关闭过滤且秘钥有效才展示', () => {
  assert.equal(
    shouldShowAdult({ disableYellowFilter: true, keyValid: true }),
    true,
  );
  assert.equal(
    shouldShowAdult({ disableYellowFilter: true, keyValid: false }),
    false,
  );
  assert.equal(
    shouldShowAdult({ disableYellowFilter: false, keyValid: true }),
    false,
  );
  assert.equal(
    shouldShowAdult({ disableYellowFilter: undefined, keyValid: true }),
    false,
  );
});
