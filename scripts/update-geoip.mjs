import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Reader } from 'maxmind';

const directory = process.env.GEOIP_DB_DIR || path.resolve('data/geoip');
await mkdir(directory, { recursive: true });
const response = await fetch(
  'https://api.github.com/repos/P3TERX/GeoLite.mmdb/releases/latest',
  { signal: AbortSignal.timeout(30_000) },
);
if (!response.ok)
  throw new Error(`获取 GeoLite 发布信息失败: ${response.status}`);
const release = await response.json();
const files = ['GeoLite2-City.mmdb', 'GeoLite2-ASN.mmdb'];
const metadata = {
  release: release.tag_name,
  downloadedAt: new Date().toISOString(),
  files: {},
};
for (const name of files) {
  const asset = release.assets.find((item) => item.name === name);
  if (!asset) throw new Error(`发布缺少 ${name}`);
  const result = await fetch(asset.browser_download_url, {
    signal: AbortSignal.timeout(180_000),
  });
  if (!result.ok) throw new Error(`下载 ${name} 失败: ${result.status}`);
  const data = Buffer.from(await result.arrayBuffer());
  const hash = createHash('sha256').update(data).digest('hex');
  if (
    data.length !== asset.size ||
    (asset.digest?.startsWith('sha256:') && asset.digest !== `sha256:${hash}`)
  )
    throw new Error(`${name} 校验失败`);
  const reader = new Reader(data);
  if (
    !reader.metadata.databaseType.includes(
      name.includes('City') ? 'City' : 'ASN',
    )
  )
    throw new Error(`${name} 数据库类型不匹配`);
  const temporary = path.join(directory, `${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data);
    await rename(temporary, path.join(directory, name));
  } finally {
    await rm(temporary, { force: true });
  }
  metadata.files[name] = { sha256: hash, size: data.length };
  console.log(`${name}: ${data.length} bytes, SHA256 ${hash}`);
}
await writeFile(
  path.join(directory, 'version.json'),
  JSON.stringify(metadata, null, 2),
);
await writeFile(
  path.join(directory, 'NOTICE.txt'),
  'GeoLite2 data created by MaxMind, available from https://www.maxmind.com.\nDistributed by https://github.com/P3TERX/GeoLite.mmdb\nLicense: https://creativecommons.org/licenses/by-sa/4.0/\n',
);
console.log(`GeoIP 数据库已更新至 ${metadata.release}`);
