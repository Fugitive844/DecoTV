import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChatCompletionsUrl,
  buildTranslationRequestBody,
  parseChatCompletionResponse,
  parseTranslationContent,
  TranslationTransportError,
} from '../src/lib/translation/protocol.mjs';
import {
  claimBatch,
  commitClaimed,
  consumeQuota,
  editItem,
  enqueueTexts,
  getItem,
  getTranslationMap,
  rekeyItem,
  resetItem,
  saveLlmConfig,
  setActiveLlmId,
  setQuota,
  getQuota,
  getLlmStats,
  STATUS,
} from '../src/lib/translation/store-core.mjs';
import {
  collectCandidateTexts,
  hasHanCharacter,
  isTranslationCandidate,
} from '../src/lib/translation/text-filter.mjs';
import { createTranslationWorker } from '../src/lib/translation/worker.mjs';
import { createMemoryKv } from './test-helpers/memory-kv.mjs';

const completion = (content, finish = 'stop') =>
  JSON.stringify({
    choices: [
      { message: { role: 'assistant', content }, finish_reason: finish },
    ],
  });

// 模拟模型：按 id 回传，返回 {status,text}
function fakeModel(handler) {
  const calls = [];
  const httpPost = async (url, headers, body) => {
    const request = JSON.parse(body);
    const items = JSON.parse(request.messages[1].content).items;
    calls.push({ url, items, request, headers });
    return handler(items, calls.length);
  };
  return { calls, httpPost };
}
const okModel = (items) => ({
  status: 200,
  text: completion(
    JSON.stringify({
      items: items.map((item) => ({
        id: item.id,
        needsTranslation: true,
        translation: `译${item.text}`,
      })),
    }),
  ),
});

function noShared() {
  return { lookup: async () => new Map(), append: async () => true };
}

async function setupWorker(kv, httpPost, options = {}) {
  await saveLlmConfig(
    kv,
    {
      id: 'c1',
      name: '假配置',
      baseUrl: 'http://mock/v1',
      model: 'fake',
      apiKey: 'sk-fake',
      createdAt: 1,
      updatedAt: 1,
    },
    true,
  );
  await setActiveLlmId(kv, 'c1');
  await setQuota(kv, 'c1', options.quota ?? -1);
  let clock = options.clock ?? 1_000_000;
  const worker = createTranslationWorker({
    kv,
    httpPost,
    sharedFile: options.sharedFile || noShared(),
    now: () => clock,
    sleep: async () => {},
    contentRetryDelayMs: 120_000,
    ...options.workerOptions,
  });
  return { worker, advance: (ms) => (clock += ms), now: () => clock };
}

test('只收集完全不含汉字的分类和频道名，日文汉字也跳过', () => {
  assert.equal(hasHanCharacter('CCTV-1 综合'), true);
  assert.equal(isTranslationCandidate('NHK 総合'), false);
  assert.equal(isTranslationCandidate('BBC News'), true);
  assert.equal(isTranslationCandidate('  '), false);
  assert.equal(
    isTranslationCandidate('2026-08-27 14:06:22'),
    false,
    '日期不收集',
  );
  assert.equal(isTranslationCandidate('4K'), true);
  assert.deepEqual(
    collectCandidateTexts({
      channels: [
        { name: 'BBC News', group: 'News' },
        { name: 'BBC News', group: '新闻' },
        { name: '凤凰卫视', group: 'News' },
      ],
    }).sort(),
    ['BBC News', 'News'],
  );
});

test('baseUrl 规范化只追加一次，DeepSeek 主机才关闭思考', () => {
  assert.equal(
    buildChatCompletionsUrl('https://api.deepseek.com/'),
    'https://api.deepseek.com/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('http://x/v1'),
    'http://x/v1/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('http://x/v1/chat/completions'),
    'http://x/v1/chat/completions',
  );
  const ds = buildTranslationRequestBody(
    { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
    [{ id: '1', text: 'a' }],
  );
  assert.deepEqual(ds.thinking, { type: 'disabled' });
  assert.deepEqual(ds.response_format, { type: 'json_object' });
  const other = buildTranslationRequestBody(
    { baseUrl: 'http://mock:18080/v1', model: 'm' },
    [{ id: '1', text: 'a' }],
  );
  assert.equal('thinking' in other, false);
  assert.equal(
    JSON.stringify(other).includes('http://'),
    false,
    '请求正文不含播放地址',
  );
});

test('外层非标准响应属于接口级错误', () => {
  assert.throws(
    () => parseChatCompletionResponse(500, '{"error":{"message":"x"}}'),
    TranslationTransportError,
  );
  assert.throws(
    () => parseChatCompletionResponse(200, '<html></html>'),
    TranslationTransportError,
  );
  assert.throws(
    () => parseChatCompletionResponse(200, '{"foo":1}'),
    TranslationTransportError,
  );
  assert.equal(parseChatCompletionResponse(200, completion(null)).content, '');
  assert.equal(
    parseChatCompletionResponse(200, completion('x', 'length')).truncated,
    true,
  );
});

test('内容按 id 校验：乱序、漏项、重复冲突、未知 id、空译文不串词', () => {
  const ids = new Map([
    ['1', 'News'],
    ['2', 'BBC'],
    ['3', 'Sports'],
    ['4', 'Kids'],
  ]);
  const { results, protocolErrors } = parseTranslationContent(
    JSON.stringify({
      items: [
        { id: '3', needsTranslation: true, translation: '体育' },
        { id: '1', needsTranslation: true, translation: '新闻' },
        { id: 2, needsTranslation: false, translation: '' },
        { id: '4', needsTranslation: true, translation: '' },
        { id: '1', needsTranslation: true, translation: '别的' },
        { id: '99', needsTranslation: true, translation: '凭空' },
      ],
    }),
    ids,
  );
  assert.deepEqual(results.get('3'), { kind: 'success', translation: '体育' });
  assert.equal(results.get('1').kind, 'fail', '重复 id 冲突');
  assert.deepEqual(results.get('2'), { kind: 'no_need' });
  assert.equal(results.get('4').kind, 'fail');
  assert.ok(protocolErrors.some((e) => e.includes('99')));
  const missing = parseTranslationContent('{"items":[]}', ids);
  assert.equal(
    [...missing.results.values()].every((r) => r.kind === 'fail'),
    true,
  );
  const broken = parseTranslationContent('{"items":[{"id"', ids, true);
  assert.match(broken.results.get('1').error, /截断/);
});

test('入库不覆盖已有状态；响应只读取成功译文', async () => {
  const kv = createMemoryKv();
  assert.equal(await enqueueTexts(kv, ['News', 'News', 'Sports'], 1), 2);
  await editItem(
    kv,
    'News',
    { translation: '新闻', needsTranslation: 'yes' },
    2,
  );
  assert.equal(await enqueueTexts(kv, ['News'], 3), 0);
  assert.equal((await getItem(kv, 'News')).status, STATUS.SUCCESS);
  const map = await getTranslationMap(kv, ['News', 'Sports', 'Unknown']);
  assert.deepEqual([...map.entries()], [['News', '新闻']]);
});

test('认领租约到期可回收；人工保存后旧任务不能覆盖', async () => {
  const kv = createMemoryKv();
  await enqueueTexts(kv, ['A', 'B'], 0);
  const claimed = await claimBatch(kv, 10, 100, 1000);
  assert.equal(claimed.length, 2);
  assert.equal(
    (await claimBatch(kv, 20, 100, 1000)).length,
    0,
    '租约内不重复认领',
  );
  await editItem(kv, 'A', { translation: '人工', needsTranslation: 'yes' }, 30);
  const ok = await commitClaimed(
    kv,
    claimed[0],
    () => ({ status: STATUS.SUCCESS, translation: '模型' }),
    40,
  );
  assert.equal(ok, false);
  assert.equal((await getItem(kv, 'A')).translation, '人工');
  const recovered = await claimBatch(kv, 2000, 100, 1000);
  assert.deepEqual(
    recovered.map((i) => i.text),
    ['B'],
    '过期租约回收，成功项不再认领',
  );
});

test('修改原文检查碰撞，不静默覆盖；重置清零失败次数', async () => {
  const kv = createMemoryKv();
  await enqueueTexts(kv, ['A', 'B'], 0);
  await assert.rejects(() => rekeyItem(kv, 'A', 'B', 1), /已有翻译记录/);
  await rekeyItem(kv, 'A', 'A2', 1);
  assert.equal(await getItem(kv, 'A'), null);
  assert.equal((await getItem(kv, 'A2')).text, 'A2');
  await assert.rejects(
    () => editItem(kv, 'B', { translation: '', needsTranslation: 'yes' }, 1),
    /不能为空/,
  );
  const reset = await resetItem(kv, 'B', 5);
  assert.equal(reset.failCount, 0);
  assert.equal(reset.status, STATUS.PENDING);
});

test('额度：0 禁止；余额 1 并发只放行一次；-1 不限；同一请求 ID 只扣一次', async () => {
  const kv = createMemoryKv();
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
  assert.equal(await getQuota(kv, 'q'), 0, '新配置初始额度为 0');
  assert.equal((await consumeQuota(kv, 'q', 'r0')).allowed, false);
  await setQuota(kv, 'q', 1);
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => consumeQuota(kv, 'q', `r${i + 1}`)),
  );
  assert.equal(results.filter((r) => r.allowed).length, 1);
  await setQuota(kv, 'q', 3);
  assert.equal((await consumeQuota(kv, 'q', 'same')).allowed, true);
  assert.equal((await consumeQuota(kv, 'q', 'same')).allowed, true);
  assert.equal(await getQuota(kv, 'q'), 2, '幂等：同一请求只扣一次');
  await setQuota(kv, 'q', -1);
  for (let i = 0; i < 5; i++)
    assert.equal((await consumeQuota(kv, 'q', `u${i}`)).allowed, true);
  assert.equal(await getQuota(kv, 'q'), -1);
  await assert.rejects(() => setQuota(kv, 'q', -2));
});

test('批次节奏：250 条依次 100、100、50，满批继续、不足休眠两分钟', async () => {
  const kv = createMemoryKv();
  const model = fakeModel(okModel);
  const sleeps = [];
  const { worker } = await setupWorker(kv, model.httpPost, {
    workerOptions: {
      sleep: async (ms) => {
        sleeps.push(ms);
        if (ms === 120_000) worker.stop();
      },
    },
  });
  await enqueueTexts(
    kv,
    Array.from({ length: 250 }, (_, i) => `Channel ${i}`),
    0,
  );
  await worker.start();
  assert.deepEqual(
    model.calls.map((c) => c.items.length),
    [100, 100, 50],
  );
  assert.deepEqual(sleeps, [120_000], '满批不休眠，尾批后休眠两分钟');
  assert.equal((await getItem(kv, 'Channel 7')).translation, '译Channel 7');
});

test('空队列不忙循环：取到 0 条也休眠两分钟', async () => {
  const kv = createMemoryKv();
  const model = fakeModel(okModel);
  const sleeps = [];
  const { worker } = await setupWorker(kv, model.httpPost, {
    workerOptions: {
      sleep: async (ms) => {
        sleeps.push(ms);
        worker.stop();
      },
    },
  });
  await worker.start();
  assert.deepEqual(sleeps, [120_000]);
  assert.equal(model.calls.length, 0);
});

test('接口级故障：首次加两次重试后停止本轮，每次请求扣额，不计词失败', async () => {
  const kv = createMemoryKv();
  const model = fakeModel(() => ({ status: 503, text: '<html>down</html>' }));
  const { worker } = await setupWorker(kv, model.httpPost, { quota: 10 });
  await enqueueTexts(kv, ['A', 'B'], 0);
  const result = await worker.runRound();
  assert.equal(result.aborted, true);
  assert.equal(model.calls.length, 3);
  assert.equal(await getQuota(kv, 'c1'), 7);
  const a = await getItem(kv, 'A');
  assert.equal(a.failCount, 0);
  assert.equal(a.status, STATUS.PENDING);
  assert.match((await getLlmStats(kv, 'c1')).lastError, /HTTP 503/);
});

test('额度不足立即停止剩余重试并释放记录', async () => {
  const kv = createMemoryKv();
  const model = fakeModel(() => ({ status: 500, text: '{}' }));
  const { worker } = await setupWorker(kv, model.httpPost, { quota: 1 });
  await enqueueTexts(kv, ['A'], 0);
  const result = await worker.runRound();
  assert.equal(result.reason, 'quota');
  assert.equal(model.calls.length, 1);
  assert.equal((await getItem(kv, 'A')).status, STATUS.PENDING);
});

test('初始额度 0 不发请求；无启用配置不发请求', async () => {
  const kv = createMemoryKv();
  const model = fakeModel(okModel);
  const { worker } = await setupWorker(kv, model.httpPost, { quota: 0 });
  await enqueueTexts(kv, ['A'], 0);
  assert.equal((await worker.runRound()).reason, 'quota');
  await setActiveLlmId(kv, null);
  assert.equal((await worker.runRound()).reason, 'no_config');
  assert.equal(model.calls.length, 0);
});

test('内容级失败：不即时重试，只给失败项计数，满 3 次停止，成功项不重翻', async () => {
  const kv = createMemoryKv();
  const model = fakeModel((items) => ({
    status: 200,
    text: completion(
      JSON.stringify({
        items: items
          .filter((item) => item.text !== 'Bad')
          .map((item) => ({
            id: item.id,
            needsTranslation: true,
            translation: `译${item.text}`,
          })),
      }),
    ),
  }));
  const { worker, advance } = await setupWorker(kv, model.httpPost);
  await enqueueTexts(kv, ['Good', 'Bad'], 0);
  await worker.runRound();
  assert.equal(model.calls.length, 1, '内容错误不即时重试');
  assert.equal((await getItem(kv, 'Good')).status, STATUS.SUCCESS);
  assert.equal((await getItem(kv, 'Bad')).failCount, 1);
  assert.equal((await worker.runRound()).claimed, 0, '至少两分钟后才重试');
  advance(120_000);
  await worker.runRound();
  advance(120_000);
  await worker.runRound();
  const bad = await getItem(kv, 'Bad');
  assert.equal(bad.failCount, 3);
  assert.equal(bad.status, STATUS.FAILED);
  assert.deepEqual(
    model.calls.slice(1).map((c) => c.items.map((i) => i.text)),
    [['Bad'], ['Bad']],
  );
  advance(600_000);
  assert.equal((await worker.runRound()).claimed, 0, '失败满 3 次不再自动处理');
});

test('坏 JSON、空内容整批计一次失败；无需翻译形成终态', async () => {
  const kv = createMemoryKv();
  let mode = 'bad';
  const model = fakeModel((items) =>
    mode === 'bad'
      ? { status: 200, text: completion('') }
      : {
          status: 200,
          text: completion(
            JSON.stringify({
              items: items.map((i) => ({
                id: i.id,
                needsTranslation: false,
                translation: '',
              })),
            }),
          ),
        },
  );
  const { worker, advance } = await setupWorker(kv, model.httpPost);
  await enqueueTexts(kv, ['CNN'], 0);
  await worker.runRound();
  assert.equal((await getItem(kv, 'CNN')).failCount, 1);
  mode = 'ok';
  advance(120_000);
  await worker.runRound();
  const item = await getItem(kv, 'CNN');
  assert.equal(item.status, STATUS.NO_NEED);
  assert.equal(item.needsTranslation, 'no');
  advance(600_000);
  assert.equal((await worker.runRound()).claimed, 0);
});

test('人工单行翻译：额度 0 也可发、不扣额、不重试；失败保留原结果', async () => {
  const kv = createMemoryKv();
  let fail = false;
  const model = fakeModel((items) =>
    fail ? { status: 500, text: '{}' } : okModel(items),
  );
  const { worker } = await setupWorker(kv, model.httpPost, { quota: 0 });
  await enqueueTexts(kv, ['News'], 0);
  await editItem(
    kv,
    'News',
    { translation: '新闻', needsTranslation: 'yes' },
    1,
  );
  const updated = await worker.translateOnce('News');
  assert.equal(updated.translation, '译News');
  assert.equal(await getQuota(kv, 'c1'), 0);
  fail = true;
  await assert.rejects(() => worker.translateOnce('News'), /手动翻译失败/);
  assert.equal(model.calls.length, 2, '失败不自动重试');
  const item = await getItem(kv, 'News');
  assert.equal(item.translation, '译News');
  assert.equal(item.status, STATUS.SUCCESS);
  const stats = await getLlmStats(kv, 'c1');
  assert.equal(stats.manualCalls, 2);
  assert.equal(stats.autoCalls, 0);
});

test('共享文件命中直接导入，不调用模型、不扣额度', async () => {
  const kv = createMemoryKv();
  const model = fakeModel(okModel);
  const appended = [];
  const sharedFile = {
    lookup: async (texts) =>
      new Map(
        texts
          .filter((t) => t === 'News')
          .map((t) => [t, { translation: '共享新闻', needsTranslation: true }]),
      ),
    append: async (entries) => {
      appended.push(...entries);
      return true;
    },
  };
  const { worker } = await setupWorker(kv, model.httpPost, {
    quota: 0,
    sharedFile,
  });
  await enqueueTexts(kv, ['News'], 0);
  await worker.runRound();
  const item = await getItem(kv, 'News');
  assert.equal(item.translation, '共享新闻');
  assert.equal(item.resultSource, 'shared');
  assert.equal(model.calls.length, 0);
  await setQuota(kv, 'c1', -1);
  await enqueueTexts(kv, ['Sports'], 0);
  await worker.runRound();
  assert.deepEqual(
    appended.map((e) => e.text),
    ['Sports'],
    '模型结果写入共享文件',
  );
});

test('模型成功但写库失败：重试落库，不重新请求模型', async () => {
  const kv = createMemoryKv();
  const model = fakeModel(okModel);
  const { worker } = await setupWorker(kv, model.httpPost);
  await enqueueTexts(kv, ['A'], 0);
  const realCall = model.httpPost;
  let armed = true;
  const wrapped = createTranslationWorker({
    kv,
    httpPost: async (...args) => {
      const result = await realCall(...args);
      if (armed) {
        kv.failNextWrites = 2;
        armed = false;
      }
      return result;
    },
    sharedFile: noShared(),
    sleep: async () => {},
  });
  void worker;
  await wrapped.runRound();
  assert.equal(model.calls.length, 1);
  assert.equal((await getItem(kv, 'A')).status, STATUS.SUCCESS);
});
