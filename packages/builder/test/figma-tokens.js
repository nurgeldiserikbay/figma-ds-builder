// Переменные и стили Figma → CSS: имена из макета, обводка в раскладке, только нужные шрифты.
import assert from 'node:assert/strict';
import { loadTokens } from '../src/tokens.js';
import { normalizeTree } from '../src/package.js';
import { generateFrame } from '../src/generate.js';

const ok = (name, fn) => { fn(); console.log('OK', name); };

const variables = [
  { name: 'Primitives', modes: ['Value'], variables: [
    { name: 'indigo/600', type: 'COLOR', scopes: [], values: { Value: { r: 0.263, g: 0.22, b: 0.792, a: 1 } } },
    { name: 'white', type: 'COLOR', scopes: [], values: { Value: { r: 1, g: 1, b: 1, a: 1 } } },
  ] },
  { name: 'Color', modes: ['Light', 'Dark'], variables: [
    { name: 'color/bg/accent', type: 'COLOR', scopes: ['FRAME_FILL'], codeSyntax: { WEB: 'var(--bg-accent)' }, values: { Light: { alias: 'indigo/600' }, Dark: { alias: 'white' } } },
  ] },
  { name: 'Spacing', modes: ['Value'], variables: [
    { name: 'space/lg', type: 'FLOAT', scopes: ['GAP'], values: { Value: 24 } },
    { name: 'radius/md', type: 'FLOAT', scopes: ['CORNER_RADIUS'], values: { Value: 10 } },
  ] },
];
const styles = { effect: [{ name: 'Shadow/Card', effects: [{ type: 'DROP_SHADOW', x: 0, y: 4, blur: 12, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }] }] };
const tokens = loadTokens(null, variables, styles);

ok('переменные Figma → tokens.css: имена для кода, алиасы, режимы, тени', () => {
  const css = tokens.css();
  assert.match(css, /--indigo-600: #4338ca;/);
  assert.match(css, /--bg-accent: var\(--indigo-600\);/);
  assert.match(css, /\[data-mode="dark"\] \{\n {2}--bg-accent: var\(--white\);/);
  assert.match(css, /--space-lg: 24px;/);
  assert.match(css, /--shadow-card: 0px 4px 12px 0px #00000040;/);
  assert.equal(tokens.varRef('color/bg/accent'), '--bg-accent');
  // цвет без привязки — смысловая переменная важнее палитры
  assert.equal(tokens.colorVar('#4338ca'), '--bg-accent');
});

const frame = () => ({
  id: '1:1', name: 'Card', type: 'FRAME', x: 0, y: 0, w: 200, h: 90, visible: true,
  fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0.263, g: 0.22, b: 0.792, a: 1 }, variable: 'color/bg/accent' }],
  strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 } }], strokeWeight: 1, strokeAlign: 'INSIDE',
  radius: [10, 10, 10, 10], effects: [{ type: 'DROP_SHADOW', x: 0, y: 4, blur: 12, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }], effectStyle: 'Shadow/Card',
  vars: { gap: 'space/lg', padding: ['space/lg', 'space/lg', 'space/lg', 'space/lg'], radius: ['radius/md', 'radius/md', 'radius/md', 'radius/md'] },
  layout: { mode: 'VERTICAL', gap: 24, padding: [24, 24, 24, 24], primaryAlign: 'MIN', counterAlign: 'MIN', wrap: false, counterGap: 0 },
  children: [
    { id: '1:2', name: 'A', type: 'RECTANGLE', x: 25, y: 25, w: 150, h: 10, visible: true, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] },
    { id: '1:3', name: 'B', type: 'RECTANGLE', x: 25, y: 59, w: 150, h: 6, visible: true, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] },
  ],
});

ok('обводка, включённая в раскладку, переносится в padding (флаг и догадка по детям)', () => {
  const t1 = frame(); t1.layout.strokesIncluded = true; normalizeTree(t1);
  assert.deepEqual(t1.layout.padding, [25, 25, 25, 25]);
  assert.deepEqual(t1.layout.designPadding, [24, 24, 24, 24]);
  const t2 = frame(); normalizeTree(t2); // старый пакет: дети на 25 = 24 + 1
  assert.deepEqual(t2.layout.padding, [25, 25, 25, 25]);
  const t3 = frame(); t3.children.forEach((c) => { c.x -= 1; c.y -= 1; }); normalizeTree(t3); // обводка не в раскладке
  assert.deepEqual(t3.layout.padding, [24, 24, 24, 24]);
  const t4 = frame(); t4.layout.strokesIncluded = true; normalizeTree(t4); normalizeTree(t4); // повторно не прибавляем
  assert.deepEqual(t4.layout.padding, [25, 25, 25, 25]);
});

ok('вёрстка ссылается на переменные Figma', () => {
  const t = frame(); delete t.strokes; normalizeTree(t);
  const { css } = generateFrame(t, { mode: 'flow', tokens, assetUrl: (r) => r, title: 'Card' });
  assert.match(css, /background: var\(--bg-accent, #4338ca\)/);
  assert.match(css, /gap: var\(--space-lg, 24px\)/);
  assert.match(css, /padding: var\(--space-lg, 24px\) var\(--space-lg, 24px\)/);
  assert.match(css, /border-radius: var\(--radius-md, 10px\)/);
  assert.match(css, /box-shadow: var\(--shadow-card, /);
});
