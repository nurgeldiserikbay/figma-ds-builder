// Сломанные места в файле не останавливают выгрузку:
// экземпляр из набора вариантов с ошибкой (variantProperties бросает) и слой, который Figma не даёт прочитать.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '../dist/code.js'), 'utf8');
const ctx = {
  figma: {
    showUI() {}, ui: { postMessage() {}, onmessage: null }, notify() {},
    clientStorage: { getAsync: async () => null, setAsync: async () => {} },
    currentPage: { selection: [], name: 'P' }, root: { name: 'F', children: [] }, mixed: Symbol('mixed'),
    getImageByHash: () => null,
    getLocalPaintStylesAsync: async () => [], getLocalTextStylesAsync: async () => [], getLocalEffectStylesAsync: async () => [],
    variables: { getLocalVariableCollectionsAsync: async () => [], getLocalVariablesAsync: async () => [] },
  },
  __html__: '', console, setTimeout, Map, JSON, Date, Math,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const base = (id, type, x, extra = {}) => ({
  id, name: id, type, visible: true, opacity: 1, blendMode: 'PASS_THROUGH',
  absoluteTransform: [[1, 0, x], [0, 1, 0]], width: 100, height: 40, fills: [], strokes: [], effects: [], cornerRadius: 0, ...extra,
});
const instance = base('Кнопка', 'INSTANCE', 10, { children: [] });
Object.defineProperty(instance, 'variantProperties', { get() { throw new Error('in get_variantProperties: Component set for node has existing errors'); } });
const unreadable = base('Сломанный', 'FRAME', 200, { children: [] });
Object.defineProperty(unreadable, 'fills', { get() { throw new Error('node is broken'); } });
const ok = base('Нормальный', 'RECTANGLE', 300);
const frame = base('Экран', 'FRAME', 0, { width: 400, height: 200, children: [instance, unreadable, ok], async exportAsync() { return new Uint8Array([1]); } });
const page = { type: 'PAGE', name: 'Стр' };
frame.parent = page;

const pkg = await ctx.buildLayoutPackage([frame], {});
const tree = JSON.parse(pkg.files.find((f) => f.path.startsWith('frames/') && f.path.endsWith('.json')).data);
assert.equal(tree.children.length, 3, 'все слои на месте');
assert.equal(tree.children[0].component.variant, undefined, 'экземпляр без свойств вариантов, но выгружен');
assert.equal(tree.children[1].error, 'node is broken', 'нечитаемый слой — рамка и причина');
assert.equal(tree.children[1].x, 200);
assert.equal(tree.children[2].name, 'Нормальный');
assert.ok(pkg.warnings.some((w) => /не прочитаны слои \(1\)/.test(w.text)), 'предупреждение о сломанном слое');
assert.ok(pkg.warnings.every((w) => w.tpl && w.vars), 'предупреждение — шаблон для перевода в окне плагина');
assert.ok(pkg.manifest.warnings.every((w) => typeof w === 'string'), 'в архив — текстом для программы');
console.log('сломанные слои: набор вариантов с ошибкой и нечитаемый слой не останавливают выгрузку — OK');
