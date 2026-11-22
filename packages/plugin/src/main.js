// Основной поток плагина: выбор фреймов, экспорт PNG и пакета, передача файлов в интерфейс.
// Склеивается с export-package.js в dist/code.js (см. build.js).

figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

// выбор «что выгружать»: последний выбор пользователя; если ничего не выделено — весь файл
(async function () {
  var saved = null;
  try { saved = await figma.clientStorage.getAsync('scope'); } catch (e) { saved = null; }
  var selected = figma.currentPage.selection.length;
  var scope = selected ? 'selection' : (saved && saved !== 'selection' ? saved : 'all');
  var resume = await loadResume();
  figma.ui.postMessage({ type: 'init', scope: scope, selected: selected, resume: resume });
})();

// Незаконченная выгрузка частями: с какой части продолжить (переживает закрытие плагина).
async function loadResume() {
  try {
    var r = await figma.clientStorage.getAsync('resume');
    return r && r.file === figma.root.name ? r : null;
  } catch (e) { return null; }
}
async function saveResume(r) {
  try { await figma.clientStorage.setAsync('resume', r); } catch (e) { /* не критично */ }
}

var stopRequested = false;

function isFrameLike(n) {
  return n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'INSTANCE';
}

/** Верхнеуровневые фреймы страницы, включая вложенные в секции. */
function topFrames(parent) {
  var out = [];
  parent.children.forEach(function (n) {
    if (n.visible === false) return;
    if (n.type === 'SECTION') out = out.concat(topFrames(n));
    else if (isFrameLike(n)) out.push(n);
  });
  return out;
}

async function collectFrames(scope) {
  if (scope === 'selection') {
    var sel = figma.currentPage.selection;
    var out = [];
    sel.forEach(function (n) {
      if (n.type === 'SECTION') out = out.concat(topFrames(n));
      else if (isFrameLike(n)) out.push(n);
    });
    return out;
  }
  if (scope === 'page') return topFrames(figma.currentPage);
  await figma.loadAllPagesAsync();
  var all = [];
  figma.root.children.forEach(function (p) { all = all.concat(topFrames(p)); });
  return all;
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'frame';
}

// Большой файл (сотни фреймов) — частями: весь архив в памяти Figma не помещается.
// Часть — до PART_FRAMES фреймов; страница Figma не разрывается, если сама не больше части.
var PART_FRAMES = 25;
function pageOf(n) { var p = n.parent; while (p && p.type !== 'PAGE') p = p.parent; return p; }
function splitParts(frames) {
  var parts = [], cur = [], curPage = null;
  var pagesOf = frames.map(pageOf);
  var sizes = new Map();
  pagesOf.forEach(function (pg) { sizes.set(pg, (sizes.get(pg) || 0) + 1); });
  frames.forEach(function (f, idx) {
    var pg = pagesOf[idx];
    var pageSize = sizes.get(pg);
    var newPage = pg !== curPage;
    if (cur.length && (cur.length >= PART_FRAMES || (newPage && cur.length + pageSize > PART_FRAMES))) { parts.push(cur); cur = []; }
    cur.push(f); curPage = pg;
  });
  if (cur.length) parts.push(cur);
  return parts;
}

function send(files, zipName) {
  // по одному файлу: крупные PNG не упираются в лимиты postMessage
  figma.ui.postMessage({ type: 'begin', count: files.length });
  files.forEach(function (f) { figma.ui.postMessage({ type: 'file', path: f.path, data: f.data }); });
  figma.ui.postMessage({ type: 'done', zipName: zipName });
}

// done/total — сколько фреймов готово из всех: интерфейс рисует полосу и оставшееся время
function progress(m, done, total) { figma.ui.postMessage({ type: 'progress', msg: typeof m === 'string' ? L(m) : m, done: done, total: total }); }

async function exportPngs(frames, scale) {
  var files = [];
  var used = {};
  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    if (stopRequested) break;
    progress(L('PNG {i} из {n}: {name}', { i: i + 1, n: frames.length, name: f.name }), i, frames.length);
    var page = f;
    while (page && page.type !== 'PAGE') page = page.parent;
    var base = safeName(page ? page.name : 'page') + '/' + safeName(f.name);
    var name = base;
    var k = 2;
    while (used[name]) name = base + ' (' + (k++) + ')';
    used[name] = true;
    try {
      var png = await f.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale }, useAbsoluteBounds: true });
      files.push({ path: name + (scale !== 1 ? '@' + scale + 'x' : '') + '.png', data: png });
    } catch (e) {
      figma.ui.postMessage({ type: 'warning', items: [L('Не удалось выгрузить «{name}»: {err}', { name: f.name, err: e && e.message ? e.message : String(e) })] });
    }
  }
  return files;
}

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'stop') { stopRequested = true; return; }
  try {
    if (msg.type === 'count') {
      var fr = await collectFrames(msg.scope);
      var pages = {};
      fr.forEach(function (f) { var p = f.parent; while (p && p.type !== 'PAGE') p = p.parent; pages[p ? p.id : '-'] = true; });
      figma.ui.postMessage({ type: 'count', count: fr.length, pages: Object.keys(pages).length });
      return;
    }
    if (msg.type === 'import-tokens') {
      var json;
      try { json = JSON.parse(msg.text); } catch (e) { throw new Error('Это не JSON: выберите tokens.json из папки design-system'); }
      var r = await importTokens(json, { paintStyles: !!msg.paintStyles, onProgress: progress });
      var done = L('Создано/обновлено: переменных {v}, текстовых стилей {t}, стилей теней {e}', { v: r.variables, t: r.textStyles, e: r.effectStyles });
      var items = [done];
      if (r.paintStyles) items.push(L('Цветовых стилей: {n}', { n: r.paintStyles }));
      if (r.skippedFonts.length) items.push(L('Нет шрифтов в Figma: {fonts} — текстовые стили для них не созданы', { fonts: r.skippedFonts.join(', ') }));
      figma.ui.postMessage({ type: 'imported', items: items });
      figma.notify(done.text);
      return;
    }
    if (msg.type !== 'export') return;
    stopRequested = false;
    try { await figma.clientStorage.setAsync('scope', msg.scope); } catch (e) { /* не критично */ }
    if (msg.scope === 'all') progress(L('Загружаю страницы файла — на большом файле до минуты…'));
    var frames = await collectFrames(msg.scope);
    if (!frames.length) {
      figma.ui.postMessage({ type: 'error', msg: L(msg.scope === 'selection' ? 'Выделите фреймы или секцию' : 'На странице нет фреймов') });
      return;
    }
    var scale = msg.scale || 1;
    var fileBase = safeName(figma.root.name);
    if (msg.what === 'png') {
      var pngs = await exportPngs(frames, scale);
      if (stopRequested) { figma.ui.postMessage({ type: 'stopped', msg: L('PNG не сохранены.') }); return; }
      send(pngs, fileBase + ' — PNG.zip');
      figma.ui.postMessage({ type: 'finished', msg: L('Готово: фреймов {n}', { n: frames.length }) });
      return;
    }
    var parts = splitParts(frames);
    // продолжение: те же фреймы → те же части; id прежний, чтобы программа склеила старые и новые части
    var from = 0;
    var exportId = Date.now().toString(36);
    if (msg.resume && msg.resume.total === parts.length && msg.resume.frames === frames.length) {
      from = Math.max(0, Math.min(parts.length - 1, msg.resume.next - 1));
      exportId = msg.resume.id;
    }
    var doneBefore = 0;
    for (var q = 0; q < from; q++) doneBefore += parts[q].length;
    var warnings = [];
    for (var pi = from; pi < parts.length; pi++) {
      var label = parts.length > 1 ? ' (часть ' + (pi + 1) + ' из ' + parts.length + ')' : '';
      var resumeState = { file: figma.root.name, id: exportId, total: parts.length, frames: frames.length, next: pi + 1, scope: msg.scope, scale: scale };
      await saveResume(resumeState);
      var pkg = await buildLayoutPackage(parts[pi], {
        scale: scale,
        part: parts.length > 1 ? { id: exportId, index: pi + 1, total: parts.length } : undefined,
        shouldStop: function () { return stopRequested; },
        onProgress: function (m, i) { progress(parts.length > 1 ? L('Часть {p} из {total} · {inner}', { p: pi + 1, total: parts.length, inner: typeof m === 'string' ? L(m) : m }) : m, doneBefore + (i || 0), frames.length); },
      });
      if (pkg.stopped) {
        figma.ui.postMessage({ type: 'stopped', resume: parts.length > 1 ? resumeState : null,
          msg: parts.length > 1 ? L('Скачано частей: {done} из {total}. Можно продолжить с части {next}.', { done: pi, total: parts.length, next: pi + 1 }) : null });
        return;
      }
      send(pkg.files, fileBase + ' — ds-package' + label + '.zip');
      warnings = warnings.concat(pkg.warnings);
      doneBefore += parts[pi].length;
      pkg = null; // память Figma — под следующую часть
    }
    await saveResume(null);
    if (warnings.length) figma.ui.postMessage({ type: 'warning', items: warnings });
    figma.ui.postMessage({ type: 'finished', parts: parts.length,
      msg: parts.length > 1 ? L('Готово: фреймов {n}, частей {parts}. Перетащите все части в DS Builder сразу.', { n: frames.length, parts: parts.length }) : L('Готово: фреймов {n}', { n: frames.length }) });
    figma.notify(L('Готово: фреймов {n}', { n: frames.length }).text);
  } catch (e) {
    // на ошибке в середине большой выгрузки можно продолжить с той же части
    var rs = msg.type === 'export' && msg.what !== 'png' ? await loadResume() : null;
    figma.ui.postMessage({ type: 'error', msg: L(String(e && e.message ? e.message : e)), resume: rs });
  }
};
