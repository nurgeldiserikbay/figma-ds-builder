// Выгружает переводимые тексты страницы тем же I18N.collect(), что и переводит её.
// node tools/i18n-keys.mjs docs/index.html > keys.json   (браузер — как у ds-build)
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(path.resolve('packages/builder/package.json'));
const { chromium } = require('playwright-core');
const file = path.resolve(process.argv[2]);
const extra = process.argv[3] ? JSON.parse(await (await import('node:fs')).promises.readFile(process.argv[3], 'utf8')) : [];
const opts = (process.env.CHROME || process.env.CHROME_PATH) ? { executablePath: process.env.CHROME || process.env.CHROME_PATH } : { channel: 'chrome' };
const b = await chromium.launch(opts);
const p = await b.newPage();
await p.goto(pathToFileURL(file).href + '?lang=ru');
const keys = await p.evaluate(() => [...new Set(window.I18N.collect(document).map((u) => u.key))]);
await b.close();
process.stdout.write(JSON.stringify([...new Set([...keys, ...extra])], null, 1));
