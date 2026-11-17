// Адаптивность по макетам: фреймы одной страницы под разные ширины → одна страница с @media.
//
// На ширине каждого макета показывается точно его проверенная вёрстка; между ширинами —
// ближайший меньший макет по центру; уже самого узкого — пропорциональное уменьшение.
// Проверка: на каждой ширине — совпадение с эталоном; на промежуточных — без горизонтальной прокрутки.
import fs from 'node:fs';
import path from 'node:path';
import { className } from './semantic.js';

// границы слов через Unicode: \b в JS понимает только латиницу
const W = (alt) => new RegExp(`(?<![\\p{L}\\d])(?:${alt})(?![\\p{L}\\d])`, 'giu');
const DEVICE_MODEL = W('(?:iphone|ipad|android|pixel|galaxy|macbook|imac)(?:\\s+(?:\\d+|pro|max|plus|mini|air|ultra|large|small|medium|se|xl))*');
const DEVICE = W('desktop|laptop|tablet|mobile|phone|smartphone|web|десктоп\\p{L}*|ноутбук\\p{L}*|планшет\\p{L}*|мобильн\\p{L}*|телефон\\p{L}*|компьютер\\p{L}*|small|medium|large|xl|lg|md|sm|xs');
const WIDTH = W('\\d{3,4}\\s*(?:px|w)?');

/** Имя страницы без указания устройства и ширины (и без суффикса-номера Figma « - 1»). */
export function pageNameOf(name) {
  return String(name)
    .replace(DEVICE_MODEL, ' ').replace(DEVICE, ' ').replace(WIDTH, ' ')
    .replace(/\s+[-–—]\s*\d{1,2}\s*$/u, '')
    .replace(/[\s/|—–_:-]+$/gu, '').replace(/^[\s/|—–_:-]+/gu, '')
    .replace(/\s*[/|—–]\s*(?=[/|—–]|$)/gu, '').replace(/\s{2,}/g, ' ').trim();
}

/** Тексты фрейма — признак «это та же страница». */
export function textsOf(tree) {
  const out = new Set();
  (function walk(n) {
    if (n.type === 'TEXT' && n.text?.characters) out.add(n.text.characters.trim().toLowerCase().replace(/\s+/g, ' '));
    (n.children || []).forEach(walk);
  })(tree);
  return out;
}

// доля общих текстов (от меньшего набора): у вариантов одной страницы тексты в основном те же
function overlap(a, b) {
  if (!a || !b) return 1;
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

/**
 * @param {{ name: string, page?: string, width: number, texts?: Set<string> }[]} frames
 * @param {Record<string, string[]>} manual — { "Главная": ["Home / Desktop", "Home / Mobile"] }
 * @returns {{ name: string, members: number[] }[]} — группы из ≥2 фреймов разной ширины, по возрастанию ширины
 */
export function groupFrames(frames, manual = {}) {
  const groups = new Map();
  const taken = new Set();
  for (const [name, list] of Object.entries(manual)) {
    const members = frames.map((f, i) => (list.includes(f.name) ? i : -1)).filter((i) => i >= 0);
    members.forEach((i) => taken.add(i));
    groups.set(name, members);
  }
  frames.forEach((f, i) => {
    if (taken.has(i)) return;
    // имя фрейма — только устройство («Desktop», «iPhone 14»): страница Figma и есть имя страницы
    const base = pageNameOf(f.name) || (f.page ? pageNameOf(f.page) || f.page : '');
    if (!base) return;
    const key = `${f.page || ''}\u0000${base.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const out = [];
  for (const [key, members] of groups) {
    const widths = new Set(members.map((i) => Math.round(frames[i].width)));
    if (members.length < 2 || widths.size !== members.length) continue;
    // группа по имени — только если у макетов в основном общие тексты (ручная --group не проверяется)
    if (key.includes('\u0000') && !members.every((i) => members.every((j) => i === j || overlap(frames[i].texts, frames[j].texts) >= 0.5))) continue;
    members.sort((a, b) => frames[a].width - frames[b].width);
    const f0 = frames[members[0]];
    out.push({ name: key.includes('\u0000') ? pageNameOf(f0.name) || f0.page || 'page' : key, members });
  }
  return out;
}

/** CSS переключения: вариант i — от своей ширины до следующей (самый узкий — и ниже). */
export function responsiveCss(widths, prefix = 'bp') {
  const L = [`.${prefix} { display: none; }`, `.${prefix} > [data-figma-id] { margin-left: auto; margin-right: auto; }`];
  widths.forEach((w, i) => {
    const min = i === 0 ? null : Math.round(w);
    const max = i === widths.length - 1 ? null : Math.round(widths[i + 1]) - 0.02;
    const cond = [min !== null ? `(min-width: ${min}px)` : null, max !== null ? `(max-width: ${max}px)` : null].filter(Boolean).join(' and ');
    L.push(cond ? `@media ${cond} { .${prefix}-${i} { display: block; } }` : `.${prefix}-${i} { display: block; }`);
  });
  return L.join('\n');
}

const bodyOf = (html) => (html.match(/<body>\n?([\s\S]*?)\n?<\/body>/) || [, ''])[1];

/**
 * Пишет адаптивную страницу. variants — по возрастанию ширины: { dir, width, fluid? }.
 * fluid — взять «резиновую» версию макета (fluid.html / fluid.css рядом с index.html), иначе — фиксированную.
 */
export function writeResponsive(siteDir, group, variants) {
  const dir = `${className(group.name) || 'page'}.responsive`;
  const files = (v) => (v.fluid ? ['fluid.html', 'fluid.css'] : ['index.html', 'styles.css']);
  const base = fs.readFileSync(path.join(siteDir, variants[0].dir, 'index.html'), 'utf8');
  const head = base.slice(0, base.indexOf('<body>')).replace(/<title>[^<]*<\/title>/, `<title>${group.name.replace(/[<&]/g, '')}</title>`).replace('<link rel="stylesheet" href="styles.css">',
    variants.map((v) => `<link rel="stylesheet" href="../${v.dir}/${files(v)[1]}">`).join('\n'));
  const smallest = Math.round(variants[0].width);
  const bodies = variants.map((v, i) => `<div class="bp bp-${i}${v.fluid ? ' bp-fluid' : ''}" data-width="${Math.round(v.width)}">\n${bodyOf(fs.readFileSync(path.join(siteDir, v.dir, files(v)[0]), 'utf8'))}\n</div>`);
  const html = `${head.replace('</head>', `<style>\n${responsiveCss(variants.map((v) => v.width))}\n</style>\n</head>`)}<body>
${bodies.join('\n')}
<script>
// уже самого узкого макета (${smallest}px) — пропорциональное уменьшение, без горизонтальной прокрутки
(function () {
  var first = document.querySelector('.bp-0 > [data-figma-id]');
  function fit() { first.style.zoom = innerWidth < ${smallest} ? String(innerWidth / ${smallest}) : ''; }
  fit(); addEventListener('resize', fit);
})();
</script>
</body>
</html>
`;
  fs.mkdirSync(path.join(siteDir, dir), { recursive: true });
  fs.writeFileSync(path.join(siteDir, dir, 'index.html'), html);
  return dir;
}
