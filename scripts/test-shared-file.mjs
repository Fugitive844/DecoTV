import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createSharedTranslationFile } from '../src/lib/translation/shared-file.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'decotv-shared-'));

test('两个独立进程并发追加，结果完整可读', async () => {
  const dir = await tempDir();
  const writer = path.join(here, 'test-helpers', 'shared-writer.mjs');
  const [a, b] = await Promise.all([
    run(process.execPath, [writer, dir, 'site1', '60']),
    run(process.execPath, [writer, dir, 'site2', '60']),
  ]);
  assert.equal(a.stdout, '60');
  assert.equal(b.stdout, '60');
  const reader = createSharedTranslationFile({ dir });
  const texts = [...Array(60).keys()].flatMap((i) => [
    `site1-${i}`,
    `site2-${i}`,
  ]);
  const hits = await reader.lookup(texts);
  assert.equal(hits.size, 120);
  assert.equal(hits.get('site2-59').translation, '译site259');
  const raw = await fs.readFile(path.join(dir, 'translations.jsonl'), 'utf8');
  assert.equal(
    raw
      .trim()
      .split('\n')
      .every((line) => JSON.parse(line).v === 1),
    true,
  );
});

test('读取能看到另一实例的新写入；损坏行与末尾半行被跳过', async () => {
  const dir = await tempDir();
  const site1 = createSharedTranslationFile({ dir });
  const site2 = createSharedTranslationFile({ dir });
  assert.equal((await site1.lookup(['News'])).size, 0);
  await site2.append([
    { text: 'News', translation: '新闻', needsTranslation: true },
  ]);
  assert.equal((await site1.lookup(['News'])).get('News').translation, '新闻');
  const file = path.join(dir, 'translations.jsonl');
  await fs.appendFile(file, 'not json\n{"v":1,"t":"Half"');
  await site2.append([
    { text: 'BBC', translation: '', needsTranslation: false },
  ]);
  const hits = await site1.lookup(['News', 'BBC', 'Half']);
  assert.equal(hits.get('BBC').needsTranslation, false);
  assert.equal(hits.has('Half'), false);
});

test('同一原文以最新记录为准；超过阈值整理后原子替换', async () => {
  const dir = await tempDir();
  const shared = createSharedTranslationFile({ dir, compactThreshold: 5 });
  for (let i = 0; i < 8; i++)
    await shared.append([
      { text: 'News', translation: `新闻${i}`, needsTranslation: true },
    ]);
  const other = createSharedTranslationFile({ dir });
  assert.equal((await other.lookup(['News'])).get('News').translation, '新闻7');
  const lines = (
    await fs.readFile(path.join(dir, 'translations.jsonl'), 'utf8')
  )
    .trim()
    .split('\n');
  assert.ok(lines.length < 8, '已整理去重');
});

test('过期锁可恢复；目录未配置或缺失时降级', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'translations.lock'));
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(path.join(dir, 'translations.lock'), past, past);
  const shared = createSharedTranslationFile({ dir, lockStaleMs: 30_000 });
  assert.equal(
    await shared.append([
      { text: 'A', translation: '甲', needsTranslation: true },
    ]),
    true,
  );
  const disabled = createSharedTranslationFile({ dir: '' });
  assert.equal((await disabled.lookup(['A'])).size, 0);
  assert.equal(
    await disabled.append([
      { text: 'A', translation: '甲', needsTranslation: true },
    ]),
    false,
  );
  const missing = createSharedTranslationFile({
    dir: path.join(dir, 'not-exist'),
  });
  assert.equal((await missing.lookup(['A'])).size, 0);
  await fs.rm(path.join(dir, 'translations.jsonl'));
  assert.equal((await shared.lookup(['A'])).size, 0, '文件丢失后不报错');
});

test('锁被持有且未过期时写入失败只返回 false', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'translations.lock'));
  const shared = createSharedTranslationFile({ dir, lockWaitMs: 100 });
  assert.equal(
    await shared.append([
      { text: 'A', translation: '甲', needsTranslation: true },
    ]),
    false,
  );
  assert.match((await shared.status()).lastError, /锁等待超时/);
});
