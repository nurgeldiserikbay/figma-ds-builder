// Склейка выгрузок: части одной выгрузки — по номеру; разные выгрузки (прошлая сборка + новая) — новая версия
// фрейма заменяет прежнюю на её месте, переменные — из самой поздней выгрузки.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mergePackages } from '../src/merge.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-merge-'));
const pkg = (name, frames, vars, part) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(path.join(d, 'frames'), { recursive: true });
  for (const f of frames) fs.writeFileSync(path.join(d, 'frames', `${f.id}.png`), `${name}:${f.id}`);
  fs.writeFileSync(path.join(d, 'variables.json'), JSON.stringify(vars));
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ file: 'F', frames: frames.map((f) => ({ ...f, png: `frames/${f.id}.png` })), part }));
  return d;
};
const old = pkg('old', [{ id: '1', name: 'Компоненты' }, { id: '2', name: 'Главная' }], { v: 'old' });
const p1 = pkg('new1', [{ id: '2', name: 'Главная (правка)' }], { v: 'new' }, { id: 'x', index: 1, total: 2 });
const p2 = pkg('new2', [{ id: '3', name: 'Тарифы' }], { v: 'new' }, { id: 'x', index: 2, total: 2 });
const { dir } = mergePackages([old, p2, p1], path.join(tmp, 'out'));
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.deepEqual(m.frames.map((f) => f.name), ['Компоненты', 'Главная (правка)', 'Тарифы'], 'прежний порядок, новая версия фрейма, новые — в конце');
assert.equal(fs.readFileSync(path.join(dir, 'frames', '2.png'), 'utf8'), 'new1:2', 'PNG — из новой выгрузки');
assert.equal(fs.readFileSync(path.join(dir, 'frames', '1.png'), 'utf8'), 'old:1');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'variables.json'), 'utf8')), { v: 'new' }, 'переменные — из последней выгрузки');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('склейка выгрузок: новая версия фрейма заменяет прежнюю, переменные — из последней — OK');

// переменные и стили из всех частей: библиотечные переменные каждая часть выгружает только свои
{
  const { mergeVariables, mergeStyles } = await import('../src/merge.js');
  const lib = (vars) => [{ name: 'Lib', remote: true, modes: ['Light', 'Dark'], variables: vars }];
  const v = (name, r) => ({ name, type: 'COLOR', values: { Light: { r, g: 0, b: 0, a: 1 }, Dark: { r, g: 0, b: 0, a: 1 } } });
  const m = mergeVariables([lib([v('A', 0.1), v('B', 0.2)]), lib([v('B', 0.2), v('C', 0.3)]), lib([v('A', 0.5)])]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].variables.map((x) => [x.name, x.values.Light.r]), [['A', 0.5], ['B', 0.2], ['C', 0.3], ['A', 0.1]], 'все переменные, поздняя часть — первой');
  const st = mergeStyles([{ paint: [{ name: 'P1' }], text: [] }, { paint: [{ name: 'P2' }, { name: 'P1' }] }]);
  assert.deepEqual(st.paint.map((x) => x.name), ['P2', 'P1']);
  console.log('Переменные и стили частей объединяются — OK');
}
