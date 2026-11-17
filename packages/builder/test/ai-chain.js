// Цепочка ИИ-провайдеров: первый отвечает 429 (лимит), второй — именами. Без сети: локальные заглушки.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { suggestNames, aiProviders } from '../src/ai.js';
import { analyzeSemantics } from '../src/semantic.js';

const calls = [];
function server(handler) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => handler(JSON.parse(body || '{}'), res, req));
    }).listen(0, '127.0.0.1', () => ok(s));
  });
}
const limited = await server((b, res) => { calls.push('limited'); res.writeHead(429); res.end('rate limit'); });
const good = await server((b, res, req) => {
  calls.push(`good:${req.headers.authorization || ''}`);
  const items = JSON.parse(b.messages[1].content);
  const names = Object.fromEntries(items.map((it) => [it.id, it.text ? 'Pricing Card' : 'feature list']));
  res.writeHead(200, { 'content-type': 'application/json' });
  // модель обрамляет JSON текстом — должно разбираться
  res.end(JSON.stringify({ choices: [{ message: { content: 'Вот ответ:\n```json\n' + JSON.stringify({ names }) + '\n```' } }] }));
});
const url = (s) => `http://127.0.0.1:${s.address().port}/v1`;

const T = (id, chars) => ({ id, name: 'Text', type: 'TEXT', x: 0, y: 0, w: 100, h: 20, text: { characters: chars } });
const tree = { id: '0:1', name: 'Page', type: 'FRAME', x: 0, y: 0, w: 400, h: 400, children: [
  { id: '0:2', name: 'Frame 12', type: 'FRAME', x: 0, y: 0, w: 400, h: 200, children: [T('0:3', '$19 / месяц')] },
  { id: '0:4', name: 'Group 7', type: 'GROUP', x: 0, y: 200, w: 400, h: 200, children: [{ id: '0:5', name: 'Rectangle 1', type: 'RECTANGLE', x: 0, y: 200, w: 10, h: 10 }] },
] };

// порядок провайдеров и платный только по флагу
const env = { GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o', DS_AI_PAID_URL: 'https://x', DS_AI_PAID_MODEL: 'm' };
assert.deepEqual(aiProviders(env).map((p) => p.name), ['Ollama', 'Groq', 'OpenRouter']);
assert.deepEqual(aiProviders(env, { paid: true }).map((p) => p.name), ['Ollama', 'Groq', 'OpenRouter', 'платный']);
assert.deepEqual(aiProviders({ DS_AI_URL: 'http://a/v1/' }).map((p) => p.url), ['http://a/v1']);

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ai-'));
const providers = [
  { name: 'Ollama', url: 'http://127.0.0.1:9/v1', model: 'm0', key: '', local: true }, // никто не слушает
  { name: 'Groq', url: url(limited), model: 'm1', key: 'k1', free: true },
  { name: 'Gemini', url: url(good), model: 'm2', key: 'k2', free: true },
];
const r = await suggestNames(tree, analyzeSemantics(tree), { providers, cacheDir });
assert.equal(r.error, undefined);
assert.ok(r.used >= 2, `имена получены: ${[...r.names]}`);
assert.equal(r.by.Gemini, r.asked);
assert.deepEqual(calls, ['limited', 'good:Bearer k2']);

// повторно — из кэша, без запросов
calls.length = 0;
const r2 = await suggestNames(tree, analyzeSemantics(tree), { providers, cacheDir });
assert.equal(r2.used, r.used);
assert.equal(calls.length, 0);

// все недоступны — ошибка, но не исключение
const r3 = await suggestNames(tree, analyzeSemantics(tree), { providers: [providers[0]], cacheDir: null });
assert.ok(r3.error && r3.names.size === 0);

limited.close(); good.close();
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log(`ИИ-цепочка: лимит → следующий провайдер, кэш, откат без ИИ — OK (${[...r.names.values()].join(', ')})`);
