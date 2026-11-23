// Несколько пакетов (части одной выгрузки или разные выгрузки одного файла) → один пакет.
// Фреймы складываются, файлы frames/ vectors/ images/ объединяются (имена — по id слоя и хэшу картинки),
// шрифты суммируются, переменные/стили/токены — из первого пакета (они общие для файла).
import fs from 'node:fs';
import path from 'node:path';

/** @param dirs папки пакетов (с manifest.json) @returns {{ dir: string, notes: string[] }} */
export function mergePackages(dirs, outDir) {
  const notes = [];
  const mans = dirs.map((d) => JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')));
  // проверка частей: все ли на месте
  const byExport = new Map();
  mans.forEach((m) => { if (m.part) { const k = m.part.id; if (!byExport.has(k)) byExport.set(k, { total: m.part.total, got: new Set() }); byExport.get(k).got.add(m.part.index); } });
  for (const [, e] of byExport) {
    const miss = [];
    for (let i = 1; i <= e.total; i++) if (!e.got.has(i)) miss.push(i);
    if (miss.length) notes.push(`Не хватает частей выгрузки: ${miss.join(', ')} из ${e.total} — они не будут свёрстаны`);
  }
  // порядок: по номеру части
  const order = dirs.map((d, i) => ({ d, m: mans[i] })).sort((a, b) => (a.m.part?.index || 0) - (b.m.part?.index || 0));

  fs.mkdirSync(outDir, { recursive: true });
  const frames = [];
  const seen = new Set();
  const fonts = new Map();
  const comps = new Map(); // описания компонентов — объединение частей
  for (const { d, m } of order) {
    const cp = m.components && path.join(d, m.components);
    if (cp && fs.existsSync(cp)) for (const c of JSON.parse(fs.readFileSync(cp, 'utf8'))) if (!comps.has(c.name)) comps.set(c.name, c);
    for (const sub of ['frames', 'vectors', 'images']) {
      const from = path.join(d, sub);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(outDir, sub), { recursive: true, force: false, errorOnExist: false });
    }
    for (const f of m.frames || []) {
      if (seen.has(f.id)) continue; // тот же фрейм в двух выгрузках — один раз
      seen.add(f.id);
      frames.push(f);
    }
    const fp = path.join(d, m.fonts || 'fonts.json');
    if (fs.existsSync(fp)) {
      for (const f of JSON.parse(fs.readFileSync(fp, 'utf8'))) {
        const k = `${f.family}\u0000${f.style}`;
        const cur = fonts.get(k);
        if (!cur) fonts.set(k, { ...f, sizes: [...(f.sizes || [])] });
        else { cur.uses += f.uses || 0; cur.sizes = [...new Set([...cur.sizes, ...(f.sizes || [])])].sort((a, b) => a - b); }
      }
    }
  }
  const first = order[0];
  for (const k of ['variables', 'styles', 'tokens']) {
    const rel = first.m[k] || `${k}.json`;
    const p = path.join(first.d, rel);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(outDir, path.basename(rel)));
  }
  // список шрифтов — только если он был хотя бы в одной части (иначе программа берёт шрифты из дерева слоёв)
  if (fonts.size) fs.writeFileSync(path.join(outDir, 'fonts.json'), JSON.stringify([...fonts.values()].sort((a, b) => b.uses - a.uses), null, 2));
  if (comps.size) fs.writeFileSync(path.join(outDir, 'components.json'), JSON.stringify([...comps.values()], null, 2));
  const manifest = { ...first.m, frames, part: undefined, fonts: fonts.size ? 'fonts.json' : undefined, components: comps.size ? 'components.json' : undefined,
    warnings: order.flatMap(({ m }) => m.warnings || []), parts: order.length };
  if (!manifest.warnings.length) delete manifest.warnings;
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir: outDir, notes };
}
