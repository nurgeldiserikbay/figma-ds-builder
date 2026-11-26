// ИИ-рецензент смысла: правки тегов/подписей/имён проходят белый список; принимаются, только если страница
// выглядит так же и проверка HTML не хуже; вредная правка (кнопка в кнопке) откатывается.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sanitizeEdits, applySemEdits, semanticOutline, aiSemanticFrame, lintSemantics } from '../src/ai-semantic.js';
import { generateFrame } from '../src/generate.js';
import { openBrowser, renderPage } from '../src/render.js';
import { comparePng } from '../src/diff.js';

const fill = (r, g, b) => [{ type: 'SOLID', visible: true, color: { r, g, b, a: 1 } }];
const seg = (n, size = 16) => ({ start: 0, end: n, fontFamily: 'Arial', fontSize: size, fontWeight: 400, lineHeight: { unit: 'PIXELS', value: size + 6 }, fills: fill(0.1, 0.1, 0.1) });
const text = (id, chars, x, y, w, size = 16) => ({ id, name: id, type: 'TEXT', x, y, w, h: size + 6, visible: true, text: { characters: chars, autoResize: 'WIDTH_AND_HEIGHT', segments: [seg(chars.length, size)] } });
const card = (id, y) => ({ id, name: 'Frame 680', type: 'FRAME', x: 24, y, w: 300, h: 40, visible: true, fills: fill(0.95, 0.95, 0.95), radius: [8, 8, 8, 8],
  children: [text(`${id}t`, `Пункт ${id}`, 36, y + 9, 120)] });
const tree = { id: 'r', name: 'Окно', type: 'FRAME', x: 0, y: 0, w: 360, h: 260, visible: true, fills: fill(1, 1, 1), children: [
  text('h', 'Настройки', 24, 20, 200, 24),
  text('s', 'Раздел', 24, 60, 100, 20),
  { id: 'g', name: 'Frame 18952', type: 'FRAME', x: 0, y: 100, w: 360, h: 150, visible: true, children: [card('c1', 100), card('c2', 150), card('c3', 200)] },
] };

// белый список
const g0 = generateFrame(tree, { mode: 'absolute', assetUrl: (r) => r, title: 'T' });
const sem = g0.sem;
const ed = sanitizeEdits([
  { id: 's', tag: sem.get('s').tag, why: 'уже так' },  // без изменений — не правка
  { id: 'r', tag: 'button', attrs: { role: 'dialog', 'aria-label': 'Настройки', type: 'x' } }, // корень: тег — нельзя, окно — можно
  { id: 'h', tag: 'script' },                       // тег не из списка
  { id: 'g', name: 'Settings list', attrs: { onclick: 'x()', role: 'group', 'aria-label': 'Список "x"' } },
  { id: 'c1t', tag: 'ul' },                         // текст списком быть не может
  { id: 'zz', tag: 'p' },
], tree, sem);
assert.deepEqual([...ed.keys()], ['r', 'g']);
assert.deepEqual(ed.get('r'), { attrs: { role: 'dialog', 'aria-label': 'Настройки' }, why: '', was: sem.get('r')?.tag || 'div', layer: 'Окно' });
assert.equal(ed.get('g').name, 'settings-list');
assert.deepEqual(ed.get('g').attrs, { role: 'group' }, 'onclick и кавычки — нельзя');
const s2 = applySemEdits(sem, tree, new Map([['c1', { tag: 'button' }], ['c2', { tag: 'a' }]]));
assert.deepEqual(s2.get('c1').attrs, { type: 'button' });
assert.equal(s2.get('c2').attrs.href, '#');
assert.notEqual(sem.get('c1')?.tag, 'button', 'исходная карта не меняется');
assert.match(semanticOutline(tree, sem), /c1t <\w+> .*«Пункт c1»/);

// сквозная проверка с заглушкой ИИ: раунд 1 — вредная правка (группа-кнопка вокруг кнопок), раунд 2 — правильная
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisem-'));
let n = 0;
const ai = await new Promise((ok) => {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const edits = n++ === 0
        ? [{ id: 'c1', tag: 'button' }, { id: 'g', tag: 'button', why: 'плохо' }]
        : [{ id: 's', tag: 'h2', why: 'подзаголовок' }, { id: 'g', tag: 'ul', name: 'settings list' }, { id: 'c1', tag: 'li' }, { id: 'c2', tag: 'li' }, { id: 'c3', tag: 'li' }];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ edits }) } }] }));
    });
  }).listen(0, '127.0.0.1', () => ok(srv));
});
const browser = await openBrowser();
try {
  const htmlP = path.join(dir, 'index.html'), cssP = path.join(dir, 'styles.css');
  const write = (edits) => { const g = generateFrame(tree, { mode: 'absolute', assetUrl: (r) => r, title: 'T', semEdits: edits }); fs.writeFileSync(htmlP, g.html); fs.writeFileSync(cssP, g.css); };
  write(null);
  await renderPage(browser, htmlP, { width: 360, height: 260, out: path.join(dir, 'reference.png') });
  const measure = async () => {
    const re = await renderPage(browser, htmlP, { width: 360, height: 260, out: path.join(dir, 'render.png'), keepPage: true });
    const issues = await lintSemantics(re.page); await re.page.close();
    return { percent: comparePng(path.join(dir, 'reference.png'), path.join(dir, 'render.png'), path.join(dir, 'diff.png')).percent, geometryFailed: 0, issues };
  };
  const base = await measure();
  const r = await aiSemanticFrame({ tree, sem, base, regenerate: async (e) => { write(e); return measure(); }, rollback: async (e) => { write(e); await measure(); },
    providers: [{ name: 'Тест', model: 'm', url: `http://127.0.0.1:${ai.address().port}/v1` }] });
  assert.equal(r.rejected, 2, 'кнопка в кнопке — откат');
  assert.ok(r.edits.some((e) => e.id === 'g' && e.name === 'settings-list'), 'имя класса принято');
  assert.ok(r.after <= 0.02, `вид не изменился: ${r.after}`);
  const html = fs.readFileSync(htmlP, 'utf8');
  assert.match(html, /<ul class="settings-list/);
  assert.match(html, /<h2[^>]*data-figma-id="s"/);
  assert.doesNotMatch(html, /<button/);
} finally { await browser.close(); ai.close(); }
console.log('ИИ-рецензент смысла: белый список, сверка вида и HTML, откат — OK');
