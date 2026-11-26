// Попиксельное сравнение рендера с эталоном из Figma.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * Пиксели RGBA → наложенные на белое. Фрейм без заливки Figma выгружает прозрачным, а страница в браузере
 * стоит на белом фоне: сравнивать нужно то, что видно (иначе весь пустой фон считался бы расхождением).
 */
export function flattenWhite(d) {
  const o = Buffer.from(d);
  for (let i = 0; i < o.length; i += 4) {
    const al = o[i + 3] / 255;
    if (al === 1) continue;
    o[i] = Math.round(o[i] * al + 255 * (1 - al));
    o[i + 1] = Math.round(o[i + 1] * al + 255 * (1 - al));
    o[i + 2] = Math.round(o[i + 2] * al + 255 * (1 - al));
    o[i + 3] = 255;
  }
  return o;
}

/**
 * @returns {{ percent: number, mismatched: number, total: number, sizeMismatch: boolean, bbox: object|null }}
 */
/** Слои с картинкой-заливкой (фото) — области, где сверка терпит разницу сглаживания. Координаты макета. */
export function imageBoxes(tree) {
  const out = [];
  (function walk(n) {
    if (n.visible === false) return;
    if ((n.fills || []).some((f) => f.type === 'IMAGE' && f.visible !== false) && n.w >= 8 && n.h >= 8) out.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    (n.children || []).forEach(walk);
  })(tree);
  return out;
}

/**
 * Фото Figma рисует в эталоне мягче, чем браузер (другое сглаживание при уменьшении): в области картинки
 * расхождение засчитывается, только если оно остаётся и после лёгкого размытия обоих изображений
 * (окно 5×5, разница цвета больше 32 из 255). Сдвиг, другой кадр или другая картинка размытием не прячутся.
 */
function softenImages(a, b, diff, w, h, boxes, scale) {
  const r = Math.max(1, Math.round(2 * scale));
  const T = 32;
  let cleared = 0;
  for (const bx of boxes) {
    const x0 = Math.max(0, Math.floor(bx.x * scale)), y0 = Math.max(0, Math.floor(bx.y * scale));
    const x1 = Math.min(w, Math.ceil((bx.x + bx.w) * scale)), y1 = Math.min(h, Math.ceil((bx.y + bx.h) * scale));
    if (x1 <= x0 || y1 <= y0) continue;
    let any = false;
    for (let y = y0; y < y1 && !any; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; if (diff[i] === 255 && diff[i + 1] === 0 && diff[i + 2] === 0) { any = true; break; } }
    if (!any) continue;
    // суммы по окну через интегральные изображения области (с полями под окно)
    const ex0 = Math.max(0, x0 - r), ey0 = Math.max(0, y0 - r), ex1 = Math.min(w, x1 + r), ey1 = Math.min(h, y1 + r);
    const W = ex1 - ex0 + 1, H = ey1 - ey0 + 1;
    const integ = (src) => {
      const I = [new Float64Array(W * H), new Float64Array(W * H), new Float64Array(W * H)];
      for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
        const i = ((ey0 + y - 1) * w + ex0 + x - 1) * 4;
        for (let c = 0; c < 3; c++) I[c][y * W + x] = src[i + c] + I[c][(y - 1) * W + x] + I[c][y * W + x - 1] - I[c][(y - 1) * W + x - 1];
      }
      return I;
    };
    const IA = integ(a), IB = integ(b);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (!(diff[i] === 255 && diff[i + 1] === 0 && diff[i + 2] === 0)) continue;
      const qx0 = Math.max(ex0, x - r) - ex0, qy0 = Math.max(ey0, y - r) - ey0, qx1 = Math.min(ex1 - 1, x + r) - ex0 + 1, qy1 = Math.min(ey1 - 1, y + r) - ey0 + 1;
      const n = (qx1 - qx0) * (qy1 - qy0);
      let worst = 0;
      for (let c = 0; c < 3; c++) {
        const sum = (I) => I[c][qy1 * W + qx1] - I[c][qy0 * W + qx1] - I[c][qy1 * W + qx0] + I[c][qy0 * W + qx0];
        worst = Math.max(worst, Math.abs(sum(IA) - sum(IB)) / n);
      }
      if (worst <= T) { diff[i] = 255; diff[i + 1] = 255; diff[i + 2] = 0; cleared++; } // как сглаживание — жёлтым
    }
  }
  return cleared;
}

export function comparePng(refPath, actualPath, diffPath, { threshold = 0.1, images = [], scale = 1 } = {}) {
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
  // Фрейм без заливки Figma выгружает прозрачным, а страница в браузере стоит на белом фоне: сравниваем
  // оба изображения, наложенные на белое (иначе весь пустой фон считался бы расхождением)
  const a = flattenWhite(pad(ref));
  const b = flattenWhite(pad(act));
  const diff = new PNG({ width: w, height: h });
  let mismatched = pixelmatch(a, b, diff.data, w, h, { threshold, includeAA: false, alpha: 0.2 });
  const softened = mismatched && images.length ? softenImages(a, b, diff.data, w, h, images, scale) : 0;
  mismatched -= softened;
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
  return { percent: (mismatched / (w * h)) * 100, mismatched, total: w * h, sizeMismatch, bbox, ...(softened ? { softened } : {}) };
}
