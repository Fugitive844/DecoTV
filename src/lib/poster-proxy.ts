import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import sharp from 'sharp';

import { resolveProxyTargetUrl } from '@/lib/proxy-security';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const cache = new Map<
  string,
  { body: Buffer; type: string; expires: number }
>();
const pending = new Map<string, Promise<{ body: Buffer; type: string }>>();
let cacheBytes = 0;
let activeLoads = 0;
const waitingLoads: Array<() => void> = [];

async function withPosterSlot(target: string, width?: number) {
  if (activeLoads >= 8)
    await new Promise<void>((resolve) => waitingLoads.push(resolve));
  else activeLoads++;
  try {
    return await loadPoster(target, width);
  } finally {
    const next = waitingLoads.shift();
    if (next) next();
    else activeLoads--;
  }
}

/** 验证文件签名，不依赖源站经常误写的 Content-Type。 */
export function detectPosterType(data: Buffer): string | null {
  if (data.length < 4) return null;
  if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return 'image/jpeg';
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (/^GIF8[79]a/.test(data.subarray(0, 6).toString('ascii')))
    return 'image/gif';
  if (
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (
    data.toString('ascii', 4, 8) === 'ftyp' &&
    /avif|avis/.test(data.toString('ascii', 8, Math.min(64, data.length)))
  )
    return 'image/avif';
  if (data[0] === 66 && data[1] === 77) return 'image/bmp';
  if (data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0)
    return 'image/x-icon';
  const prefix = data
    .subarray(0, 4096)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (
    /^(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?<svg(?:\s|\/?>)/i.test(
      prefix,
    )
  )
    return 'image/svg+xml';
  return null;
}

async function downloadPoster(
  rawUrl: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<Buffer> {
  if (redirects > 3) throw new Error('Too many redirects');
  const onAbortPromise = new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new Error('Image proxy timeout')),
      { once: true },
    );
  });
  const { url, addresses } = await Promise.race([
    resolveProxyTargetUrl(rawUrl),
    onAbortPromise,
  ]);
  signal.throwIfAborted();
  return new Promise<Buffer>((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        signal,
        // 固定已验证的公网地址；Host、SNI 及证书校验仍使用原始域名。
        lookup: (_hostname, options, callback) => {
          const selected =
            addresses.find(
              (item) => !options.family || item.family === options.family,
            ) || addresses[0];
          if (options.all) callback(null, addresses);
          else callback(null, selected.address, selected.family);
        },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          'Accept-Encoding': 'identity',
          ...(url.hostname.endsWith('.doubanio.com')
            ? { Referer: 'https://movie.douban.com/' }
            : {}),
        },
      },
      (res) => {
        const status = res.statusCode || 502;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          downloadPoster(
            new URL(res.headers.location, url).toString(),
            signal,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          reject(new Error(`Upstream image HTTP ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const encoding = res.headers['content-encoding'];
        const decoder =
          encoding === 'gzip'
            ? createGunzip()
            : encoding === 'deflate'
              ? createInflate()
              : encoding === 'br'
                ? createBrotliDecompress()
                : undefined;
        const stream = decoder ? res.pipe(decoder) : res;
        if (decoder)
          decoder.on('error', (error) => {
            res.destroy();
            reject(error);
          });
        let compressedSize = 0;
        if (decoder)
          res.on('data', (chunk: Buffer) => {
            compressedSize += chunk.length;
            if (compressedSize > MAX_IMAGE_BYTES)
              res.destroy(new Error('Image exceeds 5 MiB'));
          });
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            res.destroy(new Error('Image exceeds 5 MiB'));
            decoder?.destroy();
            reject(new Error('Image exceeds 5 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('Incomplete upstream image')));
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () =>
      req.destroy(new Error('Upstream image stalled')),
    );
    req.end();
  });
}

async function loadPoster(target: string, width: number | undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    // 仅旧 wsrv 丢失协议的地址尝试两个协议，明确的 HTTPS 地址不降级。
    const urls = /^https?:\/\//i.test(target)
      ? [target]
      : [`https://${target}`, `http://${target}`];
    let body: Buffer | undefined;
    let lastError: unknown;
    for (const url of urls) {
      try {
        body = await downloadPoster(url, controller.signal);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!body) throw lastError;
    let type = detectPosterType(body);
    if (!type) throw new Error('Upstream response is not a supported image');
    // 缩小卡片原图的解码开销，动画、SVG、BMP、ICO 保留原文件。
    if (
      width &&
      ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)
    ) {
      try {
        const image = sharp(body, { limitInputPixels: 40_000_000 });
        const metadata = await image.metadata();
        if ((metadata.pages || 1) === 1) {
          body = await image
            .rotate()
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
          type = 'image/webp';
        }
      } catch {
        /* 当前 libvips 不支持的格式交给浏览器解码。 */
      }
    }
    return { body, type };
  } finally {
    clearTimeout(timer);
  }
}

export async function getPoster(target: string, width?: number) {
  const key = JSON.stringify([target, width]);
  const stored = cache.get(key);
  if (stored && stored.expires > Date.now()) {
    cache.delete(key);
    cache.set(key, stored);
    return stored;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  if (stored) {
    cacheBytes -= stored.body.length;
    cache.delete(key);
  }
  if (pending.size >= 256) throw new Error('Image proxy busy');
  const task = withPosterSlot(target, width);
  pending.set(key, task);
  try {
    const result = await task;
    cache.set(key, { ...result, expires: Date.now() + 20 * 60 * 1000 });
    cacheBytes += result.body.length;
    while (cacheBytes > MAX_CACHE_BYTES || cache.size > 512) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      const entry = cache.get(oldest);
      if (entry) cacheBytes -= entry.body.length;
      cache.delete(oldest);
    }
    return result;
  } finally {
    pending.delete(key);
  }
}
