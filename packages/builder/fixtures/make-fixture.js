// Создаёт тестовый пакет fixtures/sample: «грязный» лендинг 1280×900.
// Шапка и hero — без Auto Layout (как часто бывает), бейдж перекрывает картинку,
// карточки — с Auto Layout.
//
// ВАЖНО: настоящий эталон делает плагин (exportAsync PNG из Figma). Здесь эталон
// синтетический: тот же макет, отрендеренный в режиме absolute (координаты 1:1).
// Поэтому тест проверяет вывод раскладки (flex по геометрии и Auto Layout),
// а не расхождения рендера Figma и браузера.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
import { generateFrame } from '../src/generate.js';
import { loadTokens } from '../src/tokens.js';
import { openBrowser, renderPage } from '../src/render.js';
import { ensureFonts, buildFontsCss, defaultCacheDir } from '../src/fonts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'sample');

const hex = (h, a = 1) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a });
const solid = (h, a) => [{ type: 'SOLID', color: hex(h, a) }];

let seq = 100;
const id = () => `1:${seq++}`;

function rect(name, x, y, w, h, o = {}) {
  return { id: id(), name, type: o.type || 'RECTANGLE', x, y, w, h, fills: o.fills || [], radius: o.radius, strokes: o.strokes, strokeWeight: o.strokeWeight, strokeAlign: o.strokeAlign, effects: o.effects, children: o.children };
}
function frame(name, x, y, w, h, children, o = {}) {
  return { ...rect(name, x, y, w, h, o), type: o.type || 'FRAME', clipsContent: !!o.clip, layout: o.layout, children };
}
function text(name, x, y, w, h, characters, s = {}) {
  return {
    id: id(), name, type: 'TEXT', x, y, w, h,
    text: {
      characters, align: s.align || 'LEFT', verticalAlign: s.va || 'TOP', autoResize: s.auto || 'NONE',
      segments: [{
        start: 0, end: characters.length, fontFamily: 'Inter', fontStyle: s.style || 'Regular',
        fontSize: s.size || 16, lineHeight: { unit: 'PIXELS', value: s.lh || Math.round((s.size || 16) * 1.5) },
        letterSpacing: { unit: 'PIXELS', value: s.ls || 0 }, fills: solid(s.color || '#18181b'),
      }],
    },
  };
}

// повёрнутый слой: transform от фрейма, size — исходный размер, x/y/w/h — видимая рамка (считается здесь независимо)
function rotate(node, deg) {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const w = node.w, h = node.h, cx = node.x + w / 2, cy = node.y + h / 2;
  const tx = cx - (cos * w / 2 - sin * h / 2), ty = cy - (sin * w / 2 + cos * h / 2);
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [cos * x - sin * y + tx, sin * x + cos * y + ty]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const r = (v) => Math.round(v * 100) / 100;
  return { ...node, transform: [[cos, -sin, tx], [sin, cos, ty]], size: { w, h }, rotation: -deg,
    x: r(Math.min(...xs)), y: r(Math.min(...ys)), w: r(Math.max(...xs) - Math.min(...xs)), h: r(Math.max(...ys) - Math.min(...ys)) };
}

const BLUE = '#3b82f6', INK = '#18181b', MUTED = '#52525b', LINE = '#e4e4e7';

// Кнопка, собранная группой «прямоугольник + текст» (без Auto Layout)
function button(name, x, y, w, h, label, primary) {
  return {
    id: id(), name, type: 'GROUP', x, y, w, h, children: [
      rect('bg', x, y, w, h, {
        radius: 10, fills: primary ? solid(BLUE) : [],
        strokes: primary ? undefined : solid(LINE), strokeWeight: 1.5, strokeAlign: 'INSIDE',
      }),
      text('label', x, y, w, h, label, { size: 16, lh: 24, style: 'Semi Bold', align: 'CENTER', va: 'CENTER', color: primary ? '#ffffff' : INK }),
    ],
  };
}

// Карточка с Auto Layout: вертикально, padding 24, gap 12
function card(x, y, title, desc, tint) {
  const p = 24, w = 368;
  const imgY = y + p, titleY = imgY + 140 + 12, descY = titleY + 28 + 12;
  return frame(`Card / ${title}`, x, y, w, 300, [
    rect('image', x + p, imgY, w - 2 * p, 140, { radius: 12, fills: [{ type: 'GRADIENT_LINEAR', css: `linear-gradient(135deg, ${tint} 0%, #ffffff 100%)` }] }),
    text('title', x + p, titleY, w - 2 * p, 28, title, { size: 20, lh: 28, style: 'Semi Bold' }),
    text('desc', x + p, descY, w - 2 * p, 48, desc, { size: 15, lh: 24, color: MUTED }),
  ], {
    radius: 16, fills: solid('#ffffff'), strokes: solid(LINE), strokeWeight: 1, strokeAlign: 'INSIDE',
    effects: [{ type: 'DROP_SHADOW', x: 0, y: 4, blur: 16, spread: 0, color: hex('#000000', 0.06) }],
    layout: { mode: 'VERTICAL', gap: 12, padding: [p, p, p, p], primaryAlign: 'MIN', counterAlign: 'MIN' },
  });
}

const nav = ['Продукт', 'Цены', 'Блог', 'Контакты'].map((t, i) =>
  text(`nav/${t}`, 720 + i * 88, 32, 80, 24, t, { size: 15, lh: 24, style: 'Medium', color: MUTED }));

const root = frame('Landing / Desktop', 0, 0, 1280, 900, [
  // шапка без Auto Layout
  frame('Header', 0, 0, 1280, 88, [
    text('logo', 64, 28, 120, 32, 'Acme', { size: 24, lh: 32, style: 'Bold', ls: -0.5 }),
    ...nav,
    button('Button / CTA', 1080, 22, 136, 44, 'Войти', true),
    rect('divider', 0, 87, 1280, 1, { fills: solid(LINE) }),
  ]),
  // hero
  text('hero/title', 64, 140, 620, 128, 'Дизайн-система из любого макета', { size: 52, lh: 64, style: 'Bold', ls: -1 }),
  text('hero/subtitle', 64, 292, 520, 56, 'Плагин собирает токены и компоненты, а программа верстает страницы и проверяет их попиксельно.', { size: 18, lh: 28, color: MUTED }),
  button('Button / Primary', 64, 380, 180, 52, 'Начать', true),
  button('Button / Secondary', 260, 380, 180, 52, 'Документация', false),
  rect('hero/image', 760, 130, 456, 320, { radius: 20, fills: [{ type: 'GRADIENT_LINEAR', css: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' }] }),
  // бейдж перекрывает картинку → absolute
  frame('badge', 1150, 104, 88, 88, [
    text('badge/text', 1150, 104, 88, 88, 'new', { size: 18, lh: 24, style: 'Bold', align: 'CENTER', va: 'CENTER', color: INK }),
  ], { type: 'FRAME', radius: 44, fills: solid('#facc15'), effects: [{ type: 'DROP_SHADOW', x: 0, y: 8, blur: 24, spread: -4, color: hex('#000000', 0.18) }] }),
  // карточки
  card(64, 520, 'Токены', 'Цвета, шрифты, отступы и радиусы с нормализацией.', '#bfdbfe'),
  card(456, 520, 'Компоненты', 'Повторяющиеся блоки становятся компонентами.', '#ddd6fe'),
  card(848, 520, 'Pixel diff', 'Каждая страница сверяется с эталоном из Figma.', '#bbf7d0'),
  // векторы (булевы операции в Figma): одноцветный и двухцветный — вставляются в страницу, цвета из токенов
  { id: id(), name: 'icon/check', type: 'BOOLEAN_OPERATION', x: 36, y: 856, w: 16, h: 16, svg: 'vectors/check.svg' },
  { id: id(), name: 'icon/badge', type: 'BOOLEAN_OPERATION', x: 12, y: 856, w: 16, h: 16, svg: 'vectors/badge.svg' },
  text('footer', 64, 852, 600, 24, '© 2026 Acme. Тестовый макет для figma-ds-builder.', { size: 14, lh: 24, color: MUTED }),
  // повёрнутый бейдж (−8°) и аватар под круглой маской
  rotate(frame('stamp', 1040, 846, 96, 32, [
    rotate(text('stamp/text', 1040, 846, 96, 32, 'beta', { size: 14, lh: 20, style: 'Semi Bold', align: 'CENTER', va: 'CENTER', color: '#ffffff' }), -8),
  ], { radius: 8, fills: solid('#16a34a') }), -8),
  { id: id(), name: 'avatar', type: 'GROUP', x: 1160, y: 836, w: 48, h: 48, children: [
    { ...rect('avatar/mask', 1160, 836, 48, 48, { fills: solid('#000000') }), type: 'ELLIPSE', isMask: true },
    rect('avatar/photo', 1150, 826, 68, 68, { fills: [{ type: 'GRADIENT_LINEAR', css: 'linear-gradient(135deg, #f97316 0%, #db2777 100%)' }] }),
  ] },
], { fills: solid('#fafafa'), clip: true });
root.id = '1:1';

// тот же лендинг под мобильный (390): фреймы «Landing / Desktop» и «Landing / Mobile» → одна адаптивная страница
const mobile = frame('Landing / Mobile', 0, 0, 390, 820, [
  text('m/logo', 20, 20, 120, 28, 'Acme', { size: 20, lh: 28, style: 'Bold' }),
  text('m/title', 20, 80, 350, 96, 'Дизайн-система из любого макета', { size: 36, lh: 48, style: 'Bold', ls: -0.5 }),
  text('m/subtitle', 20, 192, 350, 72, 'Плагин собирает токены и компоненты, а программа верстает страницы и проверяет их попиксельно.', { size: 16, lh: 24, color: MUTED }),
  button('Button / Primary', 20, 288, 350, 52, 'Начать', true),
  card(11, 372, 'Токены', 'Цвета, шрифты, отступы и радиусы с нормализацией.', '#bfdbfe'),
  text('m/footer', 20, 712, 350, 24, '© 2026 Acme.', { size: 14, lh: 24, color: MUTED }),
  // «грязный» макет: у ряда тегов Auto Layout с gap 8, но теги потом раздвинули руками до 16 —
  // flex по Auto Layout ставит их не туда; точечный запасной режим закрепляет координаты только у этого ряда
  // мелкий текст (12/14: интерлиньяж меньше «стойки» body), пустой текст и пунктирная рамка, как у загрузки логотипа
  text('m/caption', 200, 24, 110, 14, 'Шрифт 12 на 14', { size: 12, lh: 14, style: 'Medium', color: MUTED }),
  { ...text('m/empty', 200, 40, 110, 14, '', { size: 12, lh: 14 }), text: { characters: '', align: 'LEFT', verticalAlign: 'TOP', autoResize: 'NONE', segments: [],
    style: { fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 12, lineHeight: { unit: 'PIXELS', value: 14 } } } },
  { ...rect('m/logo-upload', 330, 12, 40, 40, { radius: 10 }), strokes: solid(INK), strokeWeight: 1, strokeAlign: 'INSIDE', dashPattern: [4, 4] },
  frame('tags', 20, 760, 296, 32, [
    ['HTML', 20, 72], ['CSS', 108, 64], ['React', 188, 80], ['Vue', 284, 32],
  ].slice(0, 3).map(([t, x, w]) => frame(`tag/${t}`, x, 760, w, 32, [
    text('label', x + 12, 764, w - 24, 24, t, { size: 14, lh: 24, style: 'Medium', align: 'CENTER', color: INK }),
  ], { radius: 16, fills: solid('#e4e4e7'), layout: { mode: 'HORIZONTAL', gap: 0, padding: [4, 12, 4, 12], primaryAlign: 'CENTER', counterAlign: 'CENTER' } })),
  { layout: { mode: 'HORIZONTAL', gap: 8, padding: [0, 0, 0, 0], primaryAlign: 'MIN', counterAlign: 'MIN' } }),
], { fills: [], clip: true });
mobile.id = '2:1';

const tokens = {
  color: {
    blue: { 500: { $type: 'color', $value: BLUE } },
    gray: { 50: { $type: 'color', $value: '#fafafa' }, 200: { $type: 'color', $value: LINE }, 600: { $type: 'color', $value: MUTED }, 900: { $type: 'color', $value: INK } },
    yellow: { 400: { $type: 'color', $value: '#facc15' } },
    white: { $type: 'color', $value: '#ffffff' },
  },
};

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
fs.writeFileSync(path.join(dir, 'frames', '1_1.json'), JSON.stringify(root, null, 2));
fs.mkdirSync(path.join(dir, 'vectors'), { recursive: true });
const SVGS = {
  'check.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm3.6 5.2L7 9.8 4.4 7.2 3.2 8.4 7 12.2l5.8-5.8-1.2-1.2Z" fill="${BLUE}" fill-rule="evenodd"/></svg>`,
  'badge.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><defs><clipPath id="c"><rect width="16" height="16" rx="4"/></clipPath></defs><g clip-path="url(#c)"><rect width="16" height="16" fill="${INK}"/><circle cx="8" cy="8" r="4" fill="#facc15"/></g></svg>`,
};
for (const [n, t] of Object.entries(SVGS)) fs.writeFileSync(path.join(dir, 'vectors', n), t);
fs.writeFileSync(path.join(dir, 'frames', '2_1.json'), JSON.stringify(mobile, null, 2));
fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(tokens, null, 2));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
  format: 'ds-package', version: 1, file: 'Sample landing (fixture)', createdAt: new Date().toISOString(), scale: 1,
  tokens: 'tokens.json',
  frames: [
    { id: '1:1', name: 'Landing / Desktop', page: 'Landing', width: 1280, height: 900, tree: 'frames/1_1.json', png: 'frames/1_1.png' },
    { id: '2:1', name: 'Landing / Mobile', page: 'Landing', width: 390, height: 820, tree: 'frames/2_1.json', png: 'frames/2_1.png' },
  ],
}, null, 2));

// синтетический эталон: режим absolute
const fonts = ensureFonts(['Inter'], defaultCacheDir());
const browser = await openBrowser();
for (const [tree, file, w, h] of [[root, '1_1', 1280, 900], [mobile, '2_1', 390, 820]]) {
  const tmp = path.join(dir, '.ref');
  fs.mkdirSync(tmp, { recursive: true });
  const gen = generateFrame(tree, { mode: 'absolute', tokens: loadTokens(tokens), assetUrl: (r) => r, svgText: (r) => fs.readFileSync(path.join(dir, r), 'utf8') });
  // шрифт — тот же, что подключит ds-build (Inter из npm), чтобы тест не зависел от шрифтов системы
  fs.writeFileSync(path.join(tmp, 'fonts.css'), buildFontsCss(fonts.dir, fonts.found));
  fs.writeFileSync(path.join(tmp, 'index.html'), gen.html.replace('../tokens.css', 'tokens.css').replace('<link rel="stylesheet" href="tokens.css">', '<link rel="stylesheet" href="fonts.css">\n<link rel="stylesheet" href="tokens.css">'));
  fs.writeFileSync(path.join(tmp, 'styles.css'), gen.css);
  fs.writeFileSync(path.join(tmp, 'tokens.css'), loadTokens(tokens).css());
  const png = path.join(dir, 'frames', `${file}.png`);
  await renderPage(browser, path.join(tmp, 'index.html'), { width: w, height: h, out: png });
  // фрейм без заливки Figma выгружает с прозрачным фоном — так же и эталон
  if (!tree.fills?.length) {
    const img = PNG.sync.read(fs.readFileSync(png));
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 255 && img.data[i + 1] === 255 && img.data[i + 2] === 255) img.data[i + 3] = 0;
    fs.writeFileSync(png, PNG.sync.write(img));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
await browser.close();
console.log('Fixture готов:', dir);
