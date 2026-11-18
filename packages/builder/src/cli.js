#!/usr/bin/env node
// ds-build — пакет из плагина Figma → вёрстка → проверка pixel perfect.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
import { suggestNames, aiProviders } from './ai.js';
import { analyzeSemantics } from './semantic.js';
import { analyzeDesignSystem } from './ds/analyze.js';
import { exportFiles, toTokens } from './ds/export.js';
import { familiesOf, ensureFonts, buildFontsCss, defaultCacheDir } from './fonts.js';
import { findComponents } from './components.js';
import { preparePages, exportReact, exportVue, renderReact, renderVue, checkPageHtml } from './frameworks.js';
import { groupFrames, writeResponsive, textsOf } from './responsive.js';
import { exportHtml } from './export-html.js';
import { unzipFile } from './unzip.js';
import { mergePackages } from './merge.js';

const HELP = `
ds-build ui [--port 0] [--home папка] [--no-open]
  Окно программы в браузере: выбрать архив из плагина, отметить опции, смотреть ход сборки и отчёты.
  Сборки сохраняются в ~/ds-build (или --home, DS_BUILD_HOME). Работает только на этом компьютере.

ds-build analyze <пакет | пакет.zip> [--out папка] [--delta-e 3] [--min-uses 2]
  Дизайн-система по всем фреймам пакета: tokens.json (W3C), variables.css, _tokens.scss,
  tailwind.config.js, design-system.md (с аудитом), analysis.json. По умолчанию — в ./out/design-system.

ds-build build <пакет.zip> [ещё части.zip …] [опции]
  Большой файл плагин выгружает частями («… (часть 2 из 8).zip») — передайте все части сразу.
  Вёрстка всех фреймов + проверка с эталонами. Если в пакете нет tokens.json, дизайн-система
  строится автоматически (как analyze) и цвета в вёрстке подставляются как var(--color-…).

  --out <папка>        куда положить результат (по умолчанию ./out)
  --layout <режим>     auto (по умолчанию) | flow | absolute
                         flow     — flex по Auto Layout и геометрии (чистый код)
                         absolute — абсолютное позиционирование (запасной, максимально точный)
                         auto     — сначала flow; если не проходит, закрепляет координаты только у блоков
                                    с расхождением (уровень за уровнем), absolute целиком — в крайнем случае
  --threshold <%>      допустимая доля несовпадающих пикселей вне текста, по умолчанию 0.1
  --text-threshold <%> допуск для пикселей текста (растеризация шрифтов в Figma и браузере различается),
                       по умолчанию 0.5; положение текстовых блоков всё равно проверяется геометрией ±0.5px
  --frame <имя|id>     собрать только этот фрейм (можно несколько раз)
  --fonts <режим>      auto (по умолчанию) — бесплатные шрифты макета скачиваются из npm (@fontsource);
                       none — только шрифты, установленные в системе
  --css <файл>         подключить дополнительный CSS ко всем страницам (например, свои @font-face)
  --open               открыть отчёт в браузере после сборки
  --group "Имя=Фрейм A,Фрейм B"
                       объединить фреймы одной страницы под разные ширины (по умолчанию — по именам:
                       «Home / Desktop» и «Home / Mobile» → «Home»); --no-responsive — не объединять
  --framework <список> html, react, vue (через запятую):
                       html  — чистая папка html/: страницы, css/, fonts/, assets/, без служебных атрибутов;
                               открывается с диска и выкладывается на любой хостинг
                       react, vue — проект на Vite с компонентами (повторяющиеся блоки → компоненты с параметрами);
                       каждая страница проверяется — рендер должен совпасть с рабочей вёрсткой пиксель в пиксель
  --no-refine          не подбирать поправки после сверки с эталоном
  --no-semantic        без семантических тегов (только div)
  --jobs <N>           сколько фреймов проверять одновременно (по умолчанию — ядер процессора, не больше 4)
  --no-cache           пересобрать все фреймы; по умолчанию фреймы без изменений берутся из кэша
                       (~/.cache/ds-build/frames; кэш сбрасывается при обновлении программы)
  --svg-files          векторы — файлами <img src="….svg">; по умолчанию небольшие SVG вставляются в страницу
                       (правятся в коде, цвета — из токенов var(--color-…))
  --ai                 понятные имена классов от ИИ для слоёв с безликими именами (Frame 237…).
                       Цепочка: Ollama (локально) → Groq → Gemini → OpenRouter (бесплатные планы, если задан
                       GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY). Свой сервер: DS_AI_URL, DS_AI_MODEL, DS_AI_KEY.
                       Результат проверяется так же; все недоступны — сборка без ИИ
  --ai-paid            разрешить платный провайдер в конце цепочки: DS_AI_PAID_URL, DS_AI_PAID_KEY, DS_AI_PAID_MODEL
  --no-verify          не рендерить и не сравнивать

Переменные окружения: CHROME_PATH — путь к Chrome, если он не найден автоматически.
`;

function parseArgs(argv) {
  const a = { _: [], frames: [], css: [], frameworks: [], groups: {}, responsive: true, inlineSvg: true, cache: true, jobs: Math.max(1, Math.min(4, os.availableParallelism ? os.availableParallelism() : os.cpus().length)), layout: 'auto', threshold: 0.1, textThreshold: 0.5, out: 'out', verify: true, refine: true, analyze: true, fonts: 'auto', semantic: true, ai: false };
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
    else if (k === '--no-semantic') a.semantic = false;
    else if (k === '--ai') a.ai = true;
    else if (k === '--ai-paid') { a.ai = true; a.aiPaid = true; }
    else if (k === '--fonts') a.fonts = argv[++i];
    else if (k === '--open') a.open = true;
    else if (k === '--no-responsive') a.responsive = false;
    else if (k === '--jobs') a.jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (k === '--no-cache') a.cache = false;
    else if (k === '--svg-files') a.inlineSvg = false;
    else if (k === '--port') a.port = Number(argv[++i]);
    else if (k === '--home') a.home = path.resolve(argv[++i]);
    else if (k === '--no-open') a.noOpen = true;
    else if (k === '--group') { const [n, list] = argv[++i].split('='); a.groups[n.trim()] = (list || '').split(',').map((x) => x.trim()).filter(Boolean); }
    else if (k === '--framework') a.frameworks.push(...argv[++i].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    else if (k === '--delta-e') a.deltaE = parseFloat(argv[++i]);
    else if (k === '--min-uses') a.minUses = parseInt(argv[++i], 10);
    else if (k === '-h' || k === '--help') a.help = true;
    else a._.push(k);
  }
  return a;
}

/** Версия программы для кэша: хэш исходников (любая правка генератора или проверки сбрасывает кэш). */
let progHash = null;
function programHash() {
  if (progHash) return progHash;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  return (progHash = h.digest('hex'));
}

/** Один или несколько пакетов (части выгрузки) → папка одного пакета. */
function resolvePackages(inputs) {
  const dirs = inputs.map(resolvePackageDir);
  if (dirs.length === 1) {
    const m = JSON.parse(fs.readFileSync(path.join(dirs[0], 'manifest.json'), 'utf8'));
    if (m.part?.total > 1) console.log(`  ⚠ Это часть ${m.part.index} из ${m.part.total} выгрузки — передайте все части сразу, иначе свёрстана будет только эта`);
    return dirs[0];
  }
  const { dir, notes } = mergePackages(dirs, fs.mkdtempSync(path.join(os.tmpdir(), 'ds-merged-')));
  console.log(`Частей пакета: ${dirs.length} — собраны в один`);
  for (const n of notes) console.log(`  ⚠ ${n}`);
  return dir;
}

function resolvePackageDir(input) {
  if (!input.endsWith('.zip')) return input;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-package-'));
  unzipFile(input, dir);
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
  const pkg = loadPackage(resolvePackages(args._.slice(1)));
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
  const pkgDir = resolvePackages(args._.slice(1));
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
  const fwPages = [];
  const responsive = [];
  // текст SVG из пакета: небольшие векторы вставляются прямо в страницу
  const svgText = (rel) => { try { return fs.readFileSync(path.join(pkg.dir, rel), 'utf8'); } catch { return null; } };

  // Кэш фреймов: тот же фрейм (дерево + эталон) с теми же настройками и той же версией программы
  // не пересобирается — берётся готовый результат. Ключ учитывает всё, что влияет на вёрстку и проверку.
  const cacheRoot = path.join(defaultCacheDir(), 'frames');
  const optKey = crypto.createHash('sha256').update(JSON.stringify([
    programHash(), args.layout, args.threshold, args.textThreshold, args.refine, args.semantic, args.inlineSvg, args.ai, args.verify,
    tokens.css(), extraCss, fs.existsSync(path.join(out, 'fonts.css')) ? fs.readFileSync(path.join(out, 'fonts.css'), 'utf8').replace(/url\([^)]*\)/g, '') : '', pkg.scale,
  ])).digest('hex');
  const slots = [];
  let cached = 0, doneCount = 0;

  try {
    const buildFrame = async (f, idx) => {
      const tree = f.tree();
      const dirName = safe(`${f.name}-${f.id}`);
      const fdir = path.join(out, dirName);
      fs.mkdirSync(fdir, { recursive: true });
      const hasRef = args.verify && f.pngPath && fs.existsSync(f.pngPath);
      if (hasRef) fs.copyFileSync(f.pngPath, path.join(fdir, 'reference.png'));
      const key = args.cache ? crypto.createHash('sha256').update(optKey).update(JSON.stringify(tree))
        .update(hasRef ? fs.readFileSync(f.pngPath) : '').digest('hex').slice(0, 40) : null;
      const hit = key && path.join(cacheRoot, key);
      if (hit && fs.existsSync(path.join(hit, 'meta.json'))) {
        const meta = JSON.parse(fs.readFileSync(path.join(hit, 'meta.json'), 'utf8'));
        for (const name of fs.readdirSync(hit)) if (name !== 'meta.json') fs.copyFileSync(path.join(hit, name), path.join(fdir, name));
        // дерево элементов для React/Vue и адаптивности — тем же генератором (миллисекунды)
        const absIds = meta.pinned.length ? new Set(meta.pinned) : null;
        const gen = generateFrame(tree, { mode: meta.genMode, absIds, svgText, inlineSvg: args.inlineSvg, tokens, assetUrl: (rel) => `../assets/${rel}`, title: f.name, extraCss, semantic: args.semantic, names: meta.names ? new Map(meta.names) : null });
        slots[idx] = {
          fw: { title: f.name, page: f.page, dir: dirName, root: gen.root, tree, width: f.width, height: f.height,
            gen: { mode: meta.genMode, absIds, title: f.name, names: meta.names ? new Map(meta.names) : null } },
          result: { ...meta.result, dir: dirName, cached: true },
        };
        cached++;
        console.log(`  ${f.name}: без изменений — из кэша · ${meta.status}`);
        return;
      }

      // ИИ-имена (по флагу): только для безликих слоёв; ошибки сервера не ломают сборку
      let names = null;
      if (args.ai && args.semantic) {
        const r = await suggestNames(tree, analyzeSemantics(tree), { providers: aiProviders(process.env, { paid: args.aiPaid }), cacheDir: defaultCacheDir(), log: (m) => console.log(m) });
        if (r.error) console.log(`  ИИ недоступен (${r.error}) — имена по алгоритму`);
        else if (r.asked) console.log(`  ИИ: имена для ${r.used} из ${r.asked} безликих слоёв`);
        names = r.names;
      }
      const attempts = [];
      let chosen = null;
      const parentOf = new Map();
      (function walk(n) { for (const c of n.children || []) { parentOf.set(c.id, n.id); walk(c); } })(tree);

      const runAttempt = async (mode, absIds = null) => {
        const gen = generateFrame(tree, { mode, absIds, svgText, inlineSvg: args.inlineSvg, tokens, assetUrl: (rel) => `../assets/${rel}`, title: f.name, extraCss, semantic: args.semantic, names });
        // пробные варианты — рядом с папкой фрейма (та же глубина, пути к assets не меняются)
        const attemptDir = args.layout === 'auto' ? path.join(out, `${dirName}.try-${mode}${absIds ? `-${attempts.length}` : ''}`) : fdir;
        fs.mkdirSync(attemptDir, { recursive: true });
        fs.writeFileSync(path.join(attemptDir, 'index.html'), gen.html);
        fs.writeFileSync(path.join(attemptDir, 'styles.css'), gen.css);
        const att = { mode, gen, dir: attemptDir, percent: NaN, pinned: absIds ? [...absIds] : [] };
        if (browser) {
          const rendered = await renderPage(browser, path.join(attemptDir, 'index.html'), {
            width: f.width, height: f.height, scale: pkg.scale, out: path.join(attemptDir, 'render.png'),
          });
          att.fonts = rendered.fonts;
          att.geometry = checkGeometry(tree, rendered.boxes);
          if (hasRef) {
            att.diff = comparePng(path.join(fdir, 'reference.png'), path.join(attemptDir, 'render.png'), path.join(attemptDir, 'diff.png'));
            att.percent = att.diff.percent;
            if (att.diff.mismatched) att.diff.sources = attributeDiff(tree, path.join(attemptDir, 'diff.png'), { scale: pkg.scale, top: 30 });
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
                const cssFile = path.join(attemptDir, 'styles.css');
                const cssBefore = fs.readFileSync(cssFile, 'utf8');
                const saved = { diff: att.diff, percent: att.percent, geometry: att.geometry, png: fs.readFileSync(path.join(attemptDir, 'render.png')), diffPng: fs.readFileSync(path.join(attemptDir, 'diff.png')) };
                fs.appendFileSync(cssFile, patchesCss(patches));
                const re = await renderPage(browser, path.join(attemptDir, 'index.html'), {
                  width: f.width, height: f.height, scale: pkg.scale, out: path.join(attemptDir, 'render.png'),
                });
                att.geometry = checkGeometry(tree, re.boxes);
                const before = att.percent;
                att.diff = comparePng(path.join(fdir, 'reference.png'), path.join(attemptDir, 'render.png'), path.join(attemptDir, 'diff.png'));
                att.percent = att.diff.percent;
                if (att.diff.mismatched) att.diff.sources = attributeDiff(tree, path.join(attemptDir, 'diff.png'), { scale: pkg.scale });
                // поправки вместе сделали хуже (или сдвинули блоки) — откат
                if (att.percent > before || (att.geometry?.failed || 0) > (saved.geometry?.failed || 0)) {
                  fs.writeFileSync(cssFile, cssBefore);
                  fs.writeFileSync(path.join(attemptDir, 'render.png'), saved.png);
                  fs.writeFileSync(path.join(attemptDir, 'diff.png'), saved.diffPng);
                  Object.assign(att, { diff: saved.diff, percent: saved.percent, geometry: saved.geometry });
                } else {
                  att.refine = { before, after: att.percent, patches };
                }
              }
            }
          }
        }
        attempts.push(att);
        if (attemptDir !== fdir && hasRef) fs.copyFileSync(path.join(fdir, 'reference.png'), path.join(attemptDir, 'reference.png'));
        const complete = !gen.stats.missing.length;
        if (!complete) console.log(`  ✗ не свёрстаны слои: ${gen.stats.missing.slice(0, 5).map((m) => m.name).join(', ')}${gen.stats.missing.length > 5 ? '…' : ''}`);
        att.ok = complete && (!att.geometry || att.geometry.failed === 0) && (!hasRef || pixelOk(att.diff, args));
        return att;
      };

      // слои, которые не сошлись: геометрия и (при эталоне) не-текстовые источники pixel diff.
      // Что закреплять: сдвинут сам слой — виноват родитель (раскладка его детей); у контейнера на месте,
      // но не того размера, — его собственная раскладка
      const nodeById = new Map();
      (function walk(n) { nodeById.set(n.id, n); (n.children || []).forEach(walk); })(tree);
      const culprits = (att) => {
        const bad = new Map();
        for (const i of att.geometry?.issues || []) {
          const moved = Math.abs(i.figma.x - i.html.x) > 0.5 || Math.abs(i.figma.y - i.html.y) > 0.5;
          bad.set(i.id, moved || !nodeById.get(i.id)?.children?.length ? 'parent' : 'self');
        }
        if (hasRef && att.diff && !pixelOk(att.diff, args)) {
          for (const t of att.diff.sources?.top || []) if (t.type !== 'TEXT' && t.pixels >= 50 && !bad.has(t.id)) bad.set(t.id, 'parent');
        }
        // сдвиг, унаследованный от несошедшегося предка, — не своя ошибка: берём только верхние
        const inherited = (id) => { for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (bad.has(p)) return true; return false; };
        const pins = new Set();
        for (const [id, who] of bad) if (!inherited(id)) pins.add(who === 'self' ? id : parentOf.get(id));
        pins.delete(undefined);
        return pins;
      };

      const score = (a) => (a.geometry?.failed || 0) * 1000 + (Number.isNaN(a.percent) ? 0 : a.percent);
      if (args.layout !== 'auto') {
        chosen = await runAttempt(args.layout);
      } else {
        let att = await runAttempt('flow');
        if (att.ok || (!hasRef && !att.geometry)) chosen = att;
        // точечный запасной режим: координаты только у родителей несошедшихся слоёв;
        // не сошлось — поднимаемся на уровень выше; до 4 шагов
        const pinned = new Set();
        for (let step = 0; !chosen && step < 4; step++) {
          const want = culprits(att);
          if (!want.size) break;
          let grew = false;
          for (let p of want) {
            while (p && pinned.has(p)) p = parentOf.get(p); // уже закреплён и не помогло — уровнем выше
            if (p && !pinned.has(p)) { pinned.add(p); grew = true; }
          }
          if (!grew) break;
          att = await runAttempt('hybrid', new Set(pinned));
          if (att.ok) chosen = att;
          else if (score(att) >= score(attempts[0])) break; // не помогает — дальше полный запасной режим
        }
        if (!chosen) {
          att = await runAttempt('absolute');
          if (att.ok) chosen = att;
        }
      }
      // чистая раскладка (первая попытка) остаётся, если запасные не лучше заметно (на 20%)
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
      slots[idx] = {};
      slots[idx].fw = { title: f.name, page: f.page, dir: dirName, root: chosen.gen.root, tree, width: f.width, height: f.height,
        gen: { mode: chosen.mode === 'absolute' ? 'absolute' : 'flow', absIds: chosen.pinned.length ? new Set(chosen.pinned) : null, title: f.name, names } };
      slots[idx].result = ({
        name: f.name, id: f.id, width: f.width, height: f.height, dir: dirName,
        mode: chosen.mode, stats: chosen.gen.stats, fonts: chosen.fonts, diff: chosen.diff, geometry: chosen.geometry, refine: chosen.refine, pixels: pixelSplit(chosen.diff), pass,
        pinned: chosen.pinned,
        attempts: attempts.map((a) => ({ mode: a.mode, pinned: a.pinned.length, percent: a.percent, geometryFailed: a.geometry?.failed ?? null, chosen: a.chosen })),
      });
      const geo = chosen.geometry ? `геометрия ${chosen.geometry.checked - chosen.geometry.failed}/${chosen.geometry.checked} (макс. ${chosen.geometry.maxDelta}px)` : '';
      const sp = pixelSplit(chosen.diff);
      const pix = hasRef ? `pixel diff ${chosen.percent.toFixed(3)}% (текст ${sp.textPct.toFixed(3)}%, остальное ${sp.otherPct.toFixed(3)}%)` : 'без эталона';
      const ref = chosen.refine ? ` (до автодоработки ${chosen.refine.before.toFixed(3)}%, поправок ${chosen.refine.patches.length})` : '';
      const status = `${pix}${ref} · ${geo} · ${pass === null ? '' : pass ? 'OK' : 'FAIL'}`;
      const modeLabel = chosen.mode === 'hybrid' ? `flow, координаты закреплены у блоков: ${chosen.pinned.length}` : chosen.mode;
      console.log(`  ${f.name}: ${modeLabel} · ${status}`);
      // в кэш — только проверенный результат (без браузера проверять нечего)
      if (hit && browser) {
        fs.mkdirSync(hit, { recursive: true });
        for (const name of ['index.html', 'styles.css', 'render.png', 'diff.png']) if (fs.existsSync(path.join(fdir, name))) fs.copyFileSync(path.join(fdir, name), path.join(hit, name));
        const fwg = slots[idx].fw.gen;
        fs.writeFileSync(path.join(hit, 'meta.json'), JSON.stringify({ result: slots[idx].result, genMode: fwg.mode, pinned: chosen.pinned, names: names ? [...names] : null, status: `${modeLabel} · ${status}` }));
      }
    };

    // фреймы — параллельно, по args.jobs вкладок одного браузера
    const queue = frames.map((f, i) => [f, i]);
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await buildFrame(item[0], item[1]);
        doneCount++;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(args.jobs, frames.length)) }, worker));
    for (const sl of slots) {
      if (!sl) continue;
      sl.fw.result = results.length;
      fwPages.push(sl.fw);
      results.push(sl.result);
    }
    if (cached) console.log(`Без изменений (из кэша): ${cached} из ${frames.length}`);
    // адаптивные страницы: фреймы одной страницы под разные ширины
    if (args.responsive) {
      const groups = groupFrames(fwPages.map((p) => ({ name: p.title, page: p.page, width: p.width, texts: textsOf(p.tree) })), args.groups);
      for (const g of groups) {
        const variants = g.members.map((i) => ({ ...fwPages[i], fluid: false }));
        // «резиновые» версии макетов: тот же генератор с правилами растяжения
        const writeFluid = (v) => {
          const fg = generateFrame(v.tree, { ...v.gen, fluid: true, fluidSkip: v.skip, svgText, inlineSvg: args.inlineSvg, tokens, assetUrl: (rel) => `../assets/${rel}`, extraCss, semantic: args.semantic });
          fs.writeFileSync(path.join(out, v.dir, 'fluid.html'), fg.html);
          fs.writeFileSync(path.join(out, v.dir, 'fluid.css'), fg.css);
        };
        for (const v of variants) {
          if (v.gen.mode === 'absolute') continue; // полностью абсолютная вёрстка не растягивается
          v.skip = new Set();
          v.parentOf = new Map();
          (function walk(n) { for (const c of n.children || []) { v.parentOf.set(c.id, n.id); walk(c); } })(v.tree);
          writeFluid(v);
          v.fluid = !!browser;
        }
        let dir = writeResponsive(out, g, variants);
        const entry = { name: g.name, dir, widths: variants.map((v) => Math.round(v.width)), exact: [], overflow: [], fluid: [] };
        if (browser) {
          const page = () => path.join(out, dir, 'index.html');
          const ws = variants.map((v) => v.width);
          // текстовые слои макета: на промежуточной ширине не должны налезать друг на друга и вылезать за экран
          const textIds = (tree) => { const o = []; (function w(n) { if (n.visible === false) return; if (n.type === 'TEXT') o.push(n); (n.children || []).forEach(w); })(tree); return o; };
          const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
          const checkRange = async (i) => {
            const v = variants[i];
            const hi = i < ws.length - 1 ? ws[i + 1] - 1 : Math.round(ws[i] * 1.25);
            const probes = [...new Set([Math.round((ws[i] + hi) / 2), Math.round(hi)])].filter((w) => w > ws[i]);
            const texts = textIds(v.tree);
            const out2 = [];
            for (const w of probes) {
              const r = await renderPage(browser, page(), { width: w, height: v.height, scale: 1, out: null });
              const at = new Map(r.boxes.filter((b) => b.w > 0 || b.h > 0).map((b) => [b.id, b]));
              const why = [];
              if (r.overflowX) why.push('горизонтальная прокрутка');
              const tb = texts.map((t) => [t, at.get(t.id)]).filter(([, b]) => b);
              const outside = tb.filter(([, b]) => b.x < -0.5 || b.x + b.w > w + 0.5);
              if (outside.length) why.push(`текст за краем: ${outside[0][0].name}`);
              let clash = null;
              for (let a = 0; !clash && a < tb.length; a++) for (let c = a + 1; c < tb.length; c++) {
                if (overlap(tb[a][1], tb[c][1]) && !overlap(tb[a][0], tb[c][0])) { clash = [tb[a][0].name, tb[c][0].name]; break; }
              }
              if (clash) why.push(`текст налезает: ${clash.join(' / ')}`);
              // блоки на всю ширину макета (фоны секций, шапка) и на экране должны быть на всю ширину
              const bleed = (v.tree.children || []).filter((n) => n.visible !== false && n.x <= 0.5 && n.x + n.w >= v.tree.w - 0.5 && n.w > 0);
              const short = v.fluid ? bleed.filter((n) => { const b = at.get(n.id); return b && b.w < w - 1; }) : [];
              if (short.length) why.push(`не на всю ширину: ${short[0].name}`);
              out2.push({ width: w, ok: !why.length, why });
            }
            return out2;
          };
          // на ширине макета — ровно его вёрстка; «резиновая» версия, которая не совпала или ломается между ширинами, заменяется фиксированной
          for (let round = 0; round < variants.length * 4 + 2; round++) {
            entry.exact = [];
            let changed = false;
            for (const [i, v] of variants.entries()) {
              const png = path.join(out, dir, `render-${Math.round(v.width)}.png`);
              const r = await renderPage(browser, page(), { width: v.width, height: v.height, scale: pkg.scale, out: png });
              const d = comparePng(path.join(out, v.dir, 'render.png'), png, path.join(out, dir, `diff-${Math.round(v.width)}.png`));
              const geo = checkGeometry(v.tree, r.boxes.filter((b) => b.w > 0 || b.h > 0));
              const same = d.mismatched === 0 && geo.failed === 0;
              entry.exact.push({ width: Math.round(v.width), same, percent: d.percent });
              // не совпало на ширине макета: отключаем растяжение только у родителей несошедшихся слоёв (до 3 раз)
              if (!same && v.fluid && geo.failed && (v.tries = (v.tries || 0) + 1) <= 3) {
                for (const i of geo.issues) { const p = v.parentOf.get(i.id); if (p) v.skip.add(p); }
                writeFluid(v); changed = true;
              } else if (!same && v.fluid) { v.fluid = false; changed = true; entry.rejected = { ...entry.rejected, [Math.round(v.width)]: `на ширине макета расходится (${d.percent.toFixed(3)}%, геометрия ${geo.failed})` }; }
            }
            if (!changed) {
              entry.overflow = [];
              for (const [i, v] of variants.entries()) {
                const probes = await checkRange(i);
                entry.overflow.push(...probes);
                if (v.fluid && probes.some((p) => !p.ok)) {
                  v.fluid = false; changed = true;
                  entry.rejected = { ...entry.rejected, [Math.round(v.width)]: probes.filter((p) => !p.ok).map((p) => `${p.width}px: ${p.why.join(', ')}`).join('; ') };
                }
              }
            }
            if (!changed) break;
            dir = writeResponsive(out, g, variants);
          }
          // уже самого узкого — пропорциональное уменьшение
          const narrow = Math.max(280, Math.round(ws[0] * 0.8));
          const rn = await renderPage(browser, page(), { width: narrow, height: 800, scale: 1, out: null });
          entry.overflow.unshift({ width: narrow, ok: !rn.overflowX });
        }
        entry.fluid = variants.map((v) => v.fluid);
        const ok = entry.exact.every((e) => e.same) && entry.overflow.every((e) => e.ok);
        const fl = entry.fluid.filter(Boolean).length;
        const flTxt = browser ? `; между ширинами ${fl === variants.length ? 'тянется' : fl ? `тянется у ${fl} из ${variants.length} макетов` : 'макет по центру'}` : '';
        console.log(`Адаптивная страница «${g.name}» (${entry.widths.join(' / ')}): ${browser ? (ok ? 'на каждой ширине совпадает с макетом, без горизонтальной прокрутки' : 'ЕСТЬ РАСХОЖДЕНИЯ') : 'собрана'}${flTxt} → ${dir}/`);
        if (browser && !ok) process.exitCode = 2;
        responsive.push({ ...entry, ok, components: g.members.map((i) => fwPages[i]) });
      }
    }

    // чистый HTML/CSS: самостоятельная папка html/, проверка — тот же рендер, что у рабочей вёрстки
    if (args.frameworks.includes('html') && fwPages.length) {
      const ex = exportHtml(out, fwPages, responsive.map((r) => ({ name: r.name, dir: r.dir, widths: r.widths })));
      console.log(`HTML/CSS: ${path.relative(process.cwd(), ex.root) || ex.root}`);
      if (browser) {
        // параллельно, как и фреймы
        const checkOne = async (p, k) => {
          // страница фрейма из кэша уже сверялась с этой же версией программы
          const fromCache = !p.widths && results.find((r) => r.dir === p.from)?.cached;
          if (fromCache) return;
          const checks = p.widths
            ? p.widths.map((w) => ({ w, h: fwPages.find((f) => Math.round(f.width) === w && responsive.find((r) => r.dir === p.from)?.components.includes(f))?.height, ref: path.join(out, p.from, `render-${w}.png`) }))
            : [{ w: p.width, h: p.height, ref: path.join(out, p.from, 'render.png') }];
          const bad = [];
          for (const c of checks) {
            if (!c.h || !fs.existsSync(c.ref)) continue;
            const png = path.join(out, `.html-check-${k}.png`);
            await renderPage(browser, path.join(ex.root, p.file), { width: c.w, height: c.h, scale: pkg.scale, out: png });
            const d = comparePng(c.ref, png, path.join(out, `.html-check-diff-${k}.png`));
            if (d.mismatched) bad.push(`${c.w}px: ${d.mismatched} px`);
          }
          fs.rmSync(path.join(out, `.html-check-${k}.png`), { force: true });
          fs.rmSync(path.join(out, `.html-check-diff-${k}.png`), { force: true });
          console.log(`  ${p.title}: ${bad.length ? `ОТЛИЧАЕТСЯ от рабочей вёрстки (${bad.join(', ')})` : 'совпадает с рабочей вёрсткой'}`);
          if (bad.length) process.exitCode = 2;
        };
        const q = ex.pages.map((p, k) => [p, k]);
        await Promise.all(Array.from({ length: Math.max(1, Math.min(args.jobs, q.length)) }, async () => { for (let it = q.shift(); it; it = q.shift()) await checkOne(...it); }));
      }
    }

    // компоненты и фреймворки: из того же дерева элементов; проверка — совпадение с HTML-версией
    if (args.frameworks.some((f) => f !== 'html') && fwPages.length) {
      const pages = preparePages(fwPages);
      const groupsFw = responsive.map((r) => ({ name: r.name, members: r.components.map((c) => pages[fwPages.indexOf(c)]), widths: r.widths }));
      const comps = findComponents(pages);
      console.log(`Компоненты: ${comps.components.length}${comps.components.length ? ' — ' + comps.components.slice(0, 8).map((c) => `${c.name}×${c.instances.length}${c.props.length ? ` (${c.props.map((p) => p.name).join(', ')})` : ''}`).join(', ') : ''}`);
      for (const fw of args.frameworks.filter((f) => f !== 'html')) {
        if (!['react', 'vue'].includes(fw)) { console.log(`  неизвестный фреймворк: ${fw}`); continue; }
        const dir = fw === 'react' ? exportReact(out, pages, comps, groupsFw) : exportVue(out, pages, comps, groupsFw);
        console.log(`${fw === 'react' ? 'React' : 'Vue'}: ${path.relative(process.cwd(), dir) || dir}`);
        if (!browser) continue;
        const markup = fw === 'react' ? await renderReact(pages, comps) : await renderVue(pages, comps);
        for (const p of pages) {
          const html = fs.readFileSync(path.join(out, p.dir, 'index.html'), 'utf8');
          const chk = path.join(out, `${p.dir}.${fw}-check`);
          fs.mkdirSync(chk, { recursive: true });
          fs.writeFileSync(path.join(chk, 'index.html'), checkPageHtml(html, markup[p.component], p.dir));
          const r = await renderPage(browser, path.join(chk, 'index.html'), { width: p.width, height: p.height, scale: pkg.scale, out: path.join(chk, 'render.png') });
          const d = comparePng(path.join(out, p.dir, 'render.png'), path.join(chk, 'render.png'), path.join(chk, 'diff.png'));
          const g = checkGeometry(p.tree, r.boxes);
          const same = d.mismatched === 0 && g.failed === 0;
          results[p.result].frameworks = { ...(results[p.result].frameworks || {}), [fw]: { percent: d.percent, geometry: `${g.checked - g.failed}/${g.checked}`, same } };
          console.log(`  ${p.title}: ${fw} ${same ? 'совпадает с HTML' : `ОТЛИЧАЕТСЯ: pixel ${d.percent.toFixed(3)}%, геометрия ${g.checked - g.failed}/${g.checked}`}`);
          if (same) fs.rmSync(chk, { recursive: true, force: true });
          else process.exitCode = 2;
        }
      }
      fs.writeFileSync(path.join(out, 'components.json'), JSON.stringify(comps.components.map((c) => ({
        name: c.name, uses: c.instances.length, props: c.props.map((p) => ({ name: p.name, example: p.sample })),
        pages: [...new Set(c.instances.map((i) => pages.find((p) => (function has(e) { return e === i || (e.children || []).some(has); })(p.root))?.title))],
      })), null, 2));
    }
  } finally {
    await browser?.close();
  }

  fs.writeFileSync(path.join(out, 'report.html'), buildReport({ file: pkg.manifest.file, threshold: args.threshold, textThreshold: args.textThreshold, results, responsive: responsive.map(({ components, ...r }) => r) }));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ file: pkg.manifest.file, threshold: args.threshold,
    results: results.map(({ stats, ...r }) => ({ ...r, stats })) }, null, 2));
  console.log(`Отчёт: ${path.join(out, 'report.html')}`);
  if (args.open) openFile(path.join(out, 'report.html'));
  const failed = results.filter((r) => r.pass === false).length;
  if (failed) process.exitCode = 2;
}

const args = parseArgs(process.argv.slice(2));
if (args._[0] === 'ui') {
  const { startUi } = await import('./ui.js');
  await startUi({ port: args.port || 0, open: args.noOpen !== true, home: args.home || undefined });
} else if (args.help || !['build', 'analyze'].includes(args._[0]) || !args._[1]) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
} else {
  (args._[0] === 'analyze' ? analyze(args) : build(args)).catch((e) => {
    console.error('Ошибка:', e.message);
    process.exit(1);
  });
}
