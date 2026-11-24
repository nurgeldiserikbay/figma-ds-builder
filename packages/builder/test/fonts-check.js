// Проверка шрифта по тексту страницы: у шрифта из npm латиница и кириллица — разные файлы (unicode-range),
// кириллический макет не должен получать ложное «шрифт не найден», а настоящий отсутствующий шрифт — должен.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBrowser, renderPage } from '../src/render.js';
import { ensureFonts, buildFontsCss, defaultCacheDir } from '../src/fonts.js';

const res = ensureFonts(['Inter'], defaultCacheDir(), {});
if (!res.found.includes('Inter')) { console.log('Шрифт Inter недоступен (нет сети) — проверка пропущена'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-check-'));
fs.writeFileSync(path.join(dir, 'fonts.css'), buildFontsCss(res.dir, ['Inter'], new Map([['inter', new Set(['400'])]])));
const page = (fam, text) => `<!doctype html><link rel="stylesheet" href="fonts.css"><body style="margin:0"><span class="t-1" style="font:400 16px '${fam}'">${text}</span></body>`;
fs.writeFileSync(path.join(dir, 'ru.html'), page('Inter', 'Смена пароля'));
fs.writeFileSync(path.join(dir, 'none.html'), page('Шрифт-которого-нет', 'Смена пароля'));
const b = await openBrowser();
const ru = await renderPage(b, path.join(dir, 'ru.html'), { width: 200, height: 40 });
assert.deepEqual(ru.fonts, [{ family: 'Inter', available: true }], 'кириллица: шрифт найден');
const none = await renderPage(b, path.join(dir, 'none.html'), { width: 200, height: 40 });
assert.equal(none.fonts[0].available, false, 'нет шрифта — так и сказано');
await b.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('Проверка шрифтов по тексту страницы — OK');
