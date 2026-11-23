// React/Vue: экземпляры компонента Figma → компонент с параметрами вариантов (variant, state) и атрибутов
// (disabled, aria-selected, placeholder); разметка совпадает с исходной.
import assert from 'node:assert/strict';
import { findComponents } from '../src/components.js';
import { preparePages, renderReact, renderVue } from '../src/frameworks.js';

let id = 0;
const btn = (variant, cls, extraAttrs = []) => ({
  tag: 'button', kind: 'node', id: `b${++id}`, name: 'Button', cls,
  attrs: [['type', 'button'], ...extraAttrs, ['data-figma-id', `b${id}`], ['data-component', 'Button'], ['data-variant', variant]],
  children: [{ tag: 'span', kind: 'node', id: `l${id}`, name: 'Label', cls: 'button__label', attrs: [['data-figma-id', `l${id}`]], children: [{ text: 'Купить', cls: 'button__text' }] }],
});
const buttons = [
  btn('Variant=Primary, State=Default', 'button button--primary'),
  btn('Variant=Primary, State=Hover', 'button button--primary is-hover'),
  btn('Variant=Secondary, State=Default', 'button button--secondary'),
  btn('Variant=Secondary, State=Disabled', 'button button--secondary is-disabled', [['disabled', '']]),
  btn('Variant=Primary, State=Default', 'button button--primary button--own-x1'),
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

const strip = (h) => h.replace(/ data-(figma-id|name|component|variant)="[^"]*"/g, '').replace(/ disabled=""/g, ' disabled');
// атрибуты состояния — сразу после class, как в html/ (componentize)
const expect = (b) => `<button class="${b.cls}"${b.attrs.some(([k]) => k === 'disabled') ? ' disabled' : ''} type="button"><span class="button__label"><span class="button__text">Купить</span></span></button>`;
const r = await renderReact(pages, comps);
const html = strip(r.Main);
for (const b of buttons) assert.ok(html.includes(expect(b)), `React: ${b.cls}\n${html}`);
// Vue: те же классы и атрибуты (пробелы между тегами — иначе)
const vMain = strip((await renderVue(pages, comps)).Main).replace(/>\s+</g, '><').replace(/<!--\[-->|<!--\]-->/g, '').replace(/ style=""/g, '');
for (const b of buttons) assert.ok(vMain.includes(expect(b)), `Vue: ${b.cls}\n${vMain}`);
console.log('React/Vue: компонент Figma → параметры variant, state, disabled; разметка как в HTML — OK');
