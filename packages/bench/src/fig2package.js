#!/usr/bin/env node
// .fig → ds-package (без Figma). Нужен для прогонов на открытых макетах.
//
//   node src/fig2package.js файл.fig --out папка [--frame имя]... [--min-width 320] [--reference имя=файл.png]
//
// Ограничения (в отличие от экспорта из плагина):
//   • эталонов PNG нет — Figma-рендер сделать без Figma нельзя (можно подложить вручную через --reference);
//   • векторы собираются в SVG из геометрии .fig (fillGeometry/strokeGeometry), но с одной заливкой
//     (градиенты — средним цветом), без эффектов;
//   • в инстансах применяются только переопределения текста, видимости, заливок и размеров.
import fs from 'node:fs';
import path from 'node:path';
import { loadFig } from './fig-load.js';

const gid = (g) => (g ? `${g.sessionID}:${g.localID}` : '');
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- матрицы 2×3 ----------
const I = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
function mul(a, b) {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10, m01: a.m00 * b.m01 + a.m01 * b.m11, m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
    m10: a.m10 * b.m00 + a.m11 * b.m10, m11: a.m10 * b.m01 + a.m11 * b.m11, m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12,
  };
}

// ---------- краски ----------
function gradientCss(p) {
  const t = p.transform || I;
  // transform переводит пространство слоя в пространство градиента; направление — обратное
  const det = t.m00 * t.m11 - t.m01 * t.m10 || 1;
  const dx = t.m11 / det, dy = -t.m10 / det;
  const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90);
  const stops = (p.stops || []).map((s) => {
    const c = s.color;
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${r2(c.a)}) ${Math.round(s.position * 100)}%`;
  }).join(', ');
  if (p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_DIAMOND') return `radial-gradient(${stops})`;
  if (p.type === 'GRADIENT_ANGULAR') return `conic-gradient(from ${angle}deg, ${stops})`;
  return `linear-gradient(${angle}deg, ${stops})`;
}

const hex = (bytes) => Buffer.from(bytes || []).toString('hex');

function paints(list, ctx) {
  return (list || []).map((p) => {
    const base = { type: p.type, opacity: p.opacity ?? 1, visible: p.visible !== false };
    if (p.type === 'SOLID') return { ...base, color: p.color };
    if (p.type?.startsWith('GRADIENT')) return { ...base, css: gradientCss(p) };
    if (p.type === 'IMAGE' && p.image?.hash) {
      const h = hex(p.image.hash);
      ctx.images.add(h);
      const mode = { STRETCH: 'FILL', FIT: 'FIT', FILL: 'FILL', TILE: 'TILE' }[p.imageScaleMode] || 'FILL';
      return { ...base, src: `images/${h}`, scaleMode: mode };
    }
    return null;
  }).filter(Boolean);
}

function lineHeight(lh) {
  if (!lh) return { unit: 'AUTO' };
  if (lh.units === 'PIXELS') return { unit: 'PIXELS', value: lh.value };
  if (lh.units === 'RAW') return { unit: 'PERCENT', value: lh.value * 100 };
  // в .fig «Auto» хранится как 100%
  if (lh.units === 'PERCENT') return lh.value === 100 ? { unit: 'AUTO' } : { unit: 'PERCENT', value: lh.value };
  return { unit: 'AUTO' };
}

function letterSpacing(ls) {
  if (!ls) return { unit: 'PIXELS', value: 0 };
  return { unit: ls.units === 'PERCENT' ? 'PERCENT' : 'PIXELS', value: ls.value };
}

function weightOf(style) {
  const s = (style || '').toLowerCase();
  if (/thin|hairline/.test(s)) return 100;
  if (/extra ?light|ultra ?light/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/medium/.test(s)) return 500;
  if (/semi ?bold|demi/.test(s)) return 600;
  if (/extra ?bold|ultra ?bold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  return 400;
}

function segStyle(n, ctx) {
  return {
    fontFamily: n.fontName?.family || 'Inter', fontStyle: n.fontName?.style || 'Regular',
    fontWeight: weightOf(n.fontName?.style), fontSize: n.fontSize || 12,
    lineHeight: lineHeight(n.lineHeight), letterSpacing: letterSpacing(n.letterSpacing),
    textDecoration: n.textDecoration || 'NONE', textCase: n.textCase || 'ORIGINAL',
    fills: paints(n.fillPaints, ctx),
  };
}

function textOf(n, ctx) {
  const td = n.textData || {};
  const chars = td.characters || '';
  const base = segStyle(n, ctx);
  const ids = td.characterStyleIDs || [];
  const table = new Map((td.styleOverrideTable || []).map((s) => [s.styleID, s]));
  const segments = [];
  let start = 0;
  const styleAt = (i) => ids[i] || 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i === chars.length || styleAt(i) !== styleAt(start)) {
      const o = table.get(styleAt(start));
      const merged = o ? { ...n, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) } : n;
      segments.push({ start, end: i, ...(o ? segStyle(merged, ctx) : base) });
      start = i;
    }
  }
  if (!segments.length) segments.push({ start: 0, end: 0, ...base });
  return {
    characters: chars,
    align: n.textAlignHorizontal || 'LEFT', verticalAlign: n.textAlignVertical || 'TOP',
    autoResize: n.textAutoResize || 'NONE', segments,
  };
}

function radius(n) {
  if (n.rectangleCornerRadiiIndependent) {
    return [n.rectangleTopLeftCornerRadius || 0, n.rectangleTopRightCornerRadius || 0, n.rectangleBottomRightCornerRadius || 0, n.rectangleBottomLeftCornerRadius || 0];
  }
  const r = n.cornerRadius || n.rectangleTopLeftCornerRadius || 0;
  return r ? [r, r, r, r] : undefined;
}

function effects(n) {
  return (n.effects || []).filter((e) => e.visible !== false).map((e) => {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      return { type: e.type, x: e.offset?.x || 0, y: e.offset?.y || 0, blur: e.radius || 0, spread: e.spread || 0, color: e.color };
    }
    return { type: e.type === 'FOREGROUND_BLUR' ? 'LAYER_BLUR' : 'BACKGROUND_BLUR', radius: e.radius || 0 };
  });
}

const ALIGN = { MIN: 'MIN', CENTER: 'CENTER', MAX: 'MAX', SPACE_BETWEEN: 'SPACE_BETWEEN', SPACE_EVENLY: 'SPACE_BETWEEN', BASELINE: 'BASELINE' };

function layoutOf(n) {
  if (!n.stackMode || n.stackMode === 'NONE' || n.stackMode === 'GRID') return undefined;
  const left = n.stackHorizontalPadding ?? n.stackPadding ?? 0;
  const top = n.stackVerticalPadding ?? n.stackPadding ?? 0;
  return {
    mode: n.stackMode,
    gap: n.stackSpacing || 0,
    padding: [top, n.stackPaddingRight ?? left, n.stackPaddingBottom ?? top, left],
    primaryAlign: ALIGN[n.stackPrimaryAlignItems] || 'MIN',
    counterAlign: ALIGN[n.stackCounterAlignItems] || 'MIN',
    wrap: n.stackWrap === 'WRAP',
    counterGap: n.stackCounterSpacing || 0,
  };
}

// ---------- геометрия векторов ----------
// commandsBlob: [cmd:u8, float32 LE…]  0 — Z, 1 — M x y, 2 — L x y, 3 — Q cx cy x y, 4 — C c1x c1y c2x c2y x y
function decodePath(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  const d = [];
  const pts = [];
  const f = () => { const x = v.getFloat32(i, true); i += 4; return x; };
  const take = (n) => { const a = []; for (let k = 0; k < n; k++) a.push(f()); for (let k = 0; k < n; k += 2) pts.push([a[k], a[k + 1]]); return a.map((x) => r2(x)).join(' '); };
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c === 0) d.push('Z');
    else if (c === 1) d.push('M' + take(2));
    else if (c === 2) d.push('L' + take(2));
    else if (c === 3) d.push('Q' + take(4));
    else if (c === 4) d.push('C' + take(6));
    else break; // неизвестная команда — дальше не читаем
  }
  return { d: d.join(''), pts };
}

function svgPaint(list) {
  const p = (list || []).filter((x) => x.visible !== false).reverse()[0];
  if (!p) return null;
  const op = p.opacity ?? 1;
  if (p.type === 'SOLID') return { color: p.color, op };
  if (p.type?.startsWith('GRADIENT') && p.stops?.length) return { color: p.stops[Math.floor(p.stops.length / 2)].color, op };
  return null;
}
const rgba = (c, op) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${r2((c.a ?? 1) * op)})`;

/** SVG из fillGeometry/strokeGeometry узла (координаты — в пространстве слоя). */
function vectorSvg(n, blobs) {
  const parts = [];
  const all = [];
  const add = (geo, paint) => {
    if (!paint) return;
    for (const g of geo || []) {
      const b = blobs[g.commandsBlob];
      if (!b) continue;
      const { d, pts } = decodePath(b.bytes);
      if (!d) continue;
      all.push(...pts);
      parts.push(`<path d="${d}" fill="${rgba(paint.color, paint.op)}" fill-rule="${g.windingRule === 'ODD' ? 'evenodd' : 'nonzero'}"/>`);
    }
  };
  add(n.fillGeometry, svgPaint(n.fillPaints));
  add(n.strokeGeometry, svgPaint(n.strokePaints));
  if (!parts.length) return null;
  const w = n.size?.x || 0, h = n.size?.y || 0;
  // рамка рисунка может выходить за слой (обводки снаружи, кривые)
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const box = { x: Math.floor(Math.min(0, ...xs)), y: Math.floor(Math.min(0, ...ys)) };
  box.w = Math.ceil(Math.max(w, ...xs)) - box.x;
  box.h = Math.ceil(Math.max(h, ...ys)) - box.y;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${parts.join('')}</svg>`;
  return { svg, box };
}

// ---------- построение дерева ----------
export function convert(message) {
  const nodes = new Map();
  const kids = new Map();
  for (const n of message.nodeChanges) {
    if (n.phase === 'REMOVED') continue;
    nodes.set(gid(n.guid), n);
  }
  for (const n of nodes.values()) {
    const p = n.parentIndex && gid(n.parentIndex.guid);
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.parentIndex.position < b.parentIndex.position ? -1 : 1));

  const pages = [...nodes.values()].filter((n) => n.type === 'CANVAS' && !n.internalOnly);
  return { nodes, kids, pages, blobs: message.blobs || [] };
}

const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE']);
const TYPE = { ROUNDED_RECTANGLE: 'RECTANGLE', REGULAR_POLYGON: 'POLYGON', SYMBOL: 'COMPONENT' };

/**
 * Узел .fig → узел ds-package. `abs` — абсолютная матрица родителя, `origin` — точка фрейма.
 * `inst` — контекст инстанса: { path, overrides, derived } для применения переопределений.
 */
function build(n, G, parentAbs, origin, ctx, inst) {
  const key = inst ? [...inst.path, gid(n.overrideKey || n.guid)] : null;
  const pk = key ? key.join('/') : null;
  // переопределения инстанса (текст, видимость, заливки) и вычисленные размеры
  if (inst) {
    const ov = inst.overrides.get(pk);
    if (ov) n = { ...n, ...ov, textData: ov.textData ? { ...n.textData, ...ov.textData } : n.textData };
    const d = inst.derived.get(pk);
    if (d) n = { ...n, size: d.size || n.size, transform: d.transform || n.transform,
      fillGeometry: d.fillGeometry || n.fillGeometry, strokeGeometry: d.strokeGeometry || n.strokeGeometry };
  }
  const local = n.transform || I;
  const abs = mul(parentAbs, local);
  const w = n.size?.x || 0, h = n.size?.y || 0;
  const rot = Math.atan2(abs.m10, abs.m00) * 180 / Math.PI;
  ctx.count++;

  // повёрнутый/отражённый слой: видимая рамка + исходный размер + матрица от фрейма
  const ident = Math.abs(abs.m00 - 1) < 1e-4 && Math.abs(abs.m10) < 1e-4 && Math.abs(abs.m01) < 1e-4 && Math.abs(abs.m11 - 1) < 1e-4;
  let box = { x: abs.m02 - origin.x, y: abs.m12 - origin.y, w, h };
  if (!ident) {
    const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [abs.m00 * x + abs.m01 * y + abs.m02 - origin.x, abs.m10 * x + abs.m11 * y + abs.m12 - origin.y]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  const o = {
    // внутри инстансов один и тот же мастер-слой встречается много раз: id = слой + цепочка инстансов
    id: gid(n.guid) + (inst ? '@' + inst.chain.join('/') : ''),
    name: n.name || n.type,
    // группы хранятся в .fig как FRAME с resizeToFit
    type: n.type === 'FRAME' && n.resizeToFit ? 'GROUP' : TYPE[n.type] || n.type,
    x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h),
    rotation: Math.abs(rot) < 0.01 ? 0 : r2(-rot),
    ...(ident ? {} : { size: { w: r2(w), h: r2(h) }, transform: [[abs.m00, abs.m01, r2(abs.m02 - origin.x)], [abs.m10, abs.m11, r2(abs.m12 - origin.y)]] }),
    visible: n.visible !== false,
    opacity: n.opacity ?? 1,
    blendMode: n.blendMode || 'NORMAL',
  };
  if (!o.visible) return o;
  if ((n.type === 'FRAME' && !n.resizeToFit) || n.type === 'SYMBOL' || n.type === 'INSTANCE') o.clipsContent = n.frameMaskDisabled === false;
  if (n.mask) o.isMask = true;
  o.fills = paints(n.fillPaints, ctx);
  if (n.strokePaints?.length) {
    o.strokes = paints(n.strokePaints, ctx);
    o.strokeWeight = n.borderStrokeWeightsIndependent
      ? [n.borderTopWeight || 0, n.borderRightWeight || 0, n.borderBottomWeight || 0, n.borderLeftWeight || 0]
      : n.strokeWeight || 0;
    o.strokeAlign = n.strokeAlign || 'INSIDE';
  }
  o.radius = radius(n);
  o.effects = effects(n);
  const L = layoutOf(n);
  if (L) o.layout = L;
  o.layoutPositioning = n.stackPositioning === 'ABSOLUTE' ? 'ABSOLUTE' : 'AUTO';
  // constraints и Fill в Auto Layout — для «резиновой» вёрстки (как constraints / layoutSizing* в Figma API)
  const KC = { MIN: 'MIN', CENTER: 'CENTER', MAX: 'MAX', STRETCH: 'STRETCH', SCALE: 'SCALE', FIXED_MIN: 'MIN', FIXED_MAX: 'MAX' };
  o.constraints = { h: KC[n.horizontalConstraint] || 'MIN', v: KC[n.verticalConstraint] || 'MIN' };
  const par = n.parentIndex && G.nodes.get(gid(n.parentIndex.guid));
  if (par && (par.stackMode === 'HORIZONTAL' || par.stackMode === 'VERTICAL')) {
    const grow = n.stackChildPrimaryGrow > 0, str = n.stackChildAlignSelf === 'STRETCH';
    o.sizing = par.stackMode === 'HORIZONTAL' ? { h: grow ? 'FILL' : 'FIXED', v: str ? 'FILL' : 'FIXED' } : { h: str ? 'FILL' : 'FIXED', v: grow ? 'FILL' : 'FIXED' };
  }

  if (n.type === 'TEXT') {
    o.text = textOf(n, ctx);
    return o;
  }
  if (VECTORISH.has(n.type)) {
    const v = vectorSvg(n, G.blobs);
    if (v) {
      const name = `vectors/${o.id.replace(/[:;@/]/g, '_')}.svg`;
      ctx.svgs.set(name, v.svg);
      o.svg = name;
      if (v.box.x || v.box.y || v.box.w !== Math.ceil(w) || v.box.h !== Math.ceil(h)) o.svgBox = v.box;
      ctx.vectors++;
    } else {
      o.vectorPlaceholder = true;
      ctx.placeholders++;
    }
    o.fills = [];
    delete o.strokes;
    return o;
  }

  let children = G.kids.get(gid(n.guid)) || [];
  let childInst = inst;
  if (n.type === 'INSTANCE' && n.symbolData?.symbolID) {
    const master = G.nodes.get(gid(n.symbolData.symbolID));
    children = master ? G.kids.get(gid(master.guid)) || [] : [];
    const base = inst ? key : [];
    const overrides = new Map(inst ? inst.overrides : []);
    const derived = new Map(inst ? inst.derived : []);
    const pathKey = (g) => [...base, ...g.guids.map(gid)].join('/');
    for (const ov of n.symbolData.symbolOverrides || []) {
      if (!ov.guidPath) continue;
      const { guidPath, ...rest } = ov;
      overrides.set(pathKey(guidPath), rest);
    }
    for (const d of n.derivedSymbolData || []) if (d.guidPath) derived.set(pathKey(d.guidPath), d);
    childInst = { path: base, overrides, derived, chain: [...(inst ? inst.chain : []), gid(n.guid)] };
    o.component = { name: master?.name || n.name, mainId: master ? gid(master.guid) : undefined };
    if (!master) ctx.missingMasters++;
  }
  o.children = children.map((c) => build(c, G, abs, origin, ctx, childInst));
  return o;
}

export function framesOf(G, { minWidth = 320 } = {}) {
  // верхнеуровневые фреймы страницы (в том числе внутри секций)
  const out = [];
  const visit = (n, page) => {
    for (const c of G.kids.get(gid(n.guid)) || []) {
      if (c.visible === false) continue;
      if (c.type === 'SECTION') visit(c, page);
      else if ((c.type === 'FRAME' || c.type === 'SYMBOL' || c.type === 'INSTANCE') && (c.size?.x || 0) >= minWidth) out.push({ node: c, page: page.name, parentAbsOf: n });
    }
  };
  G.pages.forEach((p) => visit(p, p));
  return out;
}

function absOf(G, n) {
  let m = n.transform || I;
  let p = n.parentIndex && G.nodes.get(gid(n.parentIndex.guid));
  while (p && p.type !== 'CANVAS') {
    m = mul(p.transform || I, m);
    p = p.parentIndex && G.nodes.get(gid(p.parentIndex.guid));
  }
  return m;
}

// ---------- CLI ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args[0];
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
  const out = get('--out') || 'out-package';
  const pick = all('--frame');
  const refs = Object.fromEntries(all('--reference').map((s) => s.split('=')));
  const minWidth = parseFloat(get('--min-width') || '320');

  const { message, images, meta } = loadFig(file);
  const G = convert(message);
  let frames = framesOf(G, { minWidth });
  if (pick.length) frames = frames.filter((f) => pick.includes(f.node.name));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'frames'), { recursive: true });

  const ctx = { images: new Set(), count: 0, vectors: 0, placeholders: 0, svgs: new Map(), missingMasters: 0 };
  const manifestFrames = [];
  const used = new Set();
  for (const f of frames) {
    const abs = absOf(G, f.node);
    const parentAbs = mul(abs, { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });
    // build() умножает на transform узла сам — передаём матрицу родителя
    const parent = f.node.parentIndex && G.nodes.get(gid(f.node.parentIndex.guid));
    const pAbs = parent && parent.type !== 'CANVAS' ? absOf(G, parent) : I;
    const tree = build(f.node, G, pAbs, { x: abs.m02, y: abs.m12 }, ctx, null);
    let fid = gid(f.node.guid).replace(/[:;]/g, '_');
    while (used.has(fid)) fid += '_';
    used.add(fid);
    fs.writeFileSync(path.join(out, 'frames', fid + '.json'), JSON.stringify(tree));
    const entry = { id: tree.id, name: tree.name, page: f.page, width: tree.w, height: tree.h, tree: `frames/${fid}.json` };
    const ref = refs[tree.name];
    if (ref) { fs.copyFileSync(ref, path.join(out, 'frames', fid + '.png')); entry.png = `frames/${fid}.png`; }
    manifestFrames.push(entry);
    void parentAbs;
  }
  if (ctx.svgs.size) {
    fs.mkdirSync(path.join(out, 'vectors'), { recursive: true });
    for (const [name, svg] of ctx.svgs) fs.writeFileSync(path.join(out, name), svg);
  }
  if (ctx.images.size) {
    fs.mkdirSync(path.join(out, 'images'), { recursive: true });
    for (const h of ctx.images) if (images[h]) fs.writeFileSync(path.join(out, 'images', h), images[h]);
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
    format: 'ds-package', version: 1, file: meta?.file_name || path.basename(file, '.fig'),
    createdAt: new Date().toISOString(), scale: 1, source: 'fig2package', frames: manifestFrames,
  }, null, 2));
  console.log(`${path.basename(file)}: фреймов ${manifestFrames.length}, слоёв ${ctx.count}, векторов ${ctx.vectors} (без геометрии ${ctx.placeholders}), картинок ${ctx.images.size}` +
    (ctx.missingMasters ? `, инстансов без мастера ${ctx.missingMasters}` : ''));
  manifestFrames.forEach((f) => console.log(`  ${f.page} / ${f.name}: ${f.width}×${f.height}${f.png ? ' (есть эталон)' : ''}`));
}
