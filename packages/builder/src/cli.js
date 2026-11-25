#!/usr/bin/env node
// ds-build — пакет из плагина Figma → вёрстка → проверка pixel perfect.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadPackage, copyAssets } from './package.js';
import { optimizeImages, applyImageSet } from './images.js';
import { loadTokens } from './tokens.js';
import { generateFrame, htmlOf } from './generate.js';
import { openBrowser, renderPage } from './render.js';
import { comparePng } from './diff.js';
import { buildReport } from './report.js';
import { checkGeometry } from './geometry.js';
import { attributeDiff } from './attribute.js';
import { refinePage, patchesCss } from './refine.js';
import { suggestNames, aiProviders, suggestScreenNames, screenTexts } from './ai.js';
import { analyzeSemantics } from './semantic.js';
import { analyzeDesignSystem } from './ds/analyze.js';
import { exportFiles, toTokens } from './ds/export.js';
import { withFigma, hasFigmaSystem } from './ds/figma.js';
import { familiesOf, facesOf, ensureFonts, buildFontsCss, defaultCacheDir } from './fonts.js';
import { findComponents } from './components.js';
import { componentizeTrees } from './componentize.js';
import { screenMap, screenMapMd, genericScreenName } from './screens.js';
import { relinkRoutes, preparePages, exportReact, exportVue, renderReact, renderVue, checkPageHtml, shippedCheckPage, projectAssetPrefix } from './frameworks.js';
import { groupFrames, writeResponsive, textsOf } from './responsive.js';
import { exportHtml } from './export-html.js';
import { unzipFile } from './unzip.js';
import { mergePackages } from './merge.js';
import { auditDesign, auditHtml, auditText, guidePage } from './design-audit.js';
import { writeCheckManifest, checkBuild, writeCheckScripts } from './check.js';

const HELP = `
ds-build ui [--port 0] [--home папка] [--no-open]
  Окно программы в браузере: выбрать архив из плагина, отметить опции, смотреть ход сборки и отчёты.
  Сборки сохраняются в ~/ds-build (или --home, DS_BUILD_HOME). Работает только на этом компьютере.

ds-build analyze <пакет | пакет.zip> [--out папка] [--delta-e 3] [--min-uses 2]
  Дизайн-система по всем фреймам пакета: tokens.json (W3C), variables.css, _tokens.scss,
  tailwind.config.js, design-system.md (с аудитом), analysis.json. По умолчанию — в ./out/design-system.

ds-build audit <пакет.zip> [ещё части.zip …] [--out папка] [--open]
  Анализ макета для дизайнера: что в файле Figma мешает хорошей вёрстке (Auto Layout, имена, компоненты,
  состояния, переменные, адаптивность, эффекты) — design-audit.html со ссылками на памятку. Без браузера, за секунды.
  При build этот анализ делается тоже.

ds-build check <папка сборки> [--screen "Имя экрана"] [--url http://localhost:5173] [--json]
  Проверка правок по макету: экраны из html/ (или запущенного проекта: страница — адрес#маршрут, либо {route}
  в адресе) рендерятся и сверяются с макетом из Figma. Пишет процент расхождения, какие слои Figma расходятся и где;
  картинки — в <папка>/.check/<экран>/ (reference, render, diff). Код 0 — всё совпало, 2 — есть расхождения.

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
  --text-area-threshold <%> или доля от площади текстовых слоёв, по умолчанию 4 (сглаживание — 2–4%,
                       не тот вес или кегль шрифта — от 4.6%); текст проходит, если укладывается в любой из допусков
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
  --allow-absolute     разрешить вёрстку целиком на координатах, если она точнее по пикселям
                       (по умолчанию — только когда без неё слои не на своих местах)
  --no-semantic        без семантических тегов (только div)
  --jobs <N>           сколько фреймов проверять одновременно (по умолчанию — ядер процессора, не больше 4)
  --no-keep-package    не сохранять пакет в <out>/.package (по умолчанию сохраняется — сборку можно дополнить:
                       ds-build build <прошлая сборка>/.package новая.zip --out <новая>)
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
  const a = { _: [], frames: [], css: [], frameworks: [], groups: {}, responsive: true, inlineSvg: true, cache: true, keepPackage: true, jobs: Math.max(1, Math.min(4, os.availableParallelism ? os.availableParallelism() : os.cpus().length)), layout: 'auto', threshold: 0.1, textThreshold: 0.5, textAreaThreshold: 4, out: 'out', verify: true, refine: true, analyze: true, fonts: 'auto', semantic: true, ai: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i];
    else if (k === '--layout') a.layout = argv[++i];
    else if (k === '--threshold') a.threshold = parseFloat(argv[++i]);
    else if (k === '--text-threshold') a.textThreshold = parseFloat(argv[++i]);
    else if (k === '--text-area-threshold') a.textAreaThreshold = parseFloat(argv[++i]);
    else if (k === '--frame') a.frames.push(argv[++i]);
    else if (k === '--css') a.css.push(argv[++i]);
    else if (k === '--no-verify') a.verify = false;
    else if (k === '--no-refine') a.refine = false;
    else if (k === '--allow-absolute') a.allowAbsolute = true;
    else if (k === '--no-analyze') a.analyze = false;
    else if (k === '--no-semantic') a.semantic = false;
    else if (k === '--ai') a.ai = true;
    else if (k === '--ai-paid') { a.ai = true; a.aiPaid = true; }
    else if (k === '--fonts') a.fonts = argv[++i];
    else if (k === '--open') a.open = true;
    else if (k === '--no-responsive') a.responsive = false;
    else if (k === '--jobs') a.jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (k === '--no-cache') a.cache = false;
    else if (k === '--no-keep-package') a.keepPackage = false;
    else if (k === '--svg-files') a.inlineSvg = false;
    else if (k === '--port') a.port = Number(argv[++i]);
    else if (k === '--home') a.home = path.resolve(argv[++i]);
    else if (k === '--no-open') a.noOpen = true;
    else if (k === '--group') { const [n, list] = argv[++i].split('='); a.groups[n.trim()] = (list || '').split(',').map((x) => x.trim()).filter(Boolean); }
    else if (k === '--framework') a.frameworks.push(...argv[++i].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    else if (k === '--delta-e') a.deltaE = parseFloat(argv[++i]);
    else if (k === '--min-uses') a.minUses = parseInt(argv[++i], 10);
    else if (k === '--screen') a.screen = argv[++i];
    else if (k === '--url') a.url = argv[++i];
    else if (k === '--json') a.json = true;
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
/** Площадь текстовых слоёв фрейма (px² эталона): мера, к которой относим расхождения в тексте. */
function textAreaOf(tree, scale = 1) {
  let a = 0;
  (function walk(n) {
    if (n.visible === false) return;
    if (n.type === 'TEXT') a += (n.w || 0) * (n.h || 0);
    (n.children || []).forEach(walk);
  })(tree);
  return a * scale * scale;
}

function pixelSplit(diff, textArea = 0) {
  if (!diff) return null;
  const total = diff.total || 1;
  const text = diff.sources?.byType?.['текст'] || 0;
  return { textPct: (text / total) * 100, otherPct: ((diff.mismatched - text) / total) * 100, textAreaPct: textArea > 0 ? (text / textArea) * 100 : null };
}
// Текст: Figma и браузер сглаживают буквы по-разному, на краях глифов это 2–4% площади текстов.
// Доля от всего экрана наказывала маленькие фреймы (подпись 12px на бейдже — 1%), поэтому текст проходит,
// если укладывается в долю экрана ИЛИ в долю площади текстов. Не тот вес или кегль шрифта — 4.6–10% площади.
const pixelOk = (diff, args, textArea = 0) => {
  const p = pixelSplit(diff, textArea);
  if (!p) return true;
  const textOk = p.textPct <= args.textThreshold || (p.textAreaPct !== null && p.textAreaPct <= args.textAreaThreshold);
  return p.otherPct <= args.threshold && textOk;
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
  // переменные и стили Figma — источник имён и значений; анализ остаётся для аудита
  const pj = (rel) => { const f = rel && path.join(pkg.dir, rel); return f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const vars = pj(pkg.manifest.variables || 'variables.json'), styles = pj(pkg.manifest.styles || 'styles.json');
  const out = hasFigmaSystem(vars, styles) ? withFigma(ds, vars, styles) : ds;
  for (const [name, data] of Object.entries(exportFiles(out, pkg.manifest.file, ds))) fs.writeFileSync(path.join(outDir, name), data);
  return out;
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

/** Анализ макета для дизайнера: design-audit.html (+ памятка рядом), design-audit.json. */
function writeDesignAudit(pkg, ds, outDir, extra = {}) {
  const a = auditDesign(pkg, ds, extra);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'design-audit.html'), auditHtml(a, { guideHref: (id) => `designer-guide.html#${id}` }));
  fs.writeFileSync(path.join(outDir, 'designer-guide.html'), guidePage());
  fs.writeFileSync(path.join(outDir, 'design-audit.json'), JSON.stringify(a, null, 2));
  return a;
}

/** ds-build audit — только проверить макет: без вёрстки и браузера, за секунды. */
async function audit(args) {
  const pkg = loadPackage(resolvePackages(args._.slice(1)));
  const out = path.resolve(args.out);
  const ds = runAnalysis(pkg, args, path.join(out, 'design-system'));
  const a = writeDesignAudit(pkg, ds, out);
  console.log(`Пакет: ${pkg.manifest.file} · фреймов: ${a.frames}`);
  console.log(auditText(a));
  console.log(`Отчёт для дизайнера: ${path.join(out, 'design-audit.html')}`);
  if (args.open) openFile(path.join(out, 'design-audit.html'));
}

async function build(args) {
  const pkgDir = resolvePackages(args._.slice(1));
  const pkg = loadPackage(pkgDir);
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  // пакет, из которого собрано, — рядом со сборкой (.package): её можно дополнить новой выгрузкой
  // (ds-build build <сборка>/.package новая.zip) или пересобрать без повторной выгрузки
  if (args.keepPackage) {
    const keep = path.join(out, '.package');
    if (path.resolve(pkgDir) !== keep) {
      fs.rmSync(keep, { recursive: true, force: true });
      fs.cpSync(pkgDir, keep, { recursive: true });
    }
  }
  // токены: из плагина, иначе — собственный анализ дизайн-системы
  // дизайн-система строится всегда; готовые токены из пакета (если есть) — приоритетнее для переменных в CSS
  let tokenJson = pkg.tokens;
  let ds = null;
  if (args.analyze) {
    ds = runAnalysis(pkg, args, path.join(out, 'design-system'));
    if (!tokenJson) {
      tokenJson = toTokens(ds);
      // палитра, подобранная по экранам, — в сохранённый пакет: сборка-дополнение возьмёт те же токены,
      // и прежние экраны останутся в кэше (иначе новые экраны чуть сдвигают палитру и меняют CSS всех)
      const keep = path.join(out, '.package');
      if (args.keepPackage && fs.existsSync(path.join(keep, 'manifest.json'))) {
        fs.writeFileSync(path.join(keep, 'tokens.json'), JSON.stringify(tokenJson, null, 2));
        const m = JSON.parse(fs.readFileSync(path.join(keep, 'manifest.json'), 'utf8'));
        fs.writeFileSync(path.join(keep, 'manifest.json'), JSON.stringify({ ...m, tokens: 'tokens.json' }, null, 2));
      }
    }
    console.log(`Дизайн-система: ${ds.colors.tokens.length} цветов, ${ds.typography.styles.length} стилей текста, аудит ${ds.audit.score}/100 → design-system/`);
  }
  const pkgJson = (rel) => { const f = rel && path.join(pkg.dir, rel); return f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  // переменные и стили эффектов из Figma — главнее угаданных по пикселям токенов
  const tokens = loadTokens(tokenJson, pkgJson(pkg.manifest.variables || 'variables.json'), pkgJson(pkg.manifest.styles || 'styles.json'));
  copyAssets(pkg, out);
  fs.writeFileSync(path.join(out, 'tokens.css'), tokens.css() || '/* токенов нет */\n');
  // шрифты макета: бесплатные — из npm, остальные должны быть установлены в системе
  const fontFiles = [];
  let missingFonts = [];
  if (args.fonts !== 'none') {
    const fams = familiesOf(pkg);
    const res = ensureFonts(fams, defaultCacheDir(), { log: (m) => console.log(m) });
    const css = buildFontsCss(res.dir, res.found, facesOf(pkg));
    if (css) { fs.writeFileSync(path.join(out, 'fonts.css'), css); fontFiles.push('fonts.css'); }
    console.log(`Шрифты: ${res.found.length ? res.found.join(', ') + ' — подключены' : 'из npm не нужны'}` +
      (res.missing.length ? `; не найдены в npm (установите в систему): ${res.missing.join(', ')}` : ''));
    missingFonts = res.missing;
  }
  // анализ макета для дизайнера — быстрый, по дереву слоёв
  {
    const a = writeDesignAudit(pkg, ds || analyzeDesignSystem(pkg.frames.map((f) => ({ name: f.name, tree: f.tree() }))), out, { missingFonts });
    console.log(`Анализ макета: ${a.score}/100 → design-audit.html`);
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
  // сколько заняла выгрузка в Figma по этапам (плагин 0.3.25+): видно, что тормозит на этом файле
  const tm = pkg.manifest.timing;
  if (tm) {
    const sec = (ms) => `${Math.round(ms / 1000)} с`;
    console.log(`Выгрузка в Figma: дерево слоёв ${sec(tm.tree)}, имена компонентов и стилей ${sec(tm.names)}, PNG экранов ${sec(tm.png)}, ` +
      `векторы ${sec(tm.svg)} (выгружено ${tm.svgExported}, одинаковых ${tm.svgCached}), картинки ${sec(tm.images)}`);
    if (tm.slowest?.length) console.log(`  дольше всего: ${tm.slowest.map((x) => `«${x.name}» ${sec(x.ms)} (слоёв ${x.layers}, векторов ${x.vectors})`).join('; ')}`);
  }
  // ИИ: названия экранов с безликими именами («Desktop - 3» → «Тарифы», адрес /pricing); в Figma имя — в figmaName
  if (args.ai) {
    const generic = frames.filter((f) => genericScreenName(f.name));
    if (generic.length) {
      const items = generic.map((f) => { const t = f.tree(); return { id: f.id, page: f.page || '', width: Math.round(f.width ?? t.w), texts: screenTexts(t) }; });
      const r = await suggestScreenNames(items, { providers: aiProviders(process.env, { paid: args.aiPaid }), cacheDir: defaultCacheDir(), log: (m) => console.log(m), isGeneric: genericScreenName });
      for (const f of generic) {
        const v = r.names.get(f.id);
        if (!v) continue;
        f.figmaName = f.name;
        f.name = v.title;
        if (v.route) f.route = v.route;
      }
      console.log(r.names.size ? `ИИ: названия экранов — ${r.names.size} из ${generic.length} (${generic.filter((f) => f.figmaName).slice(0, 4).map((f) => `«${f.figmaName}» → «${f.name}»`).join(', ')}${r.names.size > 4 ? '…' : ''})`
        : `  ⚠ ИИ не дал названия экранам${r.error ? `: ${r.error}` : ''} — остаются имена из Figma`);
    }
  }
  const browser = args.verify ? await openBrowser() : null;
  // картинки: WebP по размеру показа (1x/2x) — заливки в деревьях ссылаются на новые файлы
  const imageSet = await optimizeImages(browser, out, frames.map((f) => f.tree()), { log: (m) => console.log(m), cacheDir: args.cache ? path.join(defaultCacheDir(), 'images') : null });
  const results = [];
  const fwPages = [];
  const responsive = [];
  const codeOf = new Map(); // папка фрейма → файлы кода (для AGENTS.md в корне)
  const routeOf = new Map(); // папка фрейма → маршрут страницы в React/Vue (#route)
  // текст SVG из пакета: небольшие векторы вставляются прямо в страницу
  const svgText = (rel) => { try { return fs.readFileSync(path.join(pkg.dir, rel), 'utf8'); } catch { return null; } };

  // Кэш фреймов: тот же фрейм (дерево + эталон) с теми же настройками и той же версией программы
  // не пересобирается — берётся готовый результат. Ключ учитывает всё, что влияет на вёрстку и проверку.
  const cacheRoot = path.join(defaultCacheDir(), 'frames');
  const optKey = crypto.createHash('sha256').update(JSON.stringify([
    programHash(), args.layout, args.threshold, args.textThreshold, args.textAreaThreshold, args.refine, args.semantic, args.inlineSvg, args.ai, args.verify, !!args.allowAbsolute,
    tokens.css(), extraCss, fs.existsSync(path.join(out, 'fonts.css')) ? fs.readFileSync(path.join(out, 'fonts.css'), 'utf8').replace(/url\([^)]*\)/g, '') : '', pkg.scale,
  ])).digest('hex');
  const slots = [];
  const failedFrames = [];
  let cached = 0, doneCount = 0;
  // переходы прототипа «Navigate to» → страница фрейма из этой сборки (папки фреймов лежат рядом)
  const frameDirs = new Map(frames.map((f) => [f.id, safe(`${f.name}-${f.id}`)]));
  const frameHref = (id) => (frameDirs.has(id) ? `../${frameDirs.get(id)}/index.html` : null);

  try {
    const buildFrame = async (f, idx) => {
      const tree = applyImageSet(f.tree(), imageSet);
      const textArea = textAreaOf(tree, pkg.scale);
      const dirName = safe(`${f.name}-${f.id}`);
      const fdir = path.join(out, dirName);
      fs.mkdirSync(fdir, { recursive: true });
      fs.writeFileSync(path.join(fdir, 'tree.json'), JSON.stringify(tree)); // для ds-build check: где расходится
      const hasRef = args.verify && f.pngPath && fs.existsSync(f.pngPath);
      if (hasRef) fs.copyFileSync(f.pngPath, path.join(fdir, 'reference.png'));
      // в ключе — только куда ведут переходы этого фрейма: новые фреймы в пакете не сбрасывают кэш остальных
      const key = args.cache ? crypto.createHash('sha256').update(optKey).update(JSON.stringify(tree))
        .update(JSON.stringify(linkTargets(tree).map((id) => [id, frameHref(id)])))
        .update(hasRef ? fs.readFileSync(f.pngPath) : '').digest('hex').slice(0, 40) : null;
      const hit = key && path.join(cacheRoot, key);
      if (hit && fs.existsSync(path.join(hit, 'meta.json'))) {
        const meta = JSON.parse(fs.readFileSync(path.join(hit, 'meta.json'), 'utf8'));
        for (const name of fs.readdirSync(hit)) if (name !== 'meta.json') fs.copyFileSync(path.join(hit, name), path.join(fdir, name));
        // дерево элементов для React/Vue и адаптивности — тем же генератором (миллисекунды)
        const absIds = meta.pinned.length ? new Set(meta.pinned) : null;
        const gen = generateFrame(tree, { mode: meta.genMode, absIds, svgText, inlineSvg: args.inlineSvg, tokens, assetUrl: (rel) => `../assets/${rel}`, title: f.name, extraCss, frameHref, semantic: args.semantic, names: meta.names ? new Map(meta.names) : null });
        slots[idx] = {
          fw: { title: f.name, slug: f.route, page: f.page, dir: dirName, root: gen.root, tree, width: f.width, height: f.height,
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

      // автодоработка: подбор поправок для слоёв с наибольшим расхождением.
      // Запускаем и при прохождении порога: сдвиг строки на 1–2px укладывается в допуск для текста, но исправляется поправкой.
      // Самая дорогая часть проверки — поэтому на запасных попытках раскладки не делается, только на выбранной.
      const refineAttempt = async (att) => {
        att.refined = true;
        const attemptDir = att.dir;
        const textMiss = att.diff?.sources?.top.some((t) => t.type === 'TEXT' && t.pixels >= 150);
        if (!(args.refine && att.diff?.sources && (!pixelOk(att.diff, args, textArea) || textMiss))) return;
        const patches = await refinePage(browser, path.join(attemptDir, 'index.html'), {
          refPath: path.join(fdir, 'reference.png'), tree, sources: att.diff.sources,
          width: f.width, height: f.height, scale: pkg.scale,
        });
        if (!patches.length) return;
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
      };
      const okOf = (att) => !att.gen.stats.missing.length && (!att.geometry || att.geometry.failed === 0) && (!hasRef || pixelOk(att.diff, args, textArea));

      const runAttempt = async (mode, absIds = null, refineNow = true) => {
        const gen = generateFrame(tree, { mode, absIds, svgText, inlineSvg: args.inlineSvg, tokens, assetUrl: (rel) => `../assets/${rel}`, title: f.name, extraCss, frameHref, semantic: args.semantic, names });
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
            if (refineNow) await refineAttempt(att);
          }
        }
        attempts.push(att);
        if (attemptDir !== fdir && hasRef) fs.copyFileSync(path.join(fdir, 'reference.png'), path.join(attemptDir, 'reference.png'));
        const complete = !gen.stats.missing.length;
        if (!complete) console.log(`  ✗ не свёрстаны слои: ${gen.stats.missing.slice(0, 5).map((m) => m.name).join(', ')}${gen.stats.missing.length > 5 ? '…' : ''}`);
        att.ok = okOf(att);
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
        if (hasRef && att.diff && !pixelOk(att.diff, args, textArea)) {
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
          att = await runAttempt('hybrid', new Set(pinned), false);
          if (att.ok) chosen = att;
          else if (score(att) >= score(attempts[0])) break; // не помогает — дальше полный запасной режим
        }
        // вёрстка целиком на координатах как код не годится (с ней не поработать ни человеку, ни ИИ-агенту).
        // Она нужна, только если без неё слои стоят не на своих местах (геометрия ±0.5px). Если положение верное,
        // а расходятся пиксели (шрифт, сглаживание, эффекты) — координаты этого не исправят. --allow-absolute — как раньше.
        const geomFailed = (a) => a.geometry?.failed || 0;
        const bestStructured = attempts.reduce((a, b) => (score(b) < score(a) ? b : a));
        if (!chosen && (args.allowAbsolute || geomFailed(bestStructured) > 0)) {
          att = await runAttempt('absolute', null, false);
          if (att.ok && (args.allowAbsolute || geomFailed(att) < geomFailed(bestStructured))) chosen = att;
        }
      }
      // чистая раскладка (первая попытка) остаётся, если запасные не лучше заметно (на 20%);
      // координаты — только если с ними меньше слоёв не на месте
      if (!chosen) {
        const geomFailed = (a) => a.geometry?.failed || 0;
        const structured = attempts.filter((a) => a.mode !== 'absolute');
        chosen = structured.reduce((a, b) => (score(b) < score(a) * 0.8 ? b : a));
        const abs = attempts.find((a) => a.mode === 'absolute');
        if (abs && (args.allowAbsolute ? score(abs) < score(chosen) * 0.8 : geomFailed(abs) < geomFailed(chosen) && score(abs) < score(chosen) * 0.8)) chosen = abs;
      }
      // запасной вариант дорабатываем один раз — уже выбранный
      if (browser && hasRef && !chosen.refined) { await refineAttempt(chosen); chosen.ok = okOf(chosen); }
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
        mode: chosen.mode, stats: chosen.gen.stats, fonts: chosen.fonts, diff: chosen.diff, geometry: chosen.geometry, refine: chosen.refine, pixels: pixelSplit(chosen.diff, textArea), pass,
        pinned: chosen.pinned,
        attempts: attempts.map((a) => ({ mode: a.mode, pinned: a.pinned.length, percent: a.percent, geometryFailed: a.geometry?.failed ?? null, chosen: a.chosen })),
      });
      const geo = chosen.geometry ? `геометрия ${chosen.geometry.checked - chosen.geometry.failed}/${chosen.geometry.checked} (макс. ${chosen.geometry.maxDelta}px)` : '';
      const sp = pixelSplit(chosen.diff, textArea);
      const pix = hasRef ? `pixel diff ${chosen.percent.toFixed(3)}% (текст ${sp.textPct.toFixed(3)}%${sp.textAreaPct !== null ? ` = ${sp.textAreaPct.toFixed(1)}% площади текстов` : ''}, остальное ${sp.otherPct.toFixed(3)}%)` : 'без эталона';
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
    // один сломанный фрейм не останавливает сборку: он попадает в список «не собраны», остальные собираются.
    // Если упал сам браузер — дальше собирать нечем, сборка останавливается (её можно продолжить — кэш).
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          await buildFrame(item[0], item[1]);
        } catch (e) {
          if (/browser has been closed|Target closed|Browser closed|has been disconnected/i.test(e.message) || (browser && !browser.isConnected())) throw e;
          const msg = String(e.message).split('\n')[0].slice(0, 200);
          failedFrames.push({ id: item[0].id, name: item[0].name, page: item[0].page, error: msg });
          slots[item[1]] = undefined;
          console.log(`  ⚠ ${item[0].name}: не собран — ${msg}`);
        }
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
    if (failedFrames.length) {
      console.log(`⚠ Не собраны: ${failedFrames.length} из ${frames.length} — ${failedFrames.slice(0, 5).map((x) => `«${x.name}»`).join(', ')}${failedFrames.length > 5 ? '…' : ''}. Остальные собраны; причины — в failed-frames.json`);
      fs.writeFileSync(path.join(out, 'failed-frames.json'), JSON.stringify(failedFrames, null, 2));
    } else fs.rmSync(path.join(out, 'failed-frames.json'), { force: true });
    // адаптивные страницы: фреймы одной страницы под разные ширины
    if (args.responsive) {
      const groups = groupFrames(fwPages.map((p) => ({ name: p.title, page: p.page, width: p.width, texts: textsOf(p.tree) })), args.groups);
      for (const g of groups) {
        const variants = g.members.map((i) => ({ ...fwPages[i], fluid: false }));
        // «резиновые» версии макетов: тот же генератор с правилами растяжения
        const writeFluid = (v) => {
          // следующий по ширине макет — к его значениям плавно идут кегль, отступы, сетки
          const next = variants[variants.indexOf(v) + 1];
          const fg = generateFrame(v.tree, { ...v.gen, fluid: true, fluidSkip: v.skip, peer: next ? next.tree : null, svgText, inlineSvg: args.inlineSvg, tokens, assetUrl: (rel) => `../assets/${rel}`, extraCss, frameHref, semantic: args.semantic });
          fs.writeFileSync(path.join(out, v.dir, 'fluid.html'), fg.html);
          // поправки после сверки (межбуквенные и т. п.) — те же, что у фиксированной вёрстки этого макета
          const fixed = fs.existsSync(path.join(out, v.dir, 'styles.css')) ? fs.readFileSync(path.join(out, v.dir, 'styles.css'), 'utf8') : '';
          const mark = fixed.indexOf('/* Поправки после сверки');
          fs.writeFileSync(path.join(out, v.dir, 'fluid.css'), fg.css + (mark >= 0 ? '\n' + fixed.slice(mark) : ''));
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
              const bad = [];
              if (outside.length) { why.push(`текст за краем: ${outside[0][0].name}`); bad.push(outside[0][0].id); }
              let clash = null;
              for (let a = 0; !clash && a < tb.length; a++) for (let c = a + 1; c < tb.length; c++) {
                if (overlap(tb[a][1], tb[c][1]) && !overlap(tb[a][0], tb[c][0])) { clash = [tb[a][0], tb[c][0]]; break; }
              }
              if (clash) { why.push(`текст налезает: ${clash.map((t) => t.name).join(' / ')}`); bad.push(...clash.map((t) => t.id)); }
              // текст не помещается в свой блок (блок фиксированной высоты, а строк стало больше) — вылезет на соседей
              const spill = tb.find(([t, b]) => b.ih !== undefined && b.ih > b.h + 2 && !(t.h >= b.ih - 2));
              if (spill) { why.push(`текст не помещается в свой блок: ${spill[0].name}`); bad.push(spill[0].id); }
              // блоки на всю ширину макета (фоны секций, шапка) и на экране должны быть на всю ширину
              const bleed = (v.tree.children || []).filter((n) => n.visible !== false && n.x <= 0.5 && n.x + n.w >= v.tree.w - 0.5 && n.w > 0);
              const short = v.fluid ? bleed.filter((n) => { const b = at.get(n.id); return b && b.w < w - 1; }) : [];
              if (short.length) why.push(`не на всю ширину: ${short[0].name}`);
              out2.push({ width: w, ok: !why.length, why, bad });
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
              // та же вёрстка в общей странице растрируется чуть иначе (сглаживание отдельных букв) —
              // допускаем несколько сотен пикселей, но не сдвиг ни одного слоя
              const same = geo.failed === 0 && d.percent <= 0.02;
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
                const badIds = [...new Set(probes.flatMap((p) => p.bad || []))];
                if (v.fluid && probes.some((p) => !p.ok) && badIds.length && (v.rangeTries = (v.rangeTries || 0) + 1) <= 3) {
                  // сначала точечно: эти тексты и их родители — без плавного кегля и растяжения
                  for (const id of badIds) { v.skip.add(id); const p = v.parentOf.get(id); if (p) v.skip.add(p); }
                  writeFluid(v); changed = true;
                } else if (v.fluid && probes.some((p) => !p.ok)) {
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
      const ex = exportHtml(out, fwPages, responsive.map((r) => ({ name: r.name, dir: r.dir, widths: r.widths, members: r.components.map((c) => c.dir) })), { file: pkg.manifest.file, check: checkSummary(results) });
      console.log(`HTML/CSS: ${path.relative(process.cwd(), ex.root) || ex.root}`);
      for (const p of ex.pages) for (const from of p.responsive ? p.members : [p.from]) codeOf.set(from, [...(codeOf.get(from) || []), `html/${p.file}`]);
      if (ex.components.length) console.log(`  компоненты: ${ex.components.map((c) => `${c.block} ×${c.copies}`).join(', ')} → html/css/components.css`);
      if (browser) {
        // параллельно, как и фреймы
        const checkOne = async (p, k) => {
          // страницу проверяем всегда: общий CSS компонентов зависит от всех страниц сборки
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
      for (const p of pages) for (const fw of args.frameworks.filter((f) => f !== 'html')) codeOf.set(p.dir, [...(codeOf.get(p.dir) || []), `${fw}/src/pages/${p.component}.${fw === 'react' ? 'jsx' : 'vue'}`]);
      const groupsFw = responsive.map((r) => ({ name: r.name, members: r.components.map((c) => pages[fwPages.indexOf(c)]), widths: r.widths }));
      relinkRoutes(pages, groupsFw);
      for (const p of pages) routeOf.set(p.dir, p.route);
      // компоненты Figma (варианты, состояния) — те же классы, что в html/: деревья элементов получают классы
      // компонентов, у страниц — общий CSS компонентов + свои стили (fw.css рядом со styles.css)
      const cz = componentizeTrees(pages.map((p) => ({ root: p.root, css: fs.readFileSync(path.join(out, p.dir, 'styles.css'), 'utf8') })), (el) => htmlOf(el, 0));
      // порядок: сначала компоненты, потом страница (своё у копий должно перекрывать модификаторы)
      pages.forEach((p, i) => fs.writeFileSync(path.join(out, p.dir, 'fw.css'), `${cz.css}\n${cz.pageCss[i]}`));
      const comps = findComponents(pages);
      console.log(`Компоненты: ${comps.components.length}${comps.components.length ? ' — ' + comps.components.slice(0, 8).map((c) => `${c.name}×${c.instances.length}${c.props.length ? ` (${c.props.map((p) => p.name).join(', ')})` : ''}`).join(', ') : ''}`);
      for (const fw of args.frameworks.filter((f) => f !== 'html')) {
        if (!['react', 'vue'].includes(fw)) { console.log(`  неизвестный фреймворк: ${fw}`); continue; }
        const meta = { file: pkg.manifest.file, check: checkSummary(results) };
        const exp = fw === 'react' ? exportReact(out, pages, comps, groupsFw, meta) : exportVue(out, pages, comps, groupsFw, meta);
        const dir = exp.dir;
        console.log(`${fw === 'react' ? 'React' : 'Vue'}: ${path.relative(process.cwd(), dir) || dir}`);
        if (!browser) continue;
        const markup = fw === 'react' ? await renderReact(pages, comps) : await renderVue(pages, comps);
        // и сам отдаваемый проект: без служебных меток, иконки из icons.js, его fonts.css + site.css
        const shipOpt = { keep: exp.keep, assetPrefix: projectAssetPrefix(dir) };
        const shipped = fw === 'react' ? await renderReact(pages, comps, shipOpt) : await renderVue(pages, comps, shipOpt);
        for (const p of pages) {
          const html = fs.readFileSync(path.join(out, p.dir, 'index.html'), 'utf8');
          const chk = path.join(out, `${p.dir}.${fw}-check`);
          fs.mkdirSync(chk, { recursive: true });
          fs.writeFileSync(path.join(chk, 'index.html'), checkPageHtml(html, markup[p.component], p.dir, 'fw.css'));
          const r = await renderPage(browser, path.join(chk, 'index.html'), { width: p.width, height: p.height, scale: pkg.scale, out: path.join(chk, 'render.png') });
          const d = comparePng(path.join(out, p.dir, 'render.png'), path.join(chk, 'render.png'), path.join(chk, 'diff.png'));
          const g = checkGeometry(p.tree, r.boxes);
          fs.writeFileSync(path.join(chk, 'shipped.html'), shippedCheckPage(html, shipped[p.component], dir, chk));
          await renderPage(browser, path.join(chk, 'shipped.html'), { width: p.width, height: p.height, scale: pkg.scale, out: path.join(chk, 'shipped.png') });
          const ds = comparePng(path.join(out, p.dir, 'render.png'), path.join(chk, 'shipped.png'), path.join(chk, 'shipped-diff.png'));
          const same = d.mismatched === 0 && g.failed === 0 && ds.mismatched === 0;
          results[p.result].frameworks = { ...(results[p.result].frameworks || {}), [fw]: { percent: Math.max(d.percent, ds.percent), geometry: `${g.checked - g.failed}/${g.checked}`, same } };
          console.log(`  ${p.title}: ${fw} ${same ? 'совпадает с HTML' : `ОТЛИЧАЕТСЯ: pixel ${d.percent.toFixed(3)}%, проект ${ds.percent.toFixed(3)}%, геометрия ${g.checked - g.failed}/${g.checked}`}`);
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

  fs.writeFileSync(path.join(out, 'report.html'), buildReport({ file: pkg.manifest.file, threshold: args.threshold, textThreshold: args.textThreshold, textAreaThreshold: args.textAreaThreshold, results, responsive: responsive.map(({ components, ...r }) => r), failed: failedFrames }));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ file: pkg.manifest.file, threshold: args.threshold,
    results: results.map(({ stats, ...r }) => ({ ...r, stats })) }, null, 2));
  const scripts = writeCheckScripts(out, { cli: fileURLToPath(import.meta.url) });
  writeCheckManifest(out, { scale: pkg.scale, threshold: args.threshold, textThreshold: args.textThreshold, textAreaThreshold: args.textAreaThreshold, results, codeOf, routeOf });
  writeRootAgents(out, { file: pkg.manifest.file, results, codeOf, responsive, frames: pkg.frames, frameworks: args.frameworks, threshold: args.threshold, notes: designNotes(pkg), failed: failedFrames, scripts });
  console.log(`Отчёт: ${path.join(out, 'report.html')}`);
  if (args.open) openFile(path.join(out, 'report.html'));
  const failed = results.filter((r) => r.pass === false).length;
  if (failed) process.exitCode = 2;
}

/**
 * Корень папки сборки: AGENTS.md (что здесь код, что эталон, что служебное) и screens/ — PNG макетов
 * с понятными именами: по ним агент видит все экраны и состояния, не открывая папки проверки.
 */
function writeRootAgents(out, { file, results, codeOf, responsive, frames, frameworks, threshold, notes = { components: [], layers: [] }, failed = [], scripts = false }) {
  const scr = path.join(out, 'screens');
  fs.rmSync(scr, { recursive: true, force: true });
  const rows = [];
  const pageOf = new Map(frames.map((f) => [f.name + '|' + f.id, f.page]));
  const figmaNameOf = new Map(frames.filter((f) => f.figmaName).map((f) => [f.id, f.figmaName])); // название дал ИИ
  results.forEach((r, i) => {
    const ref = path.join(out, r.dir, 'reference.png');
    let shot = '';
    if (fs.existsSync(ref)) {
      fs.mkdirSync(scr, { recursive: true });
      shot = `screens/${String(i + 1).padStart(2, '0')}-${r.dir.replace(/-\d+_\d+$/, '')}.png`;
      fs.copyFileSync(ref, path.join(out, shot));
    }
    const layout = r.mode === 'absolute' ? '**координаты** — как код не годится, только размеры'
      : r.mode === 'hybrid' ? `flex; по координатам блоков: ${r.pinned?.length || 0}` : 'flex';
    const check = r.pass === true ? 'совпадает'
      : r.pass === false ? `расходится${Number.isFinite(r.diff?.percent) ? ` (${r.diff.percent.toFixed(2)}% пикселей)` : ''}${(r.geometry?.failed || 0) ? `, не на месте слоёв: ${r.geometry.failed}` : ''}`
      : 'не сверялся';
    const page = pageOf.get(r.name + '|' + r.id);
    const where = (page && !String(r.name).startsWith(page) ? `${page} / ${r.name}` : r.name) + (figmaNameOf.has(r.id) ? ` (в Figma: «${figmaNameOf.get(r.id)}»)` : '');
    rows.push(`| ${shot ? `[${path.basename(shot)}](${shot})` : '—'} | ${where} | ${Math.round(r.width)}×${Math.round(r.height)} | ${(codeOf.get(r.dir) || []).join(', ') || '—'} | ${layout} | ${check} |`);
  });
  const passed = results.filter((r) => r.pass === true).length;
  const withRef = results.filter((r) => r.pass !== null && r.pass !== undefined).length;
  const abs = results.filter((r) => r.mode === 'absolute').length;
  const code = ['html', 'react', 'vue'].filter((f) => frameworks.includes(f) && fs.existsSync(path.join(out, f)));
  const L = [
    `# ${file || 'Макеты'} — результат DS Builder`,
    '',
    '## Что здесь',
    '',
    ...code.map((f) => `- \`${f}/\` — код (${f === 'html' ? 'HTML и CSS' : f === 'react' ? 'React + Vite' : 'Vue + Vite'}). Внутри — свой AGENTS.md: страницы, компоненты, токены, правила.`),
    `- \`screens/\` — макеты из Figma (PNG, как в Figma): эталон всех экранов и состояний. Список — ниже.`,
    '- `design-system/` — токены: `tokens.json`, `variables.css` и описание дизайн-системы.',
    '- `report.html` — итог сверки с макетами по каждому экрану.',
    '- **Не нужно читать:** папки экранов вида `Имя-12_34/` (`render.png`, `diff.png`, `reference.png`, `index.html`, `tree.json` — служебные файлы проверки), `fonts.css`, `tokens.css`, `report.json`, `check.json`, `assets/`, `.check/`.',
    '- `.package/` — исходная выгрузка из Figma (дерево слоёв `frames/*.json`, `variables.json`, `styles.json`, `components.json`). Открывай, только если в коде не хватает данных: точное значение, имя переменной, свойство компонента.',
    '',
    '## Как доводить вёрстку до макета',
    '',
    '1. Правь код в ' + (code.length ? code.map((f) => `\`${f}/\``).join(' или ') : 'папке с кодом') + '. Макет главнее кода: правь код под макет из `screens/`, а не наоборот.',
    scripts
      ? '2. Проверь правку: `./check.sh --screen "Имя экрана"` (Windows: `check.cmd --screen "Имя экрана"`). Без `--screen` — все экраны. React/Vue: запусти проект (`npm run dev`) и добавь `--url http://localhost:5173`.'
      : '2. Проверь правку: в окне DS Builder у этой сборки — «проверить правки» (или `ds-build check <эта папка> --screen "Имя экрана"`).',
    '3. Проверка пишет процент расхождения, какие слои Figma расходятся и где (x, y, размер в координатах макета) и кладёт картинки в `.check/<экран>/`: `reference.png` — макет, `render.png` — вёрстка, `diff.png` — красным то, что отличается. Посмотри на них, поправь, проверь снова.',
    '4. Готово, когда экран отмечен ✓. Текст до 2–4% своей площади может расходиться из-за сглаживания шрифтов — это нормально. Не правь эталон и пороги проверки.',
    '5. Используй токены из `design-system/` (`var(--…)`) и готовые компоненты, а не цвета и размеры числами.',
    '',
    `## Экраны (сверено: совпадают ${passed} из ${withRef}${abs ? `; на координатах: ${abs}` : ''})`,
    '',
    '| макет | страница Figma / фрейм | размер | код | раскладка | сверка с макетом |',
    '|---|---|---|---|---|---|',
    ...rows,
  ];
  // что именно расходится — по слоям Figma, с местом: с чего начинать доводку
  const bad = results.filter((r) => r.pass === false && r.diff?.sources?.top?.length);
  if (bad.length) {
    L.push('', '## Что расходится (начни с этих мест)', '');
    for (const r of bad.slice(0, 60)) {
      const top = r.diff.sources.top.slice(0, 3).map((t) => `«${t.name}»${t.type === 'TEXT' ? ' (текст)' : ''}${t.box ? ` x ${t.box.x} y ${t.box.y}, ${t.box.w}×${t.box.h}` : ''}`).join('; ');
      L.push(`- ${r.name} (${r.diff.percent.toFixed(2)}%): ${top}`);
    }
    if (bad.length > 60) L.push(`- …и ещё ${bad.length - 60} — в report.html`);
  }
  if (responsive.length) {
    L.push('', '## Адаптивные страницы', '');
    for (const r of responsive) L.push(`- ${r.name}: ${r.widths.join(' / ')}px — одна страница, перестраивается между этими ширинами`);
  }
  // пояснения дизайнера: описания компонентов и аннотации Dev Mode — правила, которых не видно на картинке
  if (notes.components.length || notes.layers.length) {
    L.push('', '## Пояснения дизайнера', '', 'Из Figma: описания компонентов (Description) и аннотации Dev Mode. Это требования к поведению — учитывай их в коде.', '');
    for (const c of notes.components) L.push(`- Компонент «${c.name}»: ${c.description.replace(/\s*\n\s*/g, ' ')}`);
    for (const n of notes.layers) L.push(`- ${n.where}: ${n.text}`);
  }
  if (failed.length) {
    L.push('', '## Не собраны', '', 'Эти экраны не удалось сверстать (ошибка при сборке или проверке). Эталон — их PNG в пакете; сверстайте по нему или пересоберите.', '');
    for (const f of failed) L.push(`- ${f.page ? `${f.page} / ${f.name}` : f.name} — ${f.error}`);
  }
  // всплывающие окна из прототипа (Open overlay): в вёрстке — ссылка на страницу окна, агенту — сделать <dialog>
  // карта экранов: переходы, состояния, общий каркас — из прототипа и текстов, без ИИ
  try {
    const mf = frames.map((f) => { const tree = f.tree(); return { id: f.id, name: f.name, page: f.page, width: f.width ?? tree.w, height: f.height ?? tree.h, tree }; });
    const map = screenMap(mf);
    fs.writeFileSync(path.join(out, 'screens.json'), JSON.stringify(map, null, 2));
    const names = new Map(frames.map((f) => [f.id, f.page && !String(f.name).startsWith(f.page) ? `${f.page} / ${f.name}` : f.name]));
    L.push(...screenMapMd(map, (id) => names.get(id) || id));
    console.log(`Карта экранов: переходов ${map.links.length}, экранов с состояниями ${map.states.length}, общий каркас ${map.shells.length} → screens.json`);
  } catch (e) { console.log(`  ⚠ Карта экранов не построена: ${e.message}`); }
  const overlays = overlayLinks(frames);
  if (overlays.length) {
    L.push('', '## Всплывающие окна (Open overlay в прототипе)', '',
      'В макете эти кнопки открывают окно поверх экрана. В проектах React и Vue окно уже открывается в `<dialog>` поверх страницы ' +
      '(src/overlay.js, App): «закрыть» в окне его закрывает, Esc и клик по фону — тоже. В html/ это пока ссылка на страницу окна ' +
      '(`aria-haspopup="dialog"`) — если работаешь с html/, сделай `<dialog>` на странице кнопки.', '');
    for (const o of overlays) L.push(`- ${o.frame}: «${o.trigger}» → окно «${o.target}»`);
  }
  L.push('', '«Расходится» — вёрстка отличается от макета больше допуска; где именно — в report.html. ' +
    'При расхождении прав макет из screens/: правь код под него, а не наоборот.', '');
  fs.writeFileSync(path.join(out, 'AGENTS.md'), L.join('\n'));
}

/** Описания компонентов (components.json) и аннотации слоёв (notes) из пакета. */
function designNotes(pkg) {
  const p = pkg.manifest.components && path.join(pkg.dir, pkg.manifest.components);
  const components = p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).filter((c) => c?.name && c.description) : [];
  const layers = [];
  for (const f of pkg.frames) {
    const tree = f.tree?.();
    if (!tree) continue;
    (function walk(n, trail) {
      if (n.visible === false) return;
      for (const a of n.notes || []) {
        const text = [a.text, a.properties?.length ? `(свойства: ${a.properties.join(', ')})` : ''].filter(Boolean).join(' ');
        if (text) layers.push({ where: trail.join(' / '), text: text.replace(/\s*\n\s*/g, ' ') });
      }
      (n.children || []).forEach((c) => walk(c, [...trail, c.name]));
    })(tree, [f.name]);
  }
  return { components, layers: layers.slice(0, 200) };
}

/** id фреймов, на которые ведут переходы прототипа из дерева (Navigate to, Open overlay, ссылки в тексте). */
function linkTargets(tree) {
  const ids = new Set();
  (function walk(n) {
    if (n.link?.id) ids.add(n.link.id);
    for (const sg of n.text?.segments || []) if (sg.link?.id) ids.add(sg.link.id);
    (n.children || []).forEach(walk);
  })(tree);
  return [...ids].sort();
}

/** Кнопки «Open overlay» во всех фреймах: где, какая (текст или имя слоя), какое окно. */
function overlayLinks(frames) {
  const names = new Map(frames.map((f) => [f.id, f.name]));
  const out = [];
  for (const f of frames) {
    const tree = f.tree?.();
    if (!tree) continue;
    (function walk(n) {
      if (n.visible === false) return;
      if (n.link?.type === 'overlay') {
        const text = (function t(x) { return x.type === 'TEXT' ? x.text?.characters : (x.children || []).map(t).find(Boolean); })(n);
        out.push({ frame: f.name, trigger: (text || n.name || '').trim().slice(0, 60), target: names.get(n.link.id) || `слой ${n.link.id} (не выгружен)` });
      }
      (n.children || []).forEach(walk);
    })(tree);
  }
  return out;
}

/** Итог сверки для AGENTS.md: только фреймы с эталоном. */
function checkSummary(results) {
  const withRef = results.filter((r) => r.pass === true || r.pass === false);
  return { total: withRef.length, passed: withRef.filter((r) => r.pass).length, failed: withRef.filter((r) => r.pass === false).map((r) => r.frame || r.name || r.title).filter(Boolean) };
}

const args = parseArgs(process.argv.slice(2));
if (args._[0] === 'ui') {
  const { startUi } = await import('./ui.js');
  await startUi({ port: args.port || 0, open: args.noOpen !== true, home: args.home || undefined });
} else if (args._[0] === 'check' && args._[1]) {
  checkBuild({ dir: path.resolve(args._[1]), screen: args.screen, url: args.url, json: args.json })
    .then((r) => { if (r.some((x) => !x.pass)) process.exitCode = 2; })
    .catch((e) => { console.error(`Ошибка: ${e.message}`); process.exitCode = 1; });
} else if (args.help || !['build', 'analyze', 'audit'].includes(args._[0]) || !args._[1]) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
} else {
  ({ analyze, audit, build })[args._[0]](args).catch((e) => {
    console.error('Ошибка:', e.message);
    process.exit(1);
  });
}
