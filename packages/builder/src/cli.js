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

const HELP = `
ds-build build <пакет | пакет.zip> [опции]

  --out <папка>        куда положить результат (по умолчанию ./out)
  --layout <режим>     auto (по умолчанию) | flow | absolute
                         flow     — flex по Auto Layout и геометрии (чистый код)
                         absolute — абсолютное позиционирование (запасной, максимально точный)
                         auto     — сначала flow; если не проходит порог, пробует absolute
  --threshold <%>      допустимая доля несовпадающих пикселей, по умолчанию 0.1
  --frame <имя|id>     собрать только этот фрейм (можно несколько раз)
  --no-verify          не рендерить и не сравнивать

Переменные окружения: CHROME_PATH — путь к Chrome, если он не найден автоматически.
`;

function parseArgs(argv) {
  const a = { _: [], frames: [], layout: 'auto', threshold: 0.1, out: 'out', verify: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i];
    else if (k === '--layout') a.layout = argv[++i];
    else if (k === '--threshold') a.threshold = parseFloat(argv[++i]);
    else if (k === '--frame') a.frames.push(argv[++i]);
    else if (k === '--no-verify') a.verify = false;
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

const safe = (s) => String(s).replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '_').replace(/^_+|_+$/g, '') || 'frame';

async function build(args) {
  const pkgDir = resolvePackageDir(args._[1]);
  const pkg = loadPackage(pkgDir);
  const tokens = loadTokens(pkg.tokens);
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  copyAssets(pkg, out);
  fs.writeFileSync(path.join(out, 'tokens.css'), tokens.css() || '/* токенов нет */\n');

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
        const gen = generateFrame(tree, { mode, tokens, assetUrl: (rel) => `../assets/${rel}`, title: f.name });
        const attemptDir = modes.length > 1 ? path.join(fdir, `.${mode}`) : fdir;
        fs.mkdirSync(attemptDir, { recursive: true });
        // assets лежат на уровень выше папки фрейма; для вложенной попытки — на два
        const html = modes.length > 1 ? gen.html.replace(/\.\.\/(assets|tokens\.css)/g, '../../$1') : gen.html;
        fs.writeFileSync(path.join(attemptDir, 'index.html'), html);
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
          }
        }
        attempts.push(att);
        att.ok = (!att.geometry || att.geometry.failed === 0) && (!hasRef || att.percent <= args.threshold);
        if (att.ok || (!hasRef && !att.geometry)) { chosen = att; break; }
      }
      const score = (a) => (a.geometry?.failed || 0) * 1000 + (Number.isNaN(a.percent) ? 0 : a.percent);
      if (!chosen) chosen = attempts.reduce((a, b) => (score(b) < score(a) ? b : a));
      chosen.chosen = true;

      // выбранный вариант кладём в папку фрейма
      if (chosen.dir !== fdir) {
        for (const name of ['index.html', 'styles.css', 'render.png', 'diff.png']) {
          const src = path.join(chosen.dir, name);
          if (!fs.existsSync(src)) continue;
          let data = fs.readFileSync(src);
          if (name === 'index.html') data = data.toString().replace(/\.\.\/\.\.\/(assets|tokens\.css)/g, '../$1');
          fs.writeFileSync(path.join(fdir, name), data);
        }
      }
      for (const a of attempts) if (a.dir !== fdir) fs.rmSync(a.dir, { recursive: true, force: true });

      const pass = browser ? !!chosen.ok : null;
      results.push({
        name: f.name, id: f.id, width: f.width, height: f.height, dir: dirName,
        mode: chosen.mode, stats: chosen.gen.stats, fonts: chosen.fonts, diff: chosen.diff, geometry: chosen.geometry, pass,
        attempts: attempts.map((a) => ({ mode: a.mode, percent: a.percent, geometryFailed: a.geometry?.failed ?? null, chosen: a.chosen })),
      });
      const geo = chosen.geometry ? `геометрия ${chosen.geometry.checked - chosen.geometry.failed}/${chosen.geometry.checked} (макс. ${chosen.geometry.maxDelta}px)` : '';
      const pix = hasRef ? `pixel diff ${chosen.percent.toFixed(3)}%` : 'без эталона';
      const status = `${pix} · ${geo} · ${pass === null ? '' : pass ? 'OK' : 'FAIL'}`;
      console.log(`  ${f.name}: ${chosen.mode} · ${status}`);
    }
  } finally {
    await browser?.close();
  }

  fs.writeFileSync(path.join(out, 'report.html'), buildReport({ file: pkg.manifest.file, threshold: args.threshold, results }));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ file: pkg.manifest.file, threshold: args.threshold,
    results: results.map(({ stats, ...r }) => ({ ...r, stats })) }, null, 2));
  console.log(`Отчёт: ${path.join(out, 'report.html')}`);
  const failed = results.filter((r) => r.pass === false).length;
  if (failed) process.exitCode = 2;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args._[0] !== 'build' || !args._[1]) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}
build(args).catch((e) => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
