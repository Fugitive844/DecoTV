import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, '.env.development.local');
if (!fs.existsSync(envFile))
  throw new Error('请按 测试交接.md 创建 .env.development.local');
// 显式覆盖 Windows 自带的 USERNAME，防止站长账号被系统用户名覆盖。
const env = { ...process.env, ...parseEnv(fs.readFileSync(envFile, 'utf8')) };
const child = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/next/dist/bin/next'),
    'dev',
    '--webpack',
    '--hostname',
    'localhost',
    '--port',
    '3000',
  ],
  { cwd: root, env, stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
