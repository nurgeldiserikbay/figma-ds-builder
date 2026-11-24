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

/**
 * Ключ вектора: всё, от чего зависит его SVG (геометрия, заливки, обводки, эффекты, поворот, размер).
 * Одинаковые иконки в копиях компонента и на разных экранах выгружаются из Figma один раз — экспорт SVG
 * самая долгая часть выгрузки. null — ключ не собрать (тогда выгружаем как обычно).
 */
function vectorKey(node) {
  try {
    var t = node.relativeTransform;
    return JSON.stringify([node.type, num(node.width), num(node.height),
      [num(t[0][0]), num(t[0][1]), num(t[1][0]), num(t[1][1])],
      node.fillGeometry, node.strokeGeometry, node.fills, node.strokes, node.strokeWeight, node.strokeAlign,
      node.strokeCap, node.strokeJoin, node.dashPattern, node.effects, node.opacity, node.blendMode]);
  } catch (e) { return null; }
}
var SVG_BATCH = 6; // экспортов SVG одновременно
// кэш SVG на весь сеанс плагина: выгрузка частями не начинает иконки заново
var svgCache = {}, svgCacheSize = 0;

/**
 * Сообщение для окна плагина: шаблон и значения — окно переводит шаблон на язык пользователя.
 * text — то же по-русски (журнал, figma.notify). Значение может быть вложенным сообщением.
 */
function L(tpl, vars) {
  vars = vars || {};
  var text = tpl.replace(/\{(\w+)\}/g, function (m, k) {
    var v = vars[k];
    return v === undefined ? m : v && v.tpl ? v.text : String(v);
  });
  return { tpl: tpl, vars: vars, text: text };
}

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
    if (p.type === 'SOLID') {
      base.color = colorOf(p.color);
      var bound = p.boundVariables && p.boundVariables.color;
      if (bound) base.variable = refName(ctx, 'vars', bound.id);
    }
    else if (p.type.indexOf('GRADIENT') === 0) {
      base.css = gradientCss(p);
      // переменные на точках градиента
      var sv = (p.gradientStops || []).map(function (st) { return st.boundVariables && st.boundVariables.color ? refName(ctx, 'vars', st.boundVariables.color.id) : null; });
      if (sv.some(Boolean)) base.stopVariables = sv;
    }
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
    // обводка внутри занимает место в раскладке: дети сдвинуты на её толщину
    strokesIncluded: !!node.strokesIncludedInLayout,
  };
}

/**
 * Имя переменной или стиля по id. Локальные известны заранее; библиотечные (из подключённой библиотеки)
 * узнаём после обхода фрейма (resolvePending) — пока в дереве стоит метка, её заменит имя.
 */
function refName(ctx, kind, id) {
  if (!id || typeof id !== 'string' || !ctx.names) return undefined;
  var known = ctx.names[kind][id];
  if (known) return known;
  ctx.pending[kind + '|' + id] = true;
  return '\u0000' + kind + '|' + id;
}

/** Дозапрос имён библиотечных переменных и стилей, найденных в дереве. */
async function resolvePending(ctx) {
  var keys = Object.keys(ctx.pending);
  // запросы к Figma независимы — по 40 одновременно (по одному на тысячах копий компонентов это минуты)
  for (var i = 0; i < keys.length; i += 40) {
    await Promise.all(keys.slice(i, i + 40).map(function (key) { return resolveOne(ctx, key); }));
  }
  ctx.pending = {};
  ctx.names.nodes = {};
}

async function resolveOne(ctx, key) {
  var sep = key.indexOf('|'), kind = key.slice(0, sep), id = key.slice(sep + 1);
  if (ctx.names[kind][id] || ctx.names.missing[key]) return;
  try {
    if (kind === 'main') {
      var inst = ctx.names.nodes[id] || await figma.getNodeByIdAsync(id);
      var mc = inst && inst.getMainComponentAsync ? await inst.getMainComponentAsync() : null;
      var owner = mc ? (mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : mc) : null;
      ctx.names.main[id] = owner ? owner.name : ctx.names.mainFallback[id];
      // описание компонента (Description в Figma) — правила, которых не видно на картинке
      var desc = owner && typeof owner.description === 'string' ? owner.description.trim() : '';
      if (desc && !ctx.names.desc[owner.name]) ctx.names.desc[owner.name] = desc;
    } else if (kind === 'vars') {
      var v = await figma.variables.getVariableByIdAsync(id);
      if (v) { ctx.names.vars[id] = v.name; ctx.names.remoteVars[id] = v; }
    } else if (kind === 'modes') {
      var parts = id.split(':'), cid = parts.slice(0, -1).join(':'), mid = parts[parts.length - 1];
      var c = await figma.variables.getVariableCollectionByIdAsync(cid);
      var m = c && c.modes.filter(function (x) { return x.modeId === mid; })[0];
      if (m) ctx.names.modes[id] = c.name + '\u0001' + m.name;
    } else {
      var st = await figma.getStyleByIdAsync(id);
      if (st) { ctx.names[kind][id] = st.name; ctx.names.remoteStyles[id] = st; }
    }
  } catch (e) { /* нет доступа к библиотеке — останется значение без имени */ }
  if (kind === 'main' && !ctx.names.main[id]) ctx.names.main[id] = ctx.names.mainFallback[id];
  if (!ctx.names[kind][id]) ctx.names.missing[key] = true;
}

/** JSON дерева: метки заменяются именами; не найденные имена убираются (значение остаётся). */
function treeJson(tree, names) {
  return JSON.stringify(tree, function (k, v) {
    if (k === 'modes' && v && typeof v === 'object' && !Array.isArray(v)) {
      // { id коллекции: метка } → { "Коллекция": "Режим" }
      var m = {};
      Object.keys(v).forEach(function (cid) {
        var t = v[cid], full = typeof t === 'string' && t.charCodeAt(0) === 0 ? names.modes[t.slice(t.indexOf('|') + 1)] : t;
        if (full) { var parts = full.split('\u0001'); m[parts[0]] = parts[1]; }
      });
      return Object.keys(m).length ? m : undefined;
    }
    if (typeof v !== 'string' || v.charCodeAt(0) !== 0) return v;
    var sep = v.indexOf('|'), kind = v.slice(1, sep), id = v.slice(sep + 1);
    var n = names[kind][id];
    return n === undefined ? undefined : n;
  });
}

/**
 * Переменные, привязанные к свойствам слоя (имена): отступы, расстояния, радиусы, толщина обводки,
 * прозрачность, размеры.
 */
function boundVars(node, ctx) {
  var bv = node.boundVariables;
  if (!bv || !ctx.names) return undefined;
  var nm = function (k) { var a = bv[k]; return a && !Array.isArray(a) ? refName(ctx, 'vars', a.id) || null : null; };
  var out = {}, any = false;
  var put = function (key, val) { if (val) { out[key] = val; any = true; } };
  put('gap', nm('itemSpacing'));
  put('counterGap', nm('counterAxisSpacing'));
  var pad = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(nm);
  if (pad.some(Boolean)) put('padding', pad);
  var rad = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map(nm);
  if (rad.some(Boolean)) put('radius', rad);
  var sw = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'].map(nm);
  if (!sw.some(Boolean) && nm('strokeWeight')) sw = [nm('strokeWeight'), nm('strokeWeight'), nm('strokeWeight'), nm('strokeWeight')];
  if (sw.some(Boolean)) put('strokeWeight', sw);
  put('opacity', nm('opacity'));
  put('width', nm('width'));
  put('height', nm('height'));
  return any ? out : undefined;
}

/** Явно выбранные режимы переменных на слое: { "Color": "Dark" }. */
function explicitModes(node, ctx) {
  var em;
  try { em = node.explicitVariableModes; } catch (e) { return undefined; }
  if (!em || !ctx.names) return undefined;
  var out = {}, any = false;
  Object.keys(em).forEach(function (cid) { out[cid] = refName(ctx, 'modes', cid + ':' + em[cid]); any = true; });
  return any ? out : undefined;
}

/** Имена локальных переменных и стилей по id — чтобы в дереве были ссылки на дизайн-систему, а не только значения. */
async function designNames() {
  var names = { vars: {}, text: {}, effect: {}, paint: {}, modes: {}, main: {}, mainFallback: {}, remoteVars: {}, remoteStyles: {}, missing: {}, desc: {}, nodes: {} };
  try { (await figma.variables.getLocalVariablesAsync()).forEach(function (v) { names.vars[v.id] = v.name; }); } catch (e) { /* нет доступа — без имён */ }
  try {
    (await figma.variables.getLocalVariableCollectionsAsync()).forEach(function (c) {
      c.modes.forEach(function (m) { names.modes[c.id + ':' + m.modeId] = c.name + '\u0001' + m.name; });
    });
  } catch (e) { /* без режимов */ }
  try { (await figma.getLocalTextStylesAsync()).forEach(function (st) { names.text[st.id] = st.name; }); } catch (e) { /* без стилей */ }
  try { (await figma.getLocalEffectStylesAsync()).forEach(function (st) { names.effect[st.id] = st.name; }); } catch (e) { /* без стилей */ }
  try { (await figma.getLocalPaintStylesAsync()).forEach(function (st) { names.paint[st.id] = st.name; }); } catch (e) { /* без стилей */ }
  return names;
}

/** Переменные на тексте: кегль, интерлиньяж, межбуквенный, шрифт, насыщенность. */
function segVars(s, ctx) {
  var bv = s.boundVariables;
  if (!bv) return undefined;
  var out = {}, any = false;
  ['fontSize', 'lineHeight', 'letterSpacing', 'fontFamily', 'fontWeight', 'fontStyle'].forEach(function (k) {
    var a = bv[k];
    if (a && !Array.isArray(a) && a.id) { out[k] = refName(ctx, 'vars', a.id); any = true; }
  });
  return any ? out : undefined;
}

function textData(node, ctx) {
  var fields = ['fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fills', 'textDecoration', 'textCase', 'textStyleId', 'fillStyleId', 'boundVariables', 'hyperlink'];
  var segs;
  // старые версии Figma знают не все поля: пробуем без ссылок, затем без стилей
  try { segs = node.getStyledTextSegments(fields); } catch (e) {
    try { segs = node.getStyledTextSegments(fields.slice(0, 11)); } catch (e2) { segs = node.getStyledTextSegments(fields.slice(0, 9)); }
  }
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
        textStyle: refName(ctx, 'text', s.textStyleId),
        fillStyle: refName(ctx, 'paint', s.fillStyleId),
        vars: segVars(s, ctx),
        link: textLink(s.hyperlink),
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

/** Имя свойства компонента без служебного «#id»: «Label#12:0» → «Label». */
function propName(n) { return String(n).replace(/#[^#]*$/, ''); }

/** Свойства копии компонента (кроме вариантов — они в variant): текст, да/нет, замена. */
function instanceProps(node) {
  var cp;
  try { cp = node.componentProperties; } catch (e) { return undefined; }
  if (!cp) return undefined;
  var out = {}, any = false;
  Object.keys(cp).forEach(function (k) {
    var p = cp[k];
    if (!p || p.type === 'VARIANT') return;
    out[propName(k)] = { type: p.type, value: p.type === 'INSTANCE_SWAP' ? undefined : p.value };
    any = true;
  });
  return any ? out : undefined;
}

/** Аннотации Dev Mode: текст (label) и отмеченные свойства. */
function annotationsOf(node) {
  var list;
  try { list = node.annotations; } catch (e) { return undefined; }
  if (!list || !list.length) return undefined;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i] || {};
    var text = String(a.label || a.labelMarkdown || '').trim();
    var props = (a.properties || []).map(function (p) { return p && p.type; }).filter(Boolean);
    if (text || props.length) out.push(props.length ? { text: text, properties: props } : { text: text });
  }
  return out.length ? out : undefined;
}

/** Ссылка в тексте (Link в Figma): адрес или слой, к которому ведёт. */
function textLink(h) {
  if (!h || isMixed(h) || !h.value) return undefined;
  return h.type === 'URL' ? { type: 'url', url: h.value } : { type: 'node', id: h.value };
}

/**
 * Переход из прототипа по нажатию: адрес (Open link), другой фрейм (Navigate to), прокрутка к слою (Scroll to),
 * всплывающее окно (Open overlay), назад и закрыть окно. Наведение и смена варианта (Change to) — не ссылки.
 */
function protoLink(node) {
  var list;
  try { list = node.reactions; } catch (e) { return undefined; }
  if (!list || !list.length) return undefined;
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var t = r.trigger && r.trigger.type;
    if (t !== 'ON_CLICK' && t !== 'ON_PRESS') continue;
    var acts = r.actions || (r.action ? [r.action] : []);
    for (var j = 0; j < acts.length; j++) {
      var a = acts[j];
      if (!a) continue;
      if (a.type === 'URL' && a.url) return { type: 'url', url: a.url, newTab: a.openInNewTab !== false };
      if (a.type === 'NODE' && a.destinationId) {
        if (a.navigation === 'NAVIGATE') return { type: 'frame', id: a.destinationId };
        if (a.navigation === 'SCROLL_TO') return { type: 'scroll', id: a.destinationId };
        if (a.navigation === 'OVERLAY') return { type: 'overlay', id: a.destinationId };
      }
      if (a.type === 'BACK') return { type: 'back' };
      if (a.type === 'CLOSE') return { type: 'close' };
    }
  }
  return undefined;
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
  // слой связан со свойством компонента Figma: текст (characters), показ (visible), замена (mainComponent);
  // у скрытого слоя тоже — по нему программа понимает, что слой убран свойством «показать/скрыть»
  var refs;
  try { refs = node.componentPropertyReferences; } catch (e) { refs = null; }
  if (refs) {
    var pr = {};
    Object.keys(refs).forEach(function (k) { if (refs[k]) pr[k] = propName(refs[k]); });
    if (Object.keys(pr).length) o.propRefs = pr;
  }
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
  var vars = boundVars(node, ctx);
  if (vars) o.vars = vars;
  if ('effectStyleId' in node && typeof node.effectStyleId === 'string') o.effectStyle = refName(ctx, 'effect', node.effectStyleId);
  // цветовые стили (Color styles) на заливке и обводке — для файлов без переменных
  if ('fillStyleId' in node && typeof node.fillStyleId === 'string') o.fillStyle = refName(ctx, 'paint', node.fillStyleId);
  if ('strokeStyleId' in node && typeof node.strokeStyleId === 'string') o.strokeStyle = refName(ctx, 'paint', node.strokeStyleId);
  var modes = explicitModes(node, ctx);
  if (modes) o.modes = modes;
  var link = protoLink(node);
  if (link) o.link = link;

  // аннотации Dev Mode: «поле обязательное», «сортируется по клику» — для ИИ-агента
  var notes = annotationsOf(node);
  if (notes) o.notes = notes;
  var L = autoLayout(node);
  if (L) o.layout = L;
  if ('layoutPositioning' in node) o.layoutPositioning = node.layoutPositioning;
  if ('layoutSizingHorizontal' in node) o.sizing = { h: node.layoutSizingHorizontal, v: node.layoutSizingVertical };
  if ('constraints' in node && node.constraints) o.constraints = { h: node.constraints.horizontal, v: node.constraints.vertical };

  if (node.type === 'INSTANCE') {
    // набор вариантов с ошибкой (красное предупреждение в Figma) — variantProperties бросает исключение
    var variant;
    try { variant = node.variantProperties || undefined; } catch (e) { variant = undefined; }
    // имя главного компонента (набора вариантов), а не слоя: копию могли переименовать («Button Override»)
    ctx.pending['main|' + node.id] = true;
    ctx.names.mainFallback[node.id] = node.name;
    ctx.names.nodes[node.id] = node; // для поиска главного компонента без getNodeByIdAsync
    o.component = { name: '\u0000main|' + node.id, variant: variant, props: instanceProps(node) };
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

  var names = await designNames();
  // сколько заняли этапы (мс) — в manifest.json: по нему видно, что тормозит на конкретном файле
  var timing = { tree: 0, names: 0, png: 0, svg: 0, svgExported: 0, svgCached: 0, images: 0, slowest: [] };
  for (var i = 0; i < frames.length; i++) {
    if (shouldStop()) return { stopped: true, files: [], warnings: warnings };
    var f = frames[i];
    progress(L('Фрейм {i} из {n}: {name}', { i: i + 1, n: frames.length, name: f.name }), i);
    var t = f.absoluteTransform;
    var ctx = { images: images, vectors: [], instances: [], count: 0, fonts: fonts, errors: [], names: names, pending: {} };
    var tree;
    var t0 = Date.now();
    try { tree = serialize(f, t[0][2], t[1][2], ctx); } catch (e) {
      warnings.push(L('Фрейм «{name}» пропущен: {err}', { name: f.name, err: e && e.message ? e.message : String(e) }));
      continue;
    }
    if (ctx.errors.length) warnings.push(L('Фрейм «{name}»: не прочитаны слои ({n}), остались только их рамки: {list}', { name: f.name, n: ctx.errors.length, list: ctx.errors.slice(0, 3).join('; ') + (ctx.errors.length > 3 ? '; …' : '') }));
    timing.tree += Date.now() - t0;
    var tn = Date.now();
    await resolvePending(ctx);
    timing.names += Date.now() - tn;
    var fid = fileId(f.id);
    files.push({ path: 'frames/' + fid + '.json', data: treeJson(tree, names) });

    // эталон: рендер Figma
    // ровно в границах фрейма, даже если содержимое выступает за них.
    // Очень большие фреймы Figma может не отрендерить — тогда фрейм идёт без эталона (только проверка геометрии).
    // картинка экрана и векторы — одновременно: Figma готовит PNG, пока выгружаются SVG
    var t1 = Date.now();
    var pngJob = f.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale }, useAbsoluteBounds: true })
      .then(function (data) { timing.png += Date.now() - t1; return { data: data }; }, function (e) { timing.png += Date.now() - t1; return { err: e }; });
    var t2 = Date.now();
    // векторы: одинаковые — один экспорт (кэш на всю выгрузку), остальные — несколько одновременно
    for (var v = 0; v < ctx.vectors.length; v += SVG_BATCH) {
      var batch = ctx.vectors.slice(v, v + SVG_BATCH);
      var got = await Promise.all(batch.map(function (node) {
        var key = vectorKey(node);
        if (key !== null && svgCache[key]) { timing.svgCached++; return svgCache[key]; }
        timing.svgExported++;
        var job = node.exportAsync({ format: 'SVG' }).catch(function () { return null; }); // пустой вектор — пропускаем
        if (key !== null && svgCacheSize < 20000) { svgCache[key] = job; svgCacheSize++; }
        return job;
      }));
      for (var b = 0; b < batch.length; b++) if (got[b]) files.push({ path: 'vectors/' + fileId(batch[b].id) + '.svg', data: got[b] });
    }
    timing.svg += Date.now() - t2;
    var pngRes = await pngJob;
    var pngOk = !!pngRes.data;
    if (pngOk) files.push({ path: 'frames/' + fid + '.png', data: pngRes.data });
    else {
      var e = pngRes.err;
      warnings.push(L('Нет PNG для «{name}» ({w}×{h}): {err}', { name: f.name, w: Math.round(f.width), h: Math.round(f.height), err: e && e.message ? e.message : String(e) }));
    }
    var took = Date.now() - t0;
    timing.slowest.push({ name: f.name, ms: took, layers: ctx.count, vectors: ctx.vectors.length });
    timing.slowest.sort(function (x, y) { return y.ms - x.ms; });
    timing.slowest.length = Math.min(timing.slowest.length, 5);
    manifestFrames.push({
      id: f.id, name: f.name, page: f.parent && f.parent.type === 'PAGE' ? f.parent.name : (figma.currentPage.name),
      width: num(f.width), height: num(f.height),
      tree: 'frames/' + fid + '.json', png: pngOk ? 'frames/' + fid + '.png' : undefined, layers: ctx.count,
    });
  }

  var ti = Date.now();
  var hashes = Object.keys(images);
  for (var h = 0; h < hashes.length; h++) {
    progress(L('Картинки: {i} из {n}', { i: h + 1, n: hashes.length }), frames.length);
    var img = figma.getImageByHash(hashes[h]);
    if (!img) continue;
    try {
      files.push({ path: 'images/' + hashes[h] + '.png', data: await img.getBytesAsync() });
    } catch (e) { /* недоступная картинка */ }
  }

  timing.images = Date.now() - ti;

  // шрифты, которые реально используются в выгруженных макетах
  var fontList = Object.keys(fonts).map(function (k) {
    var f = fonts[k];
    return { family: f.family, style: f.style, weight: f.weight, uses: f.uses, sizes: Object.keys(f.sizes).map(Number).sort(function (a, b) { return a - b; }) };
  }).sort(function (a, b) { return b.uses - a.uses; });
  files.push({ path: 'fonts.json', data: JSON.stringify(fontList, null, 2) });
  try {
    files.push({ path: 'variables.json', data: JSON.stringify(await exportVariables(names), null, 2) });
    files.push({ path: 'styles.json', data: JSON.stringify(await exportStyles(names), null, 2) });
  } catch (e) { progress(L('Переменные/стили не выгружены: {err}', { err: e.message })); }
  var compNames = Object.keys(names.desc);
  if (compNames.length) files.push({ path: 'components.json', data: JSON.stringify(compNames.sort().map(function (n) { return { name: n, description: names.desc[n] }; }), null, 2) });
  if (opts.tokens) files.push({ path: 'tokens.json', data: JSON.stringify(opts.tokens, null, 2) });
  if (opts.analysis) files.push({ path: 'analysis.json', data: JSON.stringify(opts.analysis) });

  var manifest = {
    format: 'ds-package', version: 1,
    file: opts.fileName || figma.root.name,
    createdAt: new Date().toISOString(),
    scale: scale,
    tokens: opts.tokens ? 'tokens.json' : undefined,
    fonts: 'fonts.json', variables: 'variables.json', styles: 'styles.json',
    components: compNames.length ? 'components.json' : undefined,
    frames: manifestFrames,
    part: opts.part, // { id, index, total } — выгрузка частями: программа собирает части в один пакет
    timing: timing,
    warnings: warnings.length ? warnings.map(function (w) { return w.text; }) : undefined,
  };
  files.unshift({ path: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  return { manifest: manifest, files: files, warnings: warnings };
}

/**
 * Переменные: локальные коллекции файла и библиотечные переменные, которые встретились в макетах
 * (с цепочкой алиасов). Значения по режимам, алиасы — ссылкой на имя.
 */
async function exportVariables(names) {
  names = names || { remoteVars: {} };
  var cols = await figma.variables.getLocalVariableCollectionsAsync();
  var vars = await figma.variables.getLocalVariablesAsync();
  var byId = {};
  vars.forEach(function (v) { byId[v.id] = v; });
  // библиотечные: те, что привязаны к слоям, и всё, на что они ссылаются
  var queue = Object.keys(names.remoteVars).map(function (id) { return names.remoteVars[id]; });
  var remote = {};
  while (queue.length) {
    var rv = queue.shift();
    if (!rv || byId[rv.id] || remote[rv.id]) continue;
    remote[rv.id] = rv;
    var vals = rv.valuesByMode || {};
    for (var mk in vals) {
      var val = vals[mk];
      if (val && val.type === 'VARIABLE_ALIAS' && !byId[val.id] && !remote[val.id]) {
        try { queue.push(await figma.variables.getVariableByIdAsync(val.id)); } catch (e) { /* нет доступа */ }
      }
    }
  }
  var nameOf = function (id) { var v = byId[id] || remote[id]; return v ? v.name : id; };
  var describe = function (v, modes) {
    var values = {};
    modes.forEach(function (m) {
      var val = v.valuesByMode[m.modeId];
      if (val && val.type === 'VARIABLE_ALIAS') val = { alias: nameOf(val.id) };
      values[m.name] = val;
    });
    return { name: v.name, type: v.resolvedType, values: values, scopes: v.scopes, codeSyntax: v.codeSyntax || undefined };
  };
  var out = cols.map(function (c) {
    return {
      name: c.name,
      modes: c.modes.map(function (m) { return m.name; }),
      variables: c.variableIds.map(function (id) { return byId[id]; }).filter(Boolean).map(function (v) { return describe(v, c.modes); }),
    };
  });
  // библиотечные — по своим коллекциям (если библиотека их не отдаёт — одна коллекция «Library»)
  var groups = {};
  var ids = Object.keys(remote);
  for (var i = 0; i < ids.length; i++) {
    var v = remote[ids[i]], col = null;
    try { col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId); } catch (e) { col = null; }
    var key = col ? col.id : 'library';
    if (!groups[key]) {
      var modes = col ? col.modes : Object.keys(v.valuesByMode || {}).map(function (mid, j) { return { modeId: mid, name: j ? 'Mode ' + (j + 1) : 'Value' }; });
      groups[key] = { name: col ? col.name : 'Library', remote: true, modesRaw: modes, variables: [] };
    }
    groups[key].variables.push(describe(v, groups[key].modesRaw));
  }
  Object.keys(groups).forEach(function (k) {
    var g = groups[k];
    out.push({ name: g.name, remote: true, modes: g.modesRaw.map(function (m) { return m.name; }), variables: g.variables });
  });
  return out;
}

/** Стили: локальные и библиотечные, встретившиеся в макетах (remote: true). */
async function exportStyles(names) {
  var paint = await figma.getLocalPaintStylesAsync();
  var text = await figma.getLocalTextStylesAsync();
  var effect = await figma.getLocalEffectStylesAsync();
  var rs = names ? names.remoteStyles : {};
  Object.keys(rs).forEach(function (id) {
    var st = rs[id];
    var list = st.type === 'PAINT' ? paint : st.type === 'TEXT' ? text : st.type === 'EFFECT' ? effect : null;
    if (list && !list.some(function (x) { return x.id === st.id; })) { st.__remote = true; list.push(st); }
  });
  var ctx = { images: {}, names: names, pending: {} };
  return {
    paint: paint.map(function (s) { return { name: s.name, paints: paints(s.paints, ctx).map(function (p) { if (typeof p.variable === 'string' && p.variable.charCodeAt(0) === 0) delete p.variable; return p; }), remote: s.__remote || undefined }; }),
    text: text.map(function (s) {
      return { name: s.name, remote: s.__remote || undefined, fontFamily: s.fontName.family, fontStyle: s.fontName.style, fontSize: s.fontSize,
        lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration };
    }),
    effect: effect.map(function (s) { return { name: s.name, remote: s.__remote || undefined, effects: s.effects.map(function (e) {
      return e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'
        ? { type: e.type, x: e.offset.x, y: e.offset.y, blur: e.radius, spread: e.spread || 0, color: colorOf(e.color) }
        : { type: e.type, radius: e.radius };
    }) }; }),
  };
}
