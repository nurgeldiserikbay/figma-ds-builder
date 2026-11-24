// Картинки для сайта: WebP по размеру показа, обычный (1x) и для плотных экранов (2x).
//
// Figma отдаёт картинку в исходном размере (фото 4000×3000 в карточке 320×200). Размер показа известен из макета:
// по всем слоям, где картинка стоит заливкой, берётся самый большой (с учётом режима Fill/Fit). Из исходника
// делаются два файла — под 1x и 2x этого размера (крупнее исходника не растягиваем), в CSS — image-set().
// Кодирует WebP тот же Chromium, что проверяет вёрстку (без новых зависимостей): canvas → image/webp.
// Сжатие с потерями (quality 0.9) — только если оно почти не меняет пиксели (фото); графика с резкими краями —
// WebP без потерь. Если WebP не меньше исходного файла того же размера, остаётся исходный. Проверка — та же сверка с PNG из Figma.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const QUALITY = 0.9;

function sniff(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) return { mime: 'image/jpeg', ...jpegSize(buf) };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp' };
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return { mime: 'image/gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  return null;
}
function jpegSize(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return {};
}

/** Наибольший размер показа каждой картинки (в px макета): src → { w, h, resize } */
export function imageUsage(trees) {
  const use = new Map();
  const walk = (n) => {
    if (!n || n.visible === false) return;
    for (const f of n.fills || []) {
      if (f.type !== 'IMAGE' || !f.src || f.visible === false) continue;
      const u = use.get(f.src) || { boxes: [], resize: true };
      const w = n.size?.w || n.w, h = n.size?.h || n.h;
      u.boxes.push({ w, h, mode: f.scaleMode || 'FILL' });
      // мозаика и кадрирование (Crop) зависят от исходного размера картинки — их не уменьшаем
      if (f.scaleMode === 'TILE' || f.scaleMode === 'CROP' || f.imageTransform) u.resize = false;
      use.set(f.src, u);
    }
    (n.children || []).forEach(walk);
  };
  trees.forEach(walk);
  return use;
}

/** Размер, нужный для показа в 1x: сохраняет пропорции исходника. */
function need1x(u, iw, ih) {
  let s = 0;
  for (const b of u.boxes) {
    const k = b.mode === 'FIT' ? Math.min(b.w / iw, b.h / ih) : Math.max(b.w / iw, b.h / ih);
    if (k > s) s = k;
  }
  return { w: Math.max(1, Math.ceil(iw * s)), h: Math.max(1, Math.ceil(ih * s)) };
}

/**
 * @returns Map src → { x1, x2 } (пути внутри assets/, как src в пакете) — для image-set в CSS.
 * Картинки без замены в карте отсутствуют (остаются как есть).
 */
export async function optimizeImages(browser, outDir, trees, { log = () => {}, cacheDir = null } = {}) {
  const map = new Map();
  if (!browser) return map;
  const use = imageUsage(trees);
  if (!use.size) return map;
  const page = await browser.newPage();
  let before = 0, after = 0, lossless = 0;
  try {
    for (const [src, u] of use) {
      const file = path.join(outDir, 'assets', src);
      if (!fs.existsSync(file)) continue;
      const buf = fs.readFileSync(file);
      const info = sniff(buf);
      if (!info || !info.w || !info.h || info.mime === 'image/gif') continue; // анимацию не трогаем
      const n1 = u.resize ? need1x(u, info.w, info.h) : { w: info.w, h: info.h };
      const t1 = n1.w >= info.w ? { w: info.w, h: info.h } : n1;
      const t2 = n1.w * 2 >= info.w ? { w: info.w, h: info.h } : { w: n1.w * 2, h: n1.h * 2 };
      const sizes = t1.w === t2.w ? [t2] : [t1, t2];
      // кэш: та же картинка в тех же размерах — готовые WebP (дополнение сборки не кодирует заново)
      const ckey = cacheDir && crypto.createHash('sha256').update(buf).update(JSON.stringify([sizes, QUALITY, 1])).digest('hex').slice(0, 40);
      const cfile = ckey && path.join(cacheDir, `${ckey}.json`);
      let enc = null;
      if (cfile && fs.existsSync(cfile)) { try { enc = JSON.parse(fs.readFileSync(cfile, 'utf8')); } catch { enc = null; } }
      if (!enc) enc = await page.evaluate(async ({ b64, mime, sizes, q, maxBad }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const opt = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
        const pixels = async (src, w, h) => {
          const b = await createImageBitmap(src, opt);
          const c = new OffscreenCanvas(w, h);
          const x = c.getContext('2d');
          x.drawImage(b, 0, 0, w, h);
          return x.getImageData(0, 0, w, h).data;
        };
        const toB64 = async (b) => {
          const ab = new Uint8Array(await b.arrayBuffer());
          let s2 = '';
          for (let i = 0; i < ab.length; i += 0x8000) s2 += String.fromCharCode(...ab.subarray(i, i + 0x8000));
          return btoa(s2);
        };
        const out = [];
        for (const s of sizes) {
          const bmp = await createImageBitmap(blob, { ...opt, resizeWidth: s.w, resizeHeight: s.h, resizeQuality: 'high' });
          const c = new OffscreenCanvas(s.w, s.h);
          const x = c.getContext('2d');
          x.drawImage(bmp, 0, 0);
          const ref = x.getImageData(0, 0, s.w, s.h).data;
          const lossy = await c.convertToBlob({ type: 'image/webp', quality: q });
          if (lossy.type !== 'image/webp') return null; // браузер не умеет WebP
          // сжатие с потерями заметно портит картинку (графика, резкие края) — без потерь (quality 1 = lossless)
          const got = await pixels(lossy, s.w, s.h);
          let bad = 0;
          for (let i = 0; i < got.length; i += 4) {
            if (Math.max(Math.abs(got[i] - ref[i]), Math.abs(got[i + 1] - ref[i + 1]), Math.abs(got[i + 2] - ref[i + 2]), Math.abs(got[i + 3] - ref[i + 3])) > 24) bad++;
          }
          const ok = bad <= (s.w * s.h) * maxBad;
          const b = ok ? lossy : await c.convertToBlob({ type: 'image/webp', quality: 1 });
          out.push({ b64: await toB64(b), lossless: !ok });
        }
        return out;
      }, { b64: buf.toString('base64'), mime: info.mime, sizes, q: QUALITY, maxBad: 0.0005 }).catch(() => null);
      if (enc && cfile && !fs.existsSync(cfile)) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cfile, JSON.stringify(enc)); }
      if (!enc) continue;
      const base = src.replace(/\.(png|jpe?g|webp)$/i, '');
      const names = [];
      let bytes = 0;
      sizes.forEach((s, i) => {
        const data = Buffer.from(enc[i].b64, 'base64');
        if (enc[i].lossless) lossless++;
        const full = s.w === info.w && s.h === info.h;
        // исходник того же размера меньше WebP — оставляем исходник
        if (full && data.length >= buf.length) { names.push(src); bytes += buf.length; return; }
        const name = `${base}${sizes.length > 1 && i === 1 ? '@2x' : ''}.webp`;
        fs.writeFileSync(path.join(outDir, 'assets', name), data);
        names.push(name);
        bytes += data.length;
      });
      if (!names.includes(src)) fs.rmSync(file);
      before += buf.length;
      after += bytes;
      map.set(src, { x1: names[0], x2: names[names.length - 1] });
    }
  } finally {
    await page.close();
  }
  if (map.size) log(`Картинки: ${map.size} → WebP 1x/2x по размеру показа${lossless ? ` (без потерь: ${lossless} — графика с резкими краями)` : ''}, ${Math.round(before / 1024)} → ${Math.round(after / 1024)} КБ`);
  return map;
}

/** Заливки-картинки дерева → пути WebP (paint.set: { x1, x2 }); меняет дерево на месте. */
export function applyImageSet(tree, map) {
  if (!map?.size) return tree;
  const walk = (n) => {
    for (const f of n.fills || []) if (f.type === 'IMAGE' && map.has(f.src)) f.set = map.get(f.src);
    (n.children || []).forEach(walk);
  };
  walk(tree);
  return tree;
}
