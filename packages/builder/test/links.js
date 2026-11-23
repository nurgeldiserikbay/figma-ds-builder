// Переходы прототипа → ссылки: Navigate to (страница другого фрейма), Open link, Scroll to (#якорь),
// ссылка в тексте; поле ввода с кнопкой → <form>. Ссылка в ссылке не делается.
import assert from 'node:assert/strict';
import { generateFrame } from '../src/generate.js';
import { relinkRoutes } from '../src/frameworks.js';

const fill = (r, g, b) => [{ type: 'SOLID', visible: true, color: { r, g, b, a: 1 } }];
const seg = (start, end, extra = {}) => ({ start, end, fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: { unit: 'PIXELS', value: 24 }, fills: fill(0, 0, 0), ...extra });
const text = (id, chars, x, y, w, segs = [seg(0, chars.length)]) => ({ id, name: id, type: 'TEXT', x, y, w, h: 24, visible: true, text: { characters: chars, autoResize: 'WIDTH_AND_HEIGHT', segments: segs } });
const al = (mode, pad = 12) => ({ mode, gap: 8, padding: [pad, pad, pad, pad], primaryAlign: 'MIN', counterAlign: 'MIN' });
const btn = (id, label, x, y, link) => ({ id, name: 'Button', type: 'FRAME', x, y, w: 120, h: 48, visible: true, fills: fill(0.2, 0.3, 0.9), radius: [8, 8, 8, 8],
  layout: al('HORIZONTAL'), link, children: [text(id + 't', label, x + 12, y + 12, 96)] });

const field = { id: 'fld', name: 'Field', type: 'FRAME', x: 0, y: 400, w: 300, h: 48, visible: true, fills: fill(1, 1, 1),
  strokes: [{ type: 'SOLID', visible: true, color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }], strokeWeight: 1, radius: [8, 8, 8, 8], layout: al('HORIZONTAL'),
  children: [text('val', 'Ваша почта', 12, 412, 276)] };
const subscribe = { id: 'sub', name: 'Subscribe', type: 'FRAME', x: 0, y: 400, w: 440, h: 48, visible: true, fills: [], layout: { ...al('HORIZONTAL', 0) },
  children: [{ id: 'inp', name: 'Input', type: 'INSTANCE', component: { name: 'Input' }, x: 0, y: 400, w: 300, h: 48, visible: true, fills: [], layout: al('VERTICAL', 0), children: [field] },
    btn('send', 'Отправить', 308, 400)] };

const tree = { id: 'r', name: 'Главная', type: 'FRAME', x: 0, y: 0, w: 800, h: 1200, visible: true, fills: fill(1, 1, 1), children: [
  btn('go', 'Тарифы', 0, 0, { type: 'frame', id: '9:1' }),
  btn('ext', 'Сайт', 140, 0, { type: 'url', url: 'https://example.com', newTab: true }),
  btn('down', 'Вниз', 280, 0, { type: 'scroll', id: 'faq' }),
  btn('nowhere', 'Нет', 420, 0, { type: 'frame', id: '404:1' }),
  // ссылка внутри ссылки: внешняя ведёт на страницу, внутренняя (кнопка в карточке) остаётся простым элементом
  { id: 'card', name: 'Card', type: 'FRAME', x: 0, y: 100, w: 300, h: 120, visible: true, fills: fill(0.95, 0.95, 0.95), layout: al('VERTICAL'), link: { type: 'frame', id: '9:1' },
    children: [btn('inner', 'Ещё', 12, 112, { type: 'url', url: 'https://example.com/x' })] },
  text('para', 'Читайте правила здесь', 0, 260, 300, [seg(0, 16), seg(16, 21, { link: { type: 'url', url: 'https://example.com/rules' } })]),
  subscribe,
  { id: 'faq', name: 'FAQ', type: 'FRAME', x: 0, y: 900, w: 800, h: 200, visible: true, fills: fill(0.9, 0.9, 1), children: [text('q', 'Вопросы', 0, 900, 200)] },
] };

const frameHref = (id) => (id === '9:1' ? '../Tarify-9_1/index.html' : null);
const { html, root } = generateFrame(tree, { mode: 'flow', assetUrl: (r) => r, title: 'L', frameHref });
const open = (id) => html.match(new RegExp(`<([a-z0-9]+) [^>]*data-figma-id="${id}"[^>]*>`))?.[0] || '';
assert.match(open('go'), /^<a [^>]*href="\.\.\/Tarify-9_1\/index\.html"/, 'Navigate to → страница фрейма');
assert.match(open('ext'), /^<a [^>]*href="https:\/\/example\.com" target="_blank" rel="noopener"/, 'Open link → адрес в новой вкладке');
assert.match(open('down'), /^<a [^>]*href="#faq"/, 'Scroll to → #якорь');
assert.match(open('faq'), / id="faq"/, 'у цели — id якоря');
assert.match(open('nowhere'), /href="#"/, 'фрейма нет в сборке — #');
assert.match(open('card'), /^<a [^>]*href="\.\.\/Tarify-9_1\/index\.html"/);
assert.match(open('inner'), /^<span /, 'ссылка внутри ссылки — span');
assert.doesNotMatch(open('inner'), /href=/);
assert.match(html, /<a class="[^"]+" href="https:\/\/example\.com\/rules" target="_blank" rel="noopener">здесь<\/a>/, 'ссылка в тексте');
assert.match(open('sub'), /^<form [^>]*action="#"/, 'поле с кнопкой — форма');
assert.match(open('send'), /type="submit"/, 'кнопка формы — submit');
assert.doesNotMatch(open('go'), /type="button"/, 'у ссылки нет type кнопки');
console.log('переходы прототипа → ссылки (страница, адрес, якорь, текст), форма с полем и кнопкой — OK');

// React/Vue: путь к странице фрейма → #маршрут
const pages = [{ dir: 'Glavnaya-r', route: 'glavnaya', root }, { dir: 'Tarify-9_1', route: 'tarify', root: { tag: 'div', attrs: [], children: [] } }];
relinkRoutes(pages);
const find = (el, id) => (el.id === id ? el : (el.children || []).reduce((f, c) => f || find(c, id), null));
assert.equal(find(root, 'go').attrs.find(([k]) => k === 'href')[1], '#tarify');
assert.equal(find(root, 'down').attrs.find(([k]) => k === 'href')[1], '#faq');
console.log('React/Vue: переход на страницу → #маршрут — OK');

// ссылка и список по имени слоя; ссылка в пункте списка — список становится блоками
{
  const { analyzeSemantics } = await import('../src/semantic.js');
  const fr = (id, name, children = [], extra = {}) => ({ id, name, type: 'FRAME', x: 0, y: 0, w: 200, h: 40, visible: true, fills: [], children, ...extra });
  const tx = (id) => ({ id, name: 't', type: 'TEXT', x: 0, y: 0, w: 50, h: 20, visible: true, text: { characters: 'Пункт', segments: [{ start: 0, end: 5, fontSize: 14 }] } });
  const t = fr('root', 'Экран', [
    fr('l', 'link / Подробнее', [tx('lt')]),
    fr('ul', 'list / Тарифы', [fr('i1', 'Тариф', [tx('a')]), fr('i2', 'Тариф', [tx('b')])]),
    fr('ul2', 'Список', [fr('j1', 'Тариф', [tx('c')], { link: { type: 'url', url: 'https://x.y' } }), fr('j2', 'Тариф', [tx('d')])]),
  ], { w: 1000, h: 1000 });
  const s = analyzeSemantics(t);
  assert.equal(s.get('l').tag, 'a');
  assert.equal(s.get('l').attrs.href, '#');
  assert.equal(s.get('ul').tag, 'ul');
  assert.equal(s.get('i1').tag, 'li');
  assert.equal(s.get('j1').tag, 'a', 'пункт со ссылкой — ссылка');
  assert.notEqual(s.get('ul2').tag, 'ul', 'в <ul> не может быть <a> — список стал блоком');
  assert.notEqual(s.get('j2').tag, 'li');
  console.log('ссылка и список по имени слоя — OK');
}

// Open overlay: ссылка на страницу окна с aria-haspopup; Close — назад
{
  const t2 = { id: 'r2', name: 'Экран', type: 'FRAME', x: 0, y: 0, w: 800, h: 400, visible: true, fills: fill(1, 1, 1), children: [
    btn('open', 'Купить', 0, 0, { type: 'overlay', id: '9:1' }), btn('close', 'Закрыть', 200, 0, { type: 'close' })] };
  const { html: h2 } = generateFrame(t2, { mode: 'flow', assetUrl: (r) => r, title: 'M', frameHref });
  const op = (id) => h2.match(new RegExp(`<([a-z0-9]+) [^>]*data-figma-id="${id}"[^>]*>`))?.[0] || '';
  assert.match(op('open'), /^<a [^>]*href="\.\.\/Tarify-9_1\/index\.html" aria-haspopup="dialog"/, 'Open overlay → ссылка на окно');
  assert.match(op('close'), /href="javascript:history\.back\(\)"/, 'Close overlay → назад');
  console.log('Open overlay → ссылка с aria-haspopup, Close → назад — OK');
}
