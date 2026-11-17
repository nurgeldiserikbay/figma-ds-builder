// Иконка 128×128 и обложка 1920×1080 для публикации в Figma Community.
// Запуск: node packages/plugin/publish/make-assets.js (нужны установленные зависимости packages/builder).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openBrowser } from '../../builder/src/render.js';
import { ensureFonts, buildFontsCss, defaultCacheDir } from '../../builder/src/fonts.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const fonts = ensureFonts(['Geologica'], defaultCacheDir());
const fontCss = buildFontsCss(fonts.dir, fonts.found);
const demo = pathToFileURL(path.join(here, '..', '..', '..', 'docs', 'assets', 'demo-after.png')).href;

const base = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Geologica, system-ui, sans-serif; color: #1A2033; }
  .sel { position: absolute; border: 2px solid #0D99FF; }
  .sel i { position: absolute; width: 12px; height: 12px; background: #fff; border: 2px solid #0D99FF; }
  .sel i:nth-child(1) { left: -7px; top: -7px; } .sel i:nth-child(2) { right: -7px; top: -7px; }
  .sel i:nth-child(3) { left: -7px; bottom: -7px; } .sel i:nth-child(4) { right: -7px; bottom: -7px; }
  .dots { background: #fff radial-gradient(#E4E6EC 2px, transparent 2.2px) 0 0 / 32px 32px; }
`;

const icon = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${fontCss}${base}
  html, body { width: 128px; height: 128px; overflow: hidden; }
  .bg { position: absolute; inset: 0; background: #1A2033; border-radius: 28px; }
  .t { position: absolute; left: 0; right: 0; top: 34px; text-align: center; color: #fff; font: 700 46px/60px Geologica; letter-spacing: -1px; }
  .sel { left: 22px; top: 34px; width: 84px; height: 60px; border-width: 2px; }
  .sel i { width: 9px; height: 9px; border-width: 2px; }
  .sel i:nth-child(1) { left: -5.5px; top: -5.5px; } .sel i:nth-child(2) { right: -5.5px; top: -5.5px; }
  .sel i:nth-child(3) { left: -5.5px; bottom: -5.5px; } .sel i:nth-child(4) { right: -5.5px; bottom: -5.5px; }
</style></head><body><div class="bg"></div><div class="t">DS</div><div class="sel"><i></i><i></i><i></i><i></i></div></body></html>`;

const cover = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${fontCss}${base}
  html, body { width: 1920px; height: 1080px; overflow: hidden; }
  body { position: relative; }
  .copy { position: absolute; left: 140px; top: 250px; width: 760px; }
  h1 { position: relative; display: inline-block; font: 700 116px/1.05 Geologica; letter-spacing: -3px; padding: 6px 14px; margin-left: -14px; }
  h1 .sel { inset: 0; }
  h1 .size { position: absolute; left: 50%; bottom: -40px; transform: translateX(-50%); background: #0D99FF; color: #fff; font: 500 22px/1 Geologica; padding: 6px 12px; border-radius: 4px; letter-spacing: 0; white-space: nowrap; }
  p { margin-top: 84px; font: 400 40px/1.35 Geologica; color: #5F6577; }
  .shot { position: absolute; right: 120px; top: 170px; width: 820px; height: 740px; background: #fff; border: 1px solid #E3E5EB; box-shadow: 0 30px 80px rgba(26,32,51,.12); }
  .shot img { width: 100%; height: 100%; object-fit: cover; object-position: top left; display: block; }
  .tag { position: absolute; right: 120px; top: 930px; font: 500 28px/1 Geologica; color: #157347; }
</style></head><body class="dots">
  <div class="copy">
    <h1>DS Builder<span class="sel"><i></i><i></i><i></i><i></i></span><span class="size">pixel perfect</span></h1>
    <p>Выгружает макеты, токены, шрифты и стили для вёрстки. Программа верстает и сверяет каждую страницу с макетом.</p>
  </div>
  <div class="shot"><img src="${demo}" alt=""></div>
  <div class="tag">геометрия ±0.5px · расхождение 0.000%</div>
</body></html>`;

const browser = await openBrowser();
for (const [name, html, w, h] of [['icon', icon, 128, 128], ['cover', cover, 1920, 1080]]) {
  const file = path.join(here, `${name}.html`);
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(here, `${name}.png`), omitBackground: name === 'icon' });
  await page.close();
  fs.rmSync(file);
}
await browser.close();
console.log('Готово: icon.png (128×128), cover.png (1920×1080) →', here);
