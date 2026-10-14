import fs from 'node:fs/promises';
import path from 'node:path';

// 只检查源的标记、名称和 CMS 分类；不读取封面、详情或播放内容。
const adultPattern =
  /成人|色情|情色|伦理|三级|里番|福利|无码|有码|18禁|18\+|色猫|湿乐园|杏吧|新极品|麻豆|淫|性爱|性交|日韩AV|欧美AV|国产AV|日本AV|AV资源/i;
const [videoFile, liveFile, outputDir] = process.argv.slice(2);
if (!videoFile || !liveFile || !outputDir)
  throw new Error(
    '用法: node scripts/prepare-safe-import.mjs 视频源.json 直播源.json 输出目录',
  );
const parseFile = async (file) =>
  JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const sources = await parseFile(videoFile);
if (!Array.isArray(sources)) throw new Error('视频源文件必须是数组');
const lives = await parseFile(liveFile);
const safe = [];
const excluded = [];
const candidates = sources.filter((source) => {
  if (source.is_adult !== false || adultPattern.test(source.name || '')) {
    excluded.push({ key: source.key, reason: '成人标记或名称 / 分类未确认' });
    return false;
  }
  return true;
});
let cursor = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (cursor < candidates.length) {
      const source = candidates[cursor++];
      try {
        const url = new URL(source.api);
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('不支持的协议');
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error('分类响应过大');
        const data = JSON.parse(text);
        const categories = data.class;
        if (
          !Array.isArray(categories) ||
          categories.length === 0 ||
          categories.some((item) => typeof item.type_name !== 'string')
        )
          throw new Error('无法确认分类');
        if (categories.some((item) => adultPattern.test(item.type_name))) {
          excluded.push({ key: source.key, reason: '存在成人分类' });
        } else {
          safe.push({ ...source, is_adult: false });
        }
      } catch (error) {
        excluded.push({
          key: source.key,
          reason: `分类未确认: ${error.message}`,
        });
      }
    }
  }),
);
// 恢复原始顺序，不重写源文件。
const order = new Map(sources.map((source, index) => [source.key, index]));
safe.sort((a, b) => order.get(a.key) - order.get(b.key));
if (!safe.length) throw new Error('没有能够确认的非成人源，未输出空导入文件');
await fs.mkdir(outputDir, { recursive: true });
const api_site = Object.fromEntries(
  safe.map(({ key, name, api, detail }) => [
    key,
    { name, api, detail, is_adult: false },
  ]),
);
const config = { cache_time: 7200, api_site, lives: lives.lives || {} };
const report = {
  checkedAt: new Date().toISOString(),
  originalCount: sources.length,
  selectedCount: safe.length,
  excludedCount: excluded.length,
  liveCount: Object.keys(config.lives).length,
  excluded,
};
for (const [name, content] of [
  ['video-sources-safe.json', safe],
  ['config-safe.json', config],
  ['live-sources-verified.json', lives],
  ['filter-report.json', report],
]) {
  await fs.writeFile(
    path.join(outputDir, name),
    JSON.stringify(content, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    selected: safe.length,
    excluded: excluded.length,
    lives: report.liveCount,
    outputDir,
  }),
);
