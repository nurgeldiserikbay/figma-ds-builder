// Переменные и стили Figma → CSS: имена из макета, обводка в раскладке, только нужные шрифты.
import assert from 'node:assert/strict';
import { loadTokens } from '../src/tokens.js';
import { normalizeTree } from '../src/package.js';
import { generateFrame } from '../src/generate.js';
import { withFigma } from '../src/ds/figma.js';
import { toCss, toScss } from '../src/ds/export.js';

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
  // цвет без привязки — только переменная, одинаковая во всех режимах: --bg-accent в тёмном режиме белый,
  // и в блоке data-mode="dark" var(--bg-accent) дал бы не тот цвет, что в макете
  assert.equal(tokens.colorVar('#4338ca'), '--indigo-600');
  // одноимённые переменные (локальная и из библиотеки) — выбирается та, у которой цвет слоя
  const dup = loadTokens(null, [
    { name: 'Collection 1', remote: true, modes: ['Light', 'Dark'], variables: [{ name: 'Text/Primary', type: 'COLOR', values: { Light: { r: 0.2, g: 0.2, b: 0.2, a: 1 }, Dark: { r: 1, g: 1, b: 1, a: 1 } } }] },
    { name: 'Collection 1', remote: true, modes: ['Light', 'Dark'], variables: [{ name: 'Text/Primary', type: 'COLOR', values: { Light: { r: 0, g: 0, b: 0, a: 1 }, Dark: { r: 1, g: 1, b: 1, a: 1 } } }] },
  ]);
  assert.equal(dup.varRef('Text/Primary', '#333333'), '--text-primary');
  assert.equal(dup.varRef('Text/Primary', '#000000'), '--collection-1-text-primary');
  assert.equal(dup.varRef('Text/Primary', '#ffffff'), '--text-primary', 'в тёмном режиме цвет у обеих — любая');
  assert.equal(dup.varRef('Text/Primary', '#ff0000'), null, 'цвета нет ни в одном режиме — без переменной');
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

ok('design-system/ из переменных и стилей Figma', () => {
  const ds = { meta: { date: 'd', frames: [] }, colors: { tokens: [{ name: 'violet-700', hex: '#4338ca', uses: 5, members: ['#4338ca'] }], semantic: [], gradients: [], rare: [{ hex: '#4339ca', into: '#4338ca' }] },
    typography: { families: [{ role: 'primary', family: 'Inter' }], styles: [] }, spacing: { base: 4, tokens: [] }, radius: [], shadows: [], breakpoints: [], borders: [], audit: { score: 90, issues: [], metrics: {}, contrast: [] } };
  const st = { ...styles, text: [{ name: 'Body/Medium', fontFamily: 'Inter', fontStyle: 'Semi Bold', fontSize: 16, lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PERCENT', value: -2 } }] };
  const f = withFigma(ds, variables, st);
  const css = toCss(f);
  assert.match(css, /--indigo-600: #4338ca;/);
  assert.match(css, /--bg-accent: var\(--indigo-600\);/);
  assert.match(css, /--space-lg: 24px;/);
  assert.match(css, /--radius-md: 10px;/);
  assert.match(css, /--shadow-card: 0px 4px 12px 0px #00000040;/);
  assert.match(css, /\.type-body-medium \{[^}]*font-weight: 600;[^}]*letter-spacing: -0\.32px;/);
  assert.doesNotMatch(css, /violet/);
  assert.match(toScss(f), /\$bg-accent: \$indigo-600;/);
});

ok('цветовые стили, переменные на тексте, градиенте, обводке, прозрачности; режим на слое', () => {
  const vars2 = [...variables, { name: 'Lib', remote: true, modes: ['Default'], variables: [
    { name: 'size/body', type: 'FLOAT', scopes: ['FONT_SIZE'], values: { Default: 16 } },
    { name: 'stroke/thin', type: 'FLOAT', scopes: ['STROKE_FLOAT'], values: { Default: 2 } },
    { name: 'opacity/muted', type: 'FLOAT', scopes: ['OPACITY'], values: { Default: 50 } },
  ] }];
  const st2 = { ...styles, paint: [{ name: 'Old/Accent', paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }] };
  const tk = loadTokens(null, vars2, st2);
  const css0 = tk.css();
  assert.match(css0, /--old-accent: #ff0000;/);
  assert.match(css0, /--opacity-muted: 0\.5;/, 'прозрачность из Figma (0–100) → 0–1');
  assert.match(css0, /:root, \[data-mode="light"\] \{/);
  const tree = { id: '1:1', name: 'Screen', type: 'FRAME', x: 0, y: 0, w: 300, h: 100, visible: true, modes: { Color: 'Dark' }, fills: [], children: [
    { id: '1:2', name: 'Old', type: 'RECTANGLE', x: 0, y: 0, w: 50, h: 50, visible: true, opacity: 0.5, vars: { opacity: 'opacity/muted', strokeWeight: ['stroke/thin', 'stroke/thin', 'stroke/thin', 'stroke/thin'] },
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], fillStyle: 'Old/Accent',
      strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 } }], strokeWeight: 2, strokeAlign: 'INSIDE' },
    { id: '1:3', name: 'Grad', type: 'RECTANGLE', x: 60, y: 0, w: 50, h: 50, visible: true,
      fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, css: 'linear-gradient(90deg, rgba(67, 56, 202, 1) 0%, rgba(255, 255, 255, 1) 100%)', stopVariables: ['indigo/600', null] }] },
    { id: '1:4', name: 'T', type: 'TEXT', x: 120, y: 0, w: 100, h: 24, visible: true, text: { characters: 'Hi', autoResize: 'WIDTH_AND_HEIGHT',
      segments: [{ start: 0, end: 2, fontFamily: 'Inter', fontStyle: 'Regular', fontWeight: 400, fontSize: 16, lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PIXELS', value: 0 },
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], fillStyle: 'Old/Accent', vars: { fontSize: 'size/body' } }] } },
  ] };
  normalizeTree(tree);
  const { css, html } = generateFrame(tree, { mode: 'flow', tokens: tk, assetUrl: (r) => r, title: 'S' });
  assert.match(css, /background: var\(--old-accent, #ff0000\)/, 'цветовой стиль на заливке');
  assert.match(css, /color: var\(--old-accent, #ff0000\)/, 'цветовой стиль на тексте');
  assert.match(css, /opacity: var\(--opacity-muted, 0\.5\)/);
  assert.match(css, /outline: var\(--stroke-thin, 2px\) solid/);
  assert.match(css, /linear-gradient\(90deg, var\(--indigo-600, rgba\(67, 56, 202, 1\)\) 0%, rgba\(255, 255, 255, 1\) 100%\)/);
  assert.match(css, /font-size: var\(--size-body, 16px\)/);
  assert.match(html, /data-mode="dark"/);
});
