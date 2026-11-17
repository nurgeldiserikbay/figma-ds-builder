// Генерация HTML/CSS из дерева блоков.
import { buildBox, placements, isTransformed } from './layout.js';
import { analyzeSemantics, className, SEMANTIC_RESET } from './semantic.js';
import {
  px, r2, fillsToCss, strokesToCss, effectsToCss, radiusToCss, segmentCss, declarations, mergeShadows,
} from './css.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const slug = (s) => className(s);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 5);
}

/** Реестр классов: одинаковые наборы стилей получают один класс (основа будущих компонентов). */
class StyleRegistry {
  constructor() {
    this.byDecl = new Map();
    this.rules = [];
  }
  classFor(baseName, decl) {
    if (!decl) return null;
    let name = this.byDecl.get(decl);
    if (!name) {
      name = `${slug(baseName)}-${hash(decl)}`;
      this.byDecl.set(decl, name);
      this.rules.push(`.${name} { ${decl} }`);
    }
    return name;
  }
}

function flowCss(box) {
  const { flow, node } = box;
  if (flow === 'abs') return {};
  if (flow === 'col') return { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' };
  if (flow === 'row') return { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-start' };
  // flow === 'figma': переносим Auto Layout
  const L = node.layout;
  const o = { display: 'flex', 'flex-direction': L.mode === 'HORIZONTAL' ? 'row' : 'column' };
  const justify = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' }[L.primaryAlign] || 'flex-start';
  const align = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' }[L.counterAlign] || 'flex-start';
  o['justify-content'] = justify;
  o['align-items'] = align;
  if (L.gap && L.gap !== 'auto' && L.primaryAlign !== 'SPACE_BETWEEN') o.gap = px(L.gap);
  if (L.wrap) {
    o['flex-wrap'] = 'wrap';
    if (L.counterGap) o['row-gap'] = px(L.counterGap);
  }
  const p = L.padding || [0, 0, 0, 0];
  if (p.some(Boolean)) o.padding = p.map(px).join(' ');
  return o;
}

/** Единый gap вместо одинаковых отступов между детьми. */
function collapseGap(flow, places) {
  if ((flow !== 'col' && flow !== 'row') || places.length < 3) return null;
  const key = flow === 'col' ? 'mt' : 'ml';
  const gaps = places.slice(1).map((p) => r2(p[key]));
  if (gaps[0] > 0 && gaps.every((g) => g === gaps[0])) {
    places.slice(1).forEach((p) => (p[key] = 0));
    return gaps[0];
  }
  return null;
}

function placementStyle(p) {
  if (!p) return '';
  if (p.position === 'absolute') return `position: absolute; left: ${px(p.left)}; top: ${px(p.top)};`;
  const s = [];
  if (r2(p.mt)) s.push(`margin-top: ${px(p.mt)};`);
  if (r2(p.ml)) s.push(`margin-left: ${px(p.ml)};`);
  return s.join(' ');
}

function nodeVisualCss(node, ctx) {
  const o = {
    position: 'relative',
    'box-sizing': 'border-box',
    width: px(node.w),
    height: px(node.h),
    'flex-shrink': '0',
  };
  if (!node.svg && node.type !== 'TEXT') Object.assign(o, fillsToCss(node.fills, ctx));
  Object.assign(o, radiusToCss(node));
  if (node.clipsContent) o.overflow = 'hidden';
  if (node.opacity !== undefined && node.opacity < 1) o.opacity = String(r2(node.opacity));
  if (node.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode)) {
    o['mix-blend-mode'] = node.blendMode.toLowerCase().replace(/_/g, '-');
  }
  const strokes = node.svg || node.type === 'TEXT' ? {} : strokesToCss(node, ctx);
  return mergeShadows(o, strokes, effectsToCss(node, ctx));
}

/** Внешний блок повёрнутого слоя: видимая рамка, участвует в раскладке, без оформления. */
function outerCss(rect) {
  return { position: 'relative', 'box-sizing': 'border-box', width: px(rect.w), height: px(rect.h), 'flex-shrink': '0' };
}

/** Маска: обрезка по форме маски (прямоугольник со скруглением, эллипс, SVG). */
function maskCss(m, ctx) {
  const o = { ...outerCss(m), overflow: 'hidden' };
  if (m.type === 'ELLIPSE') o['border-radius'] = '50%';
  else Object.assign(o, radiusToCss(m));
  if (m.svg) {
    const url = `url("${ctx.assetUrl(m.svg)}")`;
    Object.assign(o, { overflow: 'visible', 'mask-image': url, '-webkit-mask-image': url, 'mask-size': '100% 100%', '-webkit-mask-size': '100% 100%', 'mask-repeat': 'no-repeat', '-webkit-mask-repeat': 'no-repeat' });
  }
  return o;
}

function svgImg(node, ctx, box) {
  const b = box || node.svgBox;
  return b
    ? `<img src="${esc(ctx.assetUrl(node.svg))}" alt="" style="position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};max-width:none">`
    : `<img src="${esc(ctx.assetUrl(node.svg))}" alt="" style="display:block;width:100%;height:100%">`;
}

function textHtml(node, ctx) {
  const t = node.text || { characters: '', segments: [] };
  const chars = t.characters || '';
  const segs = t.segments?.length ? t.segments : [{ start: 0, end: chars.length }];
  const spans = segs
    .map((s) => {
      const cls = ctx.styles.classFor('t', declarations(segmentCss(s, ctx)));
      return `<span class="${cls}">${esc(chars.slice(s.start, s.end))}</span>`;
    })
    .join('');
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[t.align] || 'left';
  const noWrap = t.autoResize === 'WIDTH_AND_HEIGHT';
  const inner = ctx.styles.classFor(
    'text',
    declarations({ display: 'block', width: '100%', 'text-align': align, 'white-space': noWrap ? 'pre' : 'pre-wrap', 'overflow-wrap': 'break-word' }),
  );
  return `<span class="${inner}">${spans}</span>`;
}

const PHRASING = new Set(['button', 'a', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']);

function emit(box, place, ctx, depth, inPhrasing = false) {
  const pad = '  '.repeat(depth);
  const node = box.node;
  const sem = node && box.kind === 'node' && ctx.semantic ? ctx.semantic.get(node.id) : null;
  let tag = sem?.tag || 'div';
  if (ctx.downgrade?.has(node?.id)) tag = 'div';
  // внутри button/a/h*/p допустимы только строчные элементы: вложенная кнопка или ссылка
  // заставила бы HTML-парсер закрыть внешнюю и перестроить дерево
  if (inPhrasing) tag = 'span';
  // список, разложенный по рядам через обёртки, остаётся div (li должны быть прямыми детьми ul)
  if (tag === 'ul' && (box.children || []).some((c) => c.kind !== 'node')) {
    tag = 'div';
    (box.children || []).forEach((c) => c.node && ctx.downgrade.add(c.node.id));
  }
  const childPhrasing = inPhrasing || ['button', 'a', 'span'].includes(tag) || /^h[1-6]$|^p$/.test(tag);
  const rotated = node && box.kind === 'node' && isTransformed(node);
  let baseDecl;
  if (box.kind === 'mask') baseDecl = maskCss(node, ctx);
  else if (rotated) baseDecl = outerCss(box.rect);
  else if (node) baseDecl = nodeVisualCss(node, ctx);
  else baseDecl = outerCss(box.rect);

  if (box.bg) {
    // фон, вобранный из нижнего прямоугольника
    const bg = box.bg;
    baseDecl = mergeShadows(baseDecl, fillsToCss(bg.fills, ctx), radiusToCss(bg), strokesToCss(bg, ctx), effectsToCss(bg, ctx));
    if (bg.type === 'ELLIPSE') baseDecl['border-radius'] = '50%';
  }

  const children = box.children || [];
  const places = box.flow === 'figma' ? children.map(() => null) : placements(box);
  const flow = flowCss(box);
  const gap = collapseGap(box.flow, places);
  if (gap) flow.gap = px(gap);

  let inner = '';
  const parts = [];
  if (rotated) {
    // сам слой — внутри рамки, с точной матрицей Figma (поворот, отражение)
    const t = node.transform, size = node.size || { w: node.w, h: node.h };
    const local = { ...node, w: size.w, h: size.h };
    const vis = nodeVisualCss(local, ctx);
    delete vis.transform;
    vis.position = 'absolute';
    vis.left = px(t[0][2] - box.rect.x);
    vis.top = px(t[1][2] - box.rect.y);
    vis.transform = `matrix(${[t[0][0], t[1][0], t[0][1], t[1][1]].map((v) => Math.round(v * 1e5) / 1e5).join(', ')}, 0, 0)`;
    vis['transform-origin'] = '0 0';
    let content = '';
    if (node.type === 'TEXT') {
      const va = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[node.text?.verticalAlign] || 'flex-start';
      Object.assign(vis, { display: 'flex', 'flex-direction': 'column', 'justify-content': va });
      content = textHtml(node, ctx);
    } else if (node.svg && node.svgSpace !== 'box') content = svgImg(node, ctx);
    const icls = ctx.styles.classFor((node.name || 'layer') + '-shape', declarations(vis));
    parts.push(`${pad}  <div class="${icls}">${content}</div>`);
    // SVG, отрисованный Figma уже с поворотом, — по рамке
    if (node.svg && node.svgSpace === 'box') parts.push(`${pad}  ${svgImg(node, ctx, node.svgBox || { x: 0, y: 0, w: box.rect.w, h: box.rect.h })}`);
  } else if (node?.type === 'TEXT' && box.kind === 'node') {
    const va = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[node.text?.verticalAlign] || 'flex-start';
    Object.assign(flow, { display: 'flex', 'flex-direction': 'column', 'justify-content': va });
    inner = textHtml(node, ctx);
  } else if (node?.svg && box.kind === 'node') {
    inner = svgImg(node, ctx);
  }
  if (!inner) {
    children.forEach((c, i) => parts.push(emit(c, places[i], ctx, depth + 1, childPhrasing)));
    for (const a of box.absChildren || []) {
      parts.push(emit(a, { position: 'absolute', left: a.rect.x - box.rect.x, top: a.rect.y - box.rect.y }, ctx, depth + 1, childPhrasing));
    }
    inner = parts.length ? '\n' + parts.join('\n') + '\n' + pad : '';
  }

  const all = { ...baseDecl, ...flow };
  if (tag !== 'div' && !all.display) all.display = 'block'; // span/a/button/h* ведут себя как блок макета
  const decl = declarations(all);
  const base = box.kind === 'mask' ? (sem?.name || node.name) + '-mask' : sem?.name || (node ? node.name : 'group');
  const cls = ctx.styles.classFor(base, decl);
  const attrs = [`class="${cls}"`];
  const st = placementStyle(place);
  if (st) attrs.push(`style="${st}"`);
  for (const [k, v] of Object.entries(sem?.attrs || {})) if (tag !== 'div' || k === 'role' || k === 'aria-label') attrs.push(`${k}="${esc(v)}"`);
  if (node) attrs.push(`data-figma-id="${esc(node.id)}"`, `data-name="${esc(node.name)}"`);
  return `${pad}<${tag} ${attrs.join(' ')}>${inner}</${tag}>`;
}

/**
 * Генерирует страницу для одного фрейма.
 * @returns {{ html: string, css: string, stats: object }}
 */
export function generateFrame(tree, { mode = 'flow', tokens, assetUrl, title, extraCss = [], semantic = true, names = null }) {
  const styles = new StyleRegistry();
  const sem = semantic ? analyzeSemantics(tree) : null;
  // имена от ИИ (если включён) — только для безликих слоёв; теги остаются алгоритмическими
  if (sem && names) for (const [id, name] of names) { const e = sem.get(id); if (e) e.name = className(name); }
  const ctx = { styles, tokens, assetUrl, semantic: sem, downgrade: new Set() };
  const root = buildBox(tree, { mode });
  const body = emit(root, null, ctx, 1);
  const tagStats = {};
  for (const m of body.matchAll(/<(h[1-6]|p|button|a|nav|header|footer|section|ul|li|span) /g)) tagStats[m[1]] = (tagStats[m[1]] || 0) + 1;

  const stats = { nodes: 0, abs: 0, col: 0, row: 0, figma: 0, classes: styles.rules.length };
  (function walk(b) {
    if (b.kind === 'node') stats.nodes++;
    if (b.children?.length) stats[b.flow] = (stats[b.flow] || 0) + 1;
    (b.children || []).forEach(walk);
    (b.absChildren || []).forEach(walk);
  })(root);
  stats.classes = styles.rules.length;
  stats.tags = tagStats;

  const css = [
    '/* Сгенерировано figma-ds-builder. Слой токенов — tokens.css */',
    '*, *::before, *::after { margin: 0; padding: 0; }',
    'html, body { margin: 0; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }',
    ...(semantic ? [SEMANTIC_RESET] : []),
    ...styles.rules,
    '',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || tree.name)}</title>
${extraCss.map((c) => `<link rel="stylesheet" href="../${c}">\n`).join('')}<link rel="stylesheet" href="../tokens.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
</body>
</html>
`;
  return { html, css, stats };
}
