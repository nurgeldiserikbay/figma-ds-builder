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

export function loadTokens(json) {
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
    css: () => (vars.length ? `:root {\n${vars.map(([n, v]) => `  ${n}: ${v};`).join('\n')}\n}\n` : ''),
  };
}
