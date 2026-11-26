// Поля формы из макета: подпись → <label for>, серый текст → placeholder, тёмный и с курсором → value,
// высокое поле → <textarea>, поле со стрелкой «Выберите…» → выпадающий список (вид как в макете).
import assert from 'node:assert/strict';
import { generateFrame } from '../src/generate.js';
import { findComponents } from '../src/components.js';
import { preparePages, renderReact, renderVue } from '../src/frameworks.js';

const fill = (r, g, b) => [{ type: 'SOLID', visible: true, color: { r, g, b, a: 1 } }];
const seg = (n, c) => ({ start: 0, end: n, fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: { unit: 'PIXELS', value: 24 }, fills: fill(c, c, c) });
const text = (id, chars, x, y, w, c = 0.1, h = 24, autoResize = 'WIDTH_AND_HEIGHT') => ({ id, name: id, type: 'TEXT', x, y, w, h, visible: true, text: { characters: chars, autoResize, segments: [seg(chars.length, c)] } });
const box = (id, name, y, h, kids, extra = {}) => ({ id, name, type: 'INSTANCE', component: { name }, x: 0, y, w: 320, h, visible: true, fills: fill(1, 1, 1),
  strokes: [{ type: 'SOLID', visible: true, color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }], strokeWeight: 1, radius: [8, 8, 8, 8], children: kids, ...extra });

const tree = { id: 'r', name: 'Профиль', type: 'FRAME', x: 0, y: 0, w: 400, h: 600, visible: true, fills: fill(1, 1, 1), children: [
  text('lbl1', 'Должность', 0, 0, 120),
  box('f1', 'Text field', 28, 48, [text('v1', 'UX/UI designer', 12, 40, 200, 0.1)]),          // тёмный — значение
  text('lbl2', 'Город', 0, 90, 120),
  box('f2', 'Text field', 118, 48, [text('v2', 'Mosc |', 12, 130, 200, 0.1)]),                 // курсор — значение без курсора
  box('f3', 'Text field', 180, 48, [text('v3', 'Введите почту', 12, 192, 200, 0.6)]),          // серый — подсказка
  text('lbl4', 'О себе', 0, 240, 120),
  box('f4', 'Text field', 268, 120, [text('v4', 'Несколько слов о себе', 12, 280, 296, 0.6, 96, 'NONE')]), // высокое — textarea
  box('f5', 'Dropdown', 400, 48, [text('v5', 'Select a level', 12, 412, 200, 0.6),
    { id: 'chev', name: 'chevron-down', type: 'VECTOR', x: 288, y: 412, w: 20, h: 20, visible: true, svg: 'vectors/chev.svg', fills: fill(0, 0, 0) }]),
] };

const { html, css, root } = generateFrame(tree, { mode: 'flow', assetUrl: (r) => r, title: 'Формы' });
const tagOf = (id) => html.match(new RegExp(`<(\\w+)[^>]*data-figma-id="${id}"[^>]*>`))?.[0] || '';

assert.match(tagOf('lbl1'), /^<label [^>]*for="field-f1"/, 'подпись над полем — label');
assert.match(tagOf('v1'), /^<input [^>]*id="field-f1"[^>]*value="UX\/UI designer"/, 'тёмный текст — значение');
assert.doesNotMatch(tagOf('v1'), /placeholder|aria-label/, 'с подписью aria-label не нужен');
assert.match(tagOf('v2'), /value="Mosc"/, 'курсор из макета убран');
assert.match(css, /:has\(> input:focus-visible\)[^{]*\{ outline: 2px/, 'фокус — на рамке поля, не на input внутри');
assert.match(tagOf('v3'), /placeholder="Введите почту"/, 'серый текст — подсказка');
assert.match(tagOf('v3'), /aria-label="Введите почту"/, 'поле без подписи — aria-label');
assert.match(tagOf('v4'), /^<textarea [^>]*placeholder="Несколько слов о себе"/, 'высокое поле — textarea');
assert.match(html, /<textarea [^>]*><\/textarea>/, 'textarea закрывается');
assert.match(tagOf('f5'), /^<button [^>]*role="combobox"[^>]*aria-haspopup="listbox"/, 'выпадающий список');
assert.ok(!/<select/.test(html), 'нативный select не рисуется — вид как в макете');

// React и Vue: те же поля (htmlFor → for, defaultValue → value) — проверяем по отрисованному HTML
const pages = preparePages([{ title: 'Forms', dir: 'forms', root }]);
const comps = findComponents(pages);
for (const [fw, out] of [['React', (await renderReact(pages, comps)).Forms], ['Vue', (await renderVue(pages, comps)).Forms]]) {
  assert.match(out, /<label [^>]*for="field-f1"/, `${fw}: label`);
  assert.match(out, /<input [^>]*value="UX\/UI designer"/, `${fw}: значение`);
  assert.match(out, /<textarea [^>]*placeholder="Несколько слов о себе"/, `${fw}: textarea`);
}
console.log('Поля формы: label, value/placeholder, курсор, textarea, выпадающий список — OK');

// окно «Video link»: иконка закрытия — кнопка с подписью; поле без подписи и с безликим именем — имя по заголовку
{
  const modal = { id: 'm', name: 'Добавление ссылки', type: 'FRAME', x: 0, y: 0, w: 592, h: 237, visible: true, fills: fill(1, 1, 1), children: [
    text('mt', 'Video link', 24, 24, 120, 0.1),
    { id: 'mx', name: 'Icons', type: 'INSTANCE', component: { name: 'Icons', variant: { Style: 'circle-x', State: 'Default' } }, x: 544, y: 26, w: 24, h: 24, visible: true,
      children: [{ id: 'mxv', name: 'Vector', type: 'VECTOR', x: 546, y: 28, w: 20, h: 20, visible: true, svg: 'vectors/x.svg', fills: [] }] },
    box('mf', 'Field', 80, 40, [text('mv', 'https://example.com', 36, 88, 300, 0.1)]),
  ] };
  const { html: h } = generateFrame(modal, { mode: 'flow', assetUrl: (r) => r, title: 'Окно', svgText: () => '<svg width="20" height="20"></svg>' });
  const tag = (id) => h.match(new RegExp(`<(\\w+)[^>]*data-figma-id="${id}"[^>]*>`))?.[0] || '';
  assert.match(tag('mx'), /^<button [^>]*aria-label="Close"/, 'иконка закрытия — кнопка');
  assert.match(tag('mv'), /aria-label="Video link"/, 'имя поля — по заголовку окна');
  console.log('Окно: кнопка закрытия и имя поля — OK');
}
