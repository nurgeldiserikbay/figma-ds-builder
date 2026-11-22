// Тексты плагина для перевода: разметка окна (I18N.collect) + русские строки скрипта окна
// и шаблоны сообщений L('…') основного кода. node tools/plugin-i18n-keys.mjs > tools/plugin-keys.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const dir = path.resolve('packages/plugin');
const require = createRequire(path.resolve('packages/builder/package.json'));
const { chromium } = require('playwright-core');
const b = await chromium.launch((process.env.CHROME || process.env.CHROME_PATH) ? { executablePath: process.env.CHROME || process.env.CHROME_PATH } : { channel: 'chrome' });
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(dir, 'dist/ui.html')).href + '?lang=ru');
const page = await p.evaluate(() => [...new Set(window.I18N.collect(document).map((u) => u.key))]);
await b.close();
const cyr = /[А-Яа-яЁё]/;
const lits = (text) => [...text.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")).filter((x) => cyr.test(x));
const html = fs.readFileSync(path.join(dir, 'src/ui.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>'));
const code = ['main.js', 'export-package.js', 'import-tokens.js'].flatMap((f) =>
  fs.readFileSync(path.join(dir, 'src', f), 'utf8').split('\n').filter((l) => /\bL\(|throw new Error\('/.test(l) && !/^\s*(\/\/|\*)/.test(l)).flatMap(lits));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
process.stdout.write(JSON.stringify([...new Set([...page, ...lits(script), ...code].map(norm))], null, 1));
