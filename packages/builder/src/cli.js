#!/usr/bin/env node
// ds-build — пакет из плагина Figma → вёрстка → проверка pixel perfect.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadPackage, copyAssets } from './package.js';
import { loadTokens } from './tokens.js';
import { generateFrame } from './generate.js';
import { openBrowser, renderPage } from './render.js';
import { comparePng } from './diff.js';
import { buildReport } from './report.js';
import { checkGeometry } from './geometry.js';
import { attributeDiff } from './attribute.js';
import { refinePage, patchesCss } from './refine.js';
import { analyzeDesignSystem } from './ds/analyze.js';
import { exportFiles, toTokens } from './ds/export.js';
import { familiesOf, ensureFonts, buildFontsCss, defaultCacheDir } from './fonts.js';

const HELP = `
ds-build analyze <пакет | пакет.zip> [--out папка] [--delta-e 3] [--min-uses 2]
  Дизайн-система по всем фреймам пакета: tokens.json (W3C), variables.css, _tokens.scss,
  tailwind.config.js, design-system.md (с аудитом), analysis.json. По умолчанию — в ./out/design-system.

ds-build build <пакет | пакет.zip> [опции]
  Вёрстка всех фреймов + проверка с эталонами. Если в пакете нет tokens.json, дизайн-система
  строится автоматически (как analyze) и цвета в вёрстке подставляются как var(--color-…).

  --out <папка>        куда положить результат (по умолчанию ./out)
  --layout <режим>     auto (по умолчанию) | flow | absolute
                         flow     — flex по Auto Layout и геометрии (чистый код)
                         absolute — абсолютное позиционирование (запасной, максимально точный)
                         auto     — сначала flow; если не проходит порог, пробует absolute
  --threshold <%>      допустимая доля несовпадающих пикселей вне текста, по умолчанию 0.1
  --text-threshold <%> допуск для пикселей текста (растеризация шрифтов в Figma и браузере различается),
                       по умолчанию 0.5; положение текстовых блоков всё равно проверяется геометрией ±0.5px
  --frame <имя|id>     собрать только этот фрейм (можно несколько раз)
  --fonts <режим>      auto (по умолчанию) — бесплатные шрифты макета скачиваются из npm (@fontsource);
                       none — только шрифты, установленные в системе
  --css <файл>         подключить дополнительный CSS ко всем страницам (например, свои @font-face)
  --open               открыть отчёт в браузере после сборки
  --no-refine          не подбирать поправки после сверки с эталоном
  --no-verify          не рендерить и не сравнивать

Переменные окружения: CHROME_PATH — путь к Chrome, если он не найден автоматически.
`;

function parseArgs(argv) {
  const a = { _: [], frames: [], css: [], layout: 'auto', threshold: 0.1, textThreshold: 0.5, out: 'out', verify: true, refine: true, analyze: true, fonts: 'auto' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i];
    else if (k === '--layout') a.layout = argv[++i];
    else if (k === '--threshold') a.threshold = parseFloat(argv[++i]);
    else if (k === '--text-threshold') a.textThreshold = parseFloat(argv[++i]);
    else if (k === '--frame') a.frames.push(argv[++i]);
    else if (k === '--css') a.css.push(argv[++i]);
    else if (k === '--no-verify') a.verify = false;
    else if (k === '--no-refine') a.refine = false;
    else if (k === '--no-analyze') a.analyze = false;
    else if (k === '--fonts') a.fonts = argv[++i];
    else if (k === '--open') a.open = true;
    else if (k === '--delta-e') a.deltaE = parseFloat(argv[++i]);
    else if (k === '--min-uses') a.minUses = parseInt(argv[++i], 10);
    else if (k === '-h' || k === '--help') a.help = true;
    else a._.push(k);
  }
  return a;
}

function resolvePackageDir(input) {
  if (!input.endsWith('.zip')) return input;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-package-'));
  // встроенных средств распаковки zip в Node нет: используем системные
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${input}' -DestinationPath '${dir}' -Force`]);
  } else {
    execFileSync('unzip', ['-q', input, '-d', dir]);
  }
  // zip может содержать папку верхнего уровня
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  const sub = fs.readdirSync(dir).map((n) => path.join(dir, n)).find((p) => fs.existsSync(path.join(p, 'manifest.json')));
  return sub || dir;
}

/** Доли несовпадающих пикселей: текст отдельно от остального. */
function pixelSplit(diff) {
  if (!diff) return null;
  const total = diff.total || 1;
  const text = diff.sources?.byType?.['текст'] || 0;
  return { textPct: (text / total) * 100, otherPct: ((diff.mismatched - text) / total) * 100 };
}
const pixelOk = (diff, args) => {
  const p = pixelSplit(diff);
  return !p || (p.otherPct <= args.threshold && p.textPct <= args.textThreshold);
};

function openFile(file) {
  const [cmd, a] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  try { execFileSync(cmd, a, { stdio: 'ignore' }); } catch { /* нет графической среды */ }
}

const safe = (s) => String(s).replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '_').replace(/^_+|_+$/g, '') || 'frame';

function runAnalysis(pkg, args, outDir) {
  const opts = {};
  if (args.deltaE) opts.deltaE = args.deltaE;
  if (args.minUses) opts.minUses = args.minUses;
  const ds = analyzeDesignSystem(pkg.frames.map((f) => ({ name: f.name, tree: f.tree() })), opts);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, data] of Object.entries(exportFiles(ds, pkg.manifest.file))) fs.writeFileSync(path.join(outDir, name), data);
  return ds;
}

async function analyze(args) {
  const pkg = loadPackage(resolvePackageDir(args._[1]));
  const outDir = path.resolve(args.out === 'out' ? 'out/design-system' : args.out);
  const ds = runAnalysis(pkg, args, outDir);
  console.log(`Дизайн-система: ${pkg.manifest.file}`);
  console.log(`  цвета: ${ds.colors.mergedFrom} → ${ds.colors.tokens.length} токенов; семантика: ${ds.colors.semantic.map((s) => `${s.role}=${s.hex}`).join(', ')}`);
  console.log(`  текст: ${ds.typography.styles.map((s) => `${s.name} ${s.size}`).join(', ')}`);
  console.log(`  отступы (база ${ds.spacing.base}): ${ds.spacing.tokens.map((s) => s.value).join(', ')}`);
  console.log(`  аудит: ${ds.audit.score}/100 — ${ds.audit.issues.map((i) => i.text).join('; ') || 'замечаний нет'}`);
  console.log(`Файлы: ${outDir}`);
}

async function build(args) {
  const pkgDir = resolvePackageDir(args._[1]);
  const pkg = loadPackage(pkgDir);
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  // токены: из плагина, иначе — собственный анализ дизайн-системы
  // дизайн-система строится всегда; готовые токены из пакета (если есть) — приоритетнее для переменных в CSS
  let tokenJson = pkg.tokens;
  if (args.analyze) {
    const ds = runAnalysis(pkg, args, path.join(out, 'design-system'));
    if (!tokenJson) tokenJson = toTokens(ds);
    console.log(`Дизайн-система: ${ds.colors.tokens.length} цветов, ${ds.typography.styles.length} стилей текста, аудит ${ds.audit.score}/100 → design-system/`);
  }
  const tokens = loadTokens(tokenJson);
  copyAssets(pkg, out);
  fs.writeFileSync(path.join(out, 'tokens.css'), tokens.css() || '/* токенов нет */\n');
  // шрифты макета: бесплатные — из npm, остальные должны быть установлены в системе
  const fontFiles = [];
  if (args.fonts !== 'none') {
    const fams = familiesOf(pkg);
    const res = ensureFonts(fams, defaultCacheDir(), { log: (m) => console.log(m) });
    const css = buildFontsCss(res.dir, res.found);
    if (css) { fs.writeFileSync(path.join(out, 'fonts.css'), css); fontFiles.push('fonts.css'); }
    console.log(`Шрифты: ${res.found.length ? res.found.join(', ') + ' — подключены' : 'из npm не нужны'}` +
      (res.missing.length ? `; не найдены в npm (установите в систему): ${res.missing.join(', ')}` : ''));
  }
  const extraCss = [...fontFiles, ...args.css.map((f, i) => {
    const name = `extra-${i + 1}.css`;
    fs.copyFileSync(f, path.join(out, name));
    return name;
  })];

  let frames = pkg.frames;
  if (args.frames.length) frames = frames.filter((f) => args.frames.includes(f.name) || args.frames.includes(f.id));
  if (!frames.length) throw new Error('Нет фреймов для сборки');

  console.log(`Пакет: ${pkg.manifest.file} · фреймов: ${frames.length} · токенов цвета: ${tokens.count}`);
  const browser = args.verify ? await openBrowser() : null;
  const results = [];
  const modes = args.layout === 'auto' ? ['flow', 'absolute'] : [args.layout];

  try {
    for (const f of frames) {
      const tree = f.tree();
      const dirName = safe(`${f.name}-${f.id}`);
      const fdir = path.join(out, dirName);
      fs.mkdirSync(fdir, { recursive: true });
      const hasRef = args.verify && f.pngPath && fs.existsSync(f.pngPath);
      if (hasRef) fs.copyFileSync(f.pngPath, path.join(fdir, 'reference.png'));

      const attempts = [];
      let chosen = null;
      for (const mode of modes) {
        const gen = generateFrame(tree, { mode, tokens, assetUrl: (rel) => `../assets/${rel}`, title: f.name, extraCss });
        // пробные варианты — рядом с папкой фрейма (та же глубина, пути к assets не меняются)
        const attemptDir = modes.length > 1 ? path.join(out, `${dirName}.try-${mode}`) : fdir;
        fs.mkdirSync(attemptDir, { recursive: true });
        fs.writeFileSync(path.join(attemptDir, 'index.html'), gen.html);
        fs.writeFileSync(path.join(attemptDir, 'styles.css'), gen.css);
        const att = { mode, gen, dir: attemptDir, percent: NaN };
        if (browser) {
          const rendered = await renderPage(browser, path.join(attemptDir, 'index.html'), {
            width: f.width, height: f.height, scale: pkg.scale, out: path.join(attemptDir, 'render.png'),
          });
          att.fonts = rendered.fonts;
          att.geometry = checkGeometry(tree, rendered.boxes);
          if (hasRef) {
            att.diff = comparePng(path.join(fdir, 'reference.png'), path.join(attemptDir, 'render.png'), path.join(attemptDir, 'diff.png'));
            att.percent = att.diff.percent;
            if (att.diff.mismatched) att.diff.sources = attributeDiff(tree, path.join(attemptDir, 'diff.png'), { scale: pkg.scale });
            // автодоработка: подбор поправок для слоёв с наибольшим расхождением
            // запускаем и при прохождении порога: сдвиг строки на 1–2px укладывается в допуск для текста,
            // но исправляется поправкой
            const textMiss = att.diff.sources?.top.some((t) => t.type === 'TEXT' && t.pixels >= 150);
            if (args.refine && att.diff.sources && (!pixelOk(att.diff, args) || textMiss)) {
              const patches = await refinePage(browser, path.join(attemptDir, 'index.html'), {
                refPath: path.join(fdir, 'reference.png'), tree, sources: att.diff.sources,
                width: f.width, height: f.height, scale: pkg.scale,
              });
              if (patches.length) {
                fs.appendFileSync(path.join(attemptDir, 'styles.css'), patchesCss(patches));
                const re = await renderPage(browser, path.join(attemptDir, 'index.html'), {
                  width: f.width, height: f.height, scale: pkg.scale, out: path.join(attemptDir, 'render.png'),
                });
                att.geometry = checkGeometry(tree, re.boxes);
                const before = att.percent;
                att.diff = comparePng(path.join(fdir, 'reference.png'), path.join(attemptDir, 'render.png'), path.join(attemptDir, 'diff.png'));
                att.percent = att.diff.percent;
                if (att.diff.mismatched) att.diff.sources = attributeDiff(tree, path.join(attemptDir, 'diff.png'), { scale: pkg.scale });
                att.refine = { before, after: att.percent, patches };
              }
            }
          }
        }
        attempts.push(att);
        if (attemptDir !== fdir && hasRef) fs.copyFileSync(path.join(fdir, 'reference.png'), path.join(attemptDir, 'reference.png'));
        att.ok = (!att.geometry || att.geometry.failed === 0) && (!hasRef || pixelOk(att.diff, args));
        if (att.ok || (!hasRef && !att.geometry)) { chosen = att; break; }
      }
      // чистая раскладка (первая попытка) остаётся, если запасная не лучше заметно (на 20%)
      const score = (a) => (a.geometry?.failed || 0) * 1000 + (Number.isNaN(a.percent) ? 0 : a.percent);
      if (!chosen) chosen = attempts.reduce((a, b) => (score(b) < score(a) * 0.8 ? b : a));
      chosen.chosen = true;

      // выбранный вариант кладём в папку фрейма
      if (chosen.dir !== fdir) {
        for (const name of ['index.html', 'styles.css', 'render.png', 'diff.png']) {
          const src = path.join(chosen.dir, name);
          if (!fs.existsSync(src)) continue;
          fs.copyFileSync(src, path.join(fdir, name));
        }
      }
      for (const a of attempts) if (a.dir !== fdir) fs.rmSync(a.dir, { recursive: true, force: true });

      const pass = browser ? !!chosen.ok : null;
      results.push({
        name: f.name, id: f.id, width: f.width, height: f.height, dir: dirName,
        mode: chosen.mode, stats: chosen.gen.stats, fonts: chosen.fonts, diff: chosen.diff, geometry: chosen.geometry, refine: chosen.refine, pixels: pixelSplit(chosen.diff), pass,
        attempts: attempts.map((a) => ({ mode: a.mode, percent: a.percent, geometryFailed: a.geometry?.failed ?? null, chosen: a.chosen })),
      });
      const geo = chosen.geometry ? `геометрия ${chosen.geometry.checked - chosen.geometry.failed}/${chosen.geometry.checked} (макс. ${chosen.geometry.maxDelta}px)` : '';
      const sp = pixelSplit(chosen.diff);
      const pix = hasRef ? `pixel diff ${chosen.percent.toFixed(3)}% (текст ${sp.textPct.toFixed(3)}%, остальное ${sp.otherPct.toFixed(3)}%)` : 'без эталона';
      const ref = chosen.refine ? ` (до автодоработки ${chosen.refine.before.toFixed(3)}%, поправок ${chosen.refine.patches.length})` : '';
      const status = `${pix}${ref} · ${geo} · ${pass === null ? '' : pass ? 'OK' : 'FAIL'}`;
      console.log(`  ${f.name}: ${chosen.mode} · ${status}`);
    }
  } finally {
    await browser?.close();
  }

  fs.writeFileSync(path.join(out, 'report.html'), buildReport({ file: pkg.manifest.file, threshold: args.threshold, textThreshold: args.textThreshold, results }));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ file: pkg.manifest.file, threshold: args.threshold,
    results: results.map(({ stats, ...r }) => ({ ...r, stats })) }, null, 2));
  console.log(`Отчёт: ${path.join(out, 'report.html')}`);
  if (args.open) openFile(path.join(out, 'report.html'));
  const failed = results.filter((r) => r.pass === false).length;
  if (failed) process.exitCode = 2;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !['build', 'analyze'].includes(args._[0]) || !args._[1]) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}
(args._[0] === 'analyze' ? analyze(args) : build(args)).catch((e) => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
