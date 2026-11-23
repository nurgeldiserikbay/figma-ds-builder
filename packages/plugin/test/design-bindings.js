// Привязки к дизайн-системе в выгрузке: локальные и библиотечные переменные, цветовые/текстовые/теневые стили,
// переменные на тексте и градиенте, режимы на фрейме. Имитация Plugin API — как в broken-nodes.js.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '../dist/code.js'), 'utf8');
const alias = (id) => ({ type: 'VARIABLE_ALIAS', id });
const col = (r, g, b) => ({ r, g, b, a: 1 });
// локальные
const localColl = { id: 'VC:1', name: 'Color', modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }], variableIds: ['V:1', 'V:2'] };
const localVars = [
  { id: 'V:1', name: 'ink/900', resolvedType: 'COLOR', variableCollectionId: 'VC:1', valuesByMode: { m1: col(0.1, 0.1, 0.1), m2: col(1, 1, 1) }, scopes: [] },
  { id: 'V:2', name: 'color/text/primary', resolvedType: 'COLOR', variableCollectionId: 'VC:1', valuesByMode: { m1: alias('V:1'), m2: alias('V:1') }, scopes: ['TEXT_FILL'], codeSyntax: { WEB: 'var(--text-primary)' } },
];
// библиотечные: не в getLocal*, доступны только по id
const libColl = { id: 'VC:lib', name: 'Brand', modes: [{ modeId: 'L1', name: 'Default' }] };
const libVars = {
  'V:lib1': { id: 'V:lib1', name: 'brand/blue', resolvedType: 'COLOR', variableCollectionId: 'VC:lib', valuesByMode: { L1: col(0, 0.4, 1) }, scopes: [], codeSyntax: { WEB: 'var(--brand-blue)' } },
  'V:lib2': { id: 'V:lib2', name: 'bg/brand', resolvedType: 'COLOR', variableCollectionId: 'VC:lib', valuesByMode: { L1: alias('V:lib1') }, scopes: ['FRAME_FILL'] },
  'V:lib3': { id: 'V:lib3', name: 'size/body', resolvedType: 'FLOAT', variableCollectionId: 'VC:lib', valuesByMode: { L1: 16 }, scopes: ['FONT_SIZE'] },
  'V:lib4': { id: 'V:lib4', name: 'stroke/thin', resolvedType: 'FLOAT', variableCollectionId: 'VC:lib', valuesByMode: { L1: 1 }, scopes: ['STROKE_FLOAT'] },
};
const textStyle = { id: 'S:t1', type: 'TEXT', name: 'Body/M', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16, lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PERCENT', value: 0 }, textCase: 'ORIGINAL', textDecoration: 'NONE' };
const libTextStyle = { id: 'S:lt', type: 'TEXT', name: 'Brand/Caption', fontName: { family: 'Inter', style: 'Medium' }, fontSize: 12, lineHeight: { unit: 'PIXELS', value: 16 }, letterSpacing: { unit: 'PIXELS', value: 0 }, textCase: 'ORIGINAL', textDecoration: 'NONE' };
const paintStyle = { id: 'S:p1', type: 'PAINT', name: 'Old/Accent', paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0.3, b: 0 } }] };
const libPaintStyle = { id: 'S:lp', type: 'PAINT', name: 'Brand/Line', paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0.8, g: 0.8, b: 0.8 } }] };
const effectStyle = { id: 'S:e1', type: 'EFFECT', name: 'Shadow/Card', effects: [{ type: 'DROP_SHADOW', visible: true, offset: { x: 0, y: 2 }, radius: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.2 } }] };
const remoteStyles = { 'S:lt': libTextStyle, 'S:lp': libPaintStyle };

const ctx = {
  figma: {
    showUI() {}, ui: { postMessage() {}, onmessage: null }, notify() {},
    clientStorage: { getAsync: async () => null, setAsync: async () => {} },
    currentPage: { selection: [], name: 'P' }, root: { name: 'F', children: [] }, mixed: Symbol('mixed'),
    getImageByHash: () => null,
    getLocalPaintStylesAsync: async () => [paintStyle], getLocalTextStylesAsync: async () => [textStyle], getLocalEffectStylesAsync: async () => [effectStyle],
    getNodeByIdAsync: async (id) => (id === 'Button Override' ? renamed : null),
    getStyleByIdAsync: async (id) => remoteStyles[id] || [paintStyle, textStyle, effectStyle].find((s) => s.id === id) || null,
    variables: {
      getLocalVariableCollectionsAsync: async () => [localColl], getLocalVariablesAsync: async () => localVars,
      getVariableByIdAsync: async (id) => libVars[id] || localVars.find((v) => v.id === id) || null,
      getVariableCollectionByIdAsync: async (id) => (id === 'VC:lib' ? libColl : id === 'VC:1' ? localColl : null),
    },
  },
  __html__: '', console, setTimeout, Map, JSON, Date, Math,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const base = (id, type, x, extra = {}) => ({
  id, name: id, type, visible: true, opacity: 1, blendMode: 'PASS_THROUGH',
  absoluteTransform: [[1, 0, x], [0, 1, 0]], width: 100, height: 40, fills: [], strokes: [], effects: [], cornerRadius: 0, ...extra,
});
const solid = (c, varId) => ({ type: 'SOLID', visible: true, opacity: 1, color: c, boundVariables: varId ? { color: alias(varId) } : undefined });
const card = base('Card', 'FRAME', 0, {
  fills: [solid({ r: 0, g: 0.4, b: 1 }, 'V:lib2')], fillStyleId: '',
  strokes: [solid({ r: 0.8, g: 0.8, b: 0.8 })], strokeStyleId: 'S:lp', strokeWeight: 1, strokeAlign: 'INSIDE',
  effectStyleId: 'S:e1', effects: effectStyle.effects,
  boundVariables: { strokeWeight: alias('V:lib4') },
  children: [],
});
const oldStyle = base('Old', 'RECTANGLE', 120, { fills: paintStyle.paints, fillStyleId: 'S:p1' });
const grad = base('Grad', 'RECTANGLE', 240, { fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, gradientTransform: [[1, 0, 0], [0, 1, 0]],
  gradientStops: [{ position: 0, color: { r: 0, g: 0.4, b: 1, a: 1 }, boundVariables: { color: alias('V:lib1') } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] }] });
const seg = (start, end, styleId, extra = {}) => ({ start, end, fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16, fontWeight: 400,
  lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PERCENT', value: 0 }, fills: [solid({ r: 0.1, g: 0.1, b: 0.1 }, 'V:2')],
  textDecoration: 'NONE', textCase: 'ORIGINAL', textStyleId: styleId, fillStyleId: '', ...extra });
const text = base('Text', 'TEXT', 360, {
  characters: 'Hello world', textAlignHorizontal: 'LEFT', textAlignVertical: 'TOP', textAutoResize: 'WIDTH_AND_HEIGHT',
  getStyledTextSegments: (fields) => {
    if (fields.includes('boundVariables')) return [seg(0, 5, 'S:t1', { boundVariables: { fontSize: alias('V:lib3') } }), seg(6, 11, 'S:lt')];
    throw new Error('ждали поля boundVariables');
  },
});
const btnSet = { type: 'COMPONENT_SET', name: 'Button' };
const btnMain = { type: 'COMPONENT', name: 'Variant=Primary', parent: btnSet };
const renamed = base('Button Override', 'INSTANCE', 400, { variantProperties: { Variant: 'Primary' }, children: [], getMainComponentAsync: async () => btnMain });
const frame = base('Screen', 'FRAME', 0, { width: 500, height: 100, children: [card, oldStyle, grad, text, renamed], explicitVariableModes: { 'VC:1': 'm2' }, async exportAsync() { return new Uint8Array([1]); } });
frame.parent = { type: 'PAGE', name: 'Стр' };

const pkg = await ctx.buildLayoutPackage([frame], {});
const file = (p) => JSON.parse(pkg.files.find((f) => f.path === p || (p === 'tree' && /^frames\/.*\.json$/.test(f.path))).data);
const tree = file('tree');
const [c, o, g, t, r] = tree.children;
assert.deepEqual(r.component, { name: 'Button', variant: { Variant: 'Primary' } }, 'переименованная копия — имя набора компонента');
assert.deepEqual(tree.modes, { Color: 'Dark' }, 'режим на фрейме');
assert.equal(c.fills[0].variable, 'bg/brand', 'библиотечная переменная на заливке — по имени');
assert.equal(c.strokeStyle, 'Brand/Line', 'библиотечный цветовой стиль на обводке');
assert.equal(c.effectStyle, 'Shadow/Card');
assert.deepEqual(c.vars.strokeWeight, ['stroke/thin', 'stroke/thin', 'stroke/thin', 'stroke/thin'], 'толщина обводки на переменной');
assert.equal(o.fillStyle, 'Old/Accent', 'локальный цветовой стиль');
assert.deepEqual(g.fills[0].stopVariables, ['brand/blue', null], 'переменная на точке градиента');
assert.equal(t.text.segments[0].textStyle, 'Body/M');
assert.equal(t.text.segments[1].textStyle, 'Brand/Caption', 'библиотечный текстовый стиль');
assert.deepEqual(t.text.segments[0].vars, { fontSize: 'size/body' }, 'кегль на переменной');
assert.equal(t.text.segments[0].fills[0].variable, 'color/text/primary');
assert.ok(!JSON.stringify(tree).includes('\\u0000'), 'в дереве не осталось меток');

const vars = file('variables.json');
const lib = vars.find((x) => x.remote);
assert.ok(lib && lib.name === 'Brand', 'библиотечная коллекция выгружена');
assert.deepEqual(lib.variables.map((v) => v.name).sort(), ['bg/brand', 'brand/blue', 'size/body', 'stroke/thin'], 'с цепочкой алиасов');
assert.deepEqual(lib.variables.find((v) => v.name === 'bg/brand').values, { Default: { alias: 'brand/blue' } });
assert.deepEqual(vars[0].modes, ['Light', 'Dark']);
const styles = file('styles.json');
assert.ok(styles.text.some((s) => s.name === 'Brand/Caption' && s.remote), 'библиотечный текстовый стиль в styles.json');
assert.ok(styles.paint.some((s) => s.name === 'Brand/Line' && s.remote));
assert.ok(styles.paint.some((s) => s.name === 'Old/Accent' && !s.remote));
console.log('привязки к дизайн-системе: локальные и библиотечные переменные, стили, текст, градиент, режимы — OK');
