// Большая выгрузка: «Остановить» → «Продолжить с части N».
// Сборка пакета подменена: проверяется поток main.js (части, id выгрузки, сохранение места, общий счётчик).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '../dist/code.js'), 'utf8');
const store = {};
const posted = [];
const pages = [];
for (let p = 0; p < 6; p++) {
  const page = { type: 'PAGE', name: `Стр ${p + 1}`, children: [] };
  for (let i = 0; i < 20; i++) page.children.push({ id: `${p}:${i}`, type: 'FRAME', name: `Ф ${i}`, visible: true, parent: page });
  pages.push(page);
}
const ui = { postMessage: (m) => posted.push(m), onmessage: null };
const ctx = {
  figma: {
    showUI() {}, ui, notify() {},
    clientStorage: { getAsync: async (k) => store[k], setAsync: async (k, v) => { store[k] = v; } },
    currentPage: pages[0], root: { name: 'Большой файл', children: pages },
    loadAllPagesAsync: async () => {},
  },
  __html__: '', console, setTimeout, Map, JSON, Date, Math,
};
pages[0].selection = [];
vm.createContext(ctx);
vm.runInContext(code, ctx);

// подмена сборки пакета: фреймы «готовятся» по одному, после 2-й части нажимаем «Остановить»
let built = [];
let stopOnce = true;
ctx.buildLayoutPackage = async (frames, opts) => {
  for (let i = 0; i < frames.length; i++) {
    if (opts.shouldStop()) return { stopped: true, files: [], warnings: [] };
    opts.onProgress('Фрейм ' + (i + 1), i);
    if (stopOnce && built.length === 2 && i === 3) { stopOnce = false; await ui.onmessage({ type: "stop" }); }
    await null;
  }
  built.push(opts.part);
  return { files: [{ path: 'manifest.json', data: JSON.stringify({ part: opts.part }) }], warnings: [] };
};

await ui.onmessage({ type: 'export', what: 'pkg', scope: 'all', scale: 1 });
const stopped = posted.find((m) => m.type === 'stopped');
assert.ok(stopped, 'есть сообщение об остановке');
assert.equal(built.length, 2, 'скачаны 2 части до остановки');
assert.equal(stopped.resume.next, 3, 'продолжить с 3-й части');
assert.equal(store.resume.next, 3, 'место сохранено в clientStorage (переживает закрытие плагина)');
const total = stopped.resume.total;
const prog = posted.filter((m) => m.type === 'progress' && m.total);
assert.ok(prog.every((m) => m.total === 120 && m.done >= 0 && m.done < 120), 'общий счётчик по всем фреймам');

posted.length = 0;
await ui.onmessage({ type: 'export', what: 'pkg', scope: 'all', scale: 1, resume: stopped.resume });
assert.equal(built.length, total, 'после продолжения скачаны все части');
assert.deepEqual(built.map((p) => p.index), Array.from({ length: total }, (_, i) => i + 1), 'части по порядку, без повторов');
assert.ok(built.every((p) => p.id === built[0].id && p.total === total), 'один id выгрузки — программа склеит старые и новые части');
const firstProg = posted.find((m) => m.type === 'progress' && m.total);
assert.ok(firstProg.done >= 40, 'счётчик продолжается с места остановки');
assert.ok(posted.some((m) => m.type === 'finished'), 'выгрузка закончена');
assert.equal(store.resume, null, 'после конца место сброшено');
console.log(`остановка/продолжение: 120 фреймов, ${total} частей, остановлено на 3-й, продолжено — OK`);
