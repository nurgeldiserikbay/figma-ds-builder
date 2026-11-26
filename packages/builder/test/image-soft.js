// Сверка фото: разница сглаживания (Figma мягче браузера) не считается расхождением, а сдвиг картинки — считается.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { comparePng, imageBoxes } from '../src/diff.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-'));
const W = 120, H = 80;
// «фото»: шахматный узор 1px (самая чувствительная к сглаживанию картинка) с крупным пятном
const photo = (dx, soft) => {
  const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const inPhoto = x >= 10 && x < 110 && y >= 10 && y < 70;
    let v = 255;
    if (inPhoto) {
      const sx = x - dx;
      const fine = (sx + y) % 2 ? 90 : 170;
      v = soft ? 130 : fine; // мягкий вариант — то же в среднем, без мелкой детали
      if (sx >= 40 && sx < 70 && y >= 25 && y < 55) v = 20; // тёмное пятно
    }
    p.data.set([v, v, v, 255], i);
  }
  const f = path.join(dir, `p${dx}${soft ? 's' : ''}.png`);
  fs.writeFileSync(f, PNG.sync.write(p));
  return f;
};
const tree = { id: 'r', type: 'FRAME', x: 0, y: 0, w: W, h: H, children: [{ id: 'i', type: 'RECTANGLE', x: 10, y: 10, w: 100, h: 60, fills: [{ type: 'IMAGE', visible: true }] }] };
const images = imageBoxes(tree);
assert.equal(images.length, 1);
const ref = photo(0, true), sharp = photo(0, false), moved = photo(8, false);
const raw = comparePng(ref, sharp, path.join(dir, 'd1.png'));
const soft = comparePng(ref, sharp, path.join(dir, 'd2.png'), { images });
assert.ok(raw.percent > 20, `без допуска сглаживание — расхождение: ${raw.percent}`);
assert.ok(soft.percent < 0.5, `с допуском — нет: ${soft.percent}`);
const shift = comparePng(ref, moved, path.join(dir, 'd3.png'), { images });
assert.ok(shift.percent > 5, `сдвиг картинки на 8px остаётся расхождением: ${shift.percent}`);
console.log('Фото: допуск на сглаживание, сдвиг ловится — OK');
