// Дизайн-система из переменных и стилей Figma (variables.json, styles.json плагина).
// Если дизайнер завёл переменные, они — источник истины: имена и значения берутся из Figma,
// анализ по пикселям остаётся для аудита (контраст, редкие оттенки) и того, чего в переменных нет.
import { variablesToTokens } from '../tokens.js';

const hex2 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
const hexOf = (c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${(c.a ?? 1) < 1 ? hex2(c.a) : ''}`;
const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const WEIGHTS = [[/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi ?bold|demi ?bold/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/bold/i, 700], [/black|heavy/i, 900]];
const weightOf = (style) => (WEIGHTS.find(([re]) => re.test(style || '')) || [0, 400])[1];

/** Есть ли в пакете что брать из Figma. */
export function hasFigmaSystem(variables, styles) {
  return (variables || []).some((c) => (c.variables || []).length) || (styles?.text || []).length > 0;
}

/** ds из анализа + переменные/стили Figma → ds для экспорта (tokens.json, variables.css, SCSS, Tailwind, md). */
export function withFigma(ds, variables, styles) {
  const fv = variablesToTokens(variables || []);
  const first = (it) => it.v.values?.[it.coll.modes?.[0]];
  const byName = new Map(fv.list.map((it) => [it.v.name, it]));
  const resolve = (name, seen = new Set()) => {
    const it = byName.get(name);
    if (!it || seen.has(name)) return null;
    seen.add(name);
    const val = first(it);
    return val && typeof val === 'object' && 'alias' in val ? resolve(val.alias, seen) : it;
  };
  const usesByHex = new Map();
  for (const t of ds.colors.tokens) for (const m of t.members || [t.hex]) usesByHex.set(m.toLowerCase(), (usesByHex.get(m.toLowerCase()) || 0) + (m === t.hex ? t.uses : 0));

  const colorItems = fv.list.filter((it) => it.v.type === 'COLOR');
  const tokens = [], semantic = [];
  for (const it of colorItems) {
    const val = first(it);
    if (!val) continue;
    if (typeof val === 'object' && 'alias' in val) {
      const base = resolve(val.alias);
      if (!base) continue;
      const hex = hexOf(first(base));
      semantic.push({ role: it.css.slice(2), token: base.css.slice(2), hex, css: it.css, ref: base.css,
        path: ['semantic', ...it.v.name.split('/').filter((p, i) => !(i === 0 && p === 'color'))], why: `переменная Figma «${it.v.name}»` });
    } else {
      const hex = hexOf(val);
      tokens.push({ name: it.css.slice(2), hex, css: it.css, path: ['color', ...it.v.name.split('/').filter((p, i) => !(i === 0 && p === 'color'))],
        uses: usesByHex.get(hex.toLowerCase()) || 0, members: [hex], figma: it.v.name });
    }
  }
  const numbers = (pred) => fv.list.filter((it) => it.v.type === 'FLOAT' && pred(it)).map((it) => {
    const base = resolve(it.v.name);
    const value = base ? first(base) : null;
    return typeof value === 'number' ? { name: it.css.slice(2).replace(/^(space|spacing|radius)-/, ''), value, css: it.css, figma: it.v.name } : null;
  }).filter(Boolean);
  const isRadius = (it) => (it.v.scopes || []).includes('CORNER_RADIUS') || /radius|corner/i.test(it.v.name);
  const isSpace = (it) => !isRadius(it) && ((it.v.scopes || []).some((s) => s === 'GAP') || /space|spacing|gap|padding/i.test(it.v.name));

  const out = { ...ds, figma: true, colors: { ...ds.colors }, typography: { ...ds.typography }, spacing: { ...ds.spacing } };
  if (tokens.length) { out.colors.tokens = tokens; out.colors.semantic = semantic; out.colors.rare = []; }
  const space = numbers(isSpace);
  if (space.length) out.spacing.tokens = space.sort((a, b) => a.value - b.value);
  const rad = numbers(isRadius);
  if (rad.length) out.radius = rad.sort((a, b) => a.value - b.value);
  const text = (styles?.text || []).map((s) => {
    const lh = s.lineHeight?.unit === 'PIXELS' ? s.lineHeight.value : s.lineHeight?.unit === 'PERCENT' ? (s.lineHeight.value / 100) * s.fontSize : null;
    const ls = s.letterSpacing?.unit === 'PERCENT' ? (s.letterSpacing.value / 100) * s.fontSize : s.letterSpacing?.value || 0;
    return { name: slug(s.name), size: s.fontSize, lineHeight: lh ? Math.round(lh * 100) / 100 : null, weight: weightOf(s.fontStyle),
      family: s.fontFamily, letterSpacing: Math.round(ls * 100) / 100, figma: s.name };
  });
  if (text.length) out.typography.styles = text;
  const px = (v) => `${Math.round((v || 0) * 100) / 100}px`;
  const shadows = (styles?.effect || []).map((st) => {
    const sh = (st.effects || []).filter((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW');
    if (!sh.length) return null;
    const e = sh[0];
    const name = slug(st.name).replace(/^shadow-/, '');
    return { name, css: sh.map((x) => `${x.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(x.x)} ${px(x.y)} ${px(x.blur)} ${px(x.spread)} ${hexOf(x.color)}`).join(', '),
      hex: hexOf(e.color), x: e.x, y: e.y, blur: e.blur, spread: e.spread, type: e.type, figma: st.name };
  }).filter(Boolean);
  if (shadows.length) out.shadows = shadows;
  return out;
}
