// React/Vue: экземпляры компонента Figma → компонент с параметрами вариантов (variant, state) и атрибутов
// (disabled, aria-selected, placeholder); разметка совпадает с исходной.
import assert from 'node:assert/strict';
import { findComponents } from '../src/components.js';
import { preparePages, renderReact, renderVue } from '../src/frameworks.js';

let id = 0;
const btn = (variant, cls, extraAttrs = [], label = 'Купить') => ({
  tag: 'button', kind: 'node', id: `b${++id}`, name: 'Button', cls,
  attrs: [['type', 'button'], ...extraAttrs, ['data-figma-id', `b${id}`], ['data-component', 'Button'], ['data-variant', variant]],
  children: [{ tag: 'span', kind: 'node', id: `l${id}`, name: 'Text', figmaProps: { characters: 'Button label' }, cls: 'button__label', attrs: [['data-figma-id', `l${id}`]], children: [{ text: label, cls: 'button__text' }] }],
});
const buttons = [
  btn('Variant=Primary, State=Default', 'button button--primary'),
  btn('Variant=Primary, State=Hover', 'button button--primary is-hover'),
  btn('Variant=Secondary, State=Default', 'button button--secondary'),
  btn('Variant=Secondary, State=Disabled', 'button button--secondary is-disabled', [['disabled', '']]),
  btn('Variant=Primary, State=Default', 'button button--primary button--own-x1', [], 'Оплатить'),
];
const root = { tag: 'div', kind: 'node', id: 'root', name: 'Page', cls: 'page', attrs: [['data-figma-id', 'root']], children: buttons };
const pages = preparePages([{ title: 'Main', dir: 'main', root }]);
const comps = findComponents(pages);
const c = comps.components.find((x) => x.name === 'Button');
assert.ok(c, 'компонент Button');
assert.deepEqual(c.props.filter((p) => p.kind === 'vprop').map((p) => p.name), ['variant', 'state']);
assert.ok(c.props.some((p) => p.name === 'className'), 'своё у копии — className');
assert.ok(c.props.some((p) => p.kind === 'attr' && p.attr === 'disabled'), 'disabled — параметр');
assert.ok(!c.props.some((p) => p.name === 'rootClass'), 'класс корня не строкой, а из вариантов');
assert.ok(c.props.some((p) => p.kind === 'text' && p.name === 'buttonLabel'), 'текст — параметр с именем свойства Figma «Button label»');

const strip = (h) => h.replace(/ data-(figma-id|name|component|variant)="[^"]*"/g, '').replace(/ disabled=""/g, ' disabled');
// атрибуты состояния — сразу после class, как в html/ (componentize)
const expect = (b) => `<button class="${b.cls}"${b.attrs.some(([k]) => k === 'disabled') ? ' disabled' : ''} type="button"><span class="button__label"><span class="button__text">${b.children[0].children[0].text}</span></span></button>`;
const r = await renderReact(pages, comps);
const html = strip(r.Main);
for (const b of buttons) assert.ok(html.includes(expect(b)), `React: ${b.cls}\n${html}`);
// Vue: те же классы и атрибуты (пробелы между тегами — иначе)
const vMain = strip((await renderVue(pages, comps)).Main).replace(/>\s+</g, '><').replace(/<!--\[-->|<!--\]-->/g, '').replace(/ style=""/g, '');
for (const b of buttons) assert.ok(vMain.includes(expect(b)), `Vue: ${b.cls}\n${vMain}`);
console.log('React/Vue: компонент Figma → параметры variant, state, disabled; разметка как в HTML — OK');

// каталог компонентов: по примеру на сочетание вариантов, подпись — значения вариантов
{
  const { catalogTree } = await import('../src/frameworks.js');
  const cat = catalogTree(comps);
  const sec = cat.children.find((x) => x.attrs?.some(([k, v]) => k === 'id' && v === 'c-Button'));
  assert.ok(sec, 'раздел Button');
  const cells = sec.children[2].children;
  assert.equal(cells.length, 4, 'primary/default, primary/hover, secondary/default, secondary/disabled — копия с другим текстом не повторяется');
  assert.deepEqual(cells.map((c) => c.children[1].children[0].text), ['variant=primary, state=default', 'variant=primary, state=hover', 'variant=secondary, state=default', 'variant=secondary, state=disabled, disabled']);
  const r2 = await renderReact([{ component: 'ComponentCatalog', root: cat }], comps);
  assert.match(r2.ComponentCatalog, /<section class="catalog__item" id="c-Button">/);
  assert.equal((r2.ComponentCatalog.match(/class="button /g) || []).length, 4, 'в каталоге рисуются сами компоненты');
  console.log('каталог компонентов: варианты из макетов, по одному на сочетание — OK');
}

// «показать/скрыть» (Boolean-свойство Figma): копии с иконкой и без — один компонент с параметром showIcon
{
  const { htmlOf } = await import('../src/generate.js');
  let n = 0;
  const icon = () => ({ tag: 'span', kind: 'node', id: `i${++n}`, name: 'Icon', figmaProps: { visible: 'Icon' }, cls: 'chip__icon', attrs: [['data-figma-id', `i${n}`]], children: [{ text: '★', cls: 'chip__star', inline: true, attrs: [] }] });
  const hole = () => ({ kind: 'opt', id: `h${++n}`, name: 'Icon', tag: '', cls: '', attrs: [], children: [], figmaProps: { visible: 'Icon' } });
  const chip = (withIcon, label) => ({ tag: 'div', kind: 'node', id: `c${++n}`, name: 'Chip', cls: 'chip', attrs: [['data-figma-id', `c${n}`], ['data-component', 'Chip']],
    children: [withIcon ? icon() : hole(), { tag: 'span', kind: 'node', id: `t${++n}`, name: 'Text', cls: 'chip__label', attrs: [['data-figma-id', `t${n}`]], children: [{ text: label, cls: 'chip__text', inline: true, attrs: [] }] }] });
  const chips = [chip(true, 'Новинка'), chip(false, 'Скидка'), chip(true, 'Хит')];
  const root2 = { tag: 'div', kind: 'node', id: 'root2', name: 'Page', cls: 'page', attrs: [['data-figma-id', 'root2']], children: chips };
  const pages2 = preparePages([{ title: 'Chips', dir: 'chips', root: root2 }]);
  const comps2 = findComponents(pages2);
  const ch = comps2.components.find((x) => x.name === 'Chip');
  assert.ok(ch, 'копии с иконкой и без — один компонент');
  assert.ok(ch.props.some((p) => p.kind === 'show' && p.name === 'showIcon'), 'параметр showIcon');
  const flat = (h) => h.replace(/ data-(figma-id|name|component|variant)="[^"]*"/g, '').replace(/>\s+</g, '><').replace(/<!--\[-->|<!--\]-->|<!---->/g, '').trim();
  const want = flat(htmlOf(root2, 0));
  assert.doesNotMatch(want, /Скидка<\/span><\/span><span class="chip__icon"/);
  assert.equal(flat((await renderReact(pages2, comps2)).Chips), want, 'React: иконка только там, где она показана');
  assert.equal(flat((await renderVue(pages2, comps2)).Chips).replace(/ style=""/g, ''), want, 'Vue: v-if');
  console.log('«показать/скрыть» из Figma → параметр showIcon (React {showIcon && …}, Vue v-if) — OK');
}

// генератор: скрытый свойством слой — пустое место в дереве элементов, в HTML его нет
{
  const { generateFrame } = await import('../src/generate.js');
  const fill = [{ type: 'SOLID', visible: true, color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }];
  const t = { id: 'r', name: 'Screen', type: 'FRAME', x: 0, y: 0, w: 300, h: 100, visible: true, fills: [], children: [
    { id: 'row', name: 'Chip', type: 'FRAME', x: 0, y: 0, w: 200, h: 40, visible: true, fills: fill, layout: { mode: 'HORIZONTAL', gap: 8, padding: [8, 8, 8, 8], primaryAlign: 'MIN', counterAlign: 'CENTER' },
      children: [
        { id: 'ic', name: 'Icon', type: 'FRAME', x: 8, y: 8, w: 24, h: 24, visible: false, propRefs: { visible: 'Show icon' } },
        { id: 'tx', name: 'Label', type: 'TEXT', x: 8, y: 8, w: 60, h: 24, visible: true, text: { characters: 'Скидка', autoResize: 'WIDTH_AND_HEIGHT', segments: [{ start: 0, end: 6, fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: { unit: 'PIXELS', value: 24 }, fills: fill }] } },
      ] },
  ] };
  const g = generateFrame(t, { mode: 'flow', assetUrl: (x) => x, title: 'S' });
  const row = (function f(e) { return e.id === 'row' ? e : (e.children || []).reduce((a, c) => a || f(c), null); })(g.root);
  assert.equal(row.children[0].kind, 'opt', 'пустое место на месте скрытой иконки');
  assert.deepEqual(row.children[0].figmaProps, { visible: 'Show icon' });
  assert.doesNotMatch(g.html, /data-figma-id="ic"/, 'в HTML скрытого слоя нет');
  console.log('генератор: слой, скрытый свойством «показать/скрыть», — пустое место для React/Vue — OK');
}

// вкладки: копии с Selected=true/false в одном ряду, выбрана одна — выбор переключается нажатием
{
  let n = 0;
  const tab = (sel, label) => ({ tag: 'div', kind: 'node', id: `tb${++n}`, name: 'Tab', cls: `tab${sel ? ' tab--selected' : ''}`,
    attrs: [['data-figma-id', `tb${n}`], ['data-component', 'Tab'], ['data-variant', `Selected=${sel}`], ['aria-selected', String(sel)]],
    children: [{ text: label, cls: 'tab__text', inline: true, attrs: [] }] });
  const bar = { tag: 'div', kind: 'node', id: 'bar', name: 'Tabs', cls: 'tabs', attrs: [['data-figma-id', 'bar']], children: [tab(false, 'Все'), tab(true, 'Новые'), tab(false, 'Архив')] };
  const pages3 = preparePages([{ title: 'Tabs', dir: 'tabs', root: { tag: 'div', kind: 'node', id: 'r3', name: 'Page', cls: 'page', attrs: [['data-figma-id', 'r3']], children: [bar] } }]);
  const comps3 = findComponents(pages3);
  const { exportReact } = await import('../src/frameworks.js');
  const os = await import('node:os'); const fs = await import('node:fs'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-tabs-'));
  fs.mkdirSync(path.join(dir, 'tabs')); fs.writeFileSync(path.join(dir, 'tokens.css'), ''); fs.writeFileSync(path.join(dir, 'tabs', 'styles.css'), '');
  exportReact(dir, pages3, comps3);
  const pageCode = fs.readFileSync(path.join(dir, 'react/src/pages', `${pages3[0].component}.jsx`), 'utf8');
  assert.match(pageCode, /const \[selected1, setSelected1\] = useState\(1\);/, 'сначала выбрана вкладка из макета');
  assert.match(pageCode, /<Tab selected=\{selected1 === 0\} [^>]*onClick=\{\(\) => setSelected1\(0\)\}/, 'нажатие выбирает вкладку');
  const compCode = fs.readFileSync(path.join(dir, 'react/src/components/Tab.jsx'), 'utf8');
  assert.match(compCode, /onClick=\{onClick\}/);
  assert.match(compCode, /aria-selected=\{selected\}/);
  const flat = (h) => h.replace(/ data-(figma-id|name|component|variant)="[^"]*"/g, '').replace(/>\s+</g, '><').replace(/<!--\[-->|<!--\]-->|<!---->| style=""/g, '').trim();
  const { htmlOf } = await import('../src/generate.js');
  assert.equal(flat((await renderReact(pages3, comps3)).Tabs ?? Object.values(await renderReact(pages3, comps3))[0]), flat(htmlOf(pages3[0].root, 0)), 'разметка как в макете');
  assert.equal(flat(Object.values(await renderVue(pages3, comps3))[0]), flat(htmlOf(pages3[0].root, 0)));
  console.log('вкладки (Selected): выбор — состояние страницы, переключается нажатием — OK');
}
