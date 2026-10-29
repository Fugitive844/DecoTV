import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyImport,
  applyManualEdit,
  importFingerprint,
  mergeSourceRecord,
  parseImportData,
  previewImport,
  restoreUpstream,
} from '../src/lib/source-merge.mjs';

const video = (key, extra = {}) => ({
  key,
  name: key,
  api: `http://${key}/api`,
  from: 'config',
  disabled: false,
  is_adult: false,
  upstream: { name: key, api: `http://${key}/api`, is_adult: false },
  ...extra,
});
const live = (key, extra = {}) => ({
  key,
  name: key,
  url: `http://${key}.m3u`,
  from: 'config',
  disabled: false,
  sortOrder: 1000,
  channelNumber: 50,
  upstream: { name: key, url: `http://${key}.m3u` },
  ...extra,
});

test('解析多种格式；同类型重复 key 明确报错', () => {
  assert.equal(
    parseImportData('video', [{ key: 'a', name: 'A', api: 'http://a' }]).length,
    1,
  );
  assert.equal(
    parseImportData('video', {
      api_site: { a: { name: 'A', api: 'http://a' } },
    })[0].key,
    'a',
  );
  assert.equal(
    parseImportData('live', { lives: { l: { name: 'L', url: 'http://l' } } })[0]
      .key,
    'l',
  );
  assert.equal(
    parseImportData('live', {
      l: { name: 'L', url: 'http://l', sortOrder: 5 },
    })[0].fields.sortOrder,
    5,
  );
  assert.throws(
    () =>
      parseImportData('video', [
        { key: 'a', name: 'A', api: 'x' },
        { key: 'a', name: 'B', api: 'y' },
      ]),
    /重复/,
  );
  assert.throws(
    () => parseImportData('live', [{ key: 'l', name: 'L' }]),
    /M3U/,
  );
  assert.throws(
    () =>
      parseImportData('live', [
        { key: 'l', name: 'L', url: 'u', sortOrder: 1.5 },
      ]),
    /整数/,
  );
});

test('人工编辑形成覆盖；智能合并保留人工值，强制覆盖清除覆盖；可恢复来源值', () => {
  const edited = applyManualEdit('video', video('a'), {
    name: '我的A',
    detail: '',
  });
  assert.deepEqual(edited.overriddenFields, ['name']);
  const smart = mergeSourceRecord(
    'video',
    edited,
    { key: 'a', fields: { name: '订阅新名', api: 'http://new' } },
    'smart',
    'config',
  );
  assert.equal(smart.name, '我的A');
  assert.equal(smart.api, 'http://new');
  assert.equal(smart.upstream.name, '订阅新名');
  const restored = restoreUpstream(smart);
  assert.equal(restored.name, '订阅新名');
  assert.equal(restored.overriddenFields, undefined);
  const forced = mergeSourceRecord(
    'video',
    edited,
    { key: 'a', fields: { name: '强制名' } },
    'overwrite',
    'custom',
  );
  assert.equal(forced.name, '强制名');
  assert.equal(forced.overriddenFields, undefined);
  assert.equal(forced.api, 'http://a/api', '导入未提供的字段保留');
});

test('直播源智能模式保留本地排序与启停，不触碰频道数', () => {
  const local = live('l', { sortOrder: 3, disabled: true });
  const merged = mergeSourceRecord(
    'live',
    local,
    {
      key: 'l',
      fields: { name: 'L2', url: 'http://l2', sortOrder: 9, disabled: false },
    },
    'smart',
    'config',
  );
  assert.equal(merged.sortOrder, 3);
  assert.equal(merged.disabled, true);
  assert.equal(merged.url, 'http://l2');
  assert.equal(merged.channelNumber, 50);
  const forced = mergeSourceRecord(
    'live',
    local,
    { key: 'l', fields: { name: 'L2', url: 'http://l2', sortOrder: 9 } },
    'overwrite',
    'custom',
  );
  assert.equal(forced.sortOrder, 9);
  assert.equal(forced.disabled, true, '未提供的本地字段保留');
});

test('四种导入模式；新直播源默认排序 1000 且启用；缺失 key 不删除', () => {
  const list = [live('a', { sortOrder: 1 }), live('b')];
  const items = parseImportData('live', [
    { key: 'a', name: 'A2', url: 'http://a2' },
    { key: 'c', name: 'C', url: 'http://c' },
  ]);
  const skip = applyImport('live', list, items, 'skip');
  assert.equal(skip.list[0].name, 'a');
  assert.equal(skip.list.length, 3);
  assert.equal(skip.list[2].sortOrder, 1000);
  assert.equal(skip.list[2].disabled, false);
  assert.ok(skip.list.some((s) => s.key === 'b'));
  const smart = applyImport('live', list, items, 'smart');
  assert.equal(smart.list[0].name, 'A2');
  assert.equal(smart.list[0].sortOrder, 1);
  assert.throws(() => applyImport('live', list, items, 'ask', {}), /未选择/);
  const ask = applyImport('live', list, items, 'ask', { a: 'skip' });
  assert.equal(ask.list[0].name, 'a');
  assert.equal(ask.summary.added, 1);
  assert.equal(list[0].name, 'a', '原数组不被修改');
});

test('预览列出新增与冲突；预览后配置变化则指纹不同', () => {
  const list = [video('a')];
  const items = parseImportData('video', [
    { key: 'a', name: 'A2', api: 'http://a/api' },
    { key: 'b', name: 'B', api: 'http://b' },
  ]);
  const preview = previewImport('video', list, items);
  assert.deepEqual(
    preview.added.map((i) => i.key),
    ['b'],
  );
  assert.deepEqual(preview.conflicts[0].changes, ['name']);
  const changed = [applyManualEdit('video', list[0], { name: '别人改了' })];
  assert.notEqual(importFingerprint(changed, items), preview.fingerprint);
});
