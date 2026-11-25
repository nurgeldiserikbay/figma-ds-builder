// ds-build check: правка вёрстки сверяется с макетом — процент, какие слои Figma расходятся, где и какой
// элемент кода стоит на их месте; после исправления — ✓. Эталон здесь — рендер исходной вёрстки.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateFrame } from '../src/generate.js';
import { openBrowser, renderPage } from '../src/render.js';
import { checkBuild, writeCheckManifest } from '../src/check.js';

const fill = (r, g, b) => [{ type: 'SOLID', visible: true, color: { r, g, b, a: 1 } }];
const tree = { id: '1:1', name: 'Главная', type: 'FRAME', x: 0, y: 0, w: 300, h: 200, visible: true, fills: fill(1, 1, 1),
  layout: { mode: 'VERTICAL', gap: 20, padding: [20, 20, 20, 20], primaryAlign: 'MIN', counterAlign: 'MIN' },
  children: [
    { id: '1:2', name: 'Баннер', type: 'RECTANGLE', x: 20, y: 20, w: 260, h: 80, visible: true, fills: fill(0.2, 0.4, 0.9), radius: [12, 12, 12, 12] },
    { id: '1:3', name: 'Плашка', type: 'RECTANGLE', x: 20, y: 120, w: 120, h: 40, visible: true, fills: fill(0.9, 0.3, 0.2) },
  ] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-'));
const sd = path.join(dir, 'Главная-1_1');
fs.mkdirSync(sd, { recursive: true });
fs.mkdirSync(path.join(dir, 'html'));
fs.writeFileSync(path.join(dir, 'tokens.css'), '');
const { html, css } = generateFrame(tree, { mode: 'flow', assetUrl: (r) => r, title: 'Главная' });
fs.writeFileSync(path.join(sd, 'index.html'), html);
fs.writeFileSync(path.join(sd, 'styles.css'), css);
fs.writeFileSync(path.join(sd, 'tree.json'), JSON.stringify(tree));
const b = await openBrowser();
await renderPage(b, path.join(sd, 'index.html'), { width: 300, height: 200, out: path.join(sd, 'reference.png') });
await b.close();
// «код» в html/: та же страница, рядом свой CSS
fs.writeFileSync(path.join(dir, 'html', 'index.html'), html.replace('href="../tokens.css"', 'href="../tokens.css"').replace('href="styles.css"', 'href="main.css"'));
fs.writeFileSync(path.join(dir, 'html', 'main.css'), css);
writeCheckManifest(dir, { scale: 1, threshold: 0.1, textThreshold: 0.5, textAreaThreshold: 4,
  results: [{ name: 'Главная', id: '1:1', dir: 'Главная-1_1', width: 300, height: 200, diff: { percent: 0 }, pass: true }],
  codeOf: new Map([['Главная-1_1', ['html/index.html']]]), routeOf: new Map() });

const lines = [];
let r = await checkBuild({ dir, log: (l) => lines.push(l) });
assert.equal(r[0].pass, true, 'без правок — совпадает');

// «ИИ» испортил цвет плашки — проверка находит слой и элемент кода
const cls = css.match(/\.([\w-]+) \{[^}]*background: #e64d33/)?.[1];
assert.ok(cls, 'класс плашки в CSS');
fs.writeFileSync(path.join(dir, 'html', 'main.css'), css.replace(/background: #e64d33/, 'background: #33aa55'));
lines.length = 0;
r = await checkBuild({ dir, log: (l) => lines.push(l) });
assert.equal(r[0].pass, false);
assert.equal(r[0].top[0].name, 'Плашка');
assert.deepEqual(r[0].top[0].box, { x: 20, y: 120, w: 120, h: 40 });
assert.match(r[0].top[0].selector, new RegExp(`\\.${cls}`));
assert.ok(fs.existsSync(path.join(dir, r[0].files.diff)), 'картинка расхождения');
assert.match(lines.join('\n'), /✗ Главная: .*\n.*«Плашка» → \w+\./);

// исправил — снова ✓
fs.writeFileSync(path.join(dir, 'html', 'main.css'), css);
r = await checkBuild({ dir, screen: 'главн', log: () => {} });
assert.equal(r[0].pass, true);
await assert.rejects(checkBuild({ dir, screen: 'нет-такого', log: () => {} }), /не найден экран/);
fs.rmSync(dir, { recursive: true, force: true });
console.log('ds-build check: расхождение, слой Figma, место и элемент кода; после правки — ✓ — OK');
