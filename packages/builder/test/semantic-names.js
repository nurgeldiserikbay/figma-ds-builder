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

// поле ввода (экземпляр «Input» с текстом в рамке) — <input> с подсказкой, а не кнопка
{
  const { generateFrame } = await import('../src/generate.js');
  const t = (id, chars, x, y, w, h) => ({ id, name: 'Value', type: 'TEXT', x, y, w, h, visible: true, text: { characters: chars, autoResize: 'HEIGHT', segments: [{ start: 0, end: chars.length, fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: { unit: 'PIXELS', value: 24 }, fills: [{ type: 'SOLID', visible: true, color: { r: 0.4, g: 0.4, b: 0.4, a: 1 } }] }] } });
  const field = { id: 'f', name: 'Field', type: 'FRAME', x: 0, y: 0, w: 320, h: 48, visible: true, fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }], strokes: [{ type: 'SOLID', visible: true, color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }], strokeWeight: 1, radius: [10, 10, 10, 10],
    layout: { mode: 'HORIZONTAL', gap: 0, padding: [12, 16, 12, 16], primaryAlign: 'MIN', counterAlign: 'MIN' }, children: [t('v', 'Ваша почта', 16, 12, 288, 24)] };
  const input = { id: 'i', name: 'Input', type: 'INSTANCE', component: { name: 'Input', variant: { State: 'Default' } }, x: 0, y: 0, w: 320, h: 48, visible: true, fills: [], layout: { mode: 'VERTICAL', gap: 4, padding: [0, 0, 0, 0], primaryAlign: 'MIN', counterAlign: 'MIN' }, children: [field] };
  const tree2 = { id: 'r', name: 'Form', type: 'FRAME', x: 0, y: 0, w: 400, h: 100, visible: true, fills: [], children: [input] };
  const s2 = analyzeSemantics(tree2);
  assert.equal(s2.get('v')?.tag, 'input', 'значение поля — <input>');
  assert.equal(s2.get('v').attrs.type, 'email');
  assert.equal(s2.get('v').attrs.placeholder, 'Ваша почта');
  assert.notEqual(s2.get('i')?.tag, 'button', 'поле ввода — не кнопка');
  const { html } = generateFrame(tree2, { mode: 'flow', assetUrl: (r) => r, title: 'F' });
  assert.match(html, /<input [^>]*type="email"[^>]*placeholder="Ваша почта"[^>]*>/);
  assert.doesNotMatch(html, /<\/input>/);
  console.log('поле ввода → <input type="email" placeholder> — OK');
}
