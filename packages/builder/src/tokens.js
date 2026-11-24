// Токены DTCG (tokens.json из плагина) → карта цветов и tokens.css.

function normHex(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (!/^#[0-9a-f]{3,8}$/.test(s)) return null;
  if (s.length === 4) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
  if (s.length === 9 && s.endsWith('ff')) s = s.slice(0, 7);
  return s;
}

function walk(obj, path, out) {
  if (!obj || typeof obj !== 'object') return;
  if ('$value' in obj) {
    out.push({ path, type: obj.$type, value: obj.$value });
    return;
  }
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('$')) walk(v, [...path, k], out);
}

const slugVar = (name) => '--' + String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hexOf = (c) => {
  const h = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  const a = c.a ?? 1;
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${a < 1 ? h(a) : ''}`;
};

/**
 * Переменные Figma (variables.json плагина) → CSS-переменные с теми же именами, что видит дизайнер:
 * имя для кода из Figma (Code syntax → Web), иначе имя переменной (color/bg/page → --color-bg-page).
 * Алиасы остаются ссылками (var(--…)), первый режим — :root, остальные — [data-mode="…"].
 */
export function variablesToTokens(collections) {
  const list = [];
  const used = new Set();
  const cssName = new Map(); // имя в Figma → --имя
  for (const c of collections || []) for (const v of c.variables || []) {
    const web = v.codeSyntax?.WEB && String(v.codeSyntax.WEB).match(/--[A-Za-z0-9_-]+/);
    let n = web ? web[0] : slugVar(v.name);
    if (used.has(n)) n = slugVar(`${c.name} ${v.name}`);
    for (let k = 2; used.has(n); k++) n = slugVar(`${c.name} ${v.name} ${k}`);
    used.add(n);
    // одно имя у двух переменных (локальная и библиотечная, две библиотеки) — первая остаётся по имени,
    // остальные различаются по значению (varRef с цветом слоя)
    if (!cssName.has(v.name)) cssName.set(v.name, n);
    list.push({ coll: c, v, css: n });
  }
  const valueOf = (v, val) => {
    if (val && typeof val === 'object' && 'alias' in val) return cssName.has(val.alias) ? `var(${cssName.get(val.alias)})` : null;
    if (v.type === 'COLOR' && val && typeof val === 'object') return hexOf(val);
    if (v.type === 'FLOAT' && typeof val === 'number') {
      const sc = v.scopes || [];
      if (sc.includes('OPACITY')) return String(Math.round(val) / 100); // в Figma прозрачность 0–100
      if (sc.includes('FONT_WEIGHT')) return String(val);
      return `${Math.round(val * 100) / 100}px`;
    }
    if (v.type === 'STRING' && typeof val === 'string') return JSON.stringify(val);
    return null;
  };
  const modes = new Map(); // режим → строки
  const byHex = new Map();
  for (const { coll, v, css } of list) {
    (coll.modes || []).forEach((m, i) => {
      const val = valueOf(v, v.values?.[m]);
      if (val == null) return;
      // первый режим — :root и свой data-mode (чтобы вложенный блок мог вернуться к нему внутри другого режима)
      const sel = `[data-mode="${String(m).toLowerCase().replace(/[^a-z0-9]+/g, '-')}"]`;
      const key = i === 0 ? `:root, ${sel}` : sel;
      if (!modes.has(key)) modes.set(key, []);
      modes.get(key).push(`  ${css}: ${val};`);
    });
  }
  // цвет во всех режимах: подставлять переменную по совпадению цвета можно, только если она одинакова во всех
  // режимах — иначе в блоке с другим режимом (data-mode="dark") var() даст другой цвет, чем в макете
  const hexIn = (it, mode, seen = new Set()) => {
    if (!it || seen.has(it)) return null;
    seen.add(it);
    const val = it.v.values?.[mode] ?? it.v.values?.[it.coll.modes?.[0]];
    if (val && typeof val === 'object' && 'alias' in val) {
      const t = list.find((x) => x.v.name === val.alias);
      return t ? hexIn(t, t.coll.modes?.includes(mode) ? mode : t.coll.modes?.[0], seen) : null;
    }
    return it.v.type === 'COLOR' && val ? normHex(hexOf(val)) : null;
  };
  const hexes = (it) => [...new Set((it.coll.modes || []).map((m) => hexIn(it, m)).filter(Boolean))];
  const ranked = list.filter((x) => x.v.type === 'COLOR').sort((a, b) => (b.v.scopes?.length ? 1 : 0) - (a.v.scopes?.length ? 1 : 0));
  for (const x of ranked) { const hs = hexes(x); if (hs.length === 1 && !byHex.has(hs[0])) byHex.set(hs[0], x.css); }
  // переменная по имени и цвету слоя: среди одноимённых — та, у которой в каком-то режиме такой цвет
  const byName = new Map();
  for (const x of list) { if (!byName.has(x.v.name)) byName.set(x.v.name, []); byName.get(x.v.name).push(x); }
  const refFor = (name, hex) => {
    const all = byName.get(name);
    if (!all) return null;
    if (!hex || all[0].v.type !== 'COLOR') return all[0].css;
    // одноимённых может быть несколько; ни у одной нет такого цвета ни в одном режиме (библиотеку поменяли
    // после макета) — честнее цвет как есть: в Figma слой выглядит именно так
    const h = normHex(hex);
    const hit = all.find((x) => hexes(x).includes(h));
    return hit ? hit.css : null;
  };
  return { list, cssName, modes, byHex, used, refFor };
}

/** Стили эффектов Figma (styles.json) → --shadow-…: те же тени, что в макете. */
function effectTokens(styles) {
  const map = new Map(), lines = [];
  const used = new Set();
  const r = (v) => `${Math.round((v || 0) * 100) / 100}px`;
  for (const st of styles?.effect || []) {
    if (map.has(st.name)) continue; // одноимённые из разных частей — берём первую (самую позднюю выгрузку)
    const sh = (st.effects || []).filter((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
      .map((e) => `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${r(e.x)} ${r(e.y)} ${r(e.blur)} ${r(e.spread)} ${hexOf(e.color)}`);
    if (!sh.length) continue;
    let n = slugVar(/shadow|тень/i.test(st.name) ? st.name : `shadow ${st.name}`);
    while (used.has(n)) n += '-2';
    used.add(n); map.set(st.name, n); lines.push(`  ${n}: ${sh.join(', ')};`);
  }
  return { map, lines };
}

/** Цветовые стили Figma (Color styles) → --имя-стиля; стиль на переменной — ссылкой на неё. */
function paintTokens(styles, fv) {
  const map = new Map(), lines = [];
  const used = new Set(fv ? fv.used : []);
  for (const st of styles?.paint || []) {
    if (map.has(st.name)) continue;
    const solids = (st.paints || []).filter((p) => p.type === 'SOLID' && p.visible !== false);
    if (solids.length !== 1) continue;
    const p = solids[0];
    const ref = p.variable && fv?.cssName.get(p.variable);
    const val = ref ? `var(${ref})` : hexOf({ ...p.color, a: (p.color.a ?? 1) * (p.opacity ?? 1) });
    let n = slugVar(st.name);
    while (used.has(n)) n += '-style';
    used.add(n); map.set(st.name, n); lines.push(`  ${n}: ${val};`);
  }
  return { map, lines };
}

export function loadTokens(json, variables = null, styles = null) {
  const fv = variables && variables.some((c) => (c.variables || []).length) ? variablesToTokens(variables) : null;
  const fx = effectTokens(styles);
  const ps = paintTokens(styles, fv);
  const base = fv ? null : loadTokensJson(json);
  const modes = fv ? new Map(fv.modes) : new Map();
  const rootKey = [...modes.keys()].find((k) => k.startsWith(':root')) || ':root';
  if (fx.lines.length || ps.lines.length) modes.set(rootKey, [...(modes.get(rootKey) || []), ...ps.lines, ...fx.lines]);
  const figmaCss = [...modes].map(([sel, lines]) => `${sel} {\n${lines.join('\n')}\n}\n`).join('\n');
  return {
    count: fv ? fv.list.length : base.count,
    fromFigma: !!fv,
    colorVar: (hex) => (fv ? fv.byHex.get(normHex(hex)) || null : base.colorVar(hex)),
    varRef: (name, hex) => (fv ? fv.refFor(name, hex) : null),
    effectVar: (name) => fx.map.get(name) || null,
    styleRef: (name) => ps.map.get(name) || null,
    css: () => (fv ? figmaCss : base.css() + (fx.lines.length || ps.lines.length ? `:root {\n${[...ps.lines, ...fx.lines].join('\n')}\n}\n` : '')),
  };
}

function loadTokensJson(json) {
  const list = [];
  if (json) walk(json, [], list);
  const byHex = new Map();
  const vars = [];
  for (const t of list) {
    if (t.type !== 'color') continue;
    const hex = normHex(t.value);
    if (!hex) continue; // алиасы {color.x} и rgba пока пропускаем
    const name = '--' + t.path.join('-').replace(/[^a-zA-Z0-9-_]/g, '-');
    vars.push([name, hex]);
    // примитивы (color.*) приоритетнее семантики, первый найденный выигрывает
    if (!byHex.has(hex)) byHex.set(hex, name);
  }
  return {
    count: vars.length,
    colorVar: (hex) => byHex.get(normHex(hex)) || null,
    varRef: () => null,
    css: () => (vars.length ? `:root {\n${vars.map(([n, v]) => `  ${n}: ${v};`).join('\n')}\n}\n` : ''),
  };
}
