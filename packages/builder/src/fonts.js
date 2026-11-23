// Шрифты для вёрстки: бесплатные (Google Fonts) скачиваются из npm (@fontsource/*) в кэш,
// и для них собирается fonts.css с @font-face. Платные шрифты нужно установить в систему самому.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const slugOf = (family) => family.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Семейства шрифтов из пакета: fonts.json плагина или проход по текстам. */
export function familiesOf(pkg) {
  const f = path.join(pkg.dir, pkg.manifest.fonts || 'fonts.json');
  if (fs.existsSync(f)) return [...new Set(JSON.parse(fs.readFileSync(f, 'utf8')).map((x) => x.family))];
  const set = new Set();
  for (const fr of pkg.frames) {
    (function walk(n) {
      for (const s of n.text?.segments || []) set.add(s.fontFamily);
      (n.children || []).forEach(walk);
    })(fr.tree());
  }
  return [...set];
}

export function defaultCacheDir() {
  return process.env.DS_BUILD_CACHE || path.join(os.homedir(), '.cache', 'ds-build');
}

/** Скачивает недостающие @fontsource-пакеты. Возвращает найденные и ненайденные семейства. */
// npm без shell: на Windows npm — это npm.cmd, а .cmd без shell не запускается, shell с массивом аргументов
// Node считает небезопасным (DEP0190). Поэтому — сам npm-cli.js через текущий node; не нашёлся — строка для shell.
function runNpm(args, opts) {
  const cands = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = cands.find((c) => c && /npm-cli\.js$/.test(c) && fs.existsSync(c));
  if (cli) return execFileSync(process.execPath, [cli, ...args], opts);
  // npm нет (установленная программа): скачиваем пакет напрямую из реестра
  const pkg = args.find((a) => a.startsWith('@fontsource/'));
  return execFileSync(process.execPath, [fileURLToPath(new URL('./fetch-npm.js', import.meta.url)), opts.cwd, pkg],
    { ...opts, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
}

export function ensureFonts(families, cacheDir, { log = () => {} } = {}) {
  const dir = path.join(cacheDir, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"ds-build-fonts","private":true}\n');
  const missingFile = path.join(dir, 'not-on-npm.json');
  const notOnNpm = new Set(fs.existsSync(missingFile) ? JSON.parse(fs.readFileSync(missingFile, 'utf8')) : []);
  const found = [], missing = [];
  for (const fam of families) {
    const slug = slugOf(fam);
    const pkgDir = path.join(dir, 'node_modules', '@fontsource', slug);
    if (fs.existsSync(pkgDir)) { found.push(fam); continue; }
    if (notOnNpm.has(slug)) { missing.push(fam); continue; }
    try {
      log(`  скачиваю шрифт ${fam}…`);
      runNpm(['install', '--silent', '--no-audit', '--no-fund', `@fontsource/${slug}`], { cwd: dir, stdio: 'ignore', timeout: 300000 });
      found.push(fam);
    } catch {
      notOnNpm.add(slug);
      missing.push(fam);
    }
  }
  fs.writeFileSync(missingFile, JSON.stringify([...notOnNpm]));
  return { found, missing, dir };
}

/** fonts.css из установленных @fontsource-пакетов (только нужные семейства, если указаны). */
/** Начертания из fonts.json пакета: Map(slug семейства → Set('400', '700-italic')). */
export function facesOf(pkg) {
  const f = path.join(pkg.dir, pkg.manifest.fonts || 'fonts.json');
  if (!fs.existsSync(f)) return null;
  const out = new Map();
  for (const x of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    const w = Number(x.weight) || 400;
    const key = `${Math.round(w / 100) * 100}${/italic|oblique/i.test(x.style || '') ? '-italic' : ''}`;
    const slug = slugOf(x.family);
    if (!out.has(slug)) out.set(slug, new Set());
    out.get(slug).add(key);
  }
  return out;
}

/**
 * faces — только начертания из макета (иначе в вёрстку попадают все насыщенности и курсивы — сотни файлов);
 * формат — только woff2: его понимают все браузеры, woff-запасной лишь удваивает число файлов.
 */
export function buildFontsCss(fontsDir, families = null, faces = null) {
  const root = path.join(fontsDir, 'node_modules', '@fontsource');
  if (!fs.existsSync(root)) return '';
  const want = families ? new Set(families.map(slugOf)) : null;
  const out = [];
  for (const pkg of fs.readdirSync(root)) {
    if (want && !want.has(pkg)) continue;
    const dir = path.join(root, pkg);
    const wantFaces = faces?.get(pkg);
    for (const f of fs.readdirSync(dir).filter((n) => /^\d{3}(-italic)?\.css$/.test(n))) {
      if (wantFaces && !wantFaces.has(f.replace(/\.css$/, ''))) continue;
      out.push(fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, '')
        .replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) => `url(${pathToFileURL(path.join(dir, 'files', file)).href})`));
    }
  }
  return out.join('\n');
}
