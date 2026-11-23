#!/usr/bin/env node
// Прогон генератора на открытых макетах: скачать → .fig → пакет → ds-build → сводка.
//
//   node src/run.js [--runs 2] [--only id] [--work ../../.bench]
//
// --runs N — повторить сборку N раз и проверить, что результаты совпадают (детерминизм).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';


const here = path.dirname(fileURLToPath(import.meta.url));
const benchDir = path.resolve(here, '..');
const builderCli = path.resolve(benchDir, '../builder/src/cli.js');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const runs = parseInt(opt('--runs', '1'), 10);
const only = opt('--only', null);
const work = path.resolve(opt('--work', path.join(benchDir, '../../.bench')));
const cfg = JSON.parse(fs.readFileSync(path.join(benchDir, 'sources.json'), 'utf8'));

const sh = (cmd, a, o = {}) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...o }).toString();

// 1. скачивание (без истории, только нужные файлы)
function fetchFile(repo, file) {
  const dir = path.join(work, 'repos', repo.replace('/', '__'));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    sh('git', ['clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', `https://github.com/${repo}`, dir], { timeout: 600000 });
  }
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) sh('git', ['-C', dir, 'checkout', '-q', 'HEAD', '--', file], { timeout: 600000 });
  return full;
}

const rows = [];
const dsChecks = [];
const sources = cfg.sources.filter((s) => !only || s.id === only);

for (const src of sources) {
  let pkg;
  if (src.package) {
    // готовый пакет из плагина (лежит в репозитории): эталоны PNG — из самой Figma
    pkg = path.resolve(benchDir, src.package);
    console.log(`${src.id}: пакет плагина ${src.package}`);
  } else {
    const fig = fetchFile(src.repo, src.fig);
    const refs = Object.entries(src.reference || {}).flatMap(([name, file]) => ['--reference', `${name}=${fetchFile(src.repo, file)}`]);
    pkg = path.join(work, 'packages', src.id);
    console.log(sh('node', [path.join(here, 'fig2package.js'), fig, '--out', pkg, ...refs]).trim());
  }

  const fingerprints = [];
  for (let r = 1; r <= runs; r++) {
    const out = path.join(work, 'out', src.id + (runs > 1 ? `-run${r}` : ''));
    fs.rmSync(out, { recursive: true, force: true });
    try {
      sh('node', [builderCli, 'build', pkg, '--out', out], { timeout: 1800000, env: { ...process.env, DS_BUILD_CACHE: path.join(work, 'cache') } });
    } catch (e) {
      if (e.status !== 2) throw e; // 2 — есть фреймы, не прошедшие проверку
    }
    const rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
    fingerprints.push(JSON.stringify(rep.results.map((x) => [x.id, x.mode, x.diff?.mismatched ?? null, x.geometry?.failed])));
    if (r > 1) continue;
    for (const x of rep.results) {
      rows.push({
        source: src.id, frame: x.name, size: `${x.width}×${x.height}`, mode: x.mode,
        nodes: x.stats.nodes, auto: x.stats.figma || 0, inferred: (x.stats.col || 0) + (x.stats.row || 0), abs: x.stats.abs || 0,
        geometry: x.geometry ? `${x.geometry.checked - x.geometry.failed}/${x.geometry.checked}` : '—',
        maxDelta: x.geometry?.maxDelta ?? null,
        pixel: x.diff ? x.diff.percent : null,
        before: x.refine ? x.refine.before : null,
        text: x.pixels?.textPct ?? null, other: x.pixels?.otherPct ?? null,
        pass: x.pass,
      });
    }
  }
  // сверка дизайн-системы с ожиданиями (например, SCSS автора шаблона)
  if (src.expect) {
    const ds = JSON.parse(fs.readFileSync(path.join(work, 'out', src.id + (runs > 1 ? '-run1' : ''), 'design-system', 'analysis.json'), 'utf8'));
    const checks = [];
    for (const [role, hex] of Object.entries(src.expect.semantic || {})) {
      const got = ds.colors.semantic.find((x) => x.role === role)?.hex;
      checks.push({ what: `semantic.${role}`, want: hex, got: got || '—', ok: got === hex });
    }
    const palette = new Set(ds.colors.tokens.flatMap((t) => t.members));
    for (const hex of src.expect.palette || []) checks.push({ what: 'palette', want: hex, got: palette.has(hex) ? 'есть' : 'нет', ok: palette.has(hex) });
    if (src.expect.spacingBase) checks.push({ what: 'spacing.base', want: src.expect.spacingBase, got: ds.spacing.base, ok: ds.spacing.base === src.expect.spacingBase });
    const ok = checks.filter((c) => c.ok).length;
    console.log(`  дизайн-система vs эталон: ${ok}/${checks.length}` + checks.filter((c) => !c.ok).map((c) => `\n    ✗ ${c.what}: ждали ${c.want}, получили ${c.got}`).join(''));
    dsChecks.push({ source: src.id, ok, total: checks.length, checks });
  }
  if (runs > 1) {
    const same = fingerprints.every((f) => f === fingerprints[0]);
    console.log(`  повторяемость (${runs} прогона): ${same ? 'результаты совпадают' : 'РЕЗУЛЬТАТЫ РАЗЛИЧАЮТСЯ'}`);
    rows.filter((r) => r.source === src.id).forEach((r) => (r.repeatable = same));
  }
}

const f3 = (v) => (v === null || v === undefined ? '—' : v.toFixed(3) + '%');
const md = [
  '| Макет | Фрейм | Размер | Слоёв | Auto Layout → flex | По геометрии | absolute | Геометрия ±0.5px | Pixel diff (до → после автодоработки) | Текст / остальное | Итог |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.source} | ${r.frame} | ${r.size} | ${r.nodes} | ${r.auto} | ${r.inferred} | ${r.abs} | ${r.geometry} (макс. ${r.maxDelta}px) | ${r.pixel === null ? 'нет эталона' : (r.before !== null ? f3(r.before) + ' → ' : '') + f3(r.pixel)} | ${r.pixel === null ? '—' : f3(r.text) + ' / ' + f3(r.other)} | ${r.pass ? '✓' : '✗'} |`),
].join('\n');
fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(work, 'summary.md'), md + '\n');
fs.writeFileSync(path.join(work, 'summary.json'), JSON.stringify({ frames: rows, designSystem: dsChecks }, null, 2));
console.log('\n' + md);
