// Компоненты: повторяющиеся поддеревья вёрстки (на всех страницах) → компонент с параметрами.
//
// Одинаковость — по структуре: теги, вложенность, роли (без текста, стилей и положения).
// Всё, что отличается между копиями, становится параметром, как варианты компонента в Figma:
//   текст → строковый параметр, класс → параметр класса (вариант оформления), картинка → параметр src,
//   внутренний отступ → параметр стиля. Если различий слишком много, это не компонент.
// Имя — из компонента Figma (если слой — инстанс), иначе из роли/имени слоя.
import { className } from './semantic.js';

const SKIP_ATTRS = new Set(['data-figma-id', 'data-name', 'data-variant']);
// атрибуты состояния из вариантов Figma (componentize) — у копий разные, это параметры, а не строение
export const ARIA_PROPS = { 'aria-selected': 'selected', 'aria-checked': 'checked', 'aria-expanded': 'expanded', 'aria-pressed': 'pressed', 'aria-current': 'current', 'aria-disabled': 'disabled', disabled: 'disabled' };
const YES = /^(true|yes|on|да|1)$/i, NO = /^(false|no|off|нет|0)$/i;
const attrOf = (el, k) => (el.attrs || []).find(([x]) => x === k)?.[1];
function parseVariant(v) {
  const o = {};
  for (const part of String(v || '').split(',')) {
    const [k, x] = part.split('=').map((t) => (t || '').trim());
    if (k && x) o[k] = x;
  }
  return o;
}

/**
 * Класс корня копий одного компонента Figma → параметры вариантов: «button button--secondary is-hover» у копий
 * с Variant=Secondary, State=Hover → общий «button» + variant → button--secondary, state → is-hover.
 * Класс относится к свойству, если он есть ровно у копий с одним его значением. Остальное (своё у копии) —
 * параметр className. null — разложить нельзя.
 */
export function variantSplit(instances) {
  const comp = attrOf(instances[0], 'data-component');
  if (!comp || instances.some((i) => attrOf(i, 'data-component') !== comp || attrOf(i, 'data-variant') === undefined)) return null;
  const vars = instances.map((i) => parseVariant(attrOf(i, 'data-variant')));
  const toks = instances.map((i) => (i.cls || '').split(/\s+/).filter(Boolean));
  const base = toks[0].filter((t) => toks.every((x) => x.includes(t)));
  const keys = [...new Set(vars.flatMap((v) => Object.keys(v)))];
  const map = Object.fromEntries(keys.map((k) => [k, {}]));
  const owned = new Set();
  for (const t of new Set(toks.flat().filter((t) => !base.includes(t)))) {
    for (const k of keys) {
      const vals = new Set(instances.map((_, j) => (toks[j].includes(t) ? vars[j][k] : null)).filter((x) => x !== null));
      if (vals.size !== 1) continue;
      const v = [...vals][0];
      if (v === undefined) continue;
      if (!instances.every((_, j) => toks[j].includes(t) === (vars[j][k] === v))) continue;
      map[k][v] = [map[k][v], t].filter(Boolean).join(' ');
      owned.add(t);
      break;
    }
  }
  const used = keys.filter((k) => Object.keys(map[k]).length);
  if (!used.length) return null;
  const extra = toks.map((x) => x.filter((t) => !base.includes(t) && !owned.has(t)).join(' '));
  return {
    base: base.join(' '),
    keys: used.map((k) => {
      const all = [...new Set(vars.map((v) => v[k]).filter(Boolean))];
      const bool = all.every((v) => YES.test(v) || NO.test(v));
      const norm = (v) => (v === undefined ? undefined : bool ? YES.test(v) : className(v));
      return { key: k, bool, map: Object.fromEntries(Object.entries(map[k]).map(([v, c]) => [String(norm(v)), c])), values: vars.map((v) => norm(v[k])) };
    }),
    extra: extra.some(Boolean) ? extra : null,
  };
}

/** Структурная подпись: теги и вложенность, без текста, классов, стилей и картинок. */
function shapeOf(el) {
  if (el.text !== undefined) return 'T';
  if (el.tag === 'img') return 'I';
  const attrs = (el.attrs || []).filter(([k]) => !SKIP_ATTRS.has(k) && !(k in ARIA_PROPS)).map(([k]) => k).join(',');
  return `${el.tag}{${attrs}}[${(el.children || []).map(shapeOf).join(',')}]`;
}

const sizeOf = (el) => 1 + (el.children || []).reduce((s, c) => s + sizeOf(c), 0);
const nodeCount = (el) => (el.id ? 1 : 0) + (el.children || []).reduce((s, c) => s + nodeCount(c), 0);

export const pascal = (s) => {
  const p = className(s).split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Z]/.test(p) ? p : `C${p}`;
};
export const camel = (s) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};

const at = (el, path) => (path === '' ? el : path.split('.').reduce((e, i) => e.children[+i], el));

/** Все места шаблона: путь, подсказка для имени (имя ближайшего слоя), элемент. */
function slots(el, p = [], hint = 'root', out = []) {
  out.push({ path: p.join('.'), el, hint: p.length === 0 ? 'root' : el.id ? el.name : hint });
  (el.children || []).forEach((c, i) => slots(c, [...p, i], el.id ? (p.length === 0 ? 'root' : el.name) : hint, out));
  return out;
}

/** Различия между копиями → параметры. null, если копии слишком разные. */
function diffProps(instances, maxShare) {
  const tpl = instances[0];
  const all = slots(tpl);
  const props = [];
  const names = new Set(['ids', 'style']);
  const add = (kind, path, hint, extra = {}, fixedName = null) => {
    const suffix = { text: '', cls: 'Class', style: 'Style', src: 'Src', html: 'Svg', vprop: '', attr: '' }[kind];
    let base = fixedName || camel(hint || 'part') + suffix;
    if (kind === 'text' && base === 'root') base = 'text';
    let n = base, k = 2;
    while (names.has(n)) n = `${base}${k++}`;
    names.add(n);
    const pr = { kind, path, name: n, ...extra };
    pr.sample = valueAt(tpl, path, kind, pr);
    props.push(pr);
    return pr;
  };
  let styleDiffs = 0;
  // корень копий компонента Figma: варианты — отдельными параметрами (variant, size, state…)
  const vs = variantSplit(instances);
  if (vs) {
    for (const k of vs.keys) add('vprop', '', null, { key: k.key, bool: k.bool, map: k.map, values: k.values, base: vs.base }, camel(k.key));
    if (vs.extra) add('cls', '', null, { extraOf: vs.base, owned: vs.keys.flatMap((k) => Object.values(k.map).flatMap((c) => c.split(' '))) }, 'className');
  }
  for (const s of all) {
    // атрибуты состояния (aria-selected, disabled…) — параметры; с тем же именем, что булево свойство варианта, — оно и есть
    // другие атрибуты, разные у копий (placeholder, type, href…) — тоже параметры, иначе у всех был бы атрибут шаблона
    const keysHere = new Set(instances.flatMap((i) => (at(i, s.path).attrs || []).map(([k]) => k)));
    for (const a of keysHere) {
      if (a in ARIA_PROPS || a.startsWith('data-') || ['src', 'style', 'class'].includes(a)) continue;
      const v = instances.map((i) => attrOf(at(i, s.path), a));
      if (v.every((x) => x === v[0])) continue;
      add('attr', s.path, null, { attr: a, plain: true }, camel(`${s.path === '' ? '' : s.hint}-${a}`));
    }
    for (const [a, pname] of Object.entries(ARIA_PROPS)) {
      const v = instances.map((i) => attrOf(at(i, s.path), a));
      if (v.every((x) => x === v[0])) continue; // одинаковый у всех — остаётся в шаблоне
      const same = props.find((p) => p.kind === 'vprop' && p.path === s.path && p.bool && p.name === pname);
      if (same) { same.attrs = [...(same.attrs || []), a]; continue; }
      add('attr', s.path, null, { attr: a }, pname);
    }
    const vals = (kind) => instances.map((i) => valueAt(i, s.path, kind));
    const differs = (kind) => { const v = vals(kind); return v.some((x) => x !== v[0]); };
    if (s.el.text !== undefined) {
      if (differs('text')) add('text', s.path, s.hint);
      if (differs('cls')) add('cls', s.path, s.hint + '-text'); // цвет/начертание текста — в классе фрагмента
      continue;
    }
    if (s.el.html !== undefined) { if (differs('html')) add('html', s.path, s.hint); if (differs('style')) { add('style', s.path, s.hint); styleDiffs++; } continue; }
    if (s.el.tag === 'img') { if (differs('src')) add('src', s.path, s.hint); if (differs('style')) { add('style', s.path, s.hint); styleDiffs++; } continue; }
    if (differs('cls') && !(s.path === '' && vs)) add('cls', s.path, s.hint);
    if (s.path !== '' && differs('style')) { add('style', s.path, s.hint); styleDiffs++; }
  }
  // текст — естественный параметр; различия в оформлении ограничиваем
  const visual = props.filter((p) => !['text', 'vprop', 'attr'].includes(p.kind) && !p.extraOf).length;
  if (visual > Math.max(3, all.length * maxShare) || styleDiffs > 2) return null;
  return props;
}

function valueAt(el, path, kind, pr) {
  const e = at(el, path);
  if (kind === 'vprop') { const v = parseVariant(attrOf(e, 'data-variant'))[pr.key]; return v === undefined ? undefined : pr.bool ? YES.test(v) : className(v); }
  if (kind === 'attr' && pr.plain) return attrOf(e, pr.attr);
  if (kind === 'attr') { const v = attrOf(e, pr.attr); return v === undefined ? undefined : v === '' || v === 'true' || v === 'page' ? true : v === 'false' ? false : v; }
  if (kind === 'cls' && pr?.extraOf !== undefined) { const base = pr.extraOf.split(' '); return (e.cls || '').split(/\s+/).filter((t) => t && !base.includes(t) && !(pr.owned || []).includes(t)).join(' '); }
  if (kind === 'text') return e.text;
  if (kind === 'cls') return e.cls;
  if (kind === 'style') return e.style || '';
  if (kind === 'src') return (e.attrs || []).find(([k]) => k === 'src')?.[1];
  if (kind === 'html') return e.html;
  return undefined;
}

function idPaths(el, p = [], out = []) {
  if (el.id) out.push(p.join('.'));
  (el.children || []).forEach((c, i) => idPaths(c, [...p, i], out));
  return out;
}

/**
 * @param {{ key: string, root: object }[]} pages
 * @returns {{ components: object[], instanceOf: Map<object, object> }}
 */
export function findComponents(pages, { minNodes = 2, minSize = 4, maxShare = 0.3 } = {}) {
  // кандидаты: блоки из ≥2 слоёв (одиночный текст — не компонент)
  const byShape = new Map();
  for (const p of pages) {
    (function collect(el, isPageRoot) {
      // экземпляр компонента Figma — кандидат при любом размере (кнопка из одной надписи — тоже компонент)
      const fig = attrOf(el, 'data-component') !== undefined;
      if (!isPageRoot && el.id && el.kind === 'node' && (fig ? nodeCount(el) >= 1 : nodeCount(el) >= minNodes && sizeOf(el) >= minSize)) {
        const s = shapeOf(el);
        if (!byShape.has(s)) byShape.set(s, []);
        byShape.get(s).push(el);
      }
      (el.children || []).forEach((c) => collect(c, false));
    })(p.root, true);
  }
  // группа годится, если различия между копиями укладываются в параметры
  const okProps = new Map();
  for (const [s, list] of byShape) {
    if (list.length < 2) continue;
    const props = diffProps(list, maxShare);
    if (props) okProps.set(s, props);
  }

  // группы из экземпляров компонентов Figma: блок без компонента Figma, внутри которого они есть, — не компонент
  // (иначе кнопки внутри «Actions» остались бы без своих вариантов)
  const figShapes = new Set([...okProps.keys()].filter((sh) => byShape.get(sh).length >= 2 && byShape.get(sh).every((e) => attrOf(e, 'data-component') !== undefined)));
  const hasFig = (el) => (el.children || []).some((c) => figShapes.has(shapeOf(c)) || hasFig(c));
  // сверху вниз: самый крупный повторяющийся блок — компонент, внутрь не спускаемся
  const chosen = new Map();
  for (const p of pages) {
    (function pick(el, isPageRoot) {
      if (!isPageRoot && el.id && el.kind === 'node' && okProps.has(shapeOf(el)) && (figShapes.has(shapeOf(el)) || !hasFig(el))) {
        // копии разных компонентов Figma одного строения — разные компоненты
        const s = `${shapeOf(el)}|${attrOf(el, 'data-component') || ''}`;
        if (!chosen.has(s)) chosen.set(s, []);
        chosen.get(s).push(el);
        return;
      }
      (el.children || []).forEach((c) => pick(c, false));
    })(p.root, true);
  }

  const used = new Set(['App', 'Page', 'Fragment']);
  const components = [];
  const instanceOf = new Map();
  for (const [shape, instances] of chosen) {
    if (instances.length < 2) continue;
    // параметры — по фактически выбранным копиям (могли отпасть вложенные)
    const props = diffProps(instances, maxShare);
    if (!props) continue;
    const template = instances[0];
    const fig = instances.find((e) => e.component?.name)?.component?.name || attrOf(template, 'data-component');
    let name = pascal(String(fig || template.name || 'Block').split(/[/=,]/)[0]);
    if (/^(Div|Span|Block|Group|Node|Layer|Shape|Part|Item)$/.test(name)) name = `${name}Block`;
    let n = name, k = 2;
    while (used.has(n)) n = `${name}${k++}`;
    used.add(n);
    const ids = idPaths(template);
    const comp = { name: n, shape, template, instances, props, idPaths: ids };
    components.push(comp);
    for (const inst of instances) {
      instanceOf.set(inst, {
        comp,
        values: Object.fromEntries(props.map((p) => [p.name, valueAt(inst, p.path, p.kind, p)])),
        ids: ids.map((pth) => at(inst, pth).id),
      });
    }
  }
  components.sort((a, b) => b.instances.length - a.instances.length || a.name.localeCompare(b.name));
  // страница с именем компонента (страница «Button» с набором вариантов) — ButtonPage: имя оставляем компоненту
  for (const p of pages) if (p.component && used.has(p.component) && components.some((c) => c.name === p.component)) {
    let n = `${p.component}Page`, k = 2;
    while (used.has(n) || pages.some((q) => q !== p && q.component === n)) n = `${p.component}Page${k++}`;
    used.add(n);
    p.component = n;
  }
  return { components, instanceOf };
}
