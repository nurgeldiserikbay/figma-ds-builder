// Проверка импорта tokens.json в Figma на имитации Plugin API:
// платформа строит дизайн-систему тестового макета → плагин импортирует дважды → без дублей.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const builder = path.join(here, '../../builder');
const outDir = path.join(here, '../../../.bench/plugin-import');
execFileSync('node', [path.join(builder, 'src/cli.js'), 'analyze', path.join(builder, 'fixtures/sample'), '--out', outDir], { stdio: 'ignore' });
const tokensText = fs.readFileSync(path.join(outDir, 'tokens.json'), 'utf8');

let seq = 0;
const state = { collections: [], variables: [], textStyles: [], effectStyles: [], paintStyles: [] };
const variables = {
  async getLocalVariableCollectionsAsync() { return state.collections; },
  async getLocalVariablesAsync() { return state.variables; },
  createVariableCollection(name) {
    const c = { id: `c${++seq}`, name, modes: [{ modeId: `m${seq}`, name: 'Mode 1' }], renameMode(id, n) { this.modes[0].name = n; } };
    state.collections.push(c);
    return c;
  },
  createVariable(name, collection, type) {
    if (typeof collection === 'string') throw new Error('ждём объект коллекции');
    const v = { id: `v${++seq}`, name, resolvedType: type, variableCollectionId: collection.id, valuesByMode: {},
      setValueForMode(m, val) {
        if (type === 'COLOR' && !(val.type === 'VARIABLE_ALIAS' || 'r' in val)) throw new Error('не цвет');
        if (type === 'FLOAT' && typeof val !== 'number') throw new Error('не число: ' + val);
        this.valuesByMode[m] = val;
      } };
    state.variables.push(v);
    return v;
  },
  createVariableAlias(v) { return { type: 'VARIABLE_ALIAS', id: v.id }; },
  setBoundVariableForPaint(p, field, v) { return { ...p, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: v.id } } }; },
};
const loaded = [];
const figma = {
  mixed: Symbol('mixed'), root: { name: 'Mock', children: [] }, currentPage: { children: [], selection: [] },
  showUI() {}, notify() {}, ui: { postMessage: (m) => posted.push(m), onmessage: null },
  variables,
  async listAvailableFontsAsync() {
    return ['Regular', 'Medium', 'Semi Bold', 'Bold'].map((style) => ({ fontName: { family: 'Inter', style } }));
  },
  async loadFontAsync(f) { loaded.push(`${f.family} ${f.style}`); },
  async getLocalTextStylesAsync() { return state.textStyles; },
  async getLocalEffectStylesAsync() { return state.effectStyles; },
  async getLocalPaintStylesAsync() { return state.paintStyles; },
  createTextStyle() { const s = { bound: {}, setBoundVariable(f, v) { this.bound[f] = v.id; } }; state.textStyles.push(s); return s; },
  createEffectStyle() { const s = {}; state.effectStyles.push(s); return s; },
  createPaintStyle() { const s = {}; state.paintStyles.push(s); return s; },
};
const posted = [];
const ctx = vm.createContext({ figma, __html__: '', console, Promise, Date, JSON, Math, Object, Array, String, Number, Symbol, TextEncoder });
vm.runInContext(fs.readFileSync(path.join(here, '../dist/code.js'), 'utf8'), ctx);

async function run() {
  posted.length = 0;
  await figma.ui.onmessage({ type: 'import-tokens', text: tokensText, paintStyles: true });
  const err = posted.find((m) => m.type === 'error');
  if (err) throw new Error(err.text);
  const m = posted.find((x) => x.type === 'imported');
  if (!m || !m.items || !m.items.every((i) => i.tpl && i.text)) throw new Error('импорт: сообщение без шаблона');
  return m.items.map((i) => i.text).join('. ');
}

const first = await run();
const snapshot = JSON.stringify({ c: state.collections.length, v: state.variables.length, t: state.textStyles.length, e: state.effectStyles.length, p: state.paintStyles.length });
const second = await run();
const after = JSON.stringify({ c: state.collections.length, v: state.variables.length, t: state.textStyles.length, e: state.effectStyles.length, p: state.paintStyles.length });

const sem = state.variables.filter((v) => state.collections.find((c) => c.id === v.variableCollectionId).name === 'DS · Semantic');
const aliased = sem.filter((v) => Object.values(v.valuesByMode)[0]?.type === 'VARIABLE_ALIAS').length;
const bound = state.textStyles.filter((s) => s.bound.fontSize).length;

console.log('импорт:', first);
console.log(`коллекции: ${state.collections.map((c) => c.name).join(', ')}`);
console.log(`семантика ссылается на примитивы: ${aliased}/${sem.length}; текстовые стили с привязкой кегля: ${bound}/${state.textStyles.length}`);
console.log(`повторный импорт: ${snapshot === after ? 'без дублей' : `ДУБЛИ ${snapshot} → ${after}`}`);
if (snapshot !== after || aliased !== sem.length || !state.textStyles.length) process.exitCode = 1;
void second;
