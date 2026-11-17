// Чистый HTML/CSS: самостоятельная папка html/, которую можно открыть с диска или выложить на любой хостинг.
//
//   html/index.html            — список страниц
//   html/<страница>.html       — по странице на фрейм (+ адаптивные страницы)
//   html/css/fonts.css         — @font-face со шрифтами из html/fonts/ (не из кэша на вашем компьютере)
//   html/css/tokens.css        — переменные дизайн-системы
//   html/css/<страница>.css    — стили страницы
//   html/assets/               — картинки и векторы
//
// Отличия от рабочей вёрстки (папки фреймов): нет служебных data-figma-id / data-name, пути относительные,
// поправки автодоработки привязаны к классам. Проверка — рендер каждой страницы совпадает с рабочей пиксель в пиксель.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { className } from './semantic.js';

const strip = (html) => html.replace(/ data-figma-id="[^"]*"/g, '').replace(/ data-name="[^"]*"/g, '');

/**
 * Поправки, привязанные к слоям ([data-figma-id="…"]), → классы fix-N на этих элементах.
 * Возвращает новые html и css.
 */
function rebindFixes(html, css) {
  const ids = [...new Set([...css.matchAll(/\[data-figma-id="([^"]+)"\]/g)].map((m) => m[1]))];
  const cls = new Map(ids.map((id, i) => [id, `fix-${i + 1}`]));
  for (const [id, c] of cls) {
    const re = new RegExp(`(<[a-z0-9]+ class=")([^"]*)("[^>]*? data-figma-id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`);
    html = html.replace(re, (_, a, b, rest) => `${a}${b} ${c}${rest}`);
    css = css.split(`[data-figma-id="${id}"]`).join(`.${c}`);
  }
  // общий сдвиг для стиля текста: «[data-figma-id] > span:has(…)» → «span:has(…)»
  css = css.replace(/\[data-figma-id\] > span:has\(/g, 'span:has(');
  return { html, css };
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

/**
 * @param siteDir  папка сборки (out/…)
 * @param pages    [{ title, dir, width, height }] — фреймы
 * @param groups   [{ name, dir, widths }] — адаптивные страницы (dir — папка <имя>.responsive)
 * @returns {{ root: string, pages: { file: string, title: string, from: string, width?: number, height?: number, widths?: number[] }[] }}
 */
export function exportHtml(siteDir, pages, groups = []) {
  const root = path.join(siteDir, 'html');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'css'), { recursive: true });
  copyDir(path.join(siteDir, 'assets'), path.join(root, 'assets'));

  // шрифты: из кэша — в html/fonts
  let fonts = '';
  const fontsCss = path.join(siteDir, 'fonts.css');
  if (fs.existsSync(fontsCss)) {
    fs.mkdirSync(path.join(root, 'fonts'), { recursive: true });
    fonts = fs.readFileSync(fontsCss, 'utf8').replace(/url\((file:[^)]+)\)/g, (m, u) => {
      const file = fileURLToPath(u);
      const name = path.basename(file);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(root, 'fonts', name));
      return `url(../fonts/${name})`;
    });
  }
  for (const f of fs.readdirSync(siteDir).filter((n) => /^extra-\d+\.css$/.test(n))) fonts += '\n' + fs.readFileSync(path.join(siteDir, f), 'utf8');
  fs.writeFileSync(path.join(root, 'css', 'fonts.css'), fonts);
  fs.copyFileSync(path.join(siteDir, 'tokens.css'), path.join(root, 'css', 'tokens.css'));

  const used = new Set();
  const slugOf = (title) => {
    const base = className(title) || 'page';
    let s = base, k = 2;
    while (used.has(s) || s === 'index') s = `${base}-${k++}`;
    used.add(s);
    return s;
  };
  const head = (title, cssFiles) => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&]/g, '')}</title>
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/tokens.css">
${cssFiles.map((c) => `<link rel="stylesheet" href="css/${c}">`).join('\n')}
`;
  const out = [];

  // страница фрейма: стили и разметка из рабочей вёрстки
  const pageCss = (dir, file, slug, html) => {
    let css = fs.readFileSync(path.join(siteDir, dir, file), 'utf8');
    const r = rebindFixes(html, css);
    const name = `${slug}.css`;
    fs.writeFileSync(path.join(root, 'css', name), r.css); // url("../assets/…") из css/ по-прежнему верный
    return { name, html: r.html };
  };

  for (const p of pages) {
    const src = fs.readFileSync(path.join(siteDir, p.dir, 'index.html'), 'utf8');
    const slug = slugOf(p.title);
    const body = src.slice(src.indexOf('<body>'));
    const { name, html } = pageCss(p.dir, 'styles.css', slug, body);
    fs.writeFileSync(path.join(root, `${slug}.html`), head(p.title, [name]) + '</head>\n' + strip(html).replace(/"\.\.\/assets\//g, '"assets/'));
    out.push({ file: `${slug}.html`, title: p.title, from: p.dir, width: p.width, height: p.height });
  }

  // адаптивные страницы: варианты (фиксированные или «резиновые») — каждый со своими стилями
  for (const g of groups) {
    const src = fs.readFileSync(path.join(siteDir, g.dir, 'index.html'), 'utf8');
    const slug = slugOf(g.name);
    const links = [...src.matchAll(/<link rel="stylesheet" href="\.\.\/([^"/]+)\/([^"]+\.css)">/g)];
    let body = src.slice(src.indexOf('<body>'));
    const files = [];
    for (const [, dir, file] of links) {
      // у каждого варианта — свой файл стилей (поправки привязываются к разметке этой страницы)
      const r = pageCss(dir, file, `${slug}-${files.length + 1}`, body);
      body = r.html;
      files.push(r.name);
    }
    const style = (src.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    const title = (src.match(/<title>([^<]*)<\/title>/) || [, g.name])[1];
    fs.writeFileSync(path.join(root, `${slug}.html`), head(title, files) + style + '\n</head>\n' + strip(body).replace(/"\.\.\/assets\//g, '"assets/'));
    out.push({ file: `${slug}.html`, title: `${g.name} (адаптивная)`, from: g.dir, widths: g.widths });
  }

  fs.writeFileSync(path.join(root, 'index.html'), `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Страницы</title>
<style>body { font: 16px/1.5 system-ui, sans-serif; margin: 40px; color: #1a2033; } a { color: #0a63c9; } li { margin: 6px 0; }</style>
</head>
<body>
<h1>Страницы</h1>
<ul>
${out.map((p) => `<li><a href="${p.file}">${p.title.replace(/[<&]/g, '')}</a></li>`).join('\n')}
</ul>
</body>
</html>
`);
  return { root, pages: out };
}
