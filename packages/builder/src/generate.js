// Генерация HTML/CSS из дерева блоков.
import { buildBox, placements, isTransformed } from './layout.js';
import { analyzeSemantics, className, SEMANTIC_RESET } from './semantic.js';
import {
  px, r2, fillsToCss, strokesToCss, effectsToCss, radiusToCss, segmentCss, declarations, mergeShadows, colorValue,
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

/** Цвет из атрибута SVG → {r,g,b,a} (0..1) или null. */
function parseSvgColor(v) {
  v = String(v).trim().toLowerCase();
  let m;
  if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v))) {
    return { r: parseInt(m[1].slice(0, 2), 16) / 255, g: parseInt(m[1].slice(2, 4), 16) / 255, b: parseInt(m[1].slice(4, 6), 16) / 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  if ((m = /^#([0-9a-f]{3})$/.exec(v))) { const [r, g, b] = [...m[1]].map((h) => parseInt(h + h, 16) / 255); return { r, g, b, a: 1 }; }
  if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v))) {
    return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] !== undefined ? +m[4] : 1 };
  }
  return null;
}

/**
 * SVG для вставки в страницу: на всю рамку элемента, id с префиксом (несколько иконок на странице не путаются
 * градиентами), цвета, совпавшие с токенами, — через var(--color-…) (иконку можно перекрасить из CSS).
 * null — если SVG лучше оставить файлом (большой, картинки, свои стили, скрипты).
 */
export function inlineSvg(text, prefix, ctx) {
  if (!text || text.length > 16384 || !/^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(text)) return null;
  if (/<(image|script|foreignObject|style|text)\b|\bon[a-z]+\s*=/i.test(text)) return null;
  let s = text.replace(/^\s*<\?xml[^>]*>\s*/i, '').trim();
  const pre = `s${String(prefix).replace(/[^a-zA-Z0-9]/g, '_')}-`;
  s = s.replace(/\bid="([^"]+)"/g, (_, id) => `id="${pre}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${pre}${id})`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, (_, k, id) => `${k}="#${pre}${id}"`);
  // цвета → токены (в атрибуте var() не работает, поэтому — в style элемента)
  s = s.replace(/<([a-zA-Z]+)\b([^>]*?)(\/?)>/g, (tag, name, attrs, close) => {
    if (/\bstyle=/.test(attrs)) return tag;
    const st = [];
    for (const k of ['fill', 'stroke']) {
      const m = new RegExp(`\\b${k}="([^"]+)"`).exec(attrs);
      const c = m && parseSvgColor(m[1]);
      if (!c) continue;
      const v = colorValue(c, 1, ctx);
      if (v.startsWith('var(')) st.push(`${k}:${v}`);
    }
    return st.length ? `<${name}${attrs} style="${st.join(';')}"${close}>` : tag;
  });
  // корень — на всю рамку элемента
  s = s.replace(/^<svg\b/, '<svg style="display:block;width:100%;height:100%" aria-hidden="true" focusable="false"');
  return s;
}

function svgImg(node, ctx, box) {
  const b = box || node.svgBox;
  const place = b ? `position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)}` : 'display:block;width:100%;height:100%';
  // небольшой SVG — прямо в страницу (рисуется так же, как картинка, но правится в коде и берёт цвета из токенов)
  const html = ctx.inlineSvg !== false && ctx.svgText ? inlineSvg(ctx.svgText(node.svg), node.id, ctx) : null;
  if (html) return { tag: 'span', inline: true, cls: ctx.styles.classFor('icon', declarations({ display: 'block' })), attrs: [], children: [], html, style: place };
  return {
    tag: 'img', void: true, inline: true,
    attrs: [['src', ctx.assetUrl(node.svg)], ['alt', '']],
    style: b ? `position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};max-width:none` : 'display:block;width:100%;height:100%',
  };
}

function textEl(node, ctx) {
  const t = node.text || { characters: '', segments: [] };
  const chars = t.characters || '';
  // пустой текст: у Figma нет сегментов — берём шрифт самого слоя (иначе font-family "undefined")
  const segs = t.segments?.length ? t.segments : [{ start: 0, end: chars.length, ...(t.style || {}) }];
  const spans = segs.map((s) => ({ tag: 'span', cls: ctx.styles.classFor('t', declarations(segmentCss(s, ctx))), text: chars.slice(s.start, s.end), attrs: [], inline: true }));
  // «стойка» строки — шрифт и интерлиньяж первого сегмента: иначе блок берёт их от body (16px, normal),
  // и строка с интерлиньяжем меньше ~18px становится выше, а текст сдвигается вниз на 2–3px
  const first = segmentCss(segs[0], ctx);
  const strut = first['font-size'] && !/NaN/.test(first['font-size'])
    ? { 'font-family': first['font-family'], 'font-size': first['font-size'], 'line-height': first['line-height'] } : {};
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[t.align] || 'left';
  const noWrap = t.autoResize === 'WIDTH_AND_HEIGHT';
  const inner = ctx.styles.classFor(
    'text',
    declarations({ display: 'block', width: '100%', 'text-align': align, 'white-space': noWrap ? 'pre' : 'pre-wrap', 'overflow-wrap': 'break-word', ...strut }),
  );
  return { tag: 'span', cls: inner, attrs: [], children: spans, inline: true, kind: 'text' };
}

// ---------------------------------------------------------------------------------------------
// «Резиновая» вёрстка между брейкпоинтами (ctx.fluid): контейнер шире макета → дети ведут себя по
// constraints Figma (MIN/CENTER/MAX/STRETCH/SCALE), а в Auto Layout — по Fill. Нет данных — по геометрии.
// Все правки построены так, что на ширине макета раскладка совпадает с исходной до пикселя
// (это проверяется рендером): margin:auto и flex-grow делят нулевой остаток.
// ---------------------------------------------------------------------------------------------

/** Как ребёнок держится по горизонтали, когда родитель шире макета. */
export function anchorOf(c, parentRect, parentNode) {
  const r = c.rect, n = c.node;
  const lg = r.x - parentRect.x, rg = parentRect.x + parentRect.w - (r.x + r.w);
  const hasImage = (n?.fills || []).some((f) => f.type === 'IMAGE' && f.visible !== false);
  // тянуть можно контейнеры, прямоугольники-фоны и линии, текст (перенос строк); не картинки, векторы и повёрнутое
  const canStretch = c.kind === 'wrap' || (!!n && !n.svg && !hasImage && !isTransformed(n));
  // на всю ширину родителя (фон секции, шапка) — тянется при любых constraints: по центру или слева
  // такой блок оставил бы пустую полосу сбоку
  if (canStretch && Math.abs(lg) <= 0.5 && Math.abs(rg) <= 0.5 && n?.type !== 'TEXT') return 'STRETCH';
  // MIN — значение по умолчанию в Figma, почти никто его не меняет: это «нет данных», решает геометрия
  const k = n?.constraints?.h && n.constraints.h !== 'MIN' ? n.constraints.h : null;
  if (k && parentNode && !(parentNode.layout && parentNode.layout.mode !== 'NONE' && n.layoutPositioning !== 'ABSOLUTE')) {
    if ((k === 'STRETCH' || k === 'SCALE') && canStretch) return 'STRETCH';
    if (k === 'STRETCH' || k === 'SCALE') return Math.abs(lg - rg) <= 1 ? 'CENTER' : 'MIN';
    return k; // MIN | CENTER | MAX
  }
  // по геометрии: поля по краям маленькие (≤32px или ≤8% ширины) и блок широкий — тянется (мобильная
  // вёрстка «на всю ширину с отступами»); широкие поля по центру — контейнер фиксированной ширины
  const small = (g) => g <= Math.max(32, parentRect.w * 0.08);
  const wide = r.w >= parentRect.w * 0.6;
  if (canStretch && wide && small(Math.max(lg, 0)) && small(Math.max(rg, 0)) && (n?.type !== 'TEXT' || Math.abs(lg - rg) <= 1 || lg <= rg)) return 'STRETCH';
  if (Math.abs(lg - rg) <= 1) return 'CENTER';
  if (rg < lg && rg <= parentRect.w * 0.25) return 'MAX';
  return 'MIN';
}

/** Инлайн-правки для ребёнка растущего контейнера; возвращает { style, grow }. */
function fluidChild(parent, child, index, places, kids) {
  const pr = parent.rect, r = child.rect;
  const lg = r.x - pr.x, rg = pr.x + pr.w - (r.x + r.w);
  const n = child.node;
  if (parent.flow === 'figma') {
    const L = parent.node.layout;
    const fill = n?.sizing?.h === 'FILL';
    if (L.mode === 'HORIZONTAL') return fill ? { style: 'flex-grow: 1;', grow: true } : { style: '', grow: false };
    // вертикальный Auto Layout: по горизонтали — поперечная ось
    // Fill — тянется; Fixed во всю ширину содержимого (типичная секция в вертикальном Auto Layout) — тоже
    const cx = pr.x + (L.padding?.[3] || 0), cw = pr.w - (L.padding?.[1] || 0) - (L.padding?.[3] || 0);
    const full = Math.abs(r.x - cx) <= 0.5 && Math.abs(r.x + r.w - (cx + cw)) <= 0.5;
    if (fill || (full && n?.type !== 'TEXT' && anchorOf(child, { x: cx, w: cw }, null) === 'STRETCH')) {
      return { style: 'align-self: stretch; width: auto;', grow: true };
    }
    return { style: '', grow: false };
  }
  const a = anchorOf(child, pr, parent.node);
  if (parent.flow === 'abs') {
    if (a === 'CENTER') return { style: `left: calc(50% - ${px(pr.w / 2 - lg)});`, grow: false };
    if (a === 'MAX') return { style: `left: auto; right: ${px(rg)};`, grow: false };
    if (a === 'STRETCH') return { style: `right: ${px(rg)}; width: auto;`, grow: true };
    return { style: '', grow: false };
  }
  if (parent.flow === 'col') {
    // через проценты, а не margin:auto — так работает и для блока шире родителя (auto не бывает отрицательным)
    if (a === 'CENTER') return { style: `margin-left: calc(50% - ${px(pr.w / 2 - lg)});`, grow: false };
    if (a === 'MAX') return { style: `margin-left: calc(100% - ${px(pr.w - lg)});`, grow: false };
    if (a === 'STRETCH') return { style: `align-self: stretch; width: auto; margin-right: ${px(rg)};`, grow: true };
    return { style: '', grow: false };
  }
  if (parent.flow === 'row') {
    // строка: свободное место уходит в самый большой промежуток (логотип слева — меню справа)
    const gaps = kids.map((k, i) => (i === 0 ? -1 : k.rect.x - (kids[i - 1].rect.x + kids[i - 1].rect.w)));
    const sorted = gaps.slice(1).sort((a, b) => b - a);
    // явный разрыв: самый большой промежуток заметно больше остальных (иначе это ровный ряд карточек)
    const big = sorted[0] >= 24 && (sorted.length === 1 || sorted[0] >= sorted[1] * 2 + 8) ? sorted[0] : -1;
    const at = gaps.indexOf(big);
    const firstL = kids[0].rect.x - pr.x, last = kids[kids.length - 1], lastR = pr.x + pr.w - (last.rect.x + last.rect.w);
    let style = '';
    if (big > 0) {
      if (index === at) style = 'margin-left: auto;';
      if (index === kids.length - 1) style += ` margin-right: ${px(lastR)};`;
    } else if (Math.abs(firstL - lastR) <= 1) {
      // ряд по центру
      if (index === 0) style = 'margin-left: auto;';
      if (index === kids.length - 1) style += ' margin-right: auto;';
    } else if (lastR < firstL && lastR <= pr.w * 0.25) {
      if (index === 0) style = 'margin-left: auto;';
      if (index === kids.length - 1) style += ` margin-right: ${px(lastR)};`;
    }
    return { style: style.trim(), grow: false };
  }
  return { style: '', grow: false };
}

function buildEl(box, place, ctx, inPhrasing = false, grow = false) {
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
    const fluid = ctx.fluid && grow && !box.pinned && !(node && ctx.fluidSkip?.has(node.id));
    children.forEach((c, i) => {
      const f = fluid ? fluidChild(box, c, i, places, children) : { style: '', grow: false };
      const el = buildEl(c, places[i], ctx, childPhrasing, f.grow);
      if (f.style) el.style = `${el.style ? el.style + ' ' : ''}${f.style}`;
      kids.push(el);
    });
    for (const a of box.absChildren || []) {
      const f = fluid ? fluidChild({ ...box, flow: 'abs' }, a, 0, [], [a]) : { style: '', grow: false };
      const el = buildEl(a, { position: 'absolute', left: a.rect.x - box.rect.x, top: a.rect.y - box.rect.y }, ctx, childPhrasing, f.grow);
      if (f.style) el.style = `${el.style} ${f.style}`;
      kids.push(el);
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
  if (el.html !== undefined) {
    const attrs = [`class="${el.cls}"`];
    if (el.style) attrs.push(`style="${el.style}"`);
    for (const [k, v] of el.attrs || []) attrs.push(`${k}="${esc(v)}"`);
    return `<span ${attrs.join(' ')}>${el.html}</span>`;
  }
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
export function generateFrame(tree, { mode = 'flow', absIds = null, fluid = false, fluidSkip = null, svgText = null, inlineSvg: inlineSvgOpt = true, tokens, assetUrl, title, extraCss = [], semantic = true, names = null }) {
  const styles = new StyleRegistry();
  const sem = semantic ? analyzeSemantics(tree) : null;
  // имена от ИИ (если включён) — только для безликих слоёв; теги остаются алгоритмическими
  if (sem && names) for (const [id, name] of names) { const e = sem.get(id); if (e) e.name = className(name); }
  const ctx = { styles, tokens, assetUrl, semantic: sem, downgrade: new Set(), fluid, fluidSkip, svgText, inlineSvg: inlineSvgOpt };
  const root = buildBox(tree, { mode, absIds });
  const rootEl = buildEl(root, null, ctx, false, fluid);
  // не уже макета: ниже его ширины страница уменьшается целиком (zoom), а не сжимается
  if (fluid) rootEl.style = `${rootEl.style ? rootEl.style + ' ' : ''}width: 100%; min-width: ${px(tree.w)};`;
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
