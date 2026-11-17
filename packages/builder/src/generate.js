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

// ---------------------------------------------------------------------------------------------
// Дерево элементов: из него получаются HTML, JSX (React) и шаблоны Vue — разметка совпадает до элемента.
// Элемент: { tag, cls, style (строка инлайн-стиля), attrs: [[k, v]], children: [], text, void, inline, id, name, kind }
// ---------------------------------------------------------------------------------------------

function svgImg(node, ctx, box) {
  const b = box || node.svgBox;
  return {
    tag: 'img', void: true, inline: true,
    attrs: [['src', ctx.assetUrl(node.svg)], ['alt', '']],
    style: b ? `position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};max-width:none` : 'display:block;width:100%;height:100%',
  };
}

function textEl(node, ctx) {
  const t = node.text || { characters: '', segments: [] };
  const chars = t.characters || '';
  const segs = t.segments?.length ? t.segments : [{ start: 0, end: chars.length }];
  const spans = segs.map((s) => ({ tag: 'span', cls: ctx.styles.classFor('t', declarations(segmentCss(s, ctx))), text: chars.slice(s.start, s.end), attrs: [], inline: true }));
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[t.align] || 'left';
  const noWrap = t.autoResize === 'WIDTH_AND_HEIGHT';
  const inner = ctx.styles.classFor(
    'text',
    declarations({ display: 'block', width: '100%', 'text-align': align, 'white-space': noWrap ? 'pre' : 'pre-wrap', 'overflow-wrap': 'break-word' }),
  );
  return { tag: 'span', cls: inner, attrs: [], children: spans, inline: true, kind: 'text' };
}

function buildEl(box, place, ctx, inPhrasing = false) {
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

  let kids = [];
  let inlineKids = false;
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
    let content = [];
    if (node.type === 'TEXT') {
      const va = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[node.text?.verticalAlign] || 'flex-start';
      Object.assign(vis, { display: 'flex', 'flex-direction': 'column', 'justify-content': va });
      content = [textEl(node, ctx)];
    } else if (node.svg && node.svgSpace !== 'box') content = [svgImg(node, ctx)];
    const icls = ctx.styles.classFor((node.name || 'layer') + '-shape', declarations(vis));
    kids.push({ tag: childPhrasing ? 'span' : 'div', cls: icls, attrs: [], children: content, inlineChildren: true, kind: 'shape' });
    // SVG, отрисованный Figma уже с поворотом, — по рамке
    if (node.svg && node.svgSpace === 'box') kids.push(svgImg(node, ctx, node.svgBox || { x: 0, y: 0, w: box.rect.w, h: box.rect.h }));
    // дети повёрнутого слоя — со своими матрицами, внутри рамки
    children.forEach((c, i) => kids.push(buildEl(c, places[i], ctx, childPhrasing)));
  } else if (node?.type === 'TEXT' && box.kind === 'node') {
    const va = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[node.text?.verticalAlign] || 'flex-start';
    Object.assign(flow, { display: 'flex', 'flex-direction': 'column', 'justify-content': va });
    kids = [textEl(node, ctx)];
    inlineKids = true;
  } else if (node?.svg && box.kind === 'node') {
    kids = [svgImg(node, ctx)];
    inlineKids = true;
  } else {
    children.forEach((c, i) => kids.push(buildEl(c, places[i], ctx, childPhrasing)));
    for (const a of box.absChildren || []) {
      kids.push(buildEl(a, { position: 'absolute', left: a.rect.x - box.rect.x, top: a.rect.y - box.rect.y }, ctx, childPhrasing));
    }
  }

  const all = { ...baseDecl, ...flow };
  if (tag !== 'div' && !all.display) all.display = 'block'; // span/a/button/h* ведут себя как блок макета
  const decl = declarations(all);
  const base = box.kind === 'mask' ? (sem?.name || node.name) + '-mask' : sem?.name || (node ? node.name : 'group');
  const cls = ctx.styles.classFor(base, decl);
  const attrs = [];
  for (const [k, v] of Object.entries(sem?.attrs || {})) if (tag !== 'div' || k === 'role' || k === 'aria-label') attrs.push([k, v]);
  if (node) attrs.push(['data-figma-id', node.id], ['data-name', node.name]);
  return {
    tag, cls, style: placementStyle(place), attrs, children: kids, inlineChildren: inlineKids,
    id: node?.id, name: sem?.name || (node ? node.name : 'group'), kind: box.kind, component: node?.component || null,
  };
}

/** Сериализация в HTML (то же форматирование, что и раньше: блоки с новой строки, текст — в строку). */
export function htmlOf(el, depth = 1) {
  const pad = '  '.repeat(depth);
  if (el.inline || el.tag === 'img') return inlineHtml(el);
  const attrs = [`class="${el.cls}"`];
  if (el.style) attrs.push(`style="${el.style}"`);
  for (const [k, v] of el.attrs) attrs.push(`${k}="${esc(v)}"`);
  const open = `${pad}<${el.tag} ${attrs.join(' ')}>`;
  const kids = el.children || [];
  if (!kids.length) return `${open}</${el.tag}>`;
  if (el.inlineChildren) return `${open}${kids.map(inlineHtml).join('')}</${el.tag}>`;
  const lines = kids.map((k) => (k.inline || k.tag === 'img' ? `${pad}  ${inlineHtml(k)}` : htmlOf(k, depth + 1)));
  return `${open}\n${lines.join('\n')}\n${pad}</${el.tag}>`;
}

function inlineHtml(el) {
  if (el.tag === 'img') {
    const a = el.attrs.map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    return `<img ${a} style="${el.style}">`;
  }
  if (el.text !== undefined) return `<span class="${el.cls}">${esc(el.text)}</span>`;
  const attrs = [`class="${el.cls}"`];
  if (el.style) attrs.push(`style="${el.style}"`);
  for (const [k, v] of el.attrs || []) attrs.push(`${k}="${esc(v)}"`);
  return `<${el.tag} ${attrs.join(' ')}>${(el.children || []).map(inlineHtml).join('')}</${el.tag}>`;
}

/**
 * Генерирует страницу для одного фрейма.
 * @returns {{ html: string, css: string, stats: object }}
 */
export function generateFrame(tree, { mode = 'flow', absIds = null, tokens, assetUrl, title, extraCss = [], semantic = true, names = null }) {
  const styles = new StyleRegistry();
  const sem = semantic ? analyzeSemantics(tree) : null;
  // имена от ИИ (если включён) — только для безликих слоёв; теги остаются алгоритмическими
  if (sem && names) for (const [id, name] of names) { const e = sem.get(id); if (e) e.name = className(name); }
  const ctx = { styles, tokens, assetUrl, semantic: sem, downgrade: new Set() };
  const root = buildBox(tree, { mode, absIds });
  const rootEl = buildEl(root, null, ctx);
  const body = htmlOf(rootEl, 1);

  // полнота: каждый видимый слой должен попасть в вёрстку (кроме вобранных фонов и содержимого векторов)
  const emitted = new Set();
  (function walkEl(e) { if (e.id) emitted.add(e.id); (e.children || []).forEach(walkEl); })(rootEl);
  const absorbed = new Set();
  (function walkBox(b) { if (b.bg) absorbed.add(b.bg.id); (b.children || []).forEach(walkBox); (b.absChildren || []).forEach(walkBox); })(root);
  const missing = [];
  (function walkTree(n) {
    if (n.visible === false) return;
    if (!emitted.has(n.id) && !absorbed.has(n.id)) missing.push({ id: n.id, name: n.name, type: n.type });
    if (n.type === 'TEXT' || n.svg) return; // их содержимое — в тексте/SVG
    (n.children || []).forEach(walkTree);
  })(tree);
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
  stats.missing = missing;

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
  return { html, css, stats, root: rootEl, rules: styles.rules };
}
