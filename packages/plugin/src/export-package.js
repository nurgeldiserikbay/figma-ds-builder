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
  // пустой текст: сегментов нет — шрифт слоя целиком (для пустой строки нужна её высота)
  var style = null;
  if (!segs.length && !isMixed(node.fontName) && !isMixed(node.fontSize)) {
    var lh = isMixed(node.lineHeight) ? { unit: 'AUTO' } : node.lineHeight;
    style = {
      fontFamily: node.fontName.family, fontStyle: node.fontName.style, fontSize: node.fontSize,
      lineHeight: lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lh.unit, value: lh.value },
    };
  }
  return {
    characters: node.characters,
    style: style,
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

function isIdentityTransform(t) {
  return Math.abs(t[0][0] - 1) < 1e-4 && Math.abs(t[1][0]) < 1e-4 && Math.abs(t[0][1]) < 1e-4 && Math.abs(t[1][1] - 1) < 1e-4;
}

/**
 * Геометрия относительно корневого фрейма.
 * Повёрнутый или отражённый слой: x,y,w,h — видимая рамка, size — исходный размер, transform — матрица от фрейма.
 */
function geometry(node, ox, oy) {
  var t = node.absoluteTransform;
  if (isIdentityTransform(t)) {
    return { x: num(t[0][2] - ox), y: num(t[1][2] - oy), w: num(node.width), h: num(node.height), rotation: 0 };
  }
  var bb = node.absoluteBoundingBox || { x: t[0][2], y: t[1][2], width: node.width, height: node.height };
  return {
    x: num(bb.x - ox), y: num(bb.y - oy), w: num(bb.width), h: num(bb.height),
    rotation: num('rotation' in node ? node.rotation || 0 : 0),
    size: { w: num(node.width), h: num(node.height) },
    transform: [[t[0][0], t[0][1], num(t[0][2] - ox)], [t[1][0], t[1][1], num(t[1][2] - oy)]],
  };
}

/** Один сломанный слой не останавливает выгрузку: остаётся его рамка, причина — в предупреждениях. */
function serializeSafe(node, ox, oy, ctx) {
  try { return serialize(node, ox, oy, ctx); } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (ctx.errors) ctx.errors.push('«' + node.name + '»: ' + msg);
    var o = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false, error: msg };
    try { var g = geometry(node, ox, oy); o.x = g.x; o.y = g.y; o.w = g.w; o.h = g.h; o.rotation = g.rotation; } catch (e2) { o.x = o.y = o.w = o.h = 0; }
    return o;
  }
}

function serialize(node, ox, oy, ctx) {
  ctx.count++;
  var g = geometry(node, ox, oy);
  var transformed = !!g.transform;
  var o = {
    id: node.id, name: node.name, type: node.type,
    x: g.x, y: g.y, w: g.w, h: g.h, rotation: g.rotation,
    size: g.size, transform: g.transform,
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
    if (node.dashPattern && node.dashPattern.length) o.dashPattern = node.dashPattern.slice();
  }
  o.radius = radius(node);
  o.effects = effects(node);
  var L = autoLayout(node);
  if (L) o.layout = L;
  if ('layoutPositioning' in node) o.layoutPositioning = node.layoutPositioning;
  if ('layoutSizingHorizontal' in node) o.sizing = { h: node.layoutSizingHorizontal, v: node.layoutSizingVertical };
  if ('constraints' in node && node.constraints) o.constraints = { h: node.constraints.horizontal, v: node.constraints.vertical };

  if (node.type === 'INSTANCE') {
    // набор вариантов с ошибкой (красное предупреждение в Figma) — variantProperties бросает исключение
    var variant;
    try { variant = node.variantProperties || undefined; } catch (e) { variant = undefined; }
    o.component = { name: node.name, variant: variant };
    ctx.instances.push(node);
  }

  if (node.type === 'TEXT') {
    o.text = textData(node, ctx);
    return o;
  }
  if (EXPORT_VECTOR_TYPES[node.type]) {
    o.svg = 'vectors/' + fileId(node.id) + '.svg';
    ctx.vectors.push(node);
    // SVG рисуется по границам рендера (обводки снаружи, тени) и уже с поворотом: рамка относительно видимой рамки слоя
    var rb = node.absoluteRenderBounds;
    if (transformed) o.svgSpace = 'box';
    if (rb) {
      var bx = rb.x - (g.x + ox), by = rb.y - (g.y + oy);
      if (Math.abs(bx) > 0.5 || Math.abs(by) > 0.5 || Math.abs(rb.width - g.w) > 0.5 || Math.abs(rb.height - g.h) > 0.5) {
        o.svgBox = { x: num(bx), y: num(by), w: num(rb.width), h: num(rb.height) };
      }
    }
    return o;
  }
  if ('children' in node) {
    o.children = node.children.map(function (c) { return serializeSafe(c, ox, oy, ctx); });
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
  var shouldStop = opts.shouldStop || function () { return false; };

  for (var i = 0; i < frames.length; i++) {
    if (shouldStop()) return { stopped: true, files: [], warnings: warnings };
    var f = frames[i];
    progress('Фрейм ' + (i + 1) + ' из ' + frames.length + ': ' + f.name, i);
    var t = f.absoluteTransform;
    var ctx = { images: images, vectors: [], instances: [], count: 0, fonts: fonts, errors: [] };
    var tree;
    try { tree = serialize(f, t[0][2], t[1][2], ctx); } catch (e) {
      warnings.push('Фрейм «' + f.name + '» пропущен: ' + (e && e.message ? e.message : e));
      continue;
    }
    if (ctx.errors.length) warnings.push('Фрейм «' + f.name + '»: не прочитаны слои (' + ctx.errors.length + '), остались только их рамки: ' + ctx.errors.slice(0, 3).join('; ') + (ctx.errors.length > 3 ? '; …' : ''));
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
    progress('Картинки: ' + (h + 1) + ' из ' + hashes.length, frames.length);
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
    part: opts.part, // { id, index, total } — выгрузка частями: программа собирает части в один пакет
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
