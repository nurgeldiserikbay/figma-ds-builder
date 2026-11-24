// Снимок полосами (длинные экраны, на которых Chromium не успевает или не может снять кадр целиком)
// совпадает со снимком целиком пиксель в пиксель.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { openBrowser, screenshot } from '../src/render.js';

const browser = await openBrowser();
const page = await browser.newPage({ viewport: { width: 300, height: 1700 }, deviceScaleFactor: 2 });
await page.setContent(`<body style="margin:0">${Array.from({ length: 17 }, (_, i) =>
  `<div style="height:100px;background:hsl(${i * 21},70%,${40 + (i % 3) * 10}%);font:14px sans-serif">полоса ${i}</div>`).join('')}</body>`);
const clip = { x: 0, y: 0, width: 300, height: 1700 };
const whole = PNG.sync.read(await screenshot(page, clip));
// таймаут 1 мс — снимок целиком не успевает, срабатывает склейка полосами
const bands = PNG.sync.read(await screenshot(page, clip, { band: 333, firstTimeout: 1 }));
assert.equal(bands.width, whole.width);
assert.equal(bands.height, whole.height);
let diff = 0;
for (let i = 0; i < whole.data.length; i++) if (whole.data[i] !== bands.data[i]) diff++;
assert.equal(diff, 0, 'склейка полосами совпадает с целым кадром');
await browser.close();
console.log(`Снимок полосами: ${whole.width}×${whole.height}, совпадает с целым — OK`);
