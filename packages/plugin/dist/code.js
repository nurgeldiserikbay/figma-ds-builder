// ---- export-package.js ----
// Экспорт пакета ds-package v1 из Figma (основной поток плагина).
// Формат: docs/package-format.md. Встраивается в code.js плагина Design System Extractor.
//
// Использование:
//   const pkg = await buildLayoutPackage(frames, { scale: 1, tokens, analysis, onProgress });
//   // pkg.files — [{ path, data }] (data: string | Uint8Array) → UI упаковывает в zip
//
// Примечание: песочница Figma отклоняет код с текстом «import» + «(» подряд даже в строках и комментариях —
// не добавляйте его в этот файл.

var EXPORT_VECTOR_TYPES = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, POLYGON: 1, LINE: 1 };

function fileId(id) { return String(id).replace(/[:;]/g, '_'); }
function num(v, d) { return typeof v === 'number' ? Math.round(v * 100) / 100 : d; }
function isMixed(v) { return v === figma.mixed; }

function colorOf(c, a) { return { r: c.r, g: c.g, b: c.b, a: a === undefined ? (c.a === undefined ? 1 : c.a) : a }; }

function gradientCss(p) {
  // угол из gradientTransform: вектор направления (a, b) первой строки матрицы
  var t = p.gradientTransform;
  var angle = 90;
  if (t) angle = Math.round((Math.atan2(t[0][1], t[0][0]) * 180) / Math.PI + 90);
  var stops = p.gradientStops.map(function (s) {
    var c = s.color;
    var rgba = 'rgba(' + Math.round(c.r * 255) + ', ' + Math.round(c.g * 255) + ', ' + Math.round(c.b * 255) + ', ' + num(c.a, 1) + ')';
    return rgba + ' ' + Math.round(s.position * 100) + '%';
  }).join(', ');
  if (p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_DIAMOND') return 'radial-gradient(' + stops + ')';
  if (p.type === 'GRADIENT_ANGULAR') return 'conic-gradient(from ' + angle + 'deg, ' + stops + ')';
  return 'linear-gradient(' + angle + 'deg, ' + stops + ')';
}

function paints(list, ctx) {
  if (!list || isMixed(list)) return [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var base = { type: p.type, opacity: num(p.opacity, 1), visible: p.visible !== false };
    if (p.type === 'SOLID') base.color = colorOf(p.color);
    else if (p.type.indexOf('GRADIENT') === 0) base.css = gradientCss(p);
    else if (p.type === 'IMAGE' && p.imageHash) {
      base.src = 'images/' + p.imageHash + '.png';
      base.scaleMode = p.scaleMode;
      ctx.images[p.imageHash] = true;
    } else continue;
    out.push(base);
  }
  return out;
}

function effects(node) {
  if (!('effects' in node)) return [];
  return node.effects.filter(function (e) { return e.visible !== false; }).map(function (e) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      return { type: e.type, x: e.offset.x, y: e.offset.y, blur: e.radius, spread: e.spread || 0, color: colorOf(e.color) };
    }
    return { type: e.type, radius: e.radius };
  });
}

function radius(node) {
  if (!('cornerRadius' in node)) return undefined;
  if (!isMixed(node.cornerRadius)) return node.cornerRadius ? [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius] : undefined;
  return [node.topLeftRadius || 0, node.topRightRadius || 0, node.bottomRightRadius || 0, node.bottomLeftRadius || 0];
}

function strokeWeight(node) {
  if (!('strokeWeight' in node)) return undefined;
  if (!isMixed(node.strokeWeight)) return node.strokeWeight;
  return [node.strokeTopWeight || 0, node.strokeRightWeight || 0, node.strokeBottomWeight || 0, node.strokeLeftWeight || 0];
}

function autoLayout(node) {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE' || node.layoutMode === 'GRID') return undefined;
  return {
    mode: node.layoutMode,
    gap: node.primaryAxisAlignItems === 'SPACE_BETWEEN' ? 'auto' : node.itemSpacing,
    padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
    primaryAlign: node.primaryAxisAlignItems,
    counterAlign: node.counterAxisAlignItems,
    wrap: node.layoutWrap === 'WRAP',
    counterGap: node.counterAxisSpacing || 0,
  };
}

function textData(node, ctx) {
  var segs = node.getStyledTextSegments(['fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fills', 'textDecoration', 'textCase']);
  segs.forEach(function (s) {
    var k = s.fontName.family + '|' + s.fontName.style;
    var f = ctx.fonts[k] || (ctx.fonts[k] = { family: s.fontName.family, style: s.fontName.style, weight: s.fontWeight, sizes: {}, uses: 0 });
    f.uses++;
    f.sizes[s.fontSize] = true;
  });
  return {
    characters: node.characters,
    align: node.textAlignHorizontal,
    verticalAlign: node.textAlignVertical,
    autoResize: node.textAutoResize,
    segments: segs.map(function (s) {
      return {
        start: s.start, end: s.end,
        fontFamily: s.fontName.family, fontStyle: s.fontName.style, fontWeight: s.fontWeight,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: s.lineHeight.unit, value: s.lineHeight.value },
        letterSpacing: { unit: s.letterSpacing.unit, value: s.letterSpacing.value },
        textDecoration: s.textDecoration, textCase: s.textCase,
        fills: paints(s.fills, ctx),
      };
    }),
  };
}

/** Геометрия относительно корневого фрейма. Для повёрнутых слоёв — без учёта поворота (x,y — точка начала). */
function geometry(node, ox, oy) {
  var t = node.absoluteTransform;
  var rot = 'rotation' in node ? node.rotation || 0 : 0;
  if (Math.abs(rot) < 0.01) {
    return { x: num(t[0][2] - ox), y: num(t[1][2] - oy), w: num(node.width), h: num(node.height), rotation: 0 };
  }
  var bb = node.absoluteBoundingBox;
  return { x: num(bb.x - ox), y: num(bb.y - oy), w: num(node.width), h: num(node.height), rotation: num(rot) };
}

function serialize(node, ox, oy, ctx) {
  ctx.count++;
  var g = geometry(node, ox, oy);
  var rot = g.rotation;
  var o = {
    id: node.id, name: node.name, type: node.type,
    x: g.x, y: g.y, w: g.w, h: g.h, rotation: g.rotation,
    visible: node.visible !== false,
    opacity: 'opacity' in node ? num(node.opacity, 1) : 1,
    blendMode: 'blendMode' in node ? node.blendMode : 'NORMAL',
  };
  if (!o.visible) return o; // скрытые слои не разворачиваем
  if ('clipsContent' in node) o.clipsContent = node.clipsContent;
  if ('isMask' in node && node.isMask) o.isMask = true;
  if ('fills' in node) o.fills = paints(node.fills, ctx);
  if ('strokes' in node && node.strokes.length) {
    o.strokes = paints(node.strokes, ctx);
    o.strokeWeight = strokeWeight(node);
    o.strokeAlign = node.strokeAlign;
  }
  o.radius = radius(node);
  o.effects = effects(node);
  var L = autoLayout(node);
  if (L) o.layout = L;
  if ('layoutPositioning' in node) o.layoutPositioning = node.layoutPositioning;
  if ('layoutSizingHorizontal' in node) o.sizing = { h: node.layoutSizingHorizontal, v: node.layoutSizingVertical };

  if (node.type === 'INSTANCE') {
    o.component = { name: node.name, variant: node.variantProperties || undefined };
    ctx.instances.push(node);
  }

  if (node.type === 'TEXT') {
    o.text = textData(node, ctx);
    return o;
  }
  if (EXPORT_VECTOR_TYPES[node.type]) {
    o.svg = 'vectors/' + fileId(node.id) + '.svg';
    ctx.vectors.push(node);
    // SVG рисуется по границам рендера (обводки снаружи, тени): рамка относительно слоя
    var rb = node.absoluteRenderBounds;
    if (rb && Math.abs(rot) < 0.01) {
      var bx = rb.x - node.absoluteTransform[0][2], by = rb.y - node.absoluteTransform[1][2];
      if (Math.abs(bx) > 0.5 || Math.abs(by) > 0.5 || Math.abs(rb.width - node.width) > 0.5 || Math.abs(rb.height - node.height) > 0.5) {
        o.svgBox = { x: num(bx), y: num(by), w: num(rb.width), h: num(rb.height) };
      }
    }
    return o;
  }
  if ('children' in node) {
    o.children = node.children.map(function (c) { return serialize(c, ox, oy, ctx); });
  }
  return o;
}

/**
 * @param {FrameNode[]} frames  верхнеуровневые фреймы (или выбранные)
 * @param {{ scale?: number, tokens?: object, analysis?: object, fileName?: string, onProgress?: function }} opts
 */
async function buildLayoutPackage(frames, opts) {
  opts = opts || {};
  var scale = opts.scale || 1;
  var files = [];
  var manifestFrames = [];
  var images = {};
  var fonts = {};
  var warnings = [];
  var progress = opts.onProgress || function () {};

  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    progress('Фрейм ' + (i + 1) + ' из ' + frames.length + ': ' + f.name);
    var t = f.absoluteTransform;
    var ctx = { images: images, vectors: [], instances: [], count: 0, fonts: fonts };
    var tree = serialize(f, t[0][2], t[1][2], ctx);
    var fid = fileId(f.id);
    files.push({ path: 'frames/' + fid + '.json', data: JSON.stringify(tree) });

    // эталон: рендер Figma
    // ровно в границах фрейма, даже если содержимое выступает за них.
    // Очень большие фреймы Figma может не отрендерить — тогда фрейм идёт без эталона (только проверка геометрии).
    var pngOk = true;
    try {
      var png = await f.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale }, useAbsoluteBounds: true });
      files.push({ path: 'frames/' + fid + '.png', data: png });
    } catch (e) {
      pngOk = false;
      warnings.push('Нет PNG для «' + f.name + '» (' + Math.round(f.width) + '×' + Math.round(f.height) + '): ' + (e && e.message ? e.message : e));
    }

    for (var v = 0; v < ctx.vectors.length; v++) {
      try {
        var svg = await ctx.vectors[v].exportAsync({ format: 'SVG' });
        files.push({ path: 'vectors/' + fileId(ctx.vectors[v].id) + '.svg', data: svg });
      } catch (e) { /* пустой вектор — пропускаем */ }
    }
    manifestFrames.push({
      id: f.id, name: f.name, page: f.parent && f.parent.type === 'PAGE' ? f.parent.name : (figma.currentPage.name),
      width: num(f.width), height: num(f.height),
      tree: 'frames/' + fid + '.json', png: pngOk ? 'frames/' + fid + '.png' : undefined, layers: ctx.count,
    });
  }

  var hashes = Object.keys(images);
  for (var h = 0; h < hashes.length; h++) {
    progress('Картинки: ' + (h + 1) + ' из ' + hashes.length);
    var img = figma.getImageByHash(hashes[h]);
    if (!img) continue;
    try {
      files.push({ path: 'images/' + hashes[h] + '.png', data: await img.getBytesAsync() });
    } catch (e) { /* недоступная картинка */ }
  }

  // шрифты, которые реально используются в выгруженных макетах
  var fontList = Object.keys(fonts).map(function (k) {
    var f = fonts[k];
    return { family: f.family, style: f.style, weight: f.weight, uses: f.uses, sizes: Object.keys(f.sizes).map(Number).sort(function (a, b) { return a - b; }) };
  }).sort(function (a, b) { return b.uses - a.uses; });
  files.push({ path: 'fonts.json', data: JSON.stringify(fontList, null, 2) });
  try {
    files.push({ path: 'variables.json', data: JSON.stringify(await exportVariables(), null, 2) });
    files.push({ path: 'styles.json', data: JSON.stringify(await exportStyles(), null, 2) });
  } catch (e) { progress('Переменные/стили не выгружены: ' + e.message); }
  if (opts.tokens) files.push({ path: 'tokens.json', data: JSON.stringify(opts.tokens, null, 2) });
  if (opts.analysis) files.push({ path: 'analysis.json', data: JSON.stringify(opts.analysis) });

  var manifest = {
    format: 'ds-package', version: 1,
    file: opts.fileName || figma.root.name,
    createdAt: new Date().toISOString(),
    scale: scale,
    tokens: opts.tokens ? 'tokens.json' : undefined,
    fonts: 'fonts.json', variables: 'variables.json', styles: 'styles.json',
    frames: manifestFrames,
    warnings: warnings.length ? warnings : undefined,
  };
  files.unshift({ path: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  return { manifest: manifest, files: files, warnings: warnings };
}

/** Локальные переменные файла: коллекции, режимы, значения (алиасы — ссылкой на имя). */
async function exportVariables() {
  var cols = await figma.variables.getLocalVariableCollectionsAsync();
  var vars = await figma.variables.getLocalVariablesAsync();
  var byId = {};
  vars.forEach(function (v) { byId[v.id] = v; });
  return cols.map(function (c) {
    return {
      name: c.name,
      modes: c.modes.map(function (m) { return m.name; }),
      variables: c.variableIds.map(function (id) { return byId[id]; }).filter(Boolean).map(function (v) {
        var values = {};
        c.modes.forEach(function (m) {
          var val = v.valuesByMode[m.modeId];
          if (val && val.type === 'VARIABLE_ALIAS') val = { alias: byId[val.id] ? byId[val.id].name : val.id };
          values[m.name] = val;
        });
        return { name: v.name, type: v.resolvedType, values: values, scopes: v.scopes };
      }),
    };
  });
}

/** Локальные стили: цвета, текст, эффекты, сетки. */
async function exportStyles() {
  var paint = await figma.getLocalPaintStylesAsync();
  var text = await figma.getLocalTextStylesAsync();
  var effect = await figma.getLocalEffectStylesAsync();
  var ctx = { images: {} };
  return {
    paint: paint.map(function (s) { return { name: s.name, paints: paints(s.paints, ctx) }; }),
    text: text.map(function (s) {
      return { name: s.name, fontFamily: s.fontName.family, fontStyle: s.fontName.style, fontSize: s.fontSize,
        lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration };
    }),
    effect: effect.map(function (s) { return { name: s.name, effects: s.effects.map(function (e) {
      return e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'
        ? { type: e.type, x: e.offset.x, y: e.offset.y, blur: e.radius, spread: e.spread || 0, color: colorOf(e.color) }
        : { type: e.type, radius: e.radius };
    }) }; }),
  };
}

// ---- import-tokens.js ----
// Импорт дизайн-системы платформы (tokens.json, W3C DTCG) в Figma:
// переменные (DS · Primitives, DS · Semantic, DS · Typography), текстовые стили, стили теней, цветовые стили.
// Повторный запуск обновляет созданное (поиск по имени), а не дублирует.
// Решений здесь нет: плагин только записывает то, что построила платформа.

function dtcgLeaves(obj, path, out) {
  if (!obj || typeof obj !== 'object') return out;
  if (Object.prototype.hasOwnProperty.call(obj, '$value')) { out.push({ path: path, type: obj.$type, value: obj.$value }); return out; }
  Object.keys(obj).forEach(function (k) { if (k.charAt(0) !== '$') dtcgLeaves(obj[k], path.concat(k), out); });
  return out;
}

function hexToRgba(hex) {
  var s = String(hex).replace('#', '');
  var n = function (i) { return parseInt(s.slice(i, i + 2), 16) / 255; };
  return { r: n(0), g: n(2), b: n(4), a: s.length >= 8 ? n(6) : 1 };
}
function dim(v) { return typeof v === 'number' ? v : parseFloat(String(v)) || 0; }

async function getCollection(name) {
  var cols = await figma.variables.getLocalVariableCollectionsAsync();
  var c = cols.filter(function (x) { return x.name === name; })[0];
  if (!c) {
    c = figma.variables.createVariableCollection(name);
    try { c.renameMode(c.modes[0].modeId, 'Value'); } catch (e) { /* бесплатный тариф: один режим — нам и нужен один */ }
  }
  return c;
}

async function upsertVariable(collection, name, type, value, cache) {
  var key = collection.id + '|' + name;
  var v = cache[key];
  if (!v) {
    v = figma.variables.createVariable(name, collection, type);
    cache[key] = v;
  }
  v.setValueForMode(collection.modes[0].modeId, value);
  return v;
}

var WEIGHT_STYLES = {
  100: ['Thin', 'Hairline'], 200: ['Extra Light', 'ExtraLight', 'Ultra Light'], 300: ['Light'], 400: ['Regular', 'Normal', 'Book'],
  500: ['Medium'], 600: ['Semi Bold', 'SemiBold', 'Demi Bold'], 700: ['Bold'], 800: ['Extra Bold', 'ExtraBold', 'Ultra Bold'], 900: ['Black', 'Heavy'],
};

/** Подбор начертания по весу среди установленных шрифтов. */
function pickStyle(available, family, weight) {
  var styles = available.filter(function (f) { return f.fontName.family === family; }).map(function (f) { return f.fontName.style; });
  if (!styles.length) return null;
  var w = Math.round((weight || 400) / 100) * 100;
  var want = (WEIGHT_STYLES[w] || ['Regular']).map(function (s) { return s.toLowerCase().replace(/\s/g, ''); });
  var hit = styles.filter(function (s) { return want.indexOf(s.toLowerCase().replace(/\s/g, '')) >= 0; })[0];
  return hit || null;
}

async function importTokens(json, opts) {
  opts = opts || {};
  var progress = opts.onProgress || function () {};
  var leaves = dtcgLeaves(json, [], []);
  var res = { variables: 0, textStyles: 0, effectStyles: 0, paintStyles: 0, skippedFonts: [] };

  var existing = await figma.variables.getLocalVariablesAsync();
  var cache = {};
  existing.forEach(function (v) { cache[v.variableCollectionId + '|' + v.name] = v; });

  progress('Переменные: примитивы…');
  var prim = await getCollection('DS · Primitives');
  var byPath = {};
  for (var i = 0; i < leaves.length; i++) {
    var l = leaves[i];
    var root = l.path[0];
    if (l.type === 'color' && root === 'color') {
      byPath[l.path.join('.')] = await upsertVariable(prim, l.path.join('/'), 'COLOR', hexToRgba(l.value), cache);
      res.variables++;
    } else if (l.type === 'dimension' && (root === 'spacing' || root === 'radius' || root === 'border' || root === 'breakpoint')) {
      byPath[l.path.join('.')] = await upsertVariable(prim, l.path.join('/'), 'FLOAT', dim(l.value), cache);
      res.variables++;
    }
  }

  progress('Переменные: семантика…');
  var sem = await getCollection('DS · Semantic');
  for (var j = 0; j < leaves.length; j++) {
    var s = leaves[j];
    if (s.path[0] !== 'semantic' || s.type !== 'color') continue;
    var m = /^\{(.+)\}$/.exec(String(s.value));
    var target = m && byPath[m[1]];
    var val = target ? figma.variables.createVariableAlias(target) : hexToRgba(s.value);
    await upsertVariable(sem, s.path.slice(1).join('/'), 'COLOR', val, cache);
    res.variables++;
  }

  progress('Текстовые стили…');
  var typo = await getCollection('DS · Typography');
  var available = await figma.listAvailableFontsAsync();
  var textStyles = await figma.getLocalTextStylesAsync();
  for (var k = 0; k < leaves.length; k++) {
    var t = leaves[k];
    if (t.type !== 'typography') continue;
    var name = t.path.slice(1).join('/');
    var v = t.value;
    var size = await upsertVariable(typo, 'font-size/' + name, 'FLOAT', dim(v.fontSize), cache);
    var lh = v.lineHeight && v.lineHeight !== 'normal' ? await upsertVariable(typo, 'line-height/' + name, 'FLOAT', dim(v.lineHeight), cache) : null;
    res.variables += lh ? 2 : 1;
    var style = pickStyle(available, v.fontFamily, v.fontWeight);
    if (!style) { res.skippedFonts.push(v.fontFamily + ' ' + v.fontWeight); continue; }
    var fontName = { family: v.fontFamily, style: style };
    await figma.loadFontAsync(fontName);
    var ts = textStyles.filter(function (x) { return x.name === 'DS/' + name; })[0] || figma.createTextStyle();
    ts.name = 'DS/' + name;
    ts.fontName = fontName;
    ts.fontSize = dim(v.fontSize);
    ts.lineHeight = lh ? { unit: 'PIXELS', value: dim(v.lineHeight) } : { unit: 'AUTO' };
    ts.letterSpacing = { unit: 'PIXELS', value: dim(v.letterSpacing) };
    try { ts.setBoundVariable('fontSize', size); if (lh) ts.setBoundVariable('lineHeight', lh); } catch (e) { /* старые версии API */ }
    res.textStyles++;
  }

  progress('Стили теней…');
  var effectStyles = await figma.getLocalEffectStylesAsync();
  for (var e = 0; e < leaves.length; e++) {
    var sh = leaves[e];
    if (sh.type !== 'shadow') continue;
    var sv = sh.value;
    var c = hexToRgba(sv.color);
    var es = effectStyles.filter(function (x) { return x.name === 'DS/shadow/' + sh.path.slice(1).join('/'); })[0] || figma.createEffectStyle();
    es.name = 'DS/shadow/' + sh.path.slice(1).join('/');
    es.effects = [{
      type: sv.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: c, offset: { x: dim(sv.offsetX), y: dim(sv.offsetY) },
      radius: dim(sv.blur), spread: dim(sv.spread), visible: true, blendMode: 'NORMAL',
    }];
    res.effectStyles++;
  }

  if (opts.paintStyles) {
    progress('Цветовые стили…');
    var paintStyles = await figma.getLocalPaintStylesAsync();
    var keys = Object.keys(byPath).filter(function (p) { return p.indexOf('color.') === 0; });
    for (var q = 0; q < keys.length; q++) {
      var varr = byPath[keys[q]];
      var nm = 'DS/' + keys[q].split('.').slice(1).join('/');
      var ps = paintStyles.filter(function (x) { return x.name === nm; })[0] || figma.createPaintStyle();
      ps.name = nm;
      var col = hexToRgba(leaves.filter(function (x) { return x.path.join('.') === keys[q]; })[0].value);
      var paint = { type: 'SOLID', color: { r: col.r, g: col.g, b: col.b }, opacity: col.a };
      try { paint = figma.variables.setBoundVariableForPaint(paint, 'color', varr); } catch (err) { /* без привязки */ }
      ps.paints = [paint];
      res.paintStyles++;
    }
  }
  return res;
}

// ---- main.js ----
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
