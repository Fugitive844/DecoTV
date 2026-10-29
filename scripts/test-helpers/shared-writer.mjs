// 子进程：向共享译文文件并发追加，模拟另一个站点。
import { createSharedTranslationFile } from '../../src/lib/translation/shared-file.mjs';

const [dir, prefix, count] = process.argv.slice(2);
const file = createSharedTranslationFile({ dir, lockWaitMs: 20_000 });
let ok = 0;
for (let i = 0; i < Number(count); i++) {
  if (
    await file.append([
      {
        text: `${prefix}-${i}`,
        translation: `译${prefix}${i}`,
        needsTranslation: true,
      },
    ])
  )
    ok++;
}
process.stdout.write(String(ok));
