// Обрезка картинки (Crop) из Figma: в вёрстке видна та же часть картинки, что в макете — пиксель в пиксель.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { cropCss } from '../src/css.js';
import { openBrowser } from '../src/render.js';

assert.equal(cropCss({ scaleMode: 'FILL', imageTransform: [[1, 0, 0], [0, 1, 0]] }), null);
assert.deepEqual(cropCss({ scaleMode: 'CROP', imageTransform: [[0.5, 0, 0.25], [0, 0.5, 0.5]] }), { size: '200% 200%', position: '50% 100%' });
assert.deepEqual(cropCss({ scaleMode: 'CROP', imageTransform: [[1, 0, -0.01694], [0, 1, -0.053239]] }, { w: 170, h: 171 }), { size: '100% 100%', position: '2.88px 9.1px' }, 'масштаб 1: сдвиг в пикселях');

// картинка 200×100 с разными цветами в каждой клетке 50×50; видимая часть — x 50…150, y 50…100
const W = 200, H = 100, img = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, cx = Math.floor(x / 50), cy = Math.floor(y / 50);
  img.data.set([cx * 60, cy * 200, 255 - cx * 60, 255], i);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crop-'));
fs.writeFileSync(path.join(dir, 'img.png'), PNG.sync.write(img));
const c = cropCss({ scaleMode: 'CROP', imageTransform: [[0.5, 0, 0.25], [0, 0.5, 0.5]] });
fs.writeFileSync(path.join(dir, 'i.html'), `<body style="margin:0"><div style="width:100px;height:50px;background:url(img.png) ${c.position} / ${c.size} no-repeat"></div>`);
const b = await openBrowser();
const page = await b.newPage({ viewport: { width: 100, height: 50 } });
await page.goto('file://' + path.join(dir, 'i.html'));
const shot = PNG.sync.read(await page.screenshot());
await b.close();
let bad = 0;
for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) {
  const s = ((y + 50) * W + (x + 50)) * 4, d = (y * 100 + x) * 4;
  if ([0, 1, 2].some((k) => Math.abs(img.data[s + k] - shot.data[d + k]) > 2)) bad++;
}
fs.rmSync(dir, { recursive: true, force: true });
assert.equal(bad, 0, `обрезка: не совпало пикселей ${bad}`);
console.log('Обрезка картинки (Crop) — та же часть, что в макете — OK');
