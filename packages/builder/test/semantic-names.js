// Блоки, названные дизайнером по смыслу, становятся смысловыми тегами.
import assert from 'node:assert/strict';
import { analyzeSemantics, landmarkByName } from '../src/semantic.js';

const box = (id, name, x, y, w, h, children = [{ id: id + 't', type: 'TEXT', name: 't', x, y, w: 10, h: 10, visible: true, text: { characters: 'a', segments: [{ start: 0, end: 1, fontSize: 14 }] } }]) =>
  ({ id, name, type: 'FRAME', x, y, w, h, visible: true, children });
const tree = { id: 'root', name: 'Экран', type: 'FRAME', x: 0, y: 0, w: 1000, h: 2000, visible: true, children: [
  box('a', 'Sidebar', 0, 300, 200, 800),
  box('b', 'Main content', 220, 300, 700, 1200, [box('c', 'section / Тарифы', 220, 300, 700, 400), box('d', 'Форма', 220, 800, 400, 300), box('e', 'Header row', 220, 1200, 700, 40)]),
  box('f', 'Навигация', 0, 100, 1000, 60),
] };
const sem = analyzeSemantics(tree);
const tag = (id) => sem.get(id)?.tag;
assert.equal(tag('a'), 'aside');
assert.equal(tag('b'), 'main');
assert.equal(tag('c'), 'section');
assert.equal(tag('d'), 'form');
assert.notEqual(tag('e'), 'header', 'строка таблицы «Header row» — не <header>');
assert.equal(tag('f'), 'nav');
assert.equal(landmarkByName('Frame 12'), null);
for (const n of ['form-control input-style-1', 'form-group', 'navbar-brand', 'main-content']) assert.equal(landmarkByName(n), null, `«${n}» — имя класса, не смысловой блок`);
assert.equal(landmarkByName('Header-5'), 'header');
assert.equal(landmarkByName('Footer 1'), 'footer');
const nested = analyzeSemantics({ ...tree, children: [box('x', 'form / Вход', 0, 0, 500, 500, [box('y', 'Form', 0, 0, 400, 300)])] });
assert.equal(nested.get('x')?.tag, 'form');
assert.notEqual(nested.get('y')?.tag, 'form', 'форма в форме не вкладывается');
console.log('смысловые теги по именам слоёв (header, nav, main, section, aside, form) — OK');
