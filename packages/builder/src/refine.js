// Автодоработка после сверки с эталоном.
//
// Для слоёв, которые дают больше всего расхождений, перебираем небольшие поправки
// и оставляем ту, что ближе к эталону в области этого слоя. Поправки не меняют
// размеры и положение блоков, поэтому проверка геометрии остаётся в силе.
//
// Сейчас поправки текстовые (метрики шрифта в браузере и в Figma немного различаются):
//   • letter-spacing — ширина строки;
//   • сдвиг строки по вертикали — положение базовой линии.
// Это место для будущих шагов, в том числе с ИИ: тот же цикл «предложить → проверить → оставить лучшее».
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { flattenWhite } from './diff.js';

function crop(png, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x, y, w, h, 0, 0);
  return out;
}

export async function refinePage(browser, htmlPath, { refPath, tree, sources, width, height, scale = 1, maxNodes = 16, minPixels = 150 }) {
  const ref = PNG.sync.read(fs.readFileSync(refPath));
  ref.data = flattenWhite(ref.data); // прозрачный фон эталона = белый фон страницы
  const nodes = new Map();
  (function walk(n) { nodes.set(n.id, n); (n.children || []).forEach(walk); })(tree);

  const page = await browser.newPage({ viewport: { width: Math.ceil(width), height: Math.ceil(height) }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const patches = [];
  const candidates = sources.top.filter((s) => s.pixels >= minPixels && nodes.get(s.id)?.type === 'TEXT').slice(0, maxNodes);

  for (const c of candidates) {
    const n = nodes.get(c.id);
    // область сравнения: блок слоя с запасом
    const pad = 6;
    const x = Math.max(0, Math.floor(n.x - pad)), y = Math.max(0, Math.floor(n.y - pad));
    const w = Math.min(Math.ceil(width) - x, Math.ceil(n.w + pad * 2)), h = Math.min(Math.ceil(height) - y, Math.ceil(n.h + pad * 2));
    if (w <= 0 || h <= 0) continue;
    const refCrop = crop(ref, Math.round(x * scale), Math.round(y * scale), Math.round(w * scale), Math.round(h * scale));

    const score = async () => {
      const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
      const img = PNG.sync.read(buf);
      if (img.width !== refCrop.width || img.height !== refCrop.height) return Infinity;
      return pixelmatch(refCrop.data, flattenWhite(img.data), null, img.width, img.height, { threshold: 0.1, includeAA: false });
    };

    const base = await page.evaluate((id) => {
      const el = document.querySelector(`[data-figma-id="${CSS.escape(id)}"]`);
      if (!el || !el.querySelector(':scope > span')) return null; // <input> и прочее без текста-спанов — не подстраиваем
      // текст одного оформления — один span; несколько — span на кусок внутри общего
      const nested = [...el.querySelectorAll(':scope > span > span')];
      const spans = nested.length ? nested : [el.querySelector(':scope > span')];
      return { single: !nested.length, ls: spans.map((s) => parseFloat(getComputedStyle(s).letterSpacing) || 0), fs: parseFloat(getComputedStyle(spans[0] || el).fontSize) || 16 };
    }, c.id);
    if (!base) continue;

    const apply = (dls, dy, dws = 0) => page.evaluate(({ id, ls, dls, dy, dws }) => {
      const el = document.querySelector(`[data-figma-id="${CSS.escape(id)}"]`);
      const inner = el.querySelector(':scope > span');
      const nested = [...el.querySelectorAll(':scope > span > span')];
      (nested.length ? nested : [inner]).forEach((s, i) => { s.style.letterSpacing = `${ls[i] + dls}px`; s.style.wordSpacing = dws ? `${dws}px` : ''; });
      inner.style.position = 'relative';
      inner.style.top = `${dy}px`;
    }, { id: c.id, ls: base.ls, dls, dy, dws });

    const before = await score();
    let best = { dls: 0, dy: 0, dws: 0, score: before };
    const unit = Math.max(0.05, base.fs / 200); // шаг интервала зависит от кегля
    // 1) интервал: грубо, затем точнее вокруг лучшего
    for (const steps of [[-4, -2, -1, 1, 2, 4], [-0.5, 0.5], [-0.25, 0.25]]) {
      const center = best.dls;
      for (const k of steps) {
        const dls = Math.round((center + k * unit) * 100) / 100;
        await apply(dls, best.dy);
        const s = await score();
        if (s < best.score) best = { ...best, dls, score: s };
      }
    }
    // 2) расстояние между словами (кернинг пар со пробелом заметно отличается у крупного текста)
    for (const k of [-4, -2, -1, 1, 2, 4]) {
      const dws = Math.round(k * unit * 2 * 100) / 100;
      await apply(best.dls, best.dy, dws);
      const s = await score();
      if (s < best.score) best = { ...best, dws, score: s };
    }
    // 3) вертикальный сдвиг строки
    for (const dy of [-2, -1, -0.5, 0.5, 1, 2]) {
      await apply(best.dls, dy, best.dws);
      const s = await score();
      if (s < best.score) best = { ...best, dy, score: s };
    }
    // оставляем только заметное улучшение
    if (best.score < before * 0.9) {
      await apply(best.dls, best.dy, best.dws);
      patches.push({ id: c.id, name: n.name, single: base.single, letterSpacing: base.ls.map((v) => Math.round((v + best.dls) * 100) / 100), wordSpacing: best.dws, dy: best.dy, before, after: best.score });
    } else {
      await apply(0, 0);
    }
  }
  // Сдвиг базовой линии зависит от кегля и интерлиньяжа, а не от слоя: если у текстов одного стиля
  // нашёлся один и тот же сдвиг, пробуем его для всех текстов этого стиля и оставляем, если вся страница ближе
  const fullScore = async () => {
    const img = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) } }));
    if (img.width !== ref.width || img.height !== ref.height) return Infinity;
    return pixelmatch(ref.data, flattenWhite(img.data), null, img.width, img.height, { threshold: 0.1, includeAA: false });
  };
  const styleOf = (id) => page.evaluate((id) => {
    const s = document.querySelector(`[data-figma-id="${CSS.escape(id)}"] > span > span`) || document.querySelector(`[data-figma-id="${CSS.escape(id)}"] > span`);
    return s ? s.className : null;
  }, id);
  const byStyle = new Map();
  for (const p of patches) {
    if (!p.dy) continue;
    const cls = await styleOf(p.id);
    if (!cls) continue;
    if (!byStyle.has(cls)) byStyle.set(cls, []);
    byStyle.get(cls).push(p.dy);
  }
  let total = byStyle.size ? await fullScore() : 0;
  for (const [cls, dys] of byStyle) {
    if (dys.some((d) => d !== dys[0])) continue; // тексты стиля не согласны — оставляем поправки по слоям
    const dy = dys[0];
    // строка текста: сам span стиля (один кусок) или его родитель (несколько кусков)
    const set = (v) => page.evaluate(({ cls, v }) => {
      for (const s of document.querySelectorAll(`.${CSS.escape(cls)}`)) {
        const inner = s.parentElement?.hasAttribute('data-figma-id') ? s : s.matches(':first-child') ? s.parentElement : null;
        if (!inner || !inner.parentElement?.hasAttribute('data-figma-id')) continue;
        inner.style.position = 'relative';
        inner.style.top = v === null ? inner.dataset.top0 ?? '' : `${v}px`;
      }
    }, { cls, v });
    await page.evaluate((cls) => {
      for (const s of document.querySelectorAll(`.${CSS.escape(cls)}`)) {
        const inner = s.parentElement?.hasAttribute('data-figma-id') ? s : s.parentElement;
        inner.dataset.top0 = inner.style.top;
      }
    }, cls);
    await set(dy);
    const t = await fullScore();
    if (t < total) {
      total = t;
      patches.push({ style: cls, dy, name: `все тексты стиля ${cls}` });
    } else {
      await set(null);
    }
  }
  await page.close();
  return patches;
}

/** Поправки → CSS (отдельный блок в конце styles.css, видно, что исправлено автоматически). */
export function patchesCss(patches) {
  if (!patches.length) return '';
  const L = ['', '/* Поправки после сверки с эталоном Figma (ds-build refine) */'];
  for (const p of patches) {
    if (p.style) {
      L.push(`[data-figma-id] > span:has(> .${p.style}:first-child), [data-figma-id] > .${p.style} { position: relative; top: ${p.dy}px; } /* ${p.name} */`);
      continue;
    }
    const sel = `[data-figma-id="${p.id}"]`;
    p.letterSpacing.forEach((ls, i) => L.push(`${sel} > span${p.single ? '' : ` > span:nth-child(${i + 1})`} { letter-spacing: ${ls}px;${p.wordSpacing ? ` word-spacing: ${p.wordSpacing}px;` : ''} } /* ${p.name} */`));
    if (p.dy) L.push(`${sel} > span { position: relative; top: ${p.dy}px; }`);
  }
  return L.join('\n') + '\n';
}
