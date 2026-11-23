// Картинки: размер показа по макету, image-set 1x/2x в CSS. Иконки: одинаковые — один раз в спрайте страницы.
import assert from 'node:assert/strict';
import { imageUsage, applyImageSet } from '../src/images.js';
import { fillsToCss } from '../src/css.js';
import { spriteIcons } from '../src/export-html.js';

const img = (src, extra = {}) => ({ type: 'IMAGE', visible: true, src, scaleMode: 'FILL', ...extra });
const tree = { id: 'r', w: 1000, h: 800, children: [
  { id: 'a', w: 320, h: 200, fills: [img('images/photo.png')] },
  { id: 'b', w: 160, h: 100, fills: [img('images/photo.png')] },
  { id: 'c', w: 64, h: 64, fills: [img('images/tile.png', { scaleMode: 'TILE' })] },
] };
const use = imageUsage([tree]);
assert.equal(use.get('images/photo.png').boxes.length, 2, 'все места показа картинки');
assert.equal(use.get('images/photo.png').resize, true);
assert.equal(use.get('images/tile.png').resize, false, 'мозаику не уменьшаем');

applyImageSet(tree, new Map([['images/photo.png', { x1: 'images/photo.webp', x2: 'images/photo@2x.webp' }]]));
const css = fillsToCss(tree.children[0].fills, { assetUrl: (p) => `../assets/${p}` });
assert.equal(css['background-image'], 'image-set(url("../assets/images/photo.webp") 1x, url("../assets/images/photo@2x.webp") 2x)');
assert.equal(fillsToCss(tree.children[2].fills, { assetUrl: (p) => p })['background-image'], 'url("images/tile.png")', 'без замены — как было');
console.log('картинки: размер показа, image-set 1x/2x — OK');

const icon = (pre) => `<svg style="display:block;width:100%;height:100%" aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="${pre}g"/></defs><path d="M1 1h22" fill="url(#${pre}g)"/></svg>`;
const html = `<body>\n<div data-name="icon / close"><span>${icon('s1_2-')}</span></div><div data-name="icon / close"><span>${icon('s3_4-')}</span></div><div data-name="logo"><span>${icon('s5_6-').replace('M1 1', 'M2 2')}</span></div>\n</body>`;
const out = spriteIcons(html);
assert.equal((out.match(/<use href="#icon-close"\/>/g) || []).length, 2, 'одинаковые иконки — ссылки на спрайт');
assert.match(out, /<g id="icon-close"><defs><linearGradient id="icon-close-g"\/><\/defs><path d="M1 1h22" fill="url\(#icon-close-g\)"\/><\/g>/, 'в спрайте — одна копия с id по имени');
assert.match(out, /<svg [^>]*viewBox="0 0 24 24" fill="none"><use /, 'у ссылки — атрибуты корня иконки');
assert.match(out, /M2 2h22/, 'иконка, встреченная один раз, — как была');
assert.equal(spriteIcons('<body>\n<p>нет иконок</p></body>'), '<body>\n<p>нет иконок</p></body>');
console.log('иконки: одинаковые — один раз в спрайте страницы — OK');
