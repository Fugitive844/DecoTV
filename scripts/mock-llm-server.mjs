#!/usr/bin/env node
/**
 * 本地模拟 OpenAI 兼容 Chat Completions 服务，仅用于验证翻译程序逻辑（不调用真实付费模型）。
 *
 *   node scripts/mock-llm-server.mjs [--port 18080] [--host 127.0.0.1] [--seed 42]
 *
 * POST /chat/completions、/v1/chat/completions：按 id 返回随机中文译文或 needsTranslation:false。
 * POST /__scenario {"scenario":"normal","count":N}：切换场景（count 次后恢复 normal，缺省一直生效）。
 *   场景：normal timeout disconnect http500 http401 html bad_outer bad_json empty truncated
 *         missing shuffled partial duplicate unknown_id delay
 * GET  /__stats：调用次数、每批项目数、模型、是否关闭思考；POST /__reset 清零。
 */
import http from 'node:http';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0
    ? args[index + 1]
    : process.env[`MOCK_LLM_${name.toUpperCase()}`] || fallback;
};
const port = Number(arg('port', '18080'));
const host = arg('host', '127.0.0.1');
let seed = Number(arg('seed', '42')) || 42;

const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const WORDS = [
  '新闻',
  '体育',
  '电影',
  '音乐',
  '少儿',
  '纪录',
  '综合',
  '财经',
  '娱乐',
  '国际',
  '频道',
  '高清',
  '生活',
  '科技',
];
const fakeTranslation = (text) =>
  `${WORDS[Math.floor(random() * WORDS.length)]}${WORDS[Math.floor(random() * WORDS.length)]}·${text.length}`;

let scenario = 'normal';
let remaining = Infinity;
const stats = {
  calls: 0,
  batches: [],
  models: new Set(),
  thinkingDisabled: 0,
  authorized: 0,
  scenarios: {},
};

const nextScenario = () => {
  const current = scenario;
  if (remaining !== Infinity && --remaining <= 0) {
    scenario = 'normal';
    remaining = Infinity;
  }
  return current;
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

const completion = (content, finishReason = 'stop') =>
  JSON.stringify({
    id: `mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: finishReason,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });

const translate = (items) =>
  items.map((item) =>
    /^[A-Z0-9]{2,4}$/.test(item.text) || random() < 0.1
      ? { id: item.id, needsTranslation: false, translation: '' }
      : {
          id: item.id,
          needsTranslation: true,
          translation: fakeTranslation(item.text),
        },
  );

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  };

  if (url.pathname === '/__stats')
    return send(
      200,
      JSON.stringify({
        ...stats,
        models: [...stats.models],
        scenario,
        remaining: remaining === Infinity ? null : remaining,
      }),
    );
  if (url.pathname === '/__reset' && req.method === 'POST') {
    Object.assign(stats, {
      calls: 0,
      batches: [],
      models: new Set(),
      thinkingDisabled: 0,
      authorized: 0,
      scenarios: {},
    });
    scenario = 'normal';
    remaining = Infinity;
    return send(200, '{"ok":true}');
  }
  if (url.pathname === '/__scenario' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    scenario = body.scenario || 'normal';
    remaining = Number(body.count) > 0 ? Number(body.count) : Infinity;
    return send(
      200,
      JSON.stringify({ ok: true, scenario, remaining: body.count || null }),
    );
  }
  if (
    !/^(\/v1)?\/chat\/completions$/.test(url.pathname) ||
    req.method !== 'POST'
  )
    return send(404, '{"error":{"message":"not found"}}');

  const raw = await readBody(req);
  stats.calls++;
  let request = {};
  let items = [];
  try {
    request = JSON.parse(raw);
    const user =
      request.messages?.find((m) => m.role === 'user')?.content || '{}';
    items = JSON.parse(user).items || [];
  } catch {
    items = [];
  }
  stats.batches.push(items.length);
  if (stats.batches.length > 200) stats.batches.shift();
  if (request.model) stats.models.add(request.model);
  if (request.thinking?.type === 'disabled') stats.thinkingDisabled++;
  if (/^Bearer .+/.test(req.headers.authorization || '')) stats.authorized++;

  const current = nextScenario();
  stats.scenarios[current] = (stats.scenarios[current] || 0) + 1;
  const results = translate(items);
  switch (current) {
    case 'timeout':
      return; // 不响应，由客户端超时
    case 'disconnect':
      return req.socket.destroy();
    case 'http500':
      return send(500, '{"error":{"message":"mock internal error"}}');
    case 'http401':
      return send(401, '{"error":{"message":"invalid api key"}}');
    case 'html':
      return send(502, '<html><body>Bad Gateway</body></html>', 'text/html');
    case 'bad_outer':
      return send(200, JSON.stringify({ result: 'no choices here' }));
    case 'bad_json':
      return send(200, completion('这不是 JSON {items:'));
    case 'empty':
      return send(200, completion(''));
    case 'truncated':
      return send(
        200,
        completion(JSON.stringify({ items: results }).slice(0, 40), 'length'),
      );
    case 'missing':
      return send(
        200,
        completion(
          JSON.stringify({
            items: results.slice(0, Math.ceil(results.length / 2)),
          }),
        ),
      );
    case 'shuffled':
      return send(
        200,
        completion(JSON.stringify({ items: [...results].reverse() })),
      );
    case 'partial':
      return send(
        200,
        completion(
          JSON.stringify({
            items: results.map((r, i) =>
              i % 2 ? { id: r.id, needsTranslation: true, translation: '' } : r,
            ),
          }),
        ),
      );
    case 'duplicate':
      return send(
        200,
        completion(
          JSON.stringify({
            items: [
              ...results,
              ...results.slice(0, 1).map((r) => ({
                ...r,
                needsTranslation: true,
                translation: '冲突译文',
              })),
            ],
          }),
        ),
      );
    case 'unknown_id':
      return send(
        200,
        completion(
          JSON.stringify({
            items: [
              ...results,
              { id: '99999', needsTranslation: true, translation: '凭空' },
            ],
          }),
        ),
      );
    case 'delay':
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return send(200, completion(JSON.stringify({ items: results })));
    default:
      return send(200, completion(JSON.stringify({ items: results })));
  }
});

server.listen(port, host, () => {
  console.log(
    `[mock-llm] http://${host}:${port}  (/chat/completions, /v1/chat/completions, /__scenario, /__stats)`,
  );
});
