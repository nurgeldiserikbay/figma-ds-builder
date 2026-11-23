// Компоненты Figma → общий CSS компонентов для html/ (один класс на компонент вместо копий на каждой странице).
//
// Экземпляры и варианты одного компонента (data-component, data-variant) с одинаковым строением
// собираются в группу. По стилям всех копий:
//   .button                      — общее для всех вариантов (в состоянии по умолчанию);
//   .button--secondary           — отличия значения свойства варианта (Variant=Secondary);
//   .button--secondary:hover     — отличия состояния State=Hover от Default того же варианта;
//                                  так же :active, :focus-visible, :disabled, [aria-current] и т. п.;
//   .button__label               — части компонента (по именам слоёв);
//   остаток экземпляра           — то, что у копии своё (ширина, переопределения), — отдельный класс страницы.
// Итоговые стили каждого элемента те же, что раньше (проверяется рендером), меняется только разметка классов.
import { className } from './semantic.js';

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'wbr']);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 5);
}

/** Разбор нашей же разметки: элементы с классами, атрибутами и позицией значения class в строке. */
export function parseHtml(src) {
  const root = { tag: '#root', children: [], attrs: {} };
  const stack = [root];
  const els = [];
  const re = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [all, tag, rest] = m;
    if (all.startsWith('</')) {
      // закрываем до ближайшего такого же тега
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs = {};
    for (const a of rest.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = { tag, attrs, children: [], parent: stack[stack.length - 1], start: m.index };
    const ci = all.indexOf(' class="');
    if (ci >= 0) { el.clsStart = m.index + ci + 8; el.clsEnd = el.clsStart + attrs.class.length; }
    el.parent.children.push(el);
    els.push(el);
    if (!rest.trim().endsWith('/') && !VOID.has(tag.toLowerCase())) stack.push(el);
  }
  return { root, els };
}

/** Простые правила «.класс { … }» → Map(класс → { свойство: значение }). */
export function parseRules(css) {
  const map = new Map();
  for (const m of css.matchAll(/^\.([\w-]+) \{ (.*) \}$/gm)) map.set(m[1], declMap(m[2]));
  return map;
}
function declMap(decl) {
  const o = {};
  // значения могут содержать «;» только внутри url("data:…") — их генератор кодирует, поэтому делим по «; »
  for (const part of decl.split(/;\s*(?![^(]*\))/)) {
    const i = part.indexOf(':');
    if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return o;
}
const declStr = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v};`).join(' ');

const STATE_KEY = /^(state|states|состояние|status)$/i;
const DEFAULT_STATE = /^(default|normal|rest|enabled|idle|по умолчанию|обычное)$/i;
/** Состояние варианта → селекторы CSS (кроме «по умолчанию»). Для показа состояния без наведения — класс is-…. */
function stateSelectors(state, tag, block) {
  const s = state.toLowerCase();
  const nav = tag === 'a' || /nav|link|tab|menu|breadcrumb|pagination/i.test(block);
  const cls = `.is-${className(state)}`;
  if (/hover|наведен/.test(s)) return [':hover', cls];
  if (/press|active|нажат/.test(s)) return nav ? ['[aria-current="page"]', cls] : [':active', cls];
  if (/focus|фокус/.test(s)) return [tag === 'button' || tag === 'a' ? ':focus-visible' : ':focus-within', cls];
  if (/disabl|inactive|неактив|недоступ/.test(s)) return [':disabled', '[aria-disabled="true"]', cls];
  if (/error|invalid|ошибк/.test(s)) return ['[aria-invalid="true"]', ':has([aria-invalid="true"])', cls];
  if (/select|выбран/.test(s)) return ['[aria-selected="true"]', cls];
  if (/check|отмеч/.test(s)) return [':has(input:checked)', cls];
  if (/current|текущ/.test(s)) return ['[aria-current="page"]', cls];
  return [cls];
}

function parseVariant(v) {
  const o = {};
  for (const part of String(v || '').split(',')) {
    const [k, x] = part.split('=').map((s) => (s || '').trim());
    if (k && x) o[k] = x;
  }
  return o;
}

/**
 * @param pages [{ html, css: { файл: текст } }] — разметка (с data-component) и стили страниц
 * @returns {{ pages: [{ html, css }], css: string, components: [{ name, block, variants, states, modifiers }] }}
 */
export function componentize(pages) {
  // 1. разбор страниц и стилей
  const parsed = pages.map((p) => {
    const { root, els } = parseHtml(p.html);
    const rules = new Map();
    for (const text of Object.values(p.css)) for (const [k, v] of parseRules(text)) rules.set(k, v);
    return { ...p, root, els, rules, repl: new Map() };
  });

  // 2. экземпляры: корень с data-component и его элементы (без вложенных компонентов)
  const groups = new Map();
  for (const pg of parsed) {
    for (const el of pg.els) {
      if (!el.attrs['data-component']) continue;
      const parts = [];
      (function walk(e, path, depth) {
        parts.push({ el: e, path, depth });
        e.children.forEach((c, i) => { if (!c.attrs['data-component']) walk(c, `${path}.${i}`, depth + 1); });
      })(el, '0', 0);
      // строение без тегов: смысловой тег копии зависит от места (li в списке, a в меню, h1/h3) — компонент тот же
      const sig = parts.map((x) => `${x.depth}${x.el.tag === 'input' ? 'i' : ''}`).join(',');
      const name = el.attrs['data-component'];
      const key = `${name}\u0000${sig}`;
      if (!groups.has(key)) groups.set(key, { name, sig, members: [] });
      groups.get(key).members.push({ pg, root: el, parts, variant: parseVariant(el.attrs['data-variant']) });
    }
  }

  // имена блоков: у самой частой формы — имя компонента, у остальных — с номером
  const blockUsed = new Map();
  const ordered = [...groups.values()].sort((a, b) => b.members.length - a.members.length);
  const out = [];
  const compCss = [];
  for (const g of ordered) {
    const base0 = className(g.name) || 'component';
    const n = (blockUsed.get(base0) || 0) + 1;
    blockUsed.set(base0, n);
    const block = n === 1 ? base0 : `${base0}-${n}`;
    const tag = g.members[0].root.tag;
    const stateKey = Object.keys(Object.assign({}, ...g.members.map((m) => m.variant))).find((k) => STATE_KEY.test(k));
    const stateOf = (m) => (stateKey ? m.variant[stateKey] : undefined);
    const isDefault = (m) => !stateOf(m) || DEFAULT_STATE.test(stateOf(m));
    const propKeys = [...new Set(g.members.flatMap((m) => Object.keys(m.variant)))].filter((k) => k !== stateKey);
    const comboOf = (m) => propKeys.map((k) => `${k}=${m.variant[k] ?? ''}`).join(',');

    // имена частей: по слою (data-name), текст внутри слоя — «…-text»
    const names = [];
    const usedNames = new Set([block]);
    g.members[0].parts.forEach((p, i) => {
      if (i === 0) { names.push(block); return; }
      let own = p.el.attrs['data-name'] ? className(p.el.attrs['data-name']) : null;
      if (!own) {
        let a = p.el.parent, up = '';
        while (a && !a.attrs['data-name']) a = a.parent;
        up = a && a !== g.members[0].root ? className(a.attrs['data-name']) : 'text';
        own = p.el.children.length ? `${up}-inner` : `${up}-text`;
        if (up === 'text') own = 'text';
      }
      let nm = `${block}__${own}`, k = 2;
      while (usedNames.has(nm)) nm = `${block}__${own}-${k++}`;
      usedNames.add(nm);
      names.push(nm);
    });

    // стили каждой части у каждой копии
    const declOf = (m, i) => {
      const e = m.parts[i].el;
      const cls = (e.attrs.class || '').split(/\s+/).filter(Boolean);
      const o = {};
      const unknown = [];
      for (const c of cls) { const r = m.pg.rules.get(c); if (r) Object.assign(o, r); else unknown.push(c); }
      return { o, unknown };
    };
    const D = g.members.map((m) => m.parts.map((_, i) => declOf(m, i)));
    // общее — значение большинства копий: одна переопределённая копия не должна разрушать компонент
    // (её отличие уйдёт в её собственный класс)
    const common = (list) => {
      if (!list.length) return {};
      const o = {};
      const keys = new Set(list.flatMap((x) => Object.keys(x)));
      for (const k of keys) {
        const cnt = new Map();
        for (const x of list) if (k in x) cnt.set(x[k], (cnt.get(x[k]) || 0) + 1);
        const [v, c] = [...cnt].sort((a, b) => b[1] - a[1])[0];
        if (c * 2 > list.length) o[k] = v;
      }
      return o;
    };
    const diff = (a, b) => Object.fromEntries(Object.entries(a).filter(([k, v]) => b[k] !== v));

    const defIdx = g.members.map((m, i) => (isDefault(m) ? i : -1)).filter((i) => i >= 0);
    const baseIdx = defIdx.length ? defIdx : g.members.map((_, i) => i);
    const rules = []; // [selector, decl]
    const P = g.members[0].parts.length;
    const sel = (i, pre) => (i === 0 ? pre : `${pre} .${names[i]}`);
    const modsUsed = new Set();
    const statesUsed = new Set();
    const computed = g.members.map(() => Array.from({ length: P }, () => ({})));
    for (let i = 0; i < P; i++) {
      const base = common(baseIdx.map((j) => D[j][i].o));
      if (Object.keys(base).length) rules.push([`.${names[i]}`, base]);
      g.members.forEach((_, j) => Object.assign(computed[j][i], base));
      // свойства вариантов (кроме состояния): общее у всех копий с этим значением, отличное от базы
      for (const k of propKeys) {
        for (const val of new Set(baseIdx.map((j) => g.members[j].variant[k]).filter(Boolean))) {
          const sameVal = baseIdx.filter((j) => g.members[j].variant[k] === val);
          const mod = diff(common(sameVal.map((j) => D[j][i].o)), base);
          // свойство, которое у части копий этого значения другое, модификатором не считаем
          if (!Object.keys(mod).length) continue;
          const mcls = `${block}--${className(val)}`;
          // часть: «.button--x .button__label» (0,2,0) — своё у копии (.c.c, тоже 0,2,0, но позже) сильнее
          rules.push([i === 0 ? `.${block}.${mcls}` : `.${mcls} .${names[i]}`, mod]);
          modsUsed.add(`${k}=${val}`);
          g.members.forEach((m, j) => { if (m.variant[k] === val) Object.assign(computed[j][i], mod); });
        }
      }
    }
    // состояния: отличие от варианта «по умолчанию» с теми же свойствами
    if (stateKey) {
      for (const [j, m] of g.members.entries()) {
        if (isDefault(m)) continue;
        const twin = g.members.findIndex((x, t) => t !== j && isDefault(x) && comboOf(x) === comboOf(m));
        if (twin < 0) continue;
        const st = stateOf(m);
        const pseudo = stateSelectors(st, tag, block);
        // модификаторы этого варианта, которые реально есть в CSS
        const mods = propKeys.map((k) => m.variant[k]).filter(Boolean).map((v) => `${block}--${className(v)}`)
          .filter((c) => rules.some(([s]) => s.includes(`.${c}`)));
        const pre = `.${block}${mods.map((c) => `.${c}`).join('')}`;
        for (let i = 0; i < P; i++) {
          const d = diff(D[j][i].o, D[twin][i].o);
          // отличие на уровне копии (например, ширина) — не состояние
          if (!Object.keys(d).length) continue;
          const key = `${pre}|${st}|${i}`;
          if (!statesUsed.has(key)) {
            statesUsed.add(key);
            rules.push([pseudo.map((ps) => sel(i, `${pre}${ps}`)).join(', '), d]);
          }
          // копии этого варианта в этом состоянии показывают его статично — классом is-…
          g.members.forEach((x, t) => { if (comboOf(x) === comboOf(m) && stateOf(x) === st) Object.assign(computed[t][i], diff(D[j][i].o, D[twin][i].o)); });
        }
      }
    }

    // 3. переразметка: компонентные классы + остаток копии (класс страницы с удвоенной специфичностью)
    for (const [j, m] of g.members.entries()) {
      for (let i = 0; i < P; i++) {
        const { o, unknown } = D[j][i];
        const rest = Object.fromEntries(Object.entries(o).filter(([k, v]) => computed[j][i][k] !== v));
        // свойство из компонента, которого у копии нет (не должно быть, но на всякий случай) — сбрасывать некуда:
        // такие копии не трогаем
        const extra = Object.keys(computed[j][i]).filter((k) => !(k in o));
        if (extra.length) { m.skip = true; break; }
        const cls = [names[i]];
        if (i === 0) {
          for (const k of propKeys) {
            const v = m.variant[k];
            if (v && rules.some(([s]) => s.includes(`.${block}--${className(v)}`))) cls.push(`${block}--${className(v)}`);
          }
          if (!isDefault(m) && rules.some(([s]) => s.includes(`.is-${className(stateOf(m))}`))) cls.push(`is-${className(stateOf(m))}`);
        }
        let restCls = null;
        if (Object.keys(rest).length) {
          const decl = declStr(rest);
          restCls = `${names[i].replace(/__/, '-')}-${hash(decl)}`;
          m.pg.restRules = m.pg.restRules || new Map();
          m.pg.restRules.set(restCls, decl);
          cls.push(restCls);
        }
        cls.push(...unknown);
        m.pendings = m.pendings || [];
        m.pendings.push([m.parts[i].el, cls.join(' ')]);
      }
      if (!m.skip) for (const [el, c] of m.pendings) m.pg.repl.set(el, c);
    }
    for (const [s, d] of rules) compCss.push(`${s} { ${declStr(d)} }`);
    out.push({ name: g.name, block, copies: g.members.length, modifiers: [...modsUsed], states: [...new Set(g.members.filter((m) => !isDefault(m)).map(stateOf))] });
  }

  // 4. страницы: новая разметка, из стилей страницы убираем ставшие ненужными классы, добавляем остатки
  const result = parsed.map((pg) => {
    let html = pg.html;
    const edits = [...pg.repl].filter(([el]) => el.clsStart !== undefined).sort((a, b) => b[0].clsStart - a[0].clsStart);
    for (const [el, c] of edits) html = html.slice(0, el.clsStart) + c + html.slice(el.clsEnd);
    const used = new Set();
    for (const m of html.matchAll(/ class="([^"]*)"/g)) m[1].split(/\s+/).forEach((c) => used.add(c));
    const css = {};
    const files = Object.keys(pg.css);
    files.forEach((f, fi) => {
      let text = pg.css[f].replace(/^\.([\w-]+) \{ .* \}\n?/gm, (line, c) => (used.has(c) ? line : ''));
      // остатки копий — в первый файл страницы (специфичность ×2: сильнее модификаторов компонента)
      if (fi === 0 && pg.restRules?.size) text += `\n/* Своё у копий компонентов (размер, переопределения) */\n${[...pg.restRules].filter(([c]) => used.has(c)).map(([c, d]) => `.${c}.${c} { ${d} }`).join('\n')}\n`;
      css[f] = text;
    });
    return { html, css };
  });
  const css = compCss.length ? `/* Компоненты из Figma: общее, варианты (--…), состояния (:hover, :active, :disabled… и класс is-…) */\n${compCss.join('\n')}\n` : '';
  return { pages: result, css, components: out };
}
