// Проверка правок по макету: ИИ или человек поправил вёрстку — `ds-build check <папка сборки>` рендерит
// экраны (html/ или запущенный проект React/Vue/любой) и сверяет с макетом из Figma: процент несовпадающих
// пикселей, текст отдельно от остального, какие слои Figma расходятся и где. Ничего не меняет в коде.
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, renderPage, elementsAt } from './render.js';
import { comparePng, imageBoxes } from './diff.js';
import { attributeDiff } from './attribute.js';

/** Сводка для проверки — пишется при сборке (check.json в корне). */
export function writeCheckManifest(out, { scale, threshold, textThreshold, textAreaThreshold, results, codeOf, routeOf }) {
  const screens = results.filter((r) => r.dir && fs.existsSync(path.join(out, r.dir, 'reference.png'))).map((r) => ({
    name: r.name, id: r.id, dir: r.dir, width: r.width, height: r.height,
    html: (codeOf.get(r.dir) || []).find((f) => f.startsWith('html/')) || null,
    route: routeOf.get(r.dir) || null,
    percent: r.diff ? Math.round(r.diff.percent * 1000) / 1000 : null, pass: r.pass ?? null,
  }));
  fs.writeFileSync(path.join(out, 'check.json'), JSON.stringify({ scale, threshold, textThreshold, textAreaThreshold, screens }, null, 2));
}

/**
 * Скрипты проверки в папке сборки: ./check.sh и check.cmd — тот же исполняемый файл, что собирал (Node или
 * программа DS Builder в роли Node), с этой папкой. ИИ-агенту не нужно знать, где установлена программа.
 * Из AppImage (Linux) путь временный — тогда скриптов нет, проверка — кнопкой в окне программы.
 */
export function writeCheckScripts(out, { exec = process.execPath, cli, env = process.env } = {}) {
  if (env.APPIMAGE) return false;
  fs.writeFileSync(path.join(out, 'check.sh'), `#!/bin/sh\n# Проверка вёрстки по макету: ./check.sh [--screen "Имя экрана"] [--url http://localhost:5173]\ncd "$(dirname "$0")" && ELECTRON_RUN_AS_NODE=1 "${exec}" "${cli}" check . "$@"\n`);
  try { fs.chmodSync(path.join(out, 'check.sh'), 0o755); } catch { /* Windows */ }
  fs.writeFileSync(path.join(out, 'check.cmd'), `@echo off\r\nrem Проверка вёрстки по макету: check.cmd [--screen "Имя экрана"] [--url http://localhost:5173]\r\nchcp 65001 >nul\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exec}" "${cli}" check "%~dp0." %*\r\n`);
  return true;
}

const textAreaOf = (tree, scale) => {
  let a = 0;
  (function walk(n) { if (n.visible === false) return; if (n.type === 'TEXT') a += (n.w || 0) * (n.h || 0); (n.children || []).forEach(walk); })(tree);
  return a * scale * scale;
};

/** Где расходится: имя слоя Figma, вид, пиксели, место (x, y, ширина, высота — в координатах макета). */
const where = (s) => `«${s.name}»${s.selector ? ` → ${s.selector}` : ''} (${s.type === 'TEXT' ? 'текст' : s.type ? s.type.toLowerCase() : 'вне слоёв'}, ${s.pixels} px${s.box ? `, x ${Math.round(s.box.x)} y ${Math.round(s.box.y)}, ${Math.round(s.box.w)}×${Math.round(s.box.h)}` : ''})`;

/**
 * @param dir    папка сборки
 * @param screen часть имени экрана или id (можно несколько через запятую); без — все экраны
 * @param url    адрес запущенного проекта (http://localhost:5173): страница — url#маршрут, или {route} в адресе
 * @param target html (по умолчанию) — страницы из html/
 */
export async function checkBuild({ dir, screen = null, url = null, json = false, log = console.log }) {
  const mf = path.join(dir, 'check.json');
  if (!fs.existsSync(mf)) throw new Error(`нет ${mf} — пересоберите макет этой версией DS Builder`);
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const want = screen ? String(screen).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  const list = m.screens.filter((s) => !want || want.some((w) => s.name.toLowerCase().includes(w) || s.id === w || s.dir.toLowerCase() === w));
  if (!list.length) throw new Error(`не найден экран «${screen}». Есть: ${m.screens.slice(0, 12).map((s) => s.name).join(', ')}${m.screens.length > 12 ? '…' : ''}`);
  const outDir = path.join(dir, '.check');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await openBrowser();
  const res = [];
  try {
    for (const s of list) {
      const target = url
        ? (url.includes('{route}') ? url.replace('{route}', s.route || '') : `${url.replace(/#.*$/, '')}${s.route ? `#${s.route}` : ''}`)
        : s.html ? path.join(dir, s.html) : path.join(dir, s.dir, 'index.html');
      if (!url && !fs.existsSync(target)) { res.push({ ...s, error: `нет файла ${path.relative(dir, target)}` }); continue; }
      const sd = path.join(outDir, s.dir);
      fs.mkdirSync(sd, { recursive: true });
      const png = path.join(sd, 'render.png'), diffPng = path.join(sd, 'diff.png');
      let r;
      try { r = await renderPage(browser, target, { width: s.width, height: s.height, scale: m.scale || 1, out: png, keepPage: true }); }
      catch (e) { res.push({ ...s, error: `не открылась страница: ${String(e.message).split('\n')[0]}` }); continue; }
      const ref = path.join(dir, s.dir, 'reference.png');
      fs.copyFileSync(ref, path.join(sd, 'reference.png'));
      const treeFile = path.join(dir, s.dir, 'tree.json');
      const tree = fs.existsSync(treeFile) ? JSON.parse(fs.readFileSync(treeFile, 'utf8')) : null;
      const d = comparePng(ref, png, diffPng, { images: tree ? imageBoxes(tree) : [], scale: m.scale || 1 });
      // дробный размер макета (1375.29) даёт разницу в 1 px — это не ошибка вёрстки
      const dim = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
      const [rw, rh] = dim(ref), [aw, ah] = dim(png);
      const realSize = Math.abs(rw - aw) > (m.scale || 1) || Math.abs(rh - ah) > (m.scale || 1);
      const src = d.mismatched && tree ? attributeDiff(tree, diffPng, { scale: m.scale || 1, top: 8 }) : null;
      // какой элемент кода на месте слоя: по положению слоя в макете (служебные атрибуты не нужны)
      if (src?.top.length) {
        const node = new Map();
        (function walk(n) { node.set(n.id, n); (n.children || []).forEach(walk); })(tree);
        const rects = src.top.map((t) => node.get(t.id)).map((n) => (n ? { x: n.x, y: n.y, w: Math.max(1, n.w), h: Math.max(1, n.h) } : { x: 0, y: 0, w: 1, h: 1 }));
        const sels = await elementsAt(r.page, rects).catch(() => []);
        src.top.forEach((t, i) => { if (sels[i]) t.selector = sels[i]; });
      }
      await r.page.close();
      const total = d.total || 1, text = src?.byType?.['текст'] || 0;
      const textArea = tree ? textAreaOf(tree, m.scale || 1) : 0;
      const textPct = (text / total) * 100, otherPct = ((d.mismatched - text) / total) * 100;
      const textAreaPct = textArea ? (text / textArea) * 100 : null;
      const pass = !realSize && otherPct <= m.threshold && (textPct <= m.textThreshold || (textAreaPct !== null && textAreaPct <= m.textAreaThreshold));
      const missingFonts = (r.fonts || []).filter((f) => !f.available).map((f) => f.family);
      res.push({ name: s.name, id: s.id, dir: s.dir, pass, percent: d.percent, textPct, otherPct, before: s.percent, size: realSize ? `размер страницы ${Math.round(aw / (m.scale || 1))}×${Math.round(ah / (m.scale || 1))}, в макете ${Math.round(s.width)}×${Math.round(s.height)} — что-то выпирает или не дотягивает` : null,
        top: src?.top || [], missingFonts, files: { reference: path.relative(dir, path.join(sd, 'reference.png')), render: path.relative(dir, png), diff: path.relative(dir, diffPng) } });
    }
  } finally {
    await browser.close();
  }
  if (json) log(JSON.stringify(res, null, 2));
  else {
    for (const x of res) {
      if (x.error) { log(`✗ ${x.name}: ${x.error}`); continue; }
      const was = x.before != null ? ` (при сборке ${x.before.toFixed(2)}%)` : '';
      log(`${x.pass ? '✓' : '✗'} ${x.name}: расхождение ${x.percent.toFixed(2)}%${was} — текст ${x.textPct.toFixed(2)}%, остальное ${x.otherPct.toFixed(2)}%`);
      if (x.size) log(`    ${x.size}`);
      if (x.missingFonts.length) log(`    нет шрифтов: ${x.missingFonts.join(', ')}`);
      if (!x.pass && x.top.length) log(`    больше всего расходится: ${x.top.slice(0, 4).map(where).join('; ')}`);
      if (!x.pass) log(`    картинки: ${x.files.reference} (макет), ${x.files.render} (вёрстка), ${x.files.diff} (красное — расхождение)`);
    }
    const ok = res.filter((x) => x.pass).length;
    log(`Итог: совпадают с макетом ${ok} из ${res.length}`);
  }
  return res;
}
