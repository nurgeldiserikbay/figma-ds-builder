// Скроллбар, нарисованный в макете: блок прокручивается, полоса стоит на месте, ползунок едет; вид — как в макете.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findScrollbars } from '../src/scrollbars.js';
import { generateFrame } from '../src/generate.js';
import { openBrowser } from '../src/render.js';

const fill = (c) => [{ type: 'SOLID', visible: true, color: { r: c, g: c, b: c, a: 1 } }];
const rect = (id, x, y, w, h, c) => ({ id, name: id, type: 'RECTANGLE', x, y, w, h, visible: true, fills: fill(c), radius: [10, 10, 10, 10] });
const items = Array.from({ length: 8 }, (_, i) => rect(`it${i}`, 0, i * 110, 300, 100, 0.9 - i * 0.05));
const tree = { id: 'r', name: 'Page', type: 'FRAME', x: 0, y: 0, w: 340, h: 400, visible: true, fills: fill(1), children: [
  { id: 'box', name: 'List', type: 'FRAME', x: 0, y: 0, w: 321, h: 400, visible: true, clipsContent: true, fills: [],
    layout: { mode: 'HORIZONTAL', gap: 16, padding: [0, 0, 0, 0], primaryAlign: 'MIN', counterAlign: 'MIN' },
    children: [
      { id: 'content', name: 'Items', type: 'FRAME', x: 0, y: 0, w: 300, h: 870, visible: true, fills: [], layout: { mode: 'VERTICAL', gap: 10, padding: [0, 0, 0, 0], primaryAlign: 'MIN', counterAlign: 'MIN' }, children: items },
      { id: 'bar', name: 'Group 65', type: 'GROUP', x: 316, y: 0, w: 5, h: 300, visible: true, children: [rect('track', 316, 0, 5, 300, 0.96), rect('thumb', 316, 0, 5, 90, 0.78)] },
    ] },
  // тонкая линия-разделитель без ползунка — не скроллбар
  rect('divider', 330, 0, 4, 200, 0.5),
] };

assert.deepEqual([...findScrollbars(tree)], [['box', { bar: 'bar', thumb: 'thumb' }]]);

const { html, css } = generateFrame(tree, { mode: 'flow', assetUrl: (r) => r, title: 'S' });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scroll-'));
fs.writeFileSync(path.join(dir, 'tokens.css'), '');
fs.mkdirSync(path.join(dir, 'p'));
fs.writeFileSync(path.join(dir, 'p', 'index.html'), html);
fs.writeFileSync(path.join(dir, 'p', 'styles.css'), css);
const b = await openBrowser();
const page = await b.newPage({ viewport: { width: 340, height: 400 } });
await page.goto('file://' + path.join(dir, 'p', 'index.html'));
const r = await page.evaluate(async () => {
  const s = document.querySelector('[data-scroll]'), bar = s.querySelector('[data-scrollbar]'), t = s.querySelector('[data-scroll-thumb]');
  const box = (e) => e.getBoundingClientRect();
  const before = { thumb: box(t).top, bar: box(bar).left, width: s.offsetWidth - s.clientWidth };
  s.scrollTop = 1e6;
  await new Promise((res) => setTimeout(res, 50));
  return { before, scrolled: s.scrollTop, bar: box(bar).top, thumbBottom: box(t).bottom, barBottom: box(bar).bottom };
});
await b.close();
fs.rmSync(dir, { recursive: true, force: true });
assert.equal(r.before.thumb, 0, 'до прокрутки — как в макете');
assert.equal(r.before.bar, 316, 'полоса на месте');
assert.equal(r.before.width, 0, 'системная полоса скрыта — раскладка как в макете');
assert.ok(r.scrolled > 400, 'блок прокручивается');
assert.equal(r.bar, 0, 'нарисованная полоса стоит на месте');
assert.ok(Math.abs(r.thumbBottom - r.barBottom) < 1, 'ползунок доехал до низа');
console.log('Скроллбар из макета: прокрутка, полоса на месте, ползунок едет — OK');
