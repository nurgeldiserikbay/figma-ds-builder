// Попиксельное сравнение рендера с эталоном из Figma.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * @returns {{ percent: number, mismatched: number, total: number, sizeMismatch: boolean, bbox: object|null }}
 */
export function comparePng(refPath, actualPath, diffPath, { threshold = 0.1 } = {}) {
  const ref = PNG.sync.read(fs.readFileSync(refPath));
  const act = PNG.sync.read(fs.readFileSync(actualPath));
  const w = Math.max(ref.width, act.width);
  const h = Math.max(ref.height, act.height);
  const sizeMismatch = ref.width !== act.width || ref.height !== act.height;

  // Приводим к общему размеру: недостающее заполняется прозрачным и считается расхождением
  const pad = (img) => {
    if (img.width === w && img.height === h) return img.data;
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out.data;
  };
  const a = pad(ref);
  const b = pad(act);
  const diff = new PNG({ width: w, height: h });
  const mismatched = pixelmatch(a, b, diff.data, w, h, { threshold, includeAA: false, alpha: 0.2 });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  // Рамка области расхождений — подсказка, где искать проблему
  let bbox = null;
  if (mismatched) {
    let x1 = w, y1 = h, x2 = -1, y2 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // pixelmatch рисует расхождения красным (255,0,0)
        if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) {
          if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y;
        }
      }
    }
    if (x2 >= 0) bbox = { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
  }
  return { percent: (mismatched / (w * h)) * 100, mismatched, total: w * h, sizeMismatch, bbox };
}
