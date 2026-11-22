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

  progress(L('Переменные: примитивы…'));
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

  progress(L('Переменные: семантика…'));
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

  progress(L('Текстовые стили…'));
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

  progress(L('Стили теней…'));
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
    progress(L('Цветовые стили…'));
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
