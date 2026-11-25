// Экспорт в React и Vue из того же дерева элементов, что и HTML: разметка совпадает до элемента.
// Компоненты — из components.js. Проверка: страницы рендерятся на сервере (React SSR, Vue SSR)
// и сравниваются с уже проверенной HTML-версией — пиксели и геометрия.
import { SCROLLBAR_JS } from './scrollbars.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pascal } from './components.js';
import { responsiveCss } from './responsive.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const ASSET_PREFIX = '../assets/';
const camelCss = (k) => k.trim().replace(/^-(webkit|moz|ms)-/, (m, v) => v[0].toUpperCase() + v.slice(1) + '-').replace(/-([a-z])/g, (m, c) => c.toUpperCase());

function styleEntries(str) {
  return (str || '').split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return [camelCss(d.slice(0, i)), d.slice(i + 1).trim()];
  });
}
const styleObjJs = (str) => `{ ${styleEntries(str).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }`;
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const jsStr = (s) => JSON.stringify(s).replace(/</g, '\\u003c');
const assetRel = (src) => (src.startsWith(ASSET_PREFIX) ? src.slice(ASSET_PREFIX.length) : null);

function pathKey(p) { return p.join('.'); }

/**
 * Векторы (inline SVG) — в одном модуле icons.js, одинаковые один раз; в коде страниц — icons.имя.
 * Агенту не нужно читать килобайты путей SVG, чтобы понять страницу.
 */
function iconRegistry() {
  const byText = new Map();
  const used = new Set();
  return {
    ref(svg, hint) {
      if (!byText.has(svg)) {
        let base = String(hint || 'icon').replace(/-[a-z0-9]{4,6}$/, '').replace(/[^a-zA-Z0-9]+(.)?/g, (m, ch) => (ch ? ch.toUpperCase() : '')).replace(/^[^a-zA-Z]+/, '');
        base = base ? base[0].toLowerCase() + base.slice(1) : 'icon';
        let n = base, k = 2;
        while (used.has(n)) n = `${base}${k++}`;
        used.add(n);
        byText.set(svg, n);
      }
      return byText.get(svg);
    },
    get size() { return byText.size; },
    object() { return Object.fromEntries([...byText].map(([t, n]) => [n, t])); },
    module() {
      return `// Векторы из макета (SVG). Страницы и компоненты ссылаются на них как icons.имя.\n// Файл большой: читать целиком не нужно — заменить иконку можно, поправив одну строку.\nexport const icons = {\n${[...byText].map(([t, n]) => `  ${n}: ${jsStr(t)},`).join('\n')}\n};\n`;
    },
  };
}

/**
 * Какие слои Figma нужны отдаваемому коду: только те, на которые ссылается CSS поправок ([data-figma-id="…"]).
 * Остальные data-figma-id и все data-name — служебные, в коде проекта они только тратят токены.
 */
export function keptIds(css) {
  return new Set([...css.matchAll(/\[data-figma-id="([^"]+)"\]/g)].map((m) => m[1]));
}
const shipCss = (css) => css.replace(/\[data-figma-id\] > span:has\(/g, 'span:has(').replace(/\[data-figma-id\] > \./g, '.');

function propMap(comp) {
  const m = new Map();
  for (const pr of comp.props) {
    if (!m.has(pr.path)) m.set(pr.path, {});
    m.get(pr.path)[pr.kind] = pr.name;
  }
  return m;
}

/** Параметры вариантов и атрибутов состояния у места шаблона (path). */
function variantAt(c, pk) {
  if (c.mode !== 'comp' || !c.comp) return null;
  const v = c.comp.props.filter((p) => p.kind === 'vprop' && p.path === pk);
  const a = c.comp.props.filter((p) => p.kind === 'attr' && p.path === pk);
  const extra = c.comp.props.find((p) => p.kind === 'cls' && p.path === pk && p.extraOf !== undefined);
  if (!v.length && !a.length) return null;
  // атрибут → имя параметра; такие атрибуты шаблона не пишем как есть
  const attrs = [...a.map((p) => [p.attr, p.name, p.plain]), ...v.flatMap((p) => (p.attrs || []).map((x) => [x, p.name]))];
  return { v, attrs, extra, skip: new Set(attrs.map(([x]) => x)) };
}
const q1 = (x) => `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const mapJs = (m) => `({ ${Object.entries(m).map(([k, c]) => `${/^[a-z_$][\w$]*$/i.test(k) ? k : q1(k)}: ${q1(c)}`).join(', ')} })`;
/** Класс корня из параметров вариантов: ['button', ({ secondary: 'button--secondary' })[variant], …].join(' '). */
function variantClassJs(va) {
  const parts = [q1(va.v[0].base), ...va.v.map((p) => `${mapJs(p.map)}[${p.bool ? `String(${p.name})` : p.name}]`)];
  if (va.extra) parts.push(va.extra.name);
  return `[${parts.join(', ')}].filter(Boolean).join(' ')`;
}
function reactAttrJs(a, name, plain) {
  if (plain) return `${JSX_NAMES[a] || a}={${name}}`;
  if (a === 'aria-current') return `aria-current={${name} ? 'page' : undefined}`;
  return `${a}={${name}}`;
}
function vueAttrJs(a, name, plain) {
  if (plain) return `:${a}="${name}"`;
  if (a === 'aria-current') return `:aria-current="${name} ? 'page' : undefined"`;
  if (a === 'disabled') return `:disabled="${name}"`;
  // Vue убирает атрибут со значением false — aria-* нужен строкой «false»
  return `:${a}="${name} === undefined ? undefined : String(${name})"`;
}

/** Значение параметра в месте использования (React — JS-выражение). */
function reactPropValue(kind, v) {
  if (typeof v === 'boolean') return String(v);
  if (kind === 'style') return styleObjJs(v);
  if (kind === 'src') { const rel = assetRel(v || ''); return rel ? `asset(${jsStr(rel)})` : jsStr(v || ''); }
  return jsStr(v ?? '');
}
/** Vue — выражение для :prop. */
function vuePropValue(kind, v) {
  if (typeof v === 'boolean') return String(v);
  if (kind === 'src') { const rel = assetRel(v || ''); return rel ? `asset(${jsStr(rel)})` : jsStr(v || ''); }
  return jsStr(v ?? '');
}

/** c.keep = null — проверка (все метки слоёв); Set — отдаваемый код (только нужные CSS поправок). */
function keepAttr(k, v, pk, c) {
  if (!c.keep) return true;
  if (k === 'data-name' || k === 'data-component' || k === 'data-variant') return false;
  if (k !== 'data-figma-id') return true;
  return c.mode === 'comp' ? c.keepIdx.has(c.idIndex.get(pk)) : c.keep.has(v);
}
/** Индексы слоёв компонента, нужные хотя бы одному его экземпляру. */
function keepIdxOf(comp, keep, instanceOf) {
  if (!keep) return new Set(comp.idPaths.map((p, i) => i));
  const out = new Set();
  for (const el of comp.instances || []) {
    const ids = instanceOf?.get(el)?.ids || [];
    ids.forEach((id, i) => { if (keep.has(id)) out.add(i); });
  }
  return out;
}
function idsFor(inst, keep) {
  if (!keep) return inst.ids;
  if (!inst.ids.some((id) => keep.has(id))) return null;
  return inst.ids.map((id) => (keep.has(id) ? id : null));
}
const dataName = (el) => (el.attrs || []).find(([k]) => k === 'data-name')?.[1];
/** Значение html-параметра компонента: ссылка на icons.js. */
function htmlProp(v, c, hint) {
  c.usesIcons = true;
  return `icons.${c.icons.ref(v ?? '', hint)}`;
}

// ---------------------------------------------------------------------------------------------
// React (JSX)
// ---------------------------------------------------------------------------------------------

/** Атрибут JSX: в строке "…" JSX не понимает экранирования — кавычки и \\ только через {"…"}. */
// имена атрибутов в JSX; значение поля — defaultValue (value без onChange React считает ошибкой)
const JSX_NAMES = { for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', autocomplete: 'autoComplete', value: 'defaultValue' };
const jsxAttr = (k0, v) => { const k = JSX_NAMES[k0] || k0; return /["\\\n{}<>&]/.test(String(v)) ? `${k}={${jsStr(v)}}` : `${k}="${v}"`; };

/**
 * Действие ссылки из прототипа в React/Vue: окно (Open overlay → <dialog> поверх страницы), «Назад»/«Закрыть»
 * (javascript:-ссылки React блокирует — вместо них обработчик нажатия). null — обычная ссылка.
 */
function linkAction(el) {
  const href = (el.attrs || []).find(([k]) => k === 'href')?.[1];
  if (!href) return null;
  if (/^javascript:/i.test(href)) return { back: true };
  if ((el.attrs || []).some(([k, v]) => k === 'aria-haspopup' && v === 'dialog') && /^#[\w-]+$/.test(href)) return { open: href.slice(1) };
  return null;
}
const OVERLAY_JS = `// Окна из прототипа Figma (Open overlay): страница окна открывается в <dialog> поверх текущей (App).
export function openOverlay(route) {
  dispatchEvent(new CustomEvent('ds-overlay', { detail: route }));
}

// «Закрыть» и «Назад» из прототипа: внутри окна — закрыть его, иначе — шаг назад по истории.
export function closeOrBack(e) {
  const d = e.currentTarget.closest('dialog');
  if (d) d.close();
  else history.back();
}
`;
const OVERLAY_CSS = `
/* окна из прототипа (Open overlay) */
.ds-overlay { padding: 0; border: 0; background: transparent; max-width: 100vw; max-height: 100vh; overflow: auto; }
.ds-overlay::backdrop { background: rgba(0, 0, 0, 0.45); }
`;
/** Есть ли в страницах окна или «назад» — тогда в проект идёт overlay.js. */
function usesOverlays(pages) {
  let any = false;
  const walk = (el) => { if (any || !el) return; if (linkAction(el)) any = true; (el.children || []).forEach(walk); };
  pages.forEach((p) => walk(p.root));
  return any;
}

/** Параметр выбора компонента (Selected=true/false или aria-selected): по нему вкладки переключаются нажатием. */
const selectProp = (comp) => comp.props.find((p) => p.name === 'selected' && ((p.kind === 'vprop' && p.bool) || (p.kind === 'attr' && !p.plain)));

/**
 * Группы выбора на странице: соседние копии одного компонента с параметром selected, выбрана ровно одна
 * (вкладки, сегменты, фильтры). Нажатие выбирает копию — состояние страницы, а не только картинка.
 * @returns Map копия → { group: номер, index, prop }
 */
function selectGroups(root, instanceOf) {
  const out = new Map();
  let n = 0;
  (function walk(el) {
    const kids = el.children || [];
    const insts = kids.filter((k) => instanceOf.has(k));
    const comp = insts[0] && instanceOf.get(insts[0]).comp;
    const sp = comp && selectProp(comp);
    if (sp && insts.length >= 2 && insts.every((k) => instanceOf.get(k).comp === comp)
      && insts.filter((k) => instanceOf.get(k).values[sp.name] === true).length === 1) {
      n++;
      insts.forEach((k, i) => out.set(k, { group: n, index: i, prop: sp.name, initial: insts.findIndex((x) => instanceOf.get(x).values[sp.name] === true) }));
    }
    kids.forEach(walk);
  })(root);
  return out;
}

/** Параметр «показать/скрыть» у места шаблона компонента. */
const showAt = (c, pk) => (c.mode === 'comp' && c.comp ? c.comp.props.find((pr) => pr.kind === 'show' && pr.path === pk) : null);

function jsx(el, c, depth, p = [], noShow = false) {
  const pad = '  '.repeat(depth);
  const pk = pathKey(p);
  if (el.kind === 'opt') return null; // слой скрыт свойством компонента — не выводится
  const sh = !noShow && showAt(c, pk);
  if (sh) return `${pad}{${sh.name} && (\n${jsx(el, c, depth + 1, p, true)}\n${pad})}`;
  if (c.mode === 'page' && c.instanceOf.has(el)) {
    const inst = c.instanceOf.get(el);
    c.used.add(inst.comp.name);
    const sel = c.select?.get(el);
    const props = inst.comp.props.filter((pr) => inst.values[pr.name] !== undefined && (!(['vprop', 'attr'].includes(pr.kind) || pr.extraOf !== undefined) || inst.values[pr.name] !== '')).map((pr) => {
      if (sel && pr.name === sel.prop) return `${pr.name}={selected${sel.group} === ${sel.index}}`;
      if (pr.kind === 'src' && assetRel(inst.values[pr.name] || '')) c.usesAsset = true;
      if (pr.kind === 'html') return `${pr.name}={${htmlProp(inst.values[pr.name], c, pr.name)}}`;
      if (pr.kind === 'vprop' && !pr.bool) return `${pr.name}="${inst.values[pr.name]}"`;
      return `${pr.name}={${reactPropValue(pr.kind, inst.values[pr.name])}}`;
    });
    if (sel) props.push(`onClick={() => setSelected${sel.group}(${sel.index})}`);
    const ids = idsFor(inst, c.keep);
    if (ids) props.push(`ids={${JSON.stringify(ids)}}`);
    if (el.style) props.push(`style={${styleObjJs(el.style)}}`);
    return `${pad}<${inst.comp.name} ${props.join(' ')} />`;
  }
  const pp = c.propAt?.get(pk) || {};
  if (el.text !== undefined) {
    // ссылка в тексте — <a href>, остальное — span
    const t = el.tag || 'span';
    const vt = variantAt(c, pk);
    const extra = (el.attrs || []).filter(([k]) => !k.startsWith('data-') && !vt?.skip.has(k)).map(([k, v]) => ` ${jsxAttr(k, v)}`).join('')
      + (vt ? vt.attrs.map(([a, name, plain]) => ` ${reactAttrJs(a, name, plain)}`).join('') : '');
    return `${pad}<${t} className=${pp.cls ? `{${pp.cls}}` : `"${el.cls}"`}${extra}>{${pp.text || jsStr(el.text)}}</${t}>`;
  }
  const attrs = [];
  const va = variantAt(c, pk);
  if (va?.v.length) attrs.push(`className={${variantClassJs(va)}}`);
  else if (pp.cls) attrs.push(`className={${pp.cls}}`);
  else if (el.cls) attrs.push(`className="${el.cls}"`);
  if (va) for (const [a, name, plain] of va.attrs) attrs.push(reactAttrJs(a, name, plain));
  if (el.html !== undefined) {
    attrs.push(pp.style ? `style={${pp.style}}` : `style={${styleObjJs(el.style)}}`);
    c.usesIcons ||= !pp.html;
    attrs.push(`dangerouslySetInnerHTML={{ __html: ${pp.html || `icons.${c.icons.ref(el.html, c.hint || el.cls)}`} }}`);
    return `${pad}<span ${attrs.join(' ')} />`;
  }
  if (el.tag === 'img') {
    const src = el.attrs.find(([k]) => k === 'src')[1];
    const rel = assetRel(src);
    if (pp.src) attrs.unshift(`src={${pp.src}}`);
    else { c.usesAsset ||= !!rel; attrs.unshift(rel ? `src={asset(${jsStr(rel)})}` : `src=${jsStr(src)}`); }
    attrs.push('alt=""');
    attrs.push(pp.style ? `style={${pp.style}}` : `style={${styleObjJs(el.style)}}`);
    return `${pad}<img ${attrs.join(' ')} />`;
  }
  const isRoot = p.length === 0;
  if (c.mode === 'comp' && isRoot) attrs.push('style={style}');
  else if (pp.style) attrs.push(`style={${pp.style}}`);
  else if (el.style) attrs.push(`style={${styleObjJs(el.style)}}`);
  if (c.mode === 'comp' && isRoot && selectProp(c.comp)) attrs.push('onClick={onClick}'); // выбор во вкладках — нажатием
  const act = linkAction(el);
  for (const [k, v] of el.attrs || []) {
    if (!keepAttr(k, v, pk, c) || va?.skip.has(k)) continue;
    if (k === 'data-figma-id' && c.mode === 'comp') attrs.push(`data-figma-id={ids?.[${c.idIndex.get(pk)}]}`);
    else if (k === 'href' && act?.back) attrs.push('href="#"');
    else attrs.push(jsxAttr(k, v));
  }
  if (act) {
    c.usesOverlay = true;
    attrs.push(act.back ? 'onClick={(e) => { e.preventDefault(); closeOrBack(e); }}' : `onClick={(e) => { e.preventDefault(); openOverlay('${act.open}'); }}`);
  }
  const kids = el.children || [];
  if (el.content !== undefined) attrs.push(jsxAttr('value', el.content)); // <textarea>: значение — defaultValue
  if (!kids.length) return `${pad}<${el.tag} ${attrs.join(' ')} />`;
  const prevHint = c.hint;
  c.hint = dataName(el) || prevHint; // имя иконки — по слою Figma вокруг неё («icon/check» → iconCheck)
  const inner = kids.map((k, i) => jsx(k, c, depth + 1, [...p, i])).filter((x) => x !== null).join('\n');
  c.hint = prevHint;
  return `${pad}<${el.tag} ${attrs.join(' ')}>\n${inner}\n${pad}</${el.tag}>`;
}

/** Допустимые значения свойства варианта (что встретилось в макетах). */
const vpropValues = (p) => [...new Set((p.values || []).filter((v) => v !== undefined && v !== null && v !== ''))].sort();
/** JSDoc-описание параметров: тип и смысл каждого — подсказки и проверка в редакторе (VS Code), TypeScript его понимает. */
function propsJsDoc(comp, withIds) {
  const L = [];
  const q = (v) => `'${String(v).replace(/'/g, "\\'")}'`;
  for (const p of comp.props) {
    let type = 'string', what;
    if (p.kind === 'vprop') {
      type = p.bool ? 'boolean' : vpropValues(p).map(q).join(' | ') || 'string';
      what = `свойство варианта Figma «${p.key}»`;
    } else if (p.kind === 'attr') {
      type = p.plain ? 'string' : 'boolean';
      what = `атрибут ${p.attr}`;
    } else if (p.kind === 'show') {
      type = 'boolean';
      what = `показать слой (свойство Figma «${p.prop}»)`;
    } else if (p.kind === 'text') what = 'текст';
    else if (p.kind === 'html') what = 'иконка (SVG из icons.js)';
    else if (p.kind === 'src') what = 'картинка (путь)';
    else if (p.kind === 'style') { type = "import('react').CSSProperties"; what = 'положение или размер части'; }
    else if (p.kind === 'cls') what = p.extraOf !== undefined ? 'дополнительный класс корня' : 'класс части (оформление)';
    L.push(` * @param {${type}} [props.${p.name}] ${what}${p.sample !== undefined && typeof p.sample !== 'object' && p.kind === 'text' ? ` — например «${String(p.sample).slice(0, 40)}»` : ''}`);
  }
  if (withIds) L.push(' * @param {Array<string | null>} [props.ids] слои Figma, к которым привязаны поправки в CSS');
  L.push(" * @param {import('react').CSSProperties} [props.style] положение на странице");
  return L;
}

function reactComponent(comp, o = {}) {
  const keepIdx = keepIdxOf(comp, o.keep, o.instanceOf);
  const c = { mode: 'comp', comp, propAt: propMap(comp), idIndex: new Map(comp.idPaths.map((p, i) => [p, i])), used: new Set(), keep: o.keep, keepIdx, icons: o.icons };
  const body = jsx(comp.template, c, 2);
  const withIds = keepIdx.size > 0;
  const args = [...comp.props.map((p) => p.name), ...(withIds ? ['ids'] : []), 'style', ...(selectProp(comp) ? ['onClick'] : [])].join(', ');
  const imports = [c.usesAsset && "import { asset } from '../assets.js';", c.usesIcons && "import { icons } from '../icons.js';", c.usesOverlay && "import { openOverlay, closeOrBack } from '../overlay.js';"].filter(Boolean);
  return `${imports.length ? imports.join('\n') + '\n\n' : ''}/**
 * ${comp.name} — компонент из макета: ${comp.instances.length} использований.
 * @param {object} props
${propsJsDoc(comp, withIds).join('\n')}
 */
export default function ${comp.name}({ ${args} }) {
  return (
${body}
  );
}
`;
}

function reactPage(page, comps, o = {}) {
  const select = selectGroups(page.root, comps.instanceOf);
  const c = { mode: 'page', instanceOf: comps.instanceOf, used: new Set(), keep: o.keep, icons: o.icons, select };
  const body = jsx(page.root, c, 2);
  // выбранная вкладка в каждой группе выбора — состояние страницы; сначала — как в макете
  const groups = [...new Map([...select.values()].map((g) => [g.group, g.initial]))];
  const state = groups.map(([g, init]) => `  const [selected${g}, setSelected${g}] = useState(${init});\n`).join('');
  const imports = [...c.used].sort().map((n) => `import ${n} from '../components/${n}.jsx';`);
  if (c.usesIcons) imports.unshift("import { icons } from '../icons.js';");
  if (c.usesAsset) imports.unshift("import { asset } from '../assets.js';");
  if (c.usesOverlay) imports.unshift("import { openOverlay, closeOrBack } from '../overlay.js';");
  if (groups.length) imports.unshift("import { useState } from 'react';");
  return `${imports.join('\n')}${imports.length ? '\n\n' : ''}export default function ${page.component}() {
${state}  return (
${body}
  );
}
`;
}

// ---------------------------------------------------------------------------------------------
// Vue (SFC)
// ---------------------------------------------------------------------------------------------

function vueTpl(el, c, depth, p = [], noShow = false) {
  const pad = '  '.repeat(depth);
  const pk = pathKey(p);
  if (el.kind === 'opt') return null; // слой скрыт свойством компонента — не выводится
  const sh = !noShow && showAt(c, pk);
  if (sh) return vueTpl(el, c, depth, p, true).replace(/^(\s*<[\w-]+)/, `$1 v-if="${sh.name}"`);
  if (c.mode === 'page' && c.instanceOf.has(el)) {
    const inst = c.instanceOf.get(el);
    c.used.add(inst.comp.name);
    const sel = c.select?.get(el);
    const props = inst.comp.props.filter((pr) => inst.values[pr.name] !== undefined && (!(['vprop', 'attr'].includes(pr.kind) || pr.extraOf !== undefined) || inst.values[pr.name] !== '')).map((pr) => {
      if (sel && pr.name === sel.prop) return `:${pr.name}="selected${sel.group} === ${sel.index}"`;
      if (pr.kind === 'src' && assetRel(inst.values[pr.name] || '')) c.usesAsset = true;
      if (pr.kind === 'html') return `:${pr.name}="${htmlProp(inst.values[pr.name], c, pr.name)}"`;
      if (pr.kind === 'vprop' && !pr.bool) return `${pr.name}="${inst.values[pr.name]}"`;
      if (pr.kind === 'cls' && pr.extraOf !== undefined) return `class-name="${escAttr(inst.values[pr.name])}"`;
      return `:${pr.name}="${escAttr(vuePropValue(pr.kind, inst.values[pr.name]))}"`;
    });
    if (sel) props.push(`@click="selected${sel.group} = ${sel.index}"`);
    const ids = idsFor(inst, c.keep);
    if (ids) props.push(`:ids="${escAttr(JSON.stringify(ids))}"`);
    if (el.style) props.push(`style="${escAttr(el.style)}"`);
    return `${pad}<${inst.comp.name} ${props.join(' ')} />`;
  }
  const pp = c.propAt?.get(pk) || {};
  if (el.text !== undefined) {
    const t = el.tag || 'span';
    const vt = variantAt(c, pk);
    const extra = (el.attrs || []).filter(([k]) => !k.startsWith('data-') && !vt?.skip.has(k)).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')
      + (vt ? vt.attrs.map(([a, name, plain]) => ` ${vueAttrJs(a, name, plain)}`).join('') : '');
    return `${pad}<${t} ${pp.cls ? `:class="${pp.cls}"` : `class="${el.cls}"`}${extra}>{{ ${pp.text || escAttr(jsStr(el.text))} }}</${t}>`;
  }
  const attrs = [];
  const va = variantAt(c, pk);
  if (va?.v.length) attrs.push(`:class="${escAttr(variantClassJs(va))}"`);
  else if (pp.cls) attrs.push(`:class="${pp.cls}"`);
  else if (el.cls) attrs.push(`class="${el.cls}"`);
  if (va) for (const [a, name, plain] of va.attrs) attrs.push(vueAttrJs(a, name, plain));
  if (el.html !== undefined) {
    attrs.push(pp.style ? `:style="${pp.style}"` : `style="${escAttr(el.style)}"`);
    c.usesIcons ||= !pp.html;
    attrs.push(`v-html="${pp.html || `icons.${c.icons.ref(el.html, c.hint || el.cls)}`}"`);
    return `${pad}<span ${attrs.join(' ')}></span>`;
  }
  if (el.tag === 'img') {
    const src = el.attrs.find(([k]) => k === 'src')[1];
    const rel = assetRel(src);
    if (pp.src) attrs.unshift(`:src="${pp.src}"`);
    else { c.usesAsset ||= !!rel; attrs.unshift(rel ? `:src="asset(${escAttr(jsStr(rel))})"` : `src="${escAttr(src)}"`); }
    attrs.push('alt=""', pp.style ? `:style="${pp.style}"` : `style="${escAttr(el.style)}"`);
    return `${pad}<img ${attrs.join(' ')} />`;
  }
  const isRoot = p.length === 0;
  if (c.mode === 'comp' && isRoot) attrs.push(':style="style"');
  else if (pp.style) attrs.push(`:style="${pp.style}"`);
  else if (el.style) attrs.push(`style="${escAttr(el.style)}"`);
  const act = linkAction(el);
  for (const [k, v] of el.attrs || []) {
    if (!keepAttr(k, v, pk, c) || va?.skip.has(k)) continue;
    if (k === 'data-figma-id' && c.mode === 'comp') attrs.push(`:data-figma-id="ids?.[${c.idIndex.get(pk)}]"`);
    else if (k === 'href' && act?.back) attrs.push('href="#"');
    else attrs.push(`${k}="${escAttr(v)}"`);
  }
  if (act) {
    c.usesOverlay = true;
    attrs.push(act.back ? '@click.prevent="closeOrBack"' : `@click.prevent="openOverlay('${act.open}')"`);
  }
  const kids = el.children || [];
  if (!kids.length) return el.void ? `${pad}<${el.tag} ${attrs.join(' ')} />` : `${pad}<${el.tag} ${attrs.join(' ')}>${el.content !== undefined ? escAttr(el.content) : ''}</${el.tag}>`;
  const prevHint = c.hint;
  c.hint = dataName(el) || prevHint;
  const inner = kids.map((k, i) => vueTpl(k, c, depth + 1, [...p, i])).filter((x) => x !== null).join('\n');
  c.hint = prevHint;
  return `${pad}<${el.tag} ${attrs.join(' ')}>\n${inner}\n${pad}</${el.tag}>`;
}

function vueComponentParts(comp, o = {}) {
  const keepIdx = keepIdxOf(comp, o.keep, o.instanceOf);
  const c = { mode: 'comp', comp, propAt: propMap(comp), idIndex: new Map(comp.idPaths.map((p, i) => [p, i])), used: new Set(), keep: o.keep, keepIdx, icons: o.icons };
  const template = vueTpl(comp.template, c, 1);
  const props = [...comp.props.map((p) => p.name), ...(keepIdx.size ? ['ids'] : []), 'style'];
  return { template, props, usesAsset: c.usesAsset, usesIcons: c.usesIcons, usesOverlay: c.usesOverlay, withIds: keepIdx.size > 0 };
}

function vueComponent(comp, o = {}) {
  const { template, props, usesAsset, usesIcons, usesOverlay, withIds } = vueComponentParts(comp, o);
  const kinds = Object.fromEntries(comp.props.map((p) => [p.name, p.kind]));
  const pr = Object.fromEntries(comp.props.map((p) => [p.name, p]));
  const defs = props.map((p) => (p === 'ids' ? 'ids: Array' : p === 'style' || kinds[p] === 'style' ? `${p}: [String, Object]`
    : kinds[p] === 'show' ? `${p}: Boolean`
    : kinds[p] === 'attr' && pr[p].plain ? `${p}: String`
    : kinds[p] === 'attr' ? `${p}: { type: [Boolean, String], default: undefined }`
    : kinds[p] === 'vprop' && pr[p].bool ? `${p}: { type: Boolean, default: undefined }`
    // свойство варианта: только значения из макета (Vue предупредит в консоли о другом)
    : kinds[p] === 'vprop' && vpropValues(pr[p]).length ? `${p}: { type: String, validator: (v) => ${JSON.stringify(vpropValues(pr[p])).replace(/"/g, "'")}.includes(v) }`
    : `${p}: String`)).join(', ');
  return `<script setup>
${usesAsset ? "import { asset } from '../assets.js';\n" : ''}${usesIcons ? "import { icons } from '../icons.js';\n" : ''}${usesOverlay ? "import { openOverlay, closeOrBack } from '../overlay.js';\n" : ''}// Компонент из макета: ${comp.instances.length} использований.${withIds ? ' ids — слои Figma, к которым привязаны поправки в CSS.' : ''}
defineProps({ ${defs} });
</script>

<template>
${template}
</template>
`;
}

function vuePageParts(page, comps, o = {}) {
  const select = selectGroups(page.root, comps.instanceOf);
  const c = { mode: 'page', instanceOf: comps.instanceOf, used: new Set(), keep: o.keep, icons: o.icons, select };
  const template = vueTpl(page.root, c, 1);
  const groups = [...new Map([...select.values()].map((g) => [g.group, g.initial]))];
  return { template, used: [...c.used].sort(), usesAsset: c.usesAsset, usesIcons: c.usesIcons, usesOverlay: c.usesOverlay, groups };
}

function vuePage(page, comps, o = {}) {
  const { template, used, usesAsset, usesIcons, usesOverlay, groups } = vuePageParts(page, comps, o);
  return `<script setup>
${groups.length ? `import { ref } from 'vue';\n// выбранная вкладка в каждой группе выбора; сначала — как в макете\n${groups.map(([g, init]) => `const selected${g} = ref(${init});`).join('\n')}\n` : ''}${usesAsset ? "import { asset } from '../assets.js';\n" : ''}${usesIcons ? "import { icons } from '../icons.js';\n" : ''}${usesOverlay ? "import { openOverlay, closeOrBack } from '../overlay.js';\n" : ''}${used.map((n) => `import ${n} from '../components/${n}.vue';`).join('\n')}
</script>

<template>
${template}
</template>
`;
}

// ---------------------------------------------------------------------------------------------
// Каталог компонентов (#components): каждый компонент во всех вариантах, что есть в макетах
// ---------------------------------------------------------------------------------------------

const CATALOG_MAX = 24; // примеров одного компонента
const CATALOG_SKIP = new Set(['style', 'ids']);
/** Подпись примера: значения вариантов и атрибутов (variant=secondary, disabled). */
function catalogCaption(comp, values) {
  return comp.props.filter((p) => p.kind === 'vprop' || p.kind === 'show' || (p.kind === 'attr' && !p.plain))
    .map((p) => [p.name, values[p.name]]).filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(', ');
}

/** Страница-каталог в виде дерева элементов: копии из макетов (те же объекты — рисуются как компоненты). */
export function catalogTree(comps) {
  const byComp = new Map();
  for (const [el, inst] of comps.instanceOf) {
    if (!byComp.has(inst.comp)) byComp.set(inst.comp, new Map());
    // пример на сочетание вариантов (variant, state, disabled…); без вариантов — по значениям параметров
    // (положение на странице не в счёт)
    const vkeys = inst.comp.props.filter((p) => p.kind === 'vprop' || p.kind === 'show' || (p.kind === 'attr' && !p.plain)).map((p) => p.name);
    const key = JSON.stringify(vkeys.length ? vkeys.map((k) => inst.values[k])
      : Object.entries(inst.values).filter(([k]) => !CATALOG_SKIP.has(k) && !inst.comp.props.find((p) => p.name === k && p.kind === 'style')));
    if (!byComp.get(inst.comp).has(key)) byComp.get(inst.comp).set(key, { el, inst });
  }
  const T = (tag, cls, text) => ({ tag, cls, attrs: [], children: [{ text, cls: `${cls}-t` }] });
  const sections = [];
  for (const comp of comps.components) {
    const hasVariants = comp.props.some((p) => p.kind === 'vprop' || p.kind === 'show');
    const ex = [...(byComp.get(comp)?.values() || [])].slice(0, hasVariants ? CATALOG_MAX : 6);
    if (!ex.length) continue;
    const params = comp.props.filter((p) => !CATALOG_SKIP.has(p.kind) && p.kind !== 'style').map((p) => p.name);
    sections.push({ tag: 'section', cls: 'catalog__item', attrs: [['id', `c-${comp.name}`]], children: [
      T('h2', 'catalog__name', comp.name),
      T('p', 'catalog__meta', `Копий в макетах: ${comp.instances.length}. Параметры: ${params.join(', ') || 'нет'}.`),
      { tag: 'div', cls: 'catalog__grid', attrs: [], children: ex.map(({ el, inst }) => ({ tag: 'figure', cls: 'catalog__cell', attrs: [], children: [
        { tag: 'div', cls: 'catalog__stage', attrs: [], children: [el] },
        ...(hasVariants ? [T('figcaption', 'catalog__cap', catalogCaption(comp, inst.values))] : []),
      ] })) },
    ] });
  }
  return { tag: 'main', cls: 'catalog', attrs: [], children: [T('h1', 'catalog__title', 'Компоненты'), ...sections] };
}

/** Стили каталога: копия в ячейке — в потоке, без положения со страницы макета. */
export const CATALOG_CSS = `
.catalog { padding: 40px; background: #fff; color: #1d1d1f; font: 15px/1.5 system-ui, sans-serif; }
.catalog__title { font-size: 32px; font-weight: 600; margin: 0 0 24px; }
.catalog__item { padding: 32px 0; border-top: 1px solid #e5e5ea; }
.catalog__name { font-size: 22px; font-weight: 600; margin: 0; }
.catalog__meta { color: #6e6e73; margin: 4px 0 20px; }
.catalog__grid { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.catalog__cell { margin: 0; display: flex; flex-direction: column; gap: 8px; max-width: 100%; }
.catalog__stage { padding: 16px; border: 1px dashed #d2d2d7; border-radius: 8px; max-width: 100%; overflow: auto; }
.catalog__stage > * { position: static !important; left: auto !important; top: auto !important; right: auto !important; bottom: auto !important; margin: 0 !important; transform: none !important; }
.catalog__cap { color: #6e6e73; font-size: 13px; }
`;

// ---------------------------------------------------------------------------------------------
// Проекты
// ---------------------------------------------------------------------------------------------

/**
 * Общий CSS: токены и стили страниц без повторов; шрифты (@font-face, с копированием файлов) — отдельно,
 * в fonts.css: там сотни строк диапазонов символов, агенту их читать незачем.
 */
function siteCss(siteDir, pages, fontsOut) {
  const parts = [];
  let fonts = '';
  const fontsCss = path.join(siteDir, 'fonts.css');
  if (fs.existsSync(fontsCss)) {
    fs.mkdirSync(fontsOut, { recursive: true });
    fonts = (fs.readFileSync(fontsCss, 'utf8').replace(/url\((file:[^)]+)\)/g, (m, u) => {
      const file = fileURLToPath(u);
      const name = path.basename(file);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(fontsOut, name));
      return `url(/fonts/${name})`;
    }));
  }
  for (const f of fs.readdirSync(siteDir).filter((n) => /^extra-\d+\.css$/.test(n))) fonts += '\n' + fs.readFileSync(path.join(siteDir, f), 'utf8');
  parts.push(fs.readFileSync(path.join(siteDir, 'tokens.css'), 'utf8'));
  const seen = new Set();
  for (const p of pages) {
    // fw.css — стили страницы с классами компонентов (если компоненты собраны), иначе рабочие
    const f = fs.existsSync(path.join(siteDir, p.dir, 'fw.css')) ? 'fw.css' : 'styles.css';
    for (const line of fs.readFileSync(path.join(siteDir, p.dir, f), 'utf8').split('\n')) {
      if (!line.trim() || seen.has(line)) continue;
      seen.add(line);
      parts.push(line.replace(/url\("\.\.\/assets\//g, 'url("/assets/'));
    }
  }
  return { fonts: fonts ? fonts + '\n' : '', css: parts.join('\n') + '\n' };
}

/** Общее для React и Vue: CSS проекта, нужные метки слоёв, реестр иконок. */
function shipOptions(siteDir, pages, comps, root, resp) {
  const sc = siteCss(siteDir, pages, path.join(root, 'public/fonts'));
  const raw = sc.css + resp.map((r) => r.css).join('\n') + '\n';
  return { fonts: sc.fonts, css: shipCss(raw), keep: keptIds(raw), icons: iconRegistry(), instanceOf: comps.instanceOf };
}

function writeFiles(root, files) {
  for (const [rel, data] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
}

// адрес страницы от ИИ (pricing) — имя компонента Pricing и маршрут #pricing; иначе — из названия
const pageKey = (p) => pascal(p.slug || p.title).replace(/^C(?=\d)/, 'Page');

export function preparePages(pages) {
  const used = new Set();
  return pages.map((p) => {
    let n = pageKey(p), k = 2;
    while (used.has(n)) n = `${pageKey(p)}${k++}`;
    used.add(n);
    return { ...p, component: n, route: n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() };
  });
}

/**
 * Переходы прототипа в деревьях элементов: путь к рабочей папке фрейма (../<папка>/index.html) → #маршрут
 * страницы проекта (экран адаптивной страницы — её маршрут). Меняет деревья на месте.
 */
export function relinkRoutes(pages, groups = []) {
  const route = new Map(pages.map((p) => [p.dir, p.route]));
  for (const g of respInfo(groups)) for (const m of g.members) route.set(m.dir, g.route);
  const walk = (el) => {
    if (!el) return;
    for (const a of el.attrs || []) {
      const m = a[0] === 'href' && /^\.\.\/([^/]+)\/index\.html$/.exec(a[1]);
      if (m) a[1] = route.has(m[1]) ? `#${route.get(m[1])}` : '#';
    }
    (el.children || []).forEach(walk);
  };
  pages.forEach((p) => walk(p.root));
}

function respInfo(groups) {
  return groups.map((g) => {
    const name = `${pascal(g.name)}Responsive`;
    const prefix = `bp-${pascal(g.name).toLowerCase()}`;
    return { ...g, component: name, route: name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(), prefix, css: responsiveCss(g.widths, prefix) };
  });
}

function reactResponsive(r) {
  const smallest = r.widths[0];
  return `import { useEffect, useRef } from 'react';
${r.members.map((m) => `import ${m.component} from './${m.component}.jsx';`).join('\n')}

/** Адаптивная страница: макеты ${r.widths.join(' / ')} px, переключение — в site.css (@media). */
export default function ${r.component}() {
  const first = useRef(null);
  useEffect(() => {
    // уже самого узкого макета — пропорциональное уменьшение
    const fit = () => { const el = first.current?.firstElementChild; if (el) el.style.zoom = innerWidth < ${smallest} ? String(innerWidth / ${smallest}) : ''; };
    fit(); addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return (
    <>
${r.members.map((m, i) => `      <div className="${r.prefix} ${r.prefix}-${i}"${i === 0 ? ' ref={first}' : ''}><${m.component} /></div>`).join('\n')}
    </>
  );
}
`;
}

function vueResponsive(r) {
  const smallest = r.widths[0];
  return `<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
${r.members.map((m) => `import ${m.component} from './${m.component}.vue';`).join('\n')}
// Адаптивная страница: макеты ${r.widths.join(' / ')} px, переключение — в site.css (@media).
const first = ref(null);
const fit = () => { const el = first.value?.firstElementChild; if (el) el.style.zoom = innerWidth < ${smallest} ? String(innerWidth / ${smallest}) : ''; };
onMounted(() => { fit(); addEventListener('resize', fit); });
onUnmounted(() => removeEventListener('resize', fit));
</script>

<template>
${r.members.map((m, i) => `  <div class="${r.prefix} ${r.prefix}-${i}"${i === 0 ? ' ref="first"' : ''}><${m.component} /></div>`).join('\n')}
</template>
`;
}

export function exportReact(siteDir, pages, comps, groups = [], meta = {}) {
  const root = path.join(siteDir, 'react');
  fs.rmSync(root, { recursive: true, force: true });
  const resp = respInfo(groups);
  // каталог компонентов — маршрут #components (как Storybook, без установки)
  const catalog = comps.components.length > 0;
  const overlays = usesOverlays(pages);
  const routesList = [...resp, ...pages, ...(catalog ? [{ component: 'ComponentCatalog', route: 'components', title: 'Компоненты' }] : [])];
  const o = shipOptions(siteDir, pages, comps, root, resp);
  const files = {
    'package.json': JSON.stringify({ name: 'figma-ds-site-react', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.0' } }, null, 2) + '\n',
    'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
    'index.html': `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0]?.title || 'Сайт'}</title>\n</head>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>\n<script>\n${SCROLLBAR_JS}\n</script>\n</body>\n</html>\n`,
    'src/assets.js': "export const asset = (p) => import.meta.env.BASE_URL + 'assets/' + p;\n",
    'src/main.jsx': "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles/fonts.css';\nimport './styles/site.css';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
    'src/App.jsx': `import { useEffect, ${overlays ? 'useRef, ' : ''}useState } from 'react';
${routesList.map((p) => `import ${p.component} from './pages/${p.component}.jsx';`).join('\n')}

// Страницы из макетов; переключение — #${routesList[0]?.route}
const routes = { ${routesList.map((p) => `'${p.route}': ${p.component}`).join(', ')} };
const first = '${routesList[0]?.route}';

export default function App() {
  // #маршрут — страница; другой #якорь (переход «Scroll to» из прототипа) — прокрутка на текущей странице
  const [route, setRoute] = useState(() => (routes[location.hash.slice(1)] ? location.hash.slice(1) : first));
  useEffect(() => {
    const on = () => {
      const h = location.hash.slice(1);
      if (routes[h]) setRoute(h);
      else document.getElementById(h)?.scrollIntoView();
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const Page = routes[route] || routes[first];
${overlays ? `  // окно из прототипа (Open overlay): страница окна — в <dialog> поверх текущей; Esc и клик по фону закрывают
  const [overlay, setOverlay] = useState(null);
  const dialog = useRef(null);
  useEffect(() => {
    const on = (e) => setOverlay(e.detail);
    addEventListener('ds-overlay', on);
    return () => removeEventListener('ds-overlay', on);
  }, []);
  useEffect(() => {
    if (overlay && !dialog.current.open) dialog.current.showModal();
  }, [overlay]);
  const Overlay = overlay && routes[overlay];
  return (
    <>
      <Page />
      <dialog ref={dialog} className="ds-overlay" onClose={() => setOverlay(null)} onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
        {Overlay && <Overlay />}
      </dialog>
    </>
  );` : '  return <Page />;'}
}
`,
    'src/styles/site.css': o.css + (catalog ? `\n/* каталог компонентов (#components) */${CATALOG_CSS}` : '') + (overlays ? OVERLAY_CSS : ''),
    'src/styles/fonts.css': o.fonts,
    'README.md': `# Вёрстка из Figma — React\n\nСгенерировано DS Builder. Компонентов: ${comps.components.length}, страниц: ${pages.length}.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nСтраницы: ${routesList.map((p) => `#${p.route}`).join(', ')}.${catalog ? '\nКаталог компонентов (все варианты из макетов) — #components.' : ''}\nКарта проекта для ИИ-агента — AGENTS.md.\n`,
  };
  for (const r of resp) files[`src/pages/${r.component}.jsx`] = reactResponsive(r);
  for (const c of comps.components) files[`src/components/${c.name}.jsx`] = reactComponent(c, o);
  for (const p of pages) files[`src/pages/${p.component}.jsx`] = reactPage(p, comps, o);
  if (overlays) files['src/overlay.js'] = OVERLAY_JS;
  if (catalog) files['src/pages/ComponentCatalog.jsx'] = reactPage({ component: 'ComponentCatalog', root: catalogTree(comps) }, comps, o);
  if (o.icons.size) files['src/icons.js'] = o.icons.module();
  files['AGENTS.md'] = agentsMd('react', { pages, comps, resp, routesList, css: o.css, icons: o.icons.size, meta });
  writeFiles(root, files);
  if (fs.existsSync(path.join(siteDir, 'assets'))) fs.cpSync(path.join(siteDir, 'assets'), path.join(root, 'public/assets'), { recursive: true });
  return { dir: root, keep: o.keep };
}

export function exportVue(siteDir, pages, comps, groups = [], meta = {}) {
  const root = path.join(siteDir, 'vue');
  fs.rmSync(root, { recursive: true, force: true });
  const resp = respInfo(groups);
  // каталог компонентов — маршрут #components (как Storybook, без установки)
  const catalog = comps.components.length > 0;
  const overlays = usesOverlays(pages);
  const routesList = [...resp, ...pages, ...(catalog ? [{ component: 'ComponentCatalog', route: 'components', title: 'Компоненты' }] : [])];
  const o = shipOptions(siteDir, pages, comps, root, resp);
  const files = {
    'package.json': JSON.stringify({ name: 'figma-ds-site-vue', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { vue: '^3.5.0' },
      devDependencies: { vite: '^6.0.0', '@vitejs/plugin-vue': '^5.2.0' } }, null, 2) + '\n',
    'vite.config.js': "import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({ plugins: [vue()] });\n",
    'index.html': `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0]?.title || 'Сайт'}</title>\n</head>\n<body>\n<div id="app"></div>\n<script type="module" src="/src/main.js"></script>\n<script>\n${SCROLLBAR_JS}\n</script>\n</body>\n</html>\n`,
    'src/assets.js': "export const asset = (p) => import.meta.env.BASE_URL + 'assets/' + p;\n",
    'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\nimport './styles/fonts.css';\nimport './styles/site.css';\n\ncreateApp(App).mount('#app');\n",
    'src/App.vue': `<script setup>
import { ref, onMounted, onUnmounted, computed${overlays ? ', nextTick' : ''} } from 'vue';
${routesList.map((p) => `import ${p.component} from './pages/${p.component}.vue';`).join('\n')}

// Страницы из макетов; переключение — #${routesList[0]?.route}
const routes = { ${routesList.map((p) => `'${p.route}': ${p.component}`).join(', ')} };
const first = '${routesList[0]?.route}';
// #маршрут — страница; другой #якорь (переход «Scroll to» из прототипа) — прокрутка на текущей странице
const route = ref(routes[location.hash.slice(1)] ? location.hash.slice(1) : first);
const on = () => {
  const h = location.hash.slice(1);
  if (routes[h]) route.value = h;
  else document.getElementById(h)?.scrollIntoView();
};
onMounted(() => addEventListener('hashchange', on));
onUnmounted(() => removeEventListener('hashchange', on));
const Page = computed(() => routes[route.value] || routes[first]);
${overlays ? `// окно из прототипа (Open overlay): страница окна — в <dialog> поверх текущей; Esc и клик по фону закрывают
const overlay = ref(null);
const dialog = ref(null);
const onOverlay = async (e) => {
  overlay.value = e.detail;
  await nextTick();
  if (!dialog.value.open) dialog.value.showModal();
};
onMounted(() => addEventListener('ds-overlay', onOverlay));
onUnmounted(() => removeEventListener('ds-overlay', onOverlay));
const Overlay = computed(() => overlay.value && routes[overlay.value]);
` : ''}</script>

<template>
  <component :is="Page" />
${overlays ? `  <dialog ref="dialog" class="ds-overlay" @close="overlay = null" @click.self="dialog.close()">
    <component :is="Overlay" v-if="Overlay" />
  </dialog>
` : ''}</template>
`,
    'src/styles/site.css': o.css + (catalog ? `\n/* каталог компонентов (#components) */${CATALOG_CSS}` : '') + (overlays ? OVERLAY_CSS : ''),
    'src/styles/fonts.css': o.fonts,
    'README.md': `# Вёрстка из Figma — Vue\n\nСгенерировано DS Builder. Компонентов: ${comps.components.length}, страниц: ${pages.length}.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nСтраницы: ${routesList.map((p) => `#${p.route}`).join(', ')}.${catalog ? '\nКаталог компонентов (все варианты из макетов) — #components.' : ''}\nКарта проекта для ИИ-агента — AGENTS.md.\n`,
  };
  for (const r of resp) files[`src/pages/${r.component}.vue`] = vueResponsive(r);
  for (const c of comps.components) files[`src/components/${c.name}.vue`] = vueComponent(c, o);
  for (const p of pages) files[`src/pages/${p.component}.vue`] = vuePage(p, comps, o);
  if (overlays) files['src/overlay.js'] = OVERLAY_JS;
  if (catalog) files['src/pages/ComponentCatalog.vue'] = vuePage({ component: 'ComponentCatalog', root: catalogTree(comps) }, comps, o);
  if (o.icons.size) files['src/icons.js'] = o.icons.module();
  files['AGENTS.md'] = agentsMd('vue', { pages, comps, resp, routesList, css: o.css, icons: o.icons.size, meta });
  writeFiles(root, files);
  if (fs.existsSync(path.join(siteDir, 'assets'))) fs.cpSync(path.join(siteDir, 'assets'), path.join(root, 'public/assets'), { recursive: true });
  return { dir: root, keep: o.keep };
}

// ---------------------------------------------------------------------------------------------
// Серверный рендер для проверки
// ---------------------------------------------------------------------------------------------

/** React: те же .jsx-файлы, asset → ../assets/, бандл esbuild, renderToStaticMarkup. */
export async function renderReact(pages, comps, opt = {}) {
  const esbuild = require('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-react-'));
  const files = { 'assets.js': `export const asset = (p) => ${jsStr(opt.assetPrefix || ASSET_PREFIX)} + p;\n`, 'overlay.js': OVERLAY_JS };
  // keep: null — с метками всех слоёв (проверка геометрии); Set — ровно как в отдаваемом проекте
  const o = { keep: opt.keep || null, icons: iconRegistry(), instanceOf: comps.instanceOf };
  for (const c of comps.components) files[`components/${c.name}.jsx`] = reactComponent(c, o);
  for (const p of pages) files[`pages/${p.component}.jsx`] = reactPage(p, comps, o);
  files['icons.js'] = o.icons.module();
  files['entry.jsx'] = `import { renderToStaticMarkup } from 'react-dom/server';
${pages.map((p) => `import ${p.component} from './pages/${p.component}.jsx';`).join('\n')}
export const out = { ${pages.map((p) => `${jsStr(p.component)}: renderToStaticMarkup(<${p.component} />)`).join(', ')} };
`;
  writeFiles(tmp, files);
  const outFile = path.join(tmp, 'bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(tmp, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: outFile,
    // где лежит react: в репозитории — packages/builder/node_modules, в установленной программе — выше
    jsx: 'automatic', nodePaths: [path.dirname(path.dirname(createRequire(import.meta.url).resolve('react/package.json')))], logLevel: 'silent',
  });
  const { out } = require(outFile);
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

/** Vue: те же шаблоны, компиляция в рантайме, renderToString. */
export async function renderVue(pages, comps, opt = {}) {
  const vue = require('vue');
  const { renderToString } = require('@vue/server-renderer');
  const out = {};
  const o = { keep: opt.keep || null, icons: iconRegistry(), instanceOf: comps.instanceOf };
  for (const p of pages) {
    const { template, used, groups } = vuePageParts(p, comps, o);
    const app = vue.createSSRApp({ template, data: () => Object.fromEntries(groups.map(([g, i]) => [`selected${g}`, i])) });
    app.config.globalProperties.asset = (x) => (opt.assetPrefix || ASSET_PREFIX) + x;
    app.config.compilerOptions.whitespace = 'condense';
    const parts = comps.components.filter((c) => used.includes(c.name)).map((c) => [c.name, vueComponentParts(c, o)]);
    app.config.globalProperties.icons = o.icons.object();
    app.config.globalProperties.openOverlay = () => {}; // обработчики нажатий при отрисовке на сервере не нужны
    app.config.globalProperties.closeOrBack = () => {};
    for (const [name, pt] of parts) app.component(name, { props: pt.props, template: pt.template });
    out[p.component] = await renderToString(app);
  }
  return out;
}

/** HTML-страница проверки: разметка фреймворка в том же окружении (CSS, шрифты), что и HTML-версия. */
export function checkPageHtml(htmlPage, markup, frameDir, cssFile = 'styles.css') {
  return htmlPage
    .replace(/<body>[\s\S]*<\/body>/, () => `<body>\n${markup}\n</body>`)
    .replace('href="styles.css"', `href="../${frameDir}/${cssFile}"`);
}

/**
 * Проверка отдаваемого проекта: его разметка (без служебных меток) с его же CSS (fonts.css + site.css).
 * Пути /fonts/ и /assets/ (корень сайта в Vite) → файлы public/ проекта.
 */
export function shippedCheckPage(htmlPage, markup, projectRoot, chkDir) {
  const pub = pathToFileURL(path.join(projectRoot, 'public')).href;
  const css = ['fonts.css', 'site.css'].map((f) => fs.readFileSync(path.join(projectRoot, 'src/styles', f), 'utf8')).join('\n')
    .replace(/url\((["']?)\/(fonts|assets)\//g, (m, q, d) => `url(${q}${pub}/${d}/`);
  fs.writeFileSync(path.join(chkDir, 'ship.css'), css);
  return htmlPage
    .replace(/<link rel="stylesheet"[^>]*>\n?/g, '')
    .replace('</head>', '<link rel="stylesheet" href="ship.css">\n</head>')
    .replace(/<body>[\s\S]*<\/body>/, () => `<body>\n${markup}\n</body>`);
}
export const projectAssetPrefix = (projectRoot) => pathToFileURL(path.join(projectRoot, 'public/assets')).href + '/';

export { pathToFileURL };

// ---------------------------------------------------------------------------------------------
// AGENTS.md — карта проекта для ИИ-агента: прочитать один файл вместо всего проекта
// ---------------------------------------------------------------------------------------------

/** Переменные :root из CSS: имя → значение. */
function cssVars(css) {
  const out = [];
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.push([d[1], d[2].trim()]);
  }
  return out;
}

export function agentsMd(kind, { pages, comps, resp = [], routesList, css, icons = 0, meta = {}, components = [] }) {
  const ext = kind === 'react' ? 'jsx' : kind === 'vue' ? 'vue' : 'html';
  const L = [];
  L.push(`# ${meta.file || 'Сайт'} — вёрстка из Figma`);
  L.push('');
  const ck = meta.check;
  const verdict = !ck || !ck.total ? 'Сгенерировано DS Builder из макетов Figma.'
    : ck.passed === ck.total ? `Сгенерировано DS Builder из макетов Figma и сверено с макетами: совпадают все (${ck.total}).`
    : `Сгенерировано DS Builder из макетов Figma и сверено с макетами: совпадают ${ck.passed} из ${ck.total} макетов${ck.failed?.length ? ` (расходятся: ${ck.failed.slice(0, 8).join(', ')}${ck.failed.length > 8 ? '…' : ''})` : ''}; подробности — report.html в папке сборки.`;
  L.push(`${verdict} ` +
    `${kind === 'html' ? 'Обычные HTML и CSS.' : `${kind === 'react' ? 'React' : 'Vue'} + Vite: \`npm install && npm run dev\`.`}`);
  L.push('');
  L.push('## Страницы');
  L.push('');
  L.push(`| ${kind === 'html' ? 'файл' : 'маршрут'} | ${kind === 'html' ? 'стили' : 'файл'} | макет Figma | ширина |`);
  L.push('|---|---|---|---|');
  for (const r of resp) {
    L.push(kind === 'html'
      ? `| ${r.file || r.component} | css/${(r.file || '').replace(/\.html$/, '')}-*.css | ${r.name} (адаптивная) | ${r.widths.join(' / ')} |`
      : `| #${r.route} | src/pages/${r.component}.${ext} | ${r.name} (адаптивная: ${r.members.map((m) => m.component).join(', ')}) | ${r.widths.join(' / ')} |`);
  }
  for (const p of pages) {
    const src = p.page && !String(p.title).startsWith(p.page) ? `${p.page} / ${p.title}` : p.title;
    L.push(kind === 'html'
      ? `| ${p.file} | css/${p.css || ''} | ${src} | ${Math.round(p.width)} |`
      : `| #${p.route} | src/pages/${p.component}.${ext} | ${src} | ${Math.round(p.width)} |`);
  }
  if (comps?.components?.length && kind !== 'html') {
    L.push('');
    L.push('## Компоненты');
    L.push('', 'Все компоненты во всех вариантах из макетов — страница-каталог `#components` (src/pages/ComponentCatalog). ' +
      'Типы параметров — в JSDoc над компонентом (React) или в defineProps (Vue): значения вариантов там перечислены.', '');
    L.push('');
    L.push('Повторяющиеся блоки макета. Параметры: text — текст, src — картинка, html — иконка из icons.js, cls — вариант оформления, style — положение,');
    L.push('vprop — свойство варианта компонента Figma (значения — в скобках; `variant="secondary"` даёт класс `button--secondary`), attr — атрибут (disabled, aria-selected, placeholder…).');
    L.push('');
    L.push('| компонент | параметры | использований |');
    L.push('|---|---|---|');
    for (const c of comps.components) {
      const props = c.props.map((p) => (p.kind === 'vprop' ? `${p.name}:vprop (${p.bool ? 'true/false' : [...new Set(p.values.filter(Boolean))].join('/')})` : `${p.name}:${p.kind}`)).join(', ') || '—';
      L.push(`| src/components/${c.name}.${ext} | ${props} | ${c.instances.length} |`);
    }
  }
  if (kind === 'html' && components.length) {
    L.push('');
    L.push('## Компоненты (css/components.css)');
    L.push('');
    L.push('Компоненты из Figma: общий класс, части — `блок__часть`, варианты — `блок--значение`, состояния — `:hover`, `:active`, `:disabled` и т. п. (для показа без наведения — класс `is-…`). Новую кнопку или карточку собирай из этих классов, не копируя стили.');
    L.push('');
    L.push('| класс | компонент Figma | варианты | состояния | на страницах |');
    L.push('|---|---|---|---|---|');
    for (const c of components) L.push(`| .${c.block} | ${c.name} | ${c.modifiers.join(', ') || '—'} | ${c.states.join(', ') || '—'} | ${c.copies} |`);
  }
  const vars = cssVars(css || '');
  if (vars.length) {
    L.push('');
    L.push(`## Дизайн-токены (${kind === 'html' ? 'css/tokens.css' : 'начало src/styles/site.css'})`);
    L.push('');
    const groups = new Map();
    for (const [k, v] of vars) {
      const g = k.replace(/^--/, '').split('-')[0];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(`${k}: ${v}`);
    }
    for (const [g, list] of groups) {
      const shown = list.slice(0, 40);
      L.push(`- ${g}: ${shown.map((x) => `\`${x}\``).join(', ')}${list.length > shown.length ? ` … ещё ${list.length - shown.length}` : ''}`);
    }
  }
  L.push('');
  L.push('## Как работать с проектом');
  L.push('');
  L.push('- Цвета, шрифты, тени — только через токены `var(--…)`, новые значения не вписывать.');
  L.push('- Размеры и отступы блоков взяты из макета и проверены. Не меняй их, если задача не об этом.');
  L.push(kind === 'html'
    ? '- Классы страницы (`hero`, `title-2`) — стили блоков в css/<страница>.css; `…--own` — своё у копии компонента (размер, переопределения). Найти стиль — поиском по имени класса.'
    : '- Классы с суффиксом (`card-1x2y3`) — стили конкретного блока в src/styles/site.css; найти стиль — поиском по имени класса.');
  if (kind === 'html') L.push('- Иконки вставлены в страницы как <svg>: правь их там же или вынеси в файлы, если нужно.');
  if (icons) L.push(`- Иконки (${icons}) — в \`src/icons.js\`, в коде — \`icons.имя\`. Файл большой (SVG), читать его целиком не нужно.`);
  L.push(`- Не нужно читать: ${kind === 'html' ? '`css/fonts.css` (шрифты), `css/base.css` (сброс стилей браузера)' : '`src/styles/fonts.css` (шрифты)'}${icons ? ', `src/icons.js` (векторы)' : ''}, ${kind === 'html' ? '`assets/`' : '`public/`'} (файлы картинок и шрифтов).`);
  if (kind !== 'html') L.push('- Атрибуты `data-figma-id` и проп `ids` остаются только там, где к слою привязана поправка в CSS (`[data-figma-id="…"]`). Удалишь — поправка перестанет действовать.');
  L.push('');
  return L.join('\n');
}
