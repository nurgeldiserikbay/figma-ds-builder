// Основной поток плагина: выбор фреймов, экспорт PNG и пакета, передача файлов в интерфейс.
// Склеивается с export-package.js в dist/code.js (см. build.js).

figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

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

function send(files, zipName) {
  // по одному файлу: крупные PNG не упираются в лимиты postMessage
  figma.ui.postMessage({ type: 'begin', count: files.length });
  files.forEach(function (f) { figma.ui.postMessage({ type: 'file', path: f.path, data: f.data }); });
  figma.ui.postMessage({ type: 'done', zipName: zipName });
}

function progress(text) { figma.ui.postMessage({ type: 'progress', text: text }); }

async function exportPngs(frames, scale) {
  var files = [];
  var used = {};
  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    progress('PNG ' + (i + 1) + ' из ' + frames.length + ': ' + f.name);
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
      figma.ui.postMessage({ type: 'warning', text: 'Не удалось выгрузить «' + f.name + '»: ' + (e && e.message ? e.message : e) });
    }
  }
  return files;
}

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'count') {
      var fr = await collectFrames(msg.scope);
      figma.ui.postMessage({ type: 'count', count: fr.length });
      return;
    }
    if (msg.type === 'import-tokens') {
      var json;
      try { json = JSON.parse(msg.text); } catch (e) { throw new Error('Это не JSON: выберите tokens.json из папки design-system'); }
      var r = await importTokens(json, { paintStyles: !!msg.paintStyles, onProgress: progress });
      var text = 'Создано/обновлено: переменных ' + r.variables + ', текстовых стилей ' + r.textStyles + ', стилей теней ' + r.effectStyles +
        (r.paintStyles ? ', цветовых стилей ' + r.paintStyles : '') +
        (r.skippedFonts.length ? '. Нет шрифтов в Figma: ' + r.skippedFonts.join(', ') + ' — текстовые стили для них не созданы' : '');
      figma.ui.postMessage({ type: 'imported', text: text });
      figma.notify(text.split('.')[0]);
      return;
    }
    if (msg.type !== 'export') return;
    var frames = await collectFrames(msg.scope);
    if (!frames.length) {
      figma.ui.postMessage({ type: 'error', text: msg.scope === 'selection' ? 'Выделите фреймы или секцию' : 'На странице нет фреймов' });
      return;
    }
    var scale = msg.scale || 1;
    var fileBase = safeName(figma.root.name);
    if (msg.what === 'png') {
      send(await exportPngs(frames, scale), fileBase + ' — PNG.zip');
    } else {
      var pkg = await buildLayoutPackage(frames, { scale: scale, onProgress: progress });
      send(pkg.files, fileBase + ' — ds-package.zip');
      if (pkg.warnings.length) figma.ui.postMessage({ type: 'warning', text: pkg.warnings.join('\n') });
    }
    figma.notify('Готово: фреймов ' + frames.length);
  } catch (e) {
    figma.ui.postMessage({ type: 'error', text: String(e && e.message ? e.message : e) });
  }
};
