// «Truncate text» из Figma: текст обрезается многоточием по высоте блока (или maxLines) и не вылезает на соседей;
// у вектора прозрачность слоя уже в SVG — в CSS её не повторяем.
import assert from 'node:assert/strict';
import { generateFrame, truncLines } from '../src/generate.js';

const seg = (n, extra = {}) => ({ start: 0, end: n, fontFamily: 'Inter', fontSize: 14, fontWeight: 400, lineHeight: { unit: 'AUTO' }, fills: [], ...extra });
const long = 'Далеко-далеко за словесными горами в стране гласных и согласных живут рыбные тексты. '.repeat(4);
const t = (extra) => ({ id: 't', name: 't', type: 'TEXT', x: 0, y: 0, w: 300, h: 56, visible: true, text: { characters: long, autoResize: 'TRUNCATE', segments: [seg(long.length)], ...extra } });
assert.equal(truncLines(t({})), 3, 'Auto: 56 / (14 × 1.33) ≈ 3 строки');
assert.equal(truncLines(t({ truncation: 'ENDING', maxLines: 2 })), 2, 'maxLines из Figma');
assert.equal(truncLines({ ...t({}), text: { ...t({}).text, autoResize: 'HEIGHT' } }), 0, 'без обрезки');
assert.equal(truncLines(t({ segments: [seg(long.length, { lineHeight: { unit: 'PIXELS', value: 20 } })] })), 3);

const tree = { id: 'r', name: 'R', type: 'FRAME', x: 0, y: 0, w: 320, h: 200, visible: true, fills: [], children: [
  t({}),
  { id: 'v', name: 'V', type: 'VECTOR', x: 0, y: 100, w: 20, h: 20, visible: true, opacity: 0.5, svg: 'vectors/v.svg', fills: [] },
] };
const { css } = generateFrame(tree, { mode: 'flow', assetUrl: (r) => r, title: 'T', svgText: () => '<svg width="20" height="20"><path opacity="0.5" d="M0 0h20v20H0z"/></svg>' });
assert.match(css, /-webkit-line-clamp: 3;[^}]*overflow: hidden/, 'обрезка многоточием');
assert.doesNotMatch(css, /opacity: 0\.5/, 'прозрачность вектора — только в SVG');
console.log('Обрезка текста многоточием и прозрачность векторов — OK');
