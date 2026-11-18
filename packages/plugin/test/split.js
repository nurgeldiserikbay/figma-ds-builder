// Деление большого файла на части: ≤25 фреймов, страница не разрывается, если сама не больше части.
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
    currentPage: { selection: [], name: 'P' }, root: { name: 'F', children: [] },
  },
  __html__: '', console, setTimeout,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// 30 страниц по 1..17 макетов: как большой файл пользователя
const frames = [];
const sizes = [];
for (let p = 0; p < 30; p++) {
  const page = { type: 'PAGE', name: `Страница ${p + 1}` };
  const n = [10, 3, 17, 8, 1, 12][p % 6];
  sizes.push(n);
  for (let i = 0; i < n; i++) frames.push({ id: `${p}:${i}`, parent: page });
}
// одна огромная страница
const big = { type: 'PAGE', name: 'Огромная' };
for (let i = 0; i < 60; i++) frames.push({ id: `big:${i}`, parent: big });

const parts = ctx.splitParts(frames);
assert.equal(parts.flat().length, frames.length, 'все фреймы попали в части');
assert.ok(parts.every((p) => p.length <= 25), 'не больше 25 в части');
// страница меньше части не разорвана
const pagesSplit = new Set();
const seen = new Map();
parts.forEach((p, i) => p.forEach((f) => { const k = f.parent.name; if (seen.has(k) && seen.get(k) !== i) pagesSplit.add(k); seen.set(k, i); }));
assert.deepEqual([...pagesSplit], ['Огромная'], 'разорвана только страница больше части');
console.log(`части: ${frames.length} фреймов → ${parts.length} частей (${parts.map((p) => p.length).join(', ')}) — OK`);
