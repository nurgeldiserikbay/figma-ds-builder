// Тексты окна программы для перевода: разметка (тем же I18N.collect, что переводит) + t('…'), tf('…'),
// названия этапов из ui.html и ошибки сервера из ui.js. node tools/app-i18n-keys.mjs > tools/app-keys.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const src = path.resolve('packages/builder/src');
const require = createRequire(path.join(src, '..', 'package.json'));
const { chromium } = require('playwright-core');
const { startUi } = await import(path.join(src, 'ui.js'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-keys-'));
const { server, url } = await startUi({ open: false, home, log: () => {}, pluginDir: home });
const b = await chromium.launch((process.env.CHROME || process.env.CHROME_PATH) ? { executablePath: process.env.CHROME || process.env.CHROME_PATH } : { channel: 'chrome' });
const p = await b.newPage();
await p.goto(url);
await p.evaluate(() => { try { localStorage.setItem('lang', 'ru'); } catch (e) {} });
await p.reload();
const page = await p.evaluate(() => [...new Set(window.I18N.collect(document).map((u) => u.key))]);
await b.close(); server.close();
const html = fs.readFileSync(path.join(src, 'ui.html'), 'utf8');
const js = fs.readFileSync(path.join(src, 'ui.js'), 'utf8');
const lit = (re, text) => [...text.matchAll(re)].map((m) => m[1].replace(/\\'/g, "'"));
const code = [
  ...lit(/\bt\('((?:[^'\\]|\\.)*)'\)/g, html),
  ...lit(/\btf\('((?:[^'\\]|\\.)*)'/g, html),
  ...lit(/text: '([^']*[А-Яа-яЁё][^']*)'/g, html),
  ...lit(/\? '(React и Vue)'/g, html),
  ...lit(/error: '([^']*[А-Яа-яЁё][^']*)'/g, js),
];
const norm = (s) => s.replace(/\s+/g, ' ').trim();
process.stdout.write(JSON.stringify([...new Set([...page, ...code].map(norm))], null, 1));
