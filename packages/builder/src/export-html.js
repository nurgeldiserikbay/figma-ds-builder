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
import { agentsMd } from './frameworks.js';
import { className } from './semantic.js';
import { componentize } from './componentize.js';

const strip = (html) => html.replace(/ data-(?:figma-id|name|component|variant)="[^"]*"/g, '');

/**
 * Поправки, привязанные к слоям ([data-figma-id="…"]), → классы fix-N на этих элементах.
 * Возвращает новые html и css.
 */
function rebindFixes(html, css, prefix = 'fix') {
  const ids = [...new Set([...css.matchAll(/\[data-figma-id="([^"]+)"\]/g)].map((m) => m[1]))];
  // у адаптивной страницы несколько файлов стилей — у каждого свои номера (иначе fix-1 одного файла
  // попадал бы на элемент другого)
  const cls = new Map(ids.map((id, i) => [id, `${prefix}-${i + 1}`]));
  for (const [id, c] of cls) {
    const re = new RegExp(`(<[a-z0-9]+ class=")([^"]*)("[^>]*? data-figma-id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`);
    html = html.replace(re, (_, a, b, rest) => `${a}${b} ${c}${rest}`);
    css = css.split(`[data-figma-id="${id}"]`).join(`.${c}`);
  }
  // общий сдвиг для стиля текста: «[data-figma-id] > span:has(…)» → «span:has(…)»
  css = css.replace(/\[data-figma-id\] > span:has\(/g, 'span:has(').replace(/\[data-figma-id\] > \./g, '.');
  return { html, css };
}

/**
 * Имена классов без хеша: «hero-cwzdf» → «hero»; одинаковые имена на странице — «title», «title-2»…
 * Хеш нужен генератору (один набор стилей — один класс), в готовой вёрстке он только мешает читать.
 */
export function plainNames(pg, compCss = '') {
  const reserved = new Set([...compCss.matchAll(/\.([\w-]+)/g)].map((m) => m[1]));
  const all = Object.values(pg.css).join('\n');
  const defined = new Set([...all.matchAll(/^\.([\w-]+)(?:\.[\w-]+)? \{/gm)].map((m) => m[1]));
  const order = [];
  for (const m of pg.html.matchAll(/ class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c && !order.includes(c)) order.push(c);
  for (const c of order) reserved.add(c);
  const map = new Map();
  const taken = new Set([...reserved]);
  for (const c of order) {
    const m = c.match(/^(.*[a-z0-9])-[0-9a-z]{5}$/);
    if (!m || !defined.has(c)) continue;
    let n = m[1], k = 2;
    if (/--own$/.test(n) || taken.has(n)) { while (taken.has(`${n}-${k}`)) k++; n = taken.has(n) ? `${n}-${k}` : n; }
    taken.add(n);
    map.set(c, n);
  }
  if (!map.size) return pg;
  const html = pg.html.replace(/ class="([^"]*)"/g, (_, v) => ` class="${v.split(/\s+/).map((c) => map.get(c) || c).join(' ')}"`);
  const css = {};
  for (const [f, text] of Object.entries(pg.css)) css[f] = text.replace(/\.([\w-]+)/g, (all, c) => (map.has(c) ? `.${map.get(c)}` : all));
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
export function exportHtml(siteDir, pages, groups = [], meta = {}) {
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
  const entries = []; // { file, title, head, css: { имя: текст }, body, info }

  // страница фрейма: стили и разметка из рабочей вёрстки
  const pageCss = (dir, file, slug, html, prefix = 'fix') => {
    const css = fs.readFileSync(path.join(siteDir, dir, file), 'utf8');
    const r = rebindFixes(html, css, prefix);
    return { name: `${slug}.css`, css: r.css, html: r.html }; // url("../assets/…") из css/ по-прежнему верный
  };

  // экраны, вошедшие в адаптивную страницу, отдельными файлами не дублируем: их вёрстка — в адаптивной
  const inGroup = new Set(groups.flatMap((g) => g.members || []));
  for (const p of pages) {
    if (inGroup.has(p.dir)) continue;
    const src = fs.readFileSync(path.join(siteDir, p.dir, 'index.html'), 'utf8');
    const slug = slugOf(p.title);
    const r = pageCss(p.dir, 'styles.css', slug, src.slice(src.indexOf('<body>')));
    entries.push({ file: `${slug}.html`, title: p.title, extra: '', css: { [r.name]: r.css }, body: r.html,
      info: { file: `${slug}.html`, css: r.name, title: p.title, page: p.page, from: p.dir, width: p.width, height: p.height } });
  }

  // адаптивные страницы: варианты (фиксированные или «резиновые») — каждый со своими стилями
  for (const g of groups) {
    const src = fs.readFileSync(path.join(siteDir, g.dir, 'index.html'), 'utf8');
    const slug = slugOf(g.name);
    const links = [...src.matchAll(/<link rel="stylesheet" href="\.\.\/([^"/]+)\/([^"]+\.css)">/g)];
    let body = src.slice(src.indexOf('<body>'));
    const css = {};
    for (const [, dir, file] of links) {
      // у каждого варианта — свой файл стилей (поправки привязываются к разметке этой страницы)
      const n = Object.keys(css).length + 1;
      const r = pageCss(dir, file, `${slug}-${n}`, body, `fix${n}`);
      body = r.html;
      css[r.name] = r.css;
    }
    const style = (src.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    const title = (src.match(/<title>([^<]*)<\/title>/) || [, g.name])[1];
    entries.push({ file: `${slug}.html`, title, extra: style + '\n', css, body,
      info: { file: `${slug}.html`, title: `${g.name} (адаптивная)`, name: g.name, from: g.dir, widths: g.widths, members: g.members || [], responsive: true } });
  }

  // компоненты Figma: общий components.css, на страницах — классы компонентов и остатки копий
  const comp = componentize(entries.map((e) => ({ html: e.body, css: e.css })));
  comp.pages = comp.pages.map((pg) => plainNames(pg, comp.css));
  if (comp.css) fs.writeFileSync(path.join(root, 'css', 'components.css'), comp.css);
  // общий сброс стилей браузера (одинаковый у всех страниц) — один раз в css/base.css
  const RESET = /^(?:\/\* Сгенерировано figma-ds-builder[^\n]*|\*, \*::before[^\n]*|html, body \{[^\n]*|h1, h2[^\n]*|ul, ol \{[^\n]*|header, footer[^\n]*|a \{ color: inherit[^\n]*|form \{ display[^\n]*|input(?:::placeholder)? \{[^\n]*|button \{ font: inherit[^\n]*)\n/gm;
  const base = [];
  for (const pg of comp.pages) for (const text of Object.values(pg.css)) for (const m of text.matchAll(RESET)) if (!base.includes(m[0])) base.push(m[0]);
  if (base.length) fs.writeFileSync(path.join(root, 'css', 'base.css'), base.join(''));
  // переходы прототипа: путь к рабочей папке фрейма → файл страницы (экран адаптивной — её файл)
  const fileOf = new Map();
  for (const e of entries) {
    fileOf.set(e.info.from, e.file);
    for (const m of e.info.members || []) fileOf.set(m, e.file);
  }
  const relink = (html) => html.replace(/ href="\.\.\/([^"/]+)\/index\.html"/g, (m, d) => ` href="${fileOf.get(d) || '#'}"`);
  entries.forEach((e, i) => {
    const pg = comp.pages[i];
    pg.html = relink(pg.html);
    for (const [name, text] of Object.entries(pg.css)) fs.writeFileSync(path.join(root, 'css', name), base.length ? text.replace(RESET, '') : text);
    const files = [...(base.length ? ['base.css'] : []), ...(comp.css ? ['components.css'] : []), ...Object.keys(pg.css)];
    fs.writeFileSync(path.join(root, e.file), head(e.title, files) + e.extra + '</head>\n' + strip(pg.html).replace(/"\.\.\/assets\//g, '"assets/'));
    out.push(e.info);
  });

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
  fs.writeFileSync(path.join(root, 'AGENTS.md'), agentsMd('html', {
    pages: out.filter((p) => !p.responsive), resp: out.filter((p) => p.responsive),
    css: fs.readFileSync(path.join(siteDir, 'tokens.css'), 'utf8'), meta, components: comp.components,
  }));
  return { root, pages: out, components: comp.components };
}
