// Компоненты: повторяющиеся поддеревья вёрстки (на всех страницах) → компонент с параметрами.
//
// Одинаковость — по структуре: теги, вложенность, роли (без текста, стилей и положения).
// Всё, что отличается между копиями, становится параметром, как варианты компонента в Figma:
//   текст → строковый параметр, класс → параметр класса (вариант оформления), картинка → параметр src,
//   внутренний отступ → параметр стиля. Если различий слишком много, это не компонент.
// Имя — из компонента Figma (если слой — инстанс), иначе из роли/имени слоя.
import { className } from './semantic.js';

const SKIP_ATTRS = new Set(['data-figma-id', 'data-name']);

/** Структурная подпись: теги и вложенность, без текста, классов, стилей и картинок. */
function shapeOf(el) {
  if (el.text !== undefined) return 'T';
  if (el.tag === 'img') return 'I';
  const attrs = (el.attrs || []).filter(([k]) => !SKIP_ATTRS.has(k)).map(([k]) => k).join(',');
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
  const add = (kind, path, hint) => {
    const suffix = { text: '', cls: 'Class', style: 'Style', src: 'Src', html: 'Svg' }[kind];
    let base = camel(hint || 'part') + suffix;
    if (kind === 'text' && base === 'root') base = 'text';
    let n = base, k = 2;
    while (names.has(n)) n = `${base}${k++}`;
    names.add(n);
    props.push({ kind, path, name: n, sample: valueAt(tpl, path, kind) });
  };
  let styleDiffs = 0;
  for (const s of all) {
    const vals = (kind) => instances.map((i) => valueAt(i, s.path, kind));
    const differs = (kind) => { const v = vals(kind); return v.some((x) => x !== v[0]); };
    if (s.el.text !== undefined) {
      if (differs('text')) add('text', s.path, s.hint);
      if (differs('cls')) add('cls', s.path, s.hint + '-text'); // цвет/начертание текста — в классе фрагмента
      continue;
    }
    if (s.el.html !== undefined) { if (differs('html')) add('html', s.path, s.hint); if (differs('style')) { add('style', s.path, s.hint); styleDiffs++; } continue; }
    if (s.el.tag === 'img') { if (differs('src')) add('src', s.path, s.hint); if (differs('style')) { add('style', s.path, s.hint); styleDiffs++; } continue; }
    if (differs('cls')) add('cls', s.path, s.hint);
    if (s.path !== '' && differs('style')) { add('style', s.path, s.hint); styleDiffs++; }
  }
  // текст — естественный параметр; различия в оформлении ограничиваем
  const visual = props.filter((p) => p.kind !== 'text').length;
  if (visual > Math.max(3, all.length * maxShare) || styleDiffs > 2) return null;
  return props;
}

function valueAt(el, path, kind) {
  const e = at(el, path);
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
      if (!isPageRoot && el.id && el.kind === 'node' && nodeCount(el) >= minNodes && sizeOf(el) >= minSize) {
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

  // сверху вниз: самый крупный повторяющийся блок — компонент, внутрь не спускаемся
  const chosen = new Map();
  for (const p of pages) {
    (function pick(el, isPageRoot) {
      if (!isPageRoot && el.id && el.kind === 'node' && okProps.has(shapeOf(el))) {
        const s = shapeOf(el);
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
    const fig = instances.find((e) => e.component?.name)?.component?.name;
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
        values: Object.fromEntries(props.map((p) => [p.name, valueAt(inst, p.path, p.kind)])),
        ids: ids.map((pth) => at(inst, pth).id),
      });
    }
  }
  components.sort((a, b) => b.instances.length - a.instances.length || a.name.localeCompare(b.name));
  return { components, instanceOf };
}
