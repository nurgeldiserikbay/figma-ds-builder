// Доводка ИИ после алгоритма: экран не сошёлся с макетом — ИИ получает расходящиеся слои (свойства из Figma,
// стили в браузере, цвета в области расхождения, при возможности — картинки макета и вёрстки) и предлагает
// CSS-правки для этих элементов. Сверка решает: стало лучше и геометрия не сломалась — правка остаётся,
// иначе откат. До нескольких раундов; правки — отдельным блоком в конце styles.css (видно, что от ИИ).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { askJson } from './ai.js';
import { flattenWhite } from './diff.js';

const SYSTEM = `Ты опытный верстальщик. Вёрстка экрана сравнивается с макетом из Figma по пикселям, и часть
элементов не совпадает. Для каждого расходящегося элемента у тебя есть: свойства слоя в Figma, текущие стили
в браузере, средние цвета в области расхождения (макет и вёрстка) и, если есть, картинки макета и вёрстки.
Предложи CSS-правки, которые сделают элемент как в макете. Правила:
- меняй только оформление: цвет, фон (background-*), прозрачность, шрифт, межбуквенный и межстрочный интервалы,
  выравнивание текста, обрезку (overflow, line-clamp, object-fit/position), скругления, рамки, тени, фильтры;
- не меняй размеры и положение (width, height, top, left, margin, padding, position, display) — они уже совпадают;
- не придумывай url(…), не трогай элементы, которых нет в списке;
- если не знаешь, как исправить, — не предлагай ничего для этого элемента.
Ответ — только JSON: {"fixes": [{"id": "<id>", "css": {"свойство": "значение"}, "why": "коротко почему"}]}.`;

const ALLOWED = /^(color|opacity|background(-[a-z]+)*|font(-[a-z]+)*|letter-spacing|word-spacing|line-height|text-(align|transform|decoration|shadow|overflow|indent)|white-space|overflow(-[xy])?|-webkit-line-clamp|line-clamp|-webkit-box-orient|object-(fit|position)|border(-[a-z]+)*|outline(-[a-z]+)*|box-shadow|filter|backdrop-filter|mix-blend-mode|clip-path|mask(-[a-z]+)*|vertical-align|font-variant(-[a-z]+)*)$/;
const TEXT_PROPS = /^(color|font|letter-spacing|word-spacing|line-height|text-|white-space|-webkit-line-clamp|line-clamp|-webkit-box-orient|overflow|vertical-align)/;

/** Правки ИИ → CSS: только разрешённые свойства, без url(…) и спецсимволов; текстовые — и на span внутри. */
export function aiFixCss(fixes, nodes) {
  const L = [];
  const ok = [];
  for (const f of fixes || []) {
    const n = nodes.get(f.id);
    if (!n || !f.css || typeof f.css !== 'object') continue;
    const decl = Object.entries(f.css)
      .map(([k, v]) => [String(k).trim().toLowerCase(), String(v).trim()])
      .filter(([k, v]) => ALLOWED.test(k) && v && v.length < 200 && !/[{};<>\\]|url\s*\(|expression|javascript:/i.test(v));
    if (!decl.length) continue;
    const sel = `[data-figma-id="${f.id}"]`;
    const own = decl.filter(([k]) => n.type !== 'TEXT' || !TEXT_PROPS.test(k));
    const text = decl.filter(([k]) => n.type === 'TEXT' && TEXT_PROPS.test(k));
    const why = String(f.why || '').replace(/\*\//g, '').slice(0, 120);
    if (own.length) L.push(`${sel} { ${own.map(([k, v]) => `${k}: ${v}`).join('; ')}; } /* ИИ: ${why} */`);
    if (text.length) L.push(`${sel} > span, ${sel} > span > span { ${text.map(([k, v]) => `${k}: ${v}`).join('; ')}; } /* ИИ: ${why} */`);
    ok.push({ id: f.id, name: n.name, css: Object.fromEntries(decl), why });
  }
  return { css: L.length ? `\n/* Правки ИИ после сверки с макетом (ds-build --ai-fix) */\n${L.join('\n')}\n` : '', fixes: ok };
}

const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** Средний цвет области (в координатах макета) — словами для ИИ без зрения. */
function meanColor(png, box, scale) {
  const x0 = Math.max(0, Math.round(box.x * scale)), y0 = Math.max(0, Math.round(box.y * scale));
  const x1 = Math.min(png.width, Math.round((box.x + box.w) * scale)), y1 = Math.min(png.height, Math.round((box.y + box.h) * scale));
  let r = 0, g = 0, b = 0, k = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * png.width + x) * 4; r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; k++; }
  return k ? hex({ r: r / k, g: g / k, b: b / k }) : null;
}
function cropB64(png, box, scale, pad = 8) {
  const x = Math.max(0, Math.round((box.x - pad) * scale)), y = Math.max(0, Math.round((box.y - pad) * scale));
  const w = Math.min(png.width - x, Math.round((box.w + pad * 2) * scale)), h = Math.min(png.height - y, Math.round((box.h + pad * 2) * scale));
  if (w <= 0 || h <= 0) return null;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x, y, w, h, 0, 0);
  return `data:image/png;base64,${PNG.sync.write(out).toString('base64')}`;
}

/** Слой Figma коротко: только то, что влияет на вид. */
function figmaOf(n) {
  const fill = (f) => (f.type === 'SOLID' ? `${hex({ r: f.color.r * 255, g: f.color.g * 255, b: f.color.b * 255 })}${f.opacity < 1 ? ` (прозрачность ${f.opacity})` : ''}`
    : f.type === 'IMAGE' ? `картинка ${f.scaleMode}${f.imageTransform ? ` обрезка ${JSON.stringify(f.imageTransform)}` : ''}` : f.type.toLowerCase());
  const o = { id: n.id, name: n.name, type: n.type, x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h) };
  if (n.opacity !== undefined && n.opacity < 1) o.opacity = n.opacity;
  if (n.fills?.length) o.fills = n.fills.filter((f) => f.visible !== false).map(fill);
  if (n.strokes?.length) o.strokes = n.strokes.filter((f) => f.visible !== false).map(fill).concat(n.strokeWeight ? [`${n.strokeWeight}px ${n.strokeAlign || ''}`] : []);
  if (n.radius?.some((r) => r)) o.radius = n.radius;
  if (n.effects?.length) o.effects = n.effects.filter((e) => e.visible !== false).map((e) => e.type.toLowerCase());
  if (n.blendMode && !/PASS_THROUGH|NORMAL/.test(n.blendMode)) o.blend = n.blendMode;
  if (n.text) {
    const s0 = n.text.segments?.[0] || {};
    Object.assign(o, { text: n.text.characters?.slice(0, 120), font: `${s0.fontFamily} ${s0.fontWeight} ${s0.fontSize}px`, lineHeight: s0.lineHeight, letterSpacing: s0.letterSpacing,
      align: n.text.align, autoResize: n.text.autoResize, truncation: n.text.truncation, maxLines: n.text.maxLines });
  }
  if (n.svg) o.vector = true;
  return o;
}

/**
 * @returns { before, after, fixes, rejected, by } или null (нечего делать / ИИ недоступен)
 * render() — перерисовать страницу и сверить: { percent, geometryFailed, sources }
 */
export async function aiFixFrame({ browser, htmlPath, cssPath, refPath, renderPath, tree, base, scale = 1, rounds = 3, render, providers, cacheDir, log = () => {}, minPixels = 80, maxNodes = 6 }) {
  const nodes = new Map();
  (function walk(n) { nodes.set(n.id, n); (n.children || []).forEach(walk); })(tree);
  const ref = PNG.sync.read(fs.readFileSync(refPath));
  ref.data = flattenWhite(ref.data);
  let cur = base; // { percent, geometryFailed, sources } — как сейчас после алгоритма
  const start = base.percent;
  const accepted = [];
  const tried = [];
  let by = null, rejected = 0;
  for (let round = 0; round < rounds; round++) {
    const top = (cur.sources?.top || []).filter((t) => t.pixels >= minPixels && nodes.has(t.id)).slice(0, maxNodes);
    if (!top.length) break;
    // как это сейчас в браузере: стили элементов на месте слоёв
    const page = await browser.newPage({ viewport: { width: Math.ceil(tree.w), height: Math.ceil(tree.h) }, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    const css = await page.evaluate((ids) => ids.map((id) => {
      const el = document.querySelector(`[data-figma-id="${CSS.escape(id)}"]`);
      if (!el) return null;
      const t = el.querySelector(':scope > span') || el;
      const pick = (e, keys) => { const cs = getComputedStyle(e); return Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k)]).filter(([, v]) => v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto')); };
      return { tag: el.tagName.toLowerCase(), ...pick(el, ['background-color', 'background-image', 'background-size', 'background-position', 'opacity', 'border-radius', 'border', 'outline', 'box-shadow', 'filter', 'overflow', 'mix-blend-mode']),
        ...(t !== el ? { text: pick(t, ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'white-space', 'text-align', '-webkit-line-clamp']) } : {}) };
    }), top.map((t) => t.id));
    await page.close();
    const render0 = PNG.sync.read(fs.readFileSync(renderPath));
    const items = top.map((t, i) => ({
      figma: figmaOf(nodes.get(t.id)), browser: css[i], mismatchPx: t.pixels, area: t.box,
      colors: t.box ? { figma: meanColor(ref, t.box, scale), page: meanColor(render0, t.box, scale) } : undefined,
    }));
    const payload = `Экран «${tree.name}» ${Math.round(tree.w)}×${Math.round(tree.h)}. Расходящиеся элементы:\n${JSON.stringify(items)}`
      + (tried.length ? `\nУже пробовали и не помогло (не повторяй): ${JSON.stringify(tried.slice(-8))}` : '');
    const images = top.slice(0, 3).flatMap((t) => (t.box ? [
      { type: 'text', text: `${t.id} — макет:` }, { type: 'image_url', image_url: { url: cropB64(ref, t.box, scale) } },
      { type: 'text', text: `${t.id} — вёрстка:` }, { type: 'image_url', image_url: { url: cropB64(render0, t.box, scale) } },
    ] : [])).filter((c) => c.type === 'text' || c.image_url.url);
    const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: images.length ? [{ type: 'text', text: payload }, ...images] : payload }];
    const textOnly = images.length ? [{ role: 'system', content: SYSTEM }, { role: 'user', content: payload }] : null;
    const r = await askJson(providers, messages, { cacheDir, log, what: `доводка «${tree.name}», раунд ${round + 1}`, textOnly });
    if (!r.parsed) { if (!accepted.length && round === 0) return { error: (r.errors || []).join('; ') || 'ИИ не ответил' }; break; }
    by = r.by;
    const { css: patch, fixes } = aiFixCss(r.parsed.fixes, nodes);
    if (!patch) break;
    const before = fs.readFileSync(cssPath, 'utf8');
    const saved = fs.existsSync(renderPath) ? fs.readFileSync(renderPath) : null;
    fs.appendFileSync(cssPath, patch);
    const next = await render();
    if (next.percent < cur.percent - 0.005 && next.geometryFailed <= cur.geometryFailed) {
      accepted.push(...fixes);
      cur = next;
    } else {
      fs.writeFileSync(cssPath, before);
      if (saved) fs.writeFileSync(renderPath, saved);
      cur = await render(); // вернуть картинки и источники к состоянию до правки
      rejected += fixes.length;
      tried.push(...fixes.map((f) => ({ id: f.id, css: f.css })));
    }
  }
  return accepted.length ? { before: start, after: cur.percent, fixes: accepted, rejected, by } : { before: start, after: start, fixes: [], rejected, by };
}
