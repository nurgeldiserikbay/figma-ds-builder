// Экспорт дизайн-системы: W3C Design Tokens (DTCG), CSS, SCSS, Tailwind, Markdown.

const px = (v) => `${Math.round(v * 100) / 100}px`;

// токены из Figma несут свои path (для tokens.json) и css (имя переменной) — их и используем
function colorPath(t) {
  if (t.path) return t.path;
  return t.step ? ['color', t.family, String(t.step)] : ['color', t.name];
}
const cssVar = (t) => t.css || '--' + colorPath(t).join('-');
const scss = (t, fallback) => '$' + (t.css ? t.css.slice(2) : fallback);

function set(obj, path, value) {
  let o = obj;
  path.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; });
  o[path[path.length - 1]] = value;
}

function cssHex(hex) {
  // #RRGGBBAA → rgba() для совместимости
  if (hex.length === 9) {
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${Math.round((n(7) / 255) * 100) / 100})`;
  }
  return hex;
}

export function toTokens(ds) {
  const t = {};
  const byName = new Map(ds.colors.tokens.map((c) => [c.name, c]));
  for (const c of ds.colors.tokens) set(t, colorPath(c), { $type: 'color', $value: c.hex });
  for (const s of ds.colors.semantic) {
    const c = byName.get(s.token);
    if (c) set(t, s.path || ['semantic', s.role], { $type: 'color', $value: `{${colorPath(c).join('.')}}`, $description: s.why });
  }
  for (const g of ds.colors.gradients) set(t, ['gradient', g.name], { $type: 'gradient', $value: g.css });
  for (const f of ds.typography.families) set(t, ['font', 'family', f.role], { $type: 'fontFamily', $value: f.family });
  for (const w of ds.typography.weights || []) set(t, ['font', 'weight', w.name], { $type: 'fontWeight', $value: w.value });
  for (const s of ds.typography.styles) {
    set(t, ['typography', s.name], {
      $type: 'typography',
      $value: { fontFamily: s.family, fontSize: px(s.size), fontWeight: s.weight, lineHeight: s.lineHeight ? px(s.lineHeight) : 'normal', letterSpacing: px(s.letterSpacing || 0) },
    });
  }
  for (const s of ds.spacing.tokens) set(t, ['spacing', s.name], { $type: 'dimension', $value: px(s.value) });
  for (const r of ds.radius) set(t, ['radius', r.name], { $type: 'dimension', $value: px(r.value) });
  for (const s of ds.shadows) {
    set(t, ['shadow', s.name], { $type: 'shadow', $value: { color: s.hex, offsetX: px(s.x), offsetY: px(s.y), blur: px(s.blur), spread: px(s.spread), inset: s.type === 'INNER_SHADOW' } });
  }
  for (const b of ds.breakpoints) set(t, ['breakpoint', b.name], { $type: 'dimension', $value: px(b.value) });
  ds.borders.forEach((b, i) => set(t, ['border', 'width', String(i + 1)], { $type: 'dimension', $value: px(b.value) }));
  return t;
}

export function toCss(ds) {
  const L = [`/* Дизайн-система — ${ds.figma ? 'переменные и стили Figma' : 'сгенерировано ds-build analyze'} (${ds.meta.date}) */`, ':root {'];
  L.push('  /* Палитра */');
  for (const c of ds.colors.tokens) L.push(`  ${cssVar(c)}: ${cssHex(c.hex)};`);
  const byName = new Map(ds.colors.tokens.map((c) => [c.name, c]));
  if (ds.colors.semantic.length) {
    L.push('', '  /* Семантика */');
    for (const s of ds.colors.semantic) if (byName.get(s.token)) L.push(`  ${s.css || `--color-${s.role}`}: var(${cssVar(byName.get(s.token))});`);
  }
  if (ds.colors.gradients.length) { L.push('', '  /* Градиенты */'); ds.colors.gradients.forEach((g) => L.push(`  --${g.name}: ${g.css};`)); }
  L.push('', '  /* Шрифты */');
  ds.typography.families.forEach((f) => L.push(`  --font-${f.role}: "${f.family}", ${f.role === 'mono' ? 'monospace' : 'sans-serif'};`));
  ds.typography.styles.forEach((s) => {
    L.push(`  --text-${s.name}-size: ${px(s.size)};`);
    L.push(`  --text-${s.name}-line-height: ${s.lineHeight ? px(s.lineHeight) : 'normal'};`);
  });
  if (ds.spacing.tokens.length) { L.push('', ds.figma ? '  /* Отступы */' : `  /* Отступы (база ${ds.spacing.base}px) */`); ds.spacing.tokens.forEach((s) => L.push(`  ${s.css || `--space-${s.name}`}: ${px(s.value)};`)); }
  if (ds.radius.length) { L.push('', '  /* Радиусы */'); ds.radius.forEach((r) => L.push(`  ${r.css || `--radius-${r.name}`}: ${px(r.value)};`)); }
  if (ds.shadows.length) { L.push('', '  /* Тени */'); ds.shadows.forEach((s) => L.push(`  --shadow-${s.name}: ${s.css};`)); }
  L.push('}', '');
  const fam = (s) => {
    const f = ds.typography.families.find((x) => x.family === s.family);
    return f ? `var(--font-${f.role})` : `"${s.family}", sans-serif`;
  };
  for (const s of ds.typography.styles) {
    // из Figma — те же классы, что в вёрстке (type-body-medium)
    L.push(`.${ds.figma ? 'type' : 'text'}-${s.name} { font-family: ${fam(s)}; font-size: var(--text-${s.name}-size); line-height: var(--text-${s.name}-line-height); font-weight: ${s.weight};${s.letterSpacing ? ` letter-spacing: ${px(s.letterSpacing)};` : ''} }`);
  }
  return L.join('\n') + '\n';
}

export function toScss(ds) {
  const L = [`// Дизайн-система — ${ds.figma ? 'переменные и стили Figma' : 'сгенерировано ds-build analyze'} (${ds.meta.date})`, ''];
  ds.colors.tokens.forEach((c) => L.push(`${scss(c, `color-${c.name}`)}: ${cssHex(c.hex)};`));
  const byName = new Map(ds.colors.tokens.map((c) => [c.name, c]));
  ds.colors.semantic.forEach((s) => byName.get(s.token) && L.push(`${scss(s, `color-${s.role}`)}: ${scss(byName.get(s.token), `color-${s.token}`)};`));
  L.push('');
  ds.typography.families.forEach((f) => L.push(`$font-${f.role}: "${f.family}", sans-serif;`));
  ds.spacing.tokens.forEach((s) => L.push(`${scss(s, `space-${s.name}`)}: ${px(s.value)};`));
  ds.radius.forEach((r) => L.push(`${scss(r, `radius-${r.name}`)}: ${px(r.value)};`));
  ds.shadows.forEach((s) => L.push(`$shadow-${s.name}: ${s.css};`));
  L.push('', '$breakpoints: (');
  ds.breakpoints.forEach((b) => L.push(`  ${b.name}: ${px(b.value)},`));
  L.push(');', '');
  for (const s of ds.typography.styles) {
    L.push(`@mixin ${ds.figma ? 'type' : 'text'}-${s.name} {`, `  font-family: "${s.family}", sans-serif;`, `  font-size: ${px(s.size)};`,
      `  line-height: ${s.lineHeight ? px(s.lineHeight) : 'normal'};`, `  font-weight: ${s.weight};`,
      ...(s.letterSpacing ? [`  letter-spacing: ${px(s.letterSpacing)};`] : []), '}');
  }
  return L.join('\n') + '\n';
}

export function toTailwind(ds) {
  const colors = {};
  for (const c of ds.colors.tokens) {
    if (c.step) { colors[c.family] = colors[c.family] || {}; colors[c.family][c.step] = cssHex(c.hex); } else colors[c.name] = cssHex(c.hex);
  }
  const byName = new Map(ds.colors.tokens.map((c) => [c.name, c]));
  for (const s of ds.colors.semantic) if (byName.get(s.token)) colors[s.role] = cssHex(byName.get(s.token).hex);
  const mk = (arr, f) => Object.fromEntries(arr.map((x) => [x.name, f(x)]));
  const theme = {
    colors,
    fontFamily: Object.fromEntries(ds.typography.families.map((f) => [f.role, [f.family, 'sans-serif']])),
    fontSize: mk(ds.typography.styles, (s) => [px(s.size), { lineHeight: s.lineHeight ? px(s.lineHeight) : 'normal', fontWeight: String(s.weight), ...(s.letterSpacing ? { letterSpacing: px(s.letterSpacing) } : {}) }]),
    spacing: mk(ds.spacing.tokens, (s) => px(s.value)),
    borderRadius: mk(ds.radius, (r) => px(r.value)),
    boxShadow: mk(ds.shadows, (s) => s.css),
    backgroundImage: mk(ds.colors.gradients, (g) => g.css),
  };
  const screens = Object.fromEntries(ds.breakpoints.filter((b) => b.name !== 'mobile').map((b) => [b.name, px(b.value)]));
  return `/** Дизайн-система — ${ds.figma ? 'переменные и стили Figma' : 'сгенерировано ds-build analyze'} (${ds.meta.date}). screens — ширины макетов (min-width). */
module.exports = {
  theme: {
    screens: ${JSON.stringify(screens, null, 2).replace(/\n/g, '\n    ')},
    extend: ${JSON.stringify(theme, null, 2).replace(/\n/g, '\n    ')}
  }
};
`;
}

export function toMarkdown(ds, title) {
  const L = [`# Дизайн-система: ${title}`, '', ds.figma
    ? `_Источник — переменные и стили Figma (имена как у дизайнера), ${ds.meta.date}. Аудит ниже — по ${ds.meta.frames.length} фреймам._`
    : `_Сгенерировано ds-build analyze, ${ds.meta.date}. Фреймов: ${ds.meta.frames.length}._`, ''];
  const a = ds.audit;
  L.push(`## Аудит: ${a.score}/100`, '');
  a.issues.forEach((i) => L.push(`- ${i.text}`));
  L.push('', `Цветов в макетах: ${ds.colors.mergedFrom} → токенов: ${ds.colors.tokens.length}. Контраст AA: ${Math.round(a.metrics.contrastPass * 100)}% фрагментов текста. Отступы на сетке ${ds.spacing.base}px: ${Math.round(ds.spacing.onGridShare * 100)}%.`, '');
  if (ds.figma) {
    L.push('## Цвета: палитра', '', '| CSS | Значение | Переменная Figma |', '|---|---|---|');
    ds.colors.tokens.forEach((c) => L.push(`| \`${cssVar(c)}\` | \`${c.hex}\` | ${c.figma || ''} |`));
  } else {
    L.push('## Цвета', '', '| Токен | Значение | Использований | Объединено |', '|---|---|---|---|');
    ds.colors.tokens.forEach((c) => L.push(`| \`${c.name}\` | \`${c.hex}\` | ${c.uses} | ${c.members.length > 1 ? c.members.filter((m) => m !== c.hex).map((m) => `\`${m}\``).join(' ') : ''} |`));
  }
  if (ds.colors.semantic.length) {
    L.push('', '### Семантика', '', '| Роль | Токен | Почему |', '|---|---|---|');
    ds.colors.semantic.forEach((s) => L.push(`| \`${s.css || s.role}\` | \`${s.ref || s.token}\` \`${s.hex}\` | ${s.why} |`));
  }
  if (ds.colors.rare.length) {
    L.push('', '### Редкие оттенки → замена', '', '| Было | Стало | ΔE |', '|---|---|---|');
    ds.colors.rare.forEach((r) => L.push(`| \`${r.hex}\` | \`${r.into}\` | ${r.deltaE} |`));
  }
  L.push('', '## Типографика', '');
  ds.typography.families.forEach((f) => L.push(`- **${f.role}**: ${f.family} (${Math.round(f.share * 100)}% текста)`));
  if (ds.typography.ratio) L.push(`- Модульная шкала заголовков: ×${ds.typography.ratio}`);
  L.push('', '| Стиль | Кегль / интерлиньяж | Начертание | Шрифт |', '|---|---|---|---|');
  ds.typography.styles.forEach((s) => L.push(`| \`${s.name}\` | ${s.size} / ${s.lineHeight ?? 'auto'} | ${s.weight} | ${s.family} |`));
  L.push('', ds.figma ? '## Отступы' : `## Отступы (база ${ds.spacing.base}px)`, '', ds.spacing.tokens.map((s) => `\`${s.css || s.name}\` ${s.value}`).join(' · '));
  if (ds.spacing.rare.length) L.push('', `Вне сетки / редкие: ${ds.spacing.rare.join(', ')}`);
  L.push('', '## Радиусы', '', ds.radius.map((r) => `\`${r.css || r.name}\` ${r.value >= 999 ? 'full' : r.value}`).join(' · ') || '—');
  L.push('', '## Тени', '', ...(ds.shadows.length ? ds.shadows.map((s) => `- \`${s.name}\`: \`${s.css}\``) : ['—']));
  L.push('', '## Брейкпоинты', '', ds.breakpoints.map((b) => `\`${b.name}\` ${b.value}px`).join(' · ') || '—');
  if (a.contrast.length) {
    L.push('', '## Контраст (WCAG AA)', '', '| Текст | Фон | Контраст | Фрагментов | Примеры |', '|---|---|---|---|---|');
    a.contrast.slice(0, 15).forEach((c) => L.push(`| \`${c.fg}\` | \`${c.bg}\` | ${c.ratio} | ${c.count} | ${c.examples.join('; ')} |`));
  }
  return L.join('\n') + '\n';
}

export function exportFiles(ds, title, raw = ds) {
  return {
    'tokens.json': JSON.stringify(toTokens(ds), null, 2) + '\n',
    'variables.css': toCss(ds),
    '_tokens.scss': toScss(ds),
    'tailwind.config.js': toTailwind(ds),
    'design-system.md': toMarkdown(ds, title),
    'analysis.json': JSON.stringify(raw, null, 2) + '\n', // анализ по пикселям — как есть
  };
}
