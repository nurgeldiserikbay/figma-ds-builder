// Генерация HTML/CSS из дерева блоков.
import { buildBox, placements } from './layout.js';
import {
  px, r2, fillsToCss, strokesToCss, effectsToCss, radiusToCss, segmentCss, declarations, mergeShadows,
} from './css.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function slug(s) {
  const t = String(s || 'node')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return /^[a-z]/.test(t) ? t : 'n-' + (t || 'node');
}

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
  if (node.rotation) o.transform = `rotate(${r2(-node.rotation)}deg)`;
  const strokes = node.svg || node.type === 'TEXT' ? {} : strokesToCss(node, ctx);
  return mergeShadows(o, strokes, effectsToCss(node, ctx));
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

function emit(box, place, ctx, depth) {
  const pad = '  '.repeat(depth);
  const node = box.node;
  let baseDecl = node ? nodeVisualCss(node, ctx) : {
    position: 'relative', 'box-sizing': 'border-box', width: px(box.rect.w), height: px(box.rect.h), 'flex-shrink': '0',
  };

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
  if (node?.type === 'TEXT') {
    const va = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[node.text?.verticalAlign] || 'flex-start';
    Object.assign(flow, { display: 'flex', 'flex-direction': 'column', 'justify-content': va });
    inner = textHtml(node, ctx);
  } else if (node?.svg) {
    inner = `<img src="${esc(ctx.assetUrl(node.svg))}" alt="" style="display:block;width:100%;height:100%">`;
  } else {
    const parts = children.map((c, i) => emit(c, places[i], ctx, depth + 1));
    for (const a of box.absChildren || []) {
      parts.push(emit(a, { position: 'absolute', left: a.rect.x - box.rect.x, top: a.rect.y - box.rect.y }, ctx, depth + 1));
    }
    inner = parts.length ? '\n' + parts.join('\n') + '\n' + pad : '';
  }

  // Ячейки внутри Auto Layout с FILL: растягиваем по главной оси
  const decl = declarations({ ...baseDecl, ...flow });
  const cls = ctx.styles.classFor(node ? node.name : 'group', decl);
  const attrs = [`class="${cls}"`];
  const st = placementStyle(place);
  if (st) attrs.push(`style="${st}"`);
  if (node) attrs.push(`data-figma-id="${esc(node.id)}"`, `data-name="${esc(node.name)}"`);
  return `${pad}<div ${attrs.join(' ')}>${inner}</div>`;
}

/**
 * Генерирует страницу для одного фрейма.
 * @returns {{ html: string, css: string, stats: object }}
 */
export function generateFrame(tree, { mode = 'flow', tokens, assetUrl, title }) {
  const styles = new StyleRegistry();
  const ctx = { styles, tokens, assetUrl };
  const root = buildBox(tree, { mode });
  const body = emit(root, null, ctx, 1);

  const stats = { nodes: 0, abs: 0, col: 0, row: 0, figma: 0, classes: styles.rules.length };
  (function walk(b) {
    if (b.kind === 'node') stats.nodes++;
    if (b.children?.length) stats[b.flow] = (stats[b.flow] || 0) + 1;
    (b.children || []).forEach(walk);
    (b.absChildren || []).forEach(walk);
  })(root);
  stats.classes = styles.rules.length;

  const css = [
    '/* Сгенерировано figma-ds-builder. Слой токенов — tokens.css */',
    '*, *::before, *::after { margin: 0; padding: 0; }',
    'html, body { margin: 0; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }',
    ...styles.rules,
    '',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || tree.name)}</title>
<link rel="stylesheet" href="../tokens.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
</body>
</html>
`;
  return { html, css, stats };
}
