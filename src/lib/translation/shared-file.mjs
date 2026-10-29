/**
 * 两站通过 Docker 挂载目录共享的译文文件（JSONL）。只写成功译文与明确无需翻译的结果。
 * 文件是节省模型请求的辅助缓存：锁或写入失败只记录错误，不影响本地数据库。
 *
 * 行格式：{"v":1,"t":原文,"r":译文,"n":是否需要翻译,"u":更新时间}
 */
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'translations.jsonl';
const LOCK_NAME = 'translations.lock';

/**
 * @param {{ dir?: string | null, lockStaleMs?: number, lockWaitMs?: number, compactThreshold?: number }} options
 */
export function createSharedTranslationFile(options) {
  const dir = options.dir ? String(options.dir) : '';
  const file = dir ? path.join(dir, FILE_NAME) : '';
  const lockDir = dir ? path.join(dir, LOCK_NAME) : '';
  const lockStaleMs = options.lockStaleMs ?? 30_000;
  const lockWaitMs = options.lockWaitMs ?? 3_000;
  const compactThreshold = options.compactThreshold ?? 20_000;

  /** @type {Map<string, { translation: string, needsTranslation: boolean, updatedAt: number }>} */
  let index = new Map();
  let offset = 0;
  let lines = 0;
  /** @type {{ ino: number, size: number } | null} */
  let fileStat = null;
  let lastError = '';

  /** @param {string} line */
  const parseLine = (line) => {
    try {
      const value = JSON.parse(line);
      if (
        value?.v !== 1 ||
        typeof value.t !== 'string' ||
        typeof value.n !== 'boolean' ||
        (value.n && (typeof value.r !== 'string' || !value.r))
      )
        return null;
      return value;
    } catch {
      return null;
    }
  };

  /** @type {Promise<void> | null} */
  let refreshing = null;
  // 同进程内串行刷新，避免并发读取重复推进偏移。
  const refresh = () =>
    (refreshing ??= loadChanges().finally(() => {
      refreshing = null;
    }));

  /** 按文件变化增量加载；文件被整理替换或截短时全量重载。 */
  const loadChanges = async () => {
    if (!file) return;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (error) {
      if (/** @type {any} */ (error)?.code === 'ENOENT') {
        index = new Map();
        offset = 0;
        lines = 0;
        fileStat = null;
        return;
      }
      throw error;
    }
    const replaced =
      !fileStat || fileStat.ino !== stat.ino || stat.size < offset;
    if (replaced) {
      index = new Map();
      offset = 0;
      lines = 0;
    }
    fileStat = { ino: stat.ino, size: stat.size };
    if (stat.size === offset) return;
    const handle = await fs.open(file, 'r');
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const end = buffer.lastIndexOf(0x0a);
      // 末尾未写完整的一行等待下次读取。
      if (end < 0) return;
      const chunk = buffer.subarray(0, end + 1).toString('utf8');
      offset += end + 1;
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        lines++;
        const value = parseLine(line);
        if (!value) continue; // 损坏行跳过
        const previous = index.get(value.t);
        const updatedAt = Number(value.u) || 0;
        if (!previous || updatedAt >= previous.updatedAt)
          index.set(value.t, {
            translation: value.n ? value.r : '',
            needsTranslation: value.n,
            updatedAt,
          });
      }
    } finally {
      await handle.close();
    }
  };

  const endsWithNewline = async () => {
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const { size } = await handle.stat();
      if (size === 0) return true;
      const buffer = Buffer.alloc(1);
      await handle.read(buffer, 0, 1, size - 1);
      return buffer[0] === 0x0a;
    } catch {
      return true;
    } finally {
      await handle?.close();
    }
  };

  const sleep = (/** @type {number} */ ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /** 跨进程短锁：mkdir 排他创建；超过 lockStaleMs 视为持有者已退出。 */
  const withLock = async (/** @type {() => Promise<void>} */ task) => {
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      try {
        await fs.mkdir(lockDir);
        break;
      } catch (error) {
        if (/** @type {any} */ (error)?.code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(lockDir);
          if (Date.now() - stat.mtimeMs > lockStaleMs) {
            await fs.rm(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) throw new Error('共享译文文件锁等待超时');
        await sleep(30 + Math.random() * 50);
      }
    }
    try {
      await task();
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  /** 锁内合并去重，写临时文件后原子替换。 */
  const compact = async () => {
    await refresh();
    const tmp = path.join(dir, `${FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
    const body = Array.from(index.entries())
      .map(([text, value]) =>
        JSON.stringify({
          v: 1,
          t: text,
          r: value.translation,
          n: value.needsTranslation,
          u: value.updatedAt,
        }),
      )
      .join('\n');
    await fs.writeFile(tmp, body ? `${body}\n` : '', 'utf8');
    await fs.rename(tmp, file);
    fileStat = null;
    await refresh();
  };

  return {
    enabled: !!dir,
    /**
     * @param {string[]} texts
     * @returns {Promise<Map<string, { translation: string, needsTranslation: boolean }>>}
     */
    async lookup(texts) {
      const result = new Map();
      if (!dir) return result;
      try {
        await refresh();
        lastError = '';
      } catch (error) {
        lastError = `读取失败：${/** @type {Error} */ (error).message}`;
        return result;
      }
      for (const text of texts) {
        const value = index.get(text);
        if (value) result.set(text, value);
      }
      return result;
    },
    /**
     * @param {{ text: string, translation: string, needsTranslation: boolean }[]} entries
     * @returns {Promise<boolean>}
     */
    async append(entries) {
      const valid = entries.filter(
        (entry) => entry.text && (!entry.needsTranslation || entry.translation),
      );
      if (!dir || valid.length === 0) return false;
      const now = Date.now();
      const body = valid
        .map((entry) =>
          JSON.stringify({
            v: 1,
            t: entry.text,
            r: entry.needsTranslation ? entry.translation : '',
            n: entry.needsTranslation,
            u: now,
          }),
        )
        .join('\n');
      try {
        await fs.mkdir(dir, { recursive: true });
        await withLock(async () => {
          // 上一个写入者中途退出留下半行时，先补换行，避免新记录被拼进损坏行。
          const prefix = (await endsWithNewline()) ? '' : '\n';
          await fs.appendFile(file, `${prefix}${body}\n`, 'utf8');
          await refresh();
          if (lines > compactThreshold && lines > index.size * 2)
            await compact();
        });
        lastError = '';
        return true;
      } catch (error) {
        lastError = `写入失败：${/** @type {Error} */ (error).message}`;
        return false;
      }
    },
    async status() {
      if (!dir) return { enabled: false, dir: '', entries: 0, lastError: '' };
      try {
        await fs.mkdir(dir, { recursive: true });
        await refresh();
        await fs.access(dir, fsConstants.W_OK);
      } catch (error) {
        lastError = `目录不可用：${/** @type {Error} */ (error).message}`;
      }
      return { enabled: true, dir, entries: index.size, lastError };
    },
  };
}
