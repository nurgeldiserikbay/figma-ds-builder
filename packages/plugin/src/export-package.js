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
  var progress = opts.onProgress || function () {};

  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    progress('Фрейм ' + (i + 1) + ' из ' + frames.length + ': ' + f.name);
    var t = f.absoluteTransform;
    var ctx = { images: images, vectors: [], instances: [], count: 0 };
    var tree = serialize(f, t[0][2], t[1][2], ctx);
    var fid = fileId(f.id);
    files.push({ path: 'frames/' + fid + '.json', data: JSON.stringify(tree) });

    // эталон: рендер Figma
    var png = await f.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
    files.push({ path: 'frames/' + fid + '.png', data: png });

    for (var v = 0; v < ctx.vectors.length; v++) {
      try {
        var svg = await ctx.vectors[v].exportAsync({ format: 'SVG' });
        files.push({ path: 'vectors/' + fileId(ctx.vectors[v].id) + '.svg', data: svg });
      } catch (e) { /* пустой вектор — пропускаем */ }
    }
    manifestFrames.push({
      id: f.id, name: f.name, page: f.parent && f.parent.type === 'PAGE' ? f.parent.name : (figma.currentPage.name),
      width: num(f.width), height: num(f.height),
      tree: 'frames/' + fid + '.json', png: 'frames/' + fid + '.png', layers: ctx.count,
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

  if (opts.tokens) files.push({ path: 'tokens.json', data: JSON.stringify(opts.tokens, null, 2) });
  if (opts.analysis) files.push({ path: 'analysis.json', data: JSON.stringify(opts.analysis) });

  var manifest = {
    format: 'ds-package', version: 1,
    file: opts.fileName || figma.root.name,
    createdAt: new Date().toISOString(),
    scale: scale,
    tokens: opts.tokens ? 'tokens.json' : undefined,
    frames: manifestFrames,
  };
  files.unshift({ path: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  return { manifest: manifest, files: files };
}
