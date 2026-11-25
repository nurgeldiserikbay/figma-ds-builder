// Доводка ИИ после алгоритма: ИИ (заглушка) предлагает CSS-правку для расходящегося слоя — сверка оставляет
// её, если стало лучше; вредная правка откатывается; опасные свойства (размеры, url) отбрасываются.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { aiFixCss, aiFixFrame } from '../src/ai-fix.js';
import { openBrowser, renderPage } from '../src/render.js';
import { comparePng } from '../src/diff.js';
import { attributeDiff } from '../src/attribute.js';

const nodes = new Map([['1:2', { id: '1:2', name: 'Card', type: 'RECTANGLE' }], ['1:3', { id: '1:3', name: 'Title', type: 'TEXT' }]]);
const { css, fixes } = aiFixCss([
  { id: '1:2', css: { 'background-color': '#ff0000', width: '10px', 'background-image': 'url(http://x)' }, why: 'цвет */ x' },
  { id: '1:3', css: { color: '#111', 'letter-spacing': '0.2px' } },
  { id: '9:9', css: { color: 'red' } },
], nodes);
assert.match(css, /\[data-figma-id="1:2"\] \{ background-color: #ff0000; \}/);
assert.doesNotMatch(css, /width|url\(/, 'размеры и url — нельзя');
assert.match(css, /\[data-figma-id="1:3"\] > span, \[data-figma-id="1:3"\] > span > span \{ color: #111; letter-spacing: 0\.2px; \}/, 'текстовые — и на span');
assert.equal(fixes.length, 2, 'неизвестный слой пропущен');

// сквозная проверка: макет — синий квадрат, вёрстка — серый; первый ответ ИИ вредный, второй правильный
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifix-'));
const page = () => `<!doctype html><html><head><link rel="stylesheet" href="styles.css"><style>body{margin:0}</style></head><body>
<div data-figma-id="1:1" style="position:relative;width:200px;height:120px;background:#fff"><div data-figma-id="1:2" class="b" style="position:absolute;left:20px;top:20px;width:100px;height:60px"></div></div></body></html>`;
fs.writeFileSync(path.join(dir, 'ref.css'), '.b { background: #2050e0; }\n');
fs.writeFileSync(path.join(dir, 'ref.html'), page().replace('styles.css', 'ref.css'));
fs.writeFileSync(path.join(dir, 'index.html'), page());
fs.writeFileSync(path.join(dir, 'styles.css'), '.b { background: #999; }\n');
const tree = { id: '1:1', name: 'Экран', type: 'FRAME', x: 0, y: 0, w: 200, h: 120, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }], children: [
  { id: '1:2', name: 'Card', type: 'RECTANGLE', x: 20, y: 20, w: 100, h: 60, fills: [{ type: 'SOLID', color: { r: 0.125, g: 0.314, b: 0.878 } }] },
] };
let n = 0;
const seen = [];
const ai = await new Promise((ok) => {
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body);
      seen.push(b.messages[1].content);
      const answer = n++ === 0 ? { fixes: [{ id: '1:2', css: { 'background-color': '#00ff00' }, why: 'наугад' }] } : { fixes: [{ id: '1:2', css: { 'background-color': '#2050e0' }, why: 'цвет из Figma' }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    });
  }).listen(0, '127.0.0.1', () => ok(s));
});
const browser = await openBrowser();
try {
  await renderPage(browser, path.join(dir, 'ref.html'), { width: 200, height: 120, out: path.join(dir, 'reference.png') });
  let geometryFailed = 0;
  const render = async () => {
    await renderPage(browser, path.join(dir, 'index.html'), { width: 200, height: 120, out: path.join(dir, 'render.png') });
    const d = comparePng(path.join(dir, 'reference.png'), path.join(dir, 'render.png'), path.join(dir, 'diff.png'));
    return { percent: d.percent, geometryFailed, sources: d.mismatched ? attributeDiff(tree, path.join(dir, 'diff.png'), { top: 30 }) : { top: [] } };
  };
  const base = await render();
  assert.ok(base.percent > 10, 'до доводки квадрат другого цвета');
  const r = await aiFixFrame({ browser, htmlPath: path.join(dir, 'index.html'), cssPath: path.join(dir, 'styles.css'), refPath: path.join(dir, 'reference.png'), renderPath: path.join(dir, 'render.png'),
    tree, base, render, rounds: 3, providers: [{ name: 'Тест', model: 'm', url: `http://127.0.0.1:${ai.address().port}/v1` }] });
  assert.equal(r.rejected, 1, 'вредная правка откатилась');
  assert.equal(r.fixes.length, 1);
  assert.ok(r.after < 0.5, `после доводки почти совпало: ${r.after}`);
  const finalCss = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
  assert.match(finalCss, /#2050e0/);
  assert.doesNotMatch(finalCss, /#00ff00/, 'отклонённой правки в стилях нет');
  assert.match(JSON.stringify(seen[1]), /Уже пробовали/, 'во второй раз ИИ знает про неудачную попытку');
  assert.match(JSON.stringify(seen[0]), /#2050e0/, 'ИИ видит цвет слоя из Figma');
} finally {
  await browser.close();
  ai.close();
}
console.log('Доводка ИИ после алгоритма — OK');
