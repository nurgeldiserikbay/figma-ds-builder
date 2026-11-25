// Копии одного компонента (карточки) получают одинаковые теги: заголовок карточки — везде <h…> или везде <span>.
import assert from 'node:assert/strict';
import { analyzeSemantics } from '../src/semantic.js';

const fill = (c) => [{ type: 'SOLID', visible: true, color: { r: c, g: c, b: c, a: 1 } }];
const text = (id, chars, x, y, size, w = 200) => ({ id, name: 'Title', type: 'TEXT', x, y, w, h: size * 1.3, visible: true,
  text: { characters: chars, autoResize: 'WIDTH_AND_HEIGHT', segments: [{ start: 0, end: chars.length, fontSize: size, fills: fill(0) }] } });
// две карточки одного компонента: вторая маленькая (≤140px) — раньше её заголовок становился <span>
const card = (id, x, w, h) => ({ id, name: 'Card', type: 'INSTANCE', component: { name: 'Card' }, x, y: 300, w, h, visible: true, fills: fill(0.95),
  children: [text(id + 't', 'Заголовок карточки', x + 10, 310, 20, w - 20), { ...text(id + 'b', 'Описание карточки, немного текста для примера', x + 10, 340, 14, w - 20), name: 'Body' }] });
const tree = { id: 'r', name: 'Page', type: 'FRAME', x: 0, y: 0, w: 800, h: 600, visible: true, fills: fill(1), children: [
  text('h', 'Главный заголовок страницы', 0, 0, 40, 700),
  { ...text('p', 'Основной текст страницы, обычного размера, его много и он описывает продукт подробно.', 0, 80, 14, 700), name: 'Lead' },
  card('c1', 0, 300, 200), card('c2', 320, 300, 200), card('c3', 640, 140, 140),
] };
const out = analyzeSemantics(tree);
const tags = ['c1t', 'c2t', 'c3t'].map((id) => out.get(id)?.tag);
assert.equal(new Set(tags).size, 1, `заголовки карточек — один тег: ${tags}`);
assert.match(tags[0], /^h[2-6]$/);
assert.equal(out.get('h').tag, 'h1');
console.log('Копии компонента: одинаковые теги заголовков — OK');
