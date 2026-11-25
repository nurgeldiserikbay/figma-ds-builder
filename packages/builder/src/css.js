// Перевод свойств узла Figma (формат ds-package) в CSS-объявления.

export const r2 = (v) => Math.round(v * 100) / 100;
export const px = (v) => (v === 0 ? '0' : `${r2(v)}px`);

const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/** {r,g,b,a} 0..1 → '#rrggbb' или '#rrggbbaa' */
export function colorHex(c, opacity = 1) {
  const a = (c.a ?? 1) * opacity;
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return a >= 0.999 ? base : base + hex2(a);
}

/** Контекст токенов: hex → имя CSS-переменной. Подставляем var(--x, #fallback). */
export function colorValue(c, opacity, ctx, variable = null, style = null) {
  const hex = colorHex(c, opacity);
  // цвет привязан к переменной Figma — её имя (при прозрачности слоя значение уже другое — ищем по цвету);
  // иначе цветовой стиль Figma (Color style) — его токен
  const opaque = (opacity ?? 1) >= 1;
  const bound = variable && opaque ? ctx?.tokens?.varRef?.(variable, hex) : null;
  if (bound) return `var(${bound}, ${hex})`;
  const styled = style && opaque ? ctx?.tokens?.styleRef?.(style) : null;
  if (styled) return `var(${styled}, ${hex})`;
  const v = ctx?.tokens?.colorVar(hex);
  return v ? `var(${v}, ${hex})` : hex;
}

const visible = (p) => p && p.visible !== false && (p.opacity ?? 1) > 0;

function paintLayer(p, ctx) {
  const op = p.opacity ?? 1;
  if (p.type === 'SOLID') {
    const c = colorValue(p.color, op, ctx, p.variable, p.style);
    return { image: `linear-gradient(${c}, ${c})`, solid: c };
  }
  if (p.type && p.type.startsWith('GRADIENT') && p.css) {
    // переменные на точках градиента: i-й цвет в CSS → var(--…, цвет)
    if (!p.stopVariables?.some(Boolean)) return { image: p.css };
    let i = 0;
    const css = p.css.replace(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g, (m) => {
      const ref = p.stopVariables[i++] && ctx?.tokens?.varRef?.(p.stopVariables[i - 1]);
      return ref ? `var(${ref}, ${m})` : m;
    });
    return { image: css };
  }
  if (p.type === 'IMAGE' && p.src) {
    const size = { FILL: 'cover', FIT: 'contain', TILE: 'auto', CROP: 'cover' }[p.scaleMode] || 'cover';
    // WebP по размеру показа (images.js): 1x и 2x — браузер берёт нужный по плотности экрана
    const set = p.set && p.set.x1 !== p.set.x2
      ? `image-set(url("${ctx.assetUrl(p.set.x1)}") 1x, url("${ctx.assetUrl(p.set.x2)}") 2x)` : null;
    const crop = cropCss(p);
    return {
      image: set || `url("${ctx.assetUrl(p.set ? p.set.x1 : p.src)}")`,
      size: crop ? crop.size : size,
      position: crop ? crop.position : undefined,
      repeat: p.scaleMode === 'TILE' ? 'repeat' : 'no-repeat',
    };
  }
  return null;
}

/**
 * Обрезка картинки (Crop): imageTransform [[a, b, tx], [c, d, ty]] — видимая часть в долях картинки
 * (от tx до tx + a по ширине, от ty до ty + d по высоте). Картинка в CSS — в 1/a и 1/d размера слоя,
 * сдвиг в процентах: (слой − картинка) · p = −tx/a · слой → p = tx / (1 − a). Поворот в обрезке — не переносим.
 */
export function cropCss(p) {
  const m = p.scaleMode === 'CROP' && p.imageTransform;
  if (!m || Math.abs(m[0][1]) > 1e-6 || Math.abs(m[1][0]) > 1e-6 || !(m[0][0] > 0) || !(m[1][1] > 0)) return null;
  const [a, tx] = [m[0][0], m[0][2]], [d, ty] = [m[1][1], m[1][2]];
  const pct = (v) => `${Math.round(v * 1e4) / 1e4}%`;
  const pos = (t, k) => (Math.abs(1 - k) < 1e-6 ? '0%' : pct((t / (1 - k)) * 100));
  return { size: `${pct(100 / a)} ${pct(100 / d)}`, position: `${pos(tx, a)} ${pos(ty, d)}` };
}

/** Заливки → background. Figma: массив снизу вверх; CSS: первый слой сверху. */
export function fillsToCss(fills, ctx) {
  const layers = (fills || []).filter(visible).map((p) => paintLayer(p, ctx)).filter(Boolean);
  if (!layers.length) return {};
  if (layers.length === 1 && layers[0].solid) return { background: layers[0].solid };
  const top = [...layers].reverse();
  const out = { 'background-image': top.map((l) => l.image).join(', ') };
  if (top.some((l) => l.size)) {
    out['background-size'] = top.map((l) => l.size || 'auto').join(', ');
    out['background-position'] = top.map((l) => l.position || 'center').join(', ');
    out['background-repeat'] = top.map((l) => l.repeat || 'no-repeat').join(', ');
  }
  return out;
}

/** Первый видимый сплошной цвет (для текста). */
export function solidColor(fills, ctx) {
  const p = (fills || []).filter(visible).reverse().find((f) => f.type === 'SOLID');
  return p ? colorValue(p.color, p.opacity ?? 1, ctx, p.variable, p.style) : null;
}

/** Обводка через outline: не влияет на раскладку и повторяет border-radius. */
export function strokesToCss(node, ctx) {
  const p = (node.strokes || []).filter(visible).reverse().find((s) => s.type === 'SOLID');
  if (!p) return {};
  const color = colorValue(p.color, p.opacity ?? 1, ctx, p.variable, p.style);
  const w = node.strokeWeight;
  if (Array.isArray(w)) {
    // разные стороны: inset box-shadow по сторонам (только INSIDE — самый частый случай)
    const [t, r, b, l] = w;
    const sh = [];
    if (t) sh.push(`inset 0 ${px(t)} 0 0 ${color}`);
    if (r) sh.push(`inset ${px(-r)} 0 0 0 ${color}`);
    if (b) sh.push(`inset 0 ${px(-b)} 0 0 ${color}`);
    if (l) sh.push(`inset ${px(l)} 0 0 0 ${color}`);
    return sh.length ? { _shadows: sh } : {};
  }
  if (!w) return {};
  // пунктир: outline dashed в браузере рисует свои штрихи, поэтому — SVG-рамка с тем же dasharray фоном элемента
  const dash = (node.dashPattern || []).filter((d) => d > 0);
  if (dash.length && node.w > 0 && node.h > 0 && (node.strokeAlign || 'INSIDE') !== 'OUTSIDE') {
    const c = p.color, a = (p.opacity ?? 1) * (c.a ?? 1);
    const rgb = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    const inset = w / 2;
    const rad = Array.isArray(node.radius) ? node.radius[0] : node.radius || 0;
    const W = r2(node.w), H = r2(node.h);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'>`
      + `<rect x='${r2(inset)}' y='${r2(inset)}' width='${r2(W - w)}' height='${r2(H - w)}' rx='${r2(Math.max(0, rad - inset))}' fill='none' `
      + `stroke='${rgb}' stroke-opacity='${r2(a)}' stroke-width='${r2(w)}' stroke-dasharray='${dash.map(r2).join(' ')}'/></svg>`;
    return { _dash: `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")` };
  }
  const offset = { INSIDE: -w, CENTER: -w / 2, OUTSIDE: 0 }[node.strokeAlign || 'INSIDE'];
  const sw = node.vars?.strokeWeight;
  const width = sw && sw.every((x) => x === sw[0]) ? withVar(ctx, sw[0], px(w)) : px(w);
  return { outline: `${width} solid ${color}`, 'outline-offset': px(offset) };
}

export function effectsToCss(node, ctx) {
  const out = {};
  const shadows = [];
  for (const e of node.effects || []) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const c = colorValue(e.color, 1, ctx);
      shadows.push(`${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(e.x || 0)} ${px(e.y || 0)} ${px(e.blur || 0)} ${px(e.spread || 0)} ${c}`);
    } else if (e.type === 'LAYER_BLUR') {
      out.filter = `blur(${px(e.radius / 2)})`;
    } else if (e.type === 'BACKGROUND_BLUR') {
      out['backdrop-filter'] = `blur(${px(e.radius / 2)})`;
    }
  }
  // стиль эффекта из Figma — его токен (значение из макета — запасное)
  const ref = shadows.length && node.effectStyle ? ctx?.tokens?.effectVar?.(node.effectStyle) : null;
  if (shadows.length) out._shadows = ref ? [`var(${ref}, ${shadows.join(', ')})`] : shadows;
  return out;
}

export function radiusToCss(node, ctx) {
  if (node.type === 'ELLIPSE') return { 'border-radius': '50%' };
  const r = node.radius;
  if (!r) return {};
  const arr = Array.isArray(r) ? r : [r, r, r, r];
  if (arr.every((v) => !v)) return {};
  const maxR = Math.min(node.w, node.h) / 2;
  const c = arr.map((v, i) => withVar(ctx, node.vars?.radius?.[i], px(Math.min(v, maxR))));
  return { 'border-radius': c.every((v) => v === c[0]) ? c[0] : c.join(' ') };
}

/** Значение, привязанное к переменной Figma: var(--space-lg, 24px). */
export function withVar(ctx, figmaName, value) {
  const ref = figmaName && ctx?.tokens?.varRef?.(figmaName);
  return ref ? `var(${ref}, ${value})` : value;
}

const WEIGHTS = [
  [/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300],
  [/medium/i, 500], [/semi ?bold|demi ?bold/i, 600], [/extra ?bold|ultra ?bold/i, 800],
  [/bold/i, 700], [/black|heavy/i, 900],
];
export function fontWeight(seg) {
  if (seg.fontWeight) return seg.fontWeight;
  for (const [re, w] of WEIGHTS) if (re.test(seg.fontStyle || '')) return w;
  return 400;
}

export function segmentCss(seg, ctx) {
  const o = {};
  if (seg.fontFamily) o['font-family'] = `"${seg.fontFamily}", sans-serif`;
  const V = seg.vars || {};
  if (Number.isFinite(seg.fontSize)) o['font-size'] = withVar(ctx, V.fontSize, px(seg.fontSize));
  if (seg.fontFamily || seg.fontWeight) o['font-weight'] = withVar(ctx, V.fontWeight, String(fontWeight(seg)));
  if (/italic|oblique/i.test(seg.fontStyle || '')) o['font-style'] = 'italic';
  const lh = seg.lineHeight;
  if (lh && lh.unit === 'PIXELS') o['line-height'] = withVar(ctx, V.lineHeight, px(lh.value));
  else if (lh && lh.unit === 'PERCENT') o['line-height'] = String(r2(lh.value / 100));
  else o['line-height'] = 'normal';
  const ls = seg.letterSpacing;
  if (ls && ls.value) o['letter-spacing'] = ls.unit === 'PERCENT' ? `${r2(ls.value / 100)}em` : withVar(ctx, V.letterSpacing, px(ls.value));
  const color = solidColor(seg.fills, ctx);
  if (color) o.color = color;
  const tc = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' }[seg.textCase];
  if (tc) o['text-transform'] = tc;
  const td = { UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' }[seg.textDecoration];
  if (td) o['text-decoration'] = td;
  return o;
}

/** Объект объявлений → строка CSS (служебные ключи вида _x склеиваются отдельно). */
export function declarations(obj) {
  const o = { ...obj };
  if (o._dash) {
    // пунктирная рамка — верхний слой фона, заливки — под ней
    const d = o._dash;
    if (o.background) { o['background-color'] = o.background; delete o.background; }
    const imgs = o['background-image'] ? o['background-image'] : null;
    const n = imgs ? (imgs.match(/(?:url|gradient)\(/g) || []).length : 0;
    const list = (k, v, def) => [v, ...(o[k] ? [o[k]] : n ? [Array(n).fill(def).join(', ')] : [])].join(', ');
    o['background-size'] = list('background-size', '100% 100%', 'auto');
    o['background-position'] = list('background-position', '0 0', '0% 0%');
    o['background-repeat'] = list('background-repeat', 'no-repeat', 'repeat');
    o['background-image'] = imgs ? `${d}, ${imgs}` : d;
  }
  delete o._dash;
  if (o._shadows?.length) o['box-shadow'] = o._shadows.join(', ');
  delete o._shadows;
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
}

export function mergeShadows(...objs) {
  const out = {};
  const sh = [];
  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      if (k === '_shadows') sh.push(...v);
      else out[k] = v;
    }
  }
  if (sh.length) out._shadows = sh;
  return out;
}
