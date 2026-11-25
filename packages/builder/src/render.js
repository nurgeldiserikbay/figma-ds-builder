// Рендер сгенерированной страницы в Chromium через Playwright.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { PNG } from 'pngjs';

/**
 * Браузер: системный Chrome (channel "chrome") или путь из CHROME_PATH.
 * Отдельно скачивать Chromium не нужно.
 */
export async function openBrowser() {
  const executablePath = process.env.CHROME_PATH;
  try {
    // sRGB без управления цветом: скриншоты одинаковы на любом мониторе и совпадают с Figma
    const args = ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none',
      ...(process.env.DS_CHROME_ARGS || '').split(/\s+/).filter(Boolean)];
    if (executablePath) return await chromium.launch({ executablePath, args });
    // Google Chrome, а если его нет — Microsoft Edge (тот же Chromium, есть на любом Windows)
    let first;
    for (const channel of ['chrome', 'msedge']) {
      try { return await chromium.launch({ channel, args }); } catch (e) { first ||= e; }
    }
    throw first;
  } catch (e) {
    throw new Error(
      'Не удалось запустить браузер для проверки. Установите Google Chrome (или Microsoft Edge) либо укажите путь к нему в CHROME_PATH.\n' + e.message,
    );
  }
}

export async function renderPage(browser, htmlPath, { width, height, scale = 1, out, keepPage = false }) {
  const page = await browser.newPage({
    viewport: { width: Math.ceil(width), height: Math.ceil(height) },
    deviceScaleFactor: scale,
  });
  // файл с диска или адрес запущенного проекта (Vite, свой сервер) — тогда ждём, пока стихнет сеть
  const remote = /^https?:\/\//i.test(htmlPath);
  await page.goto(remote ? htmlPath : pathToFileURL(htmlPath).href, { waitUntil: remote ? 'networkidle' : 'load' });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => {
    // шрифты из npm разбиты на поднаборы символов (латиница, кириллица…): проверяем на тексте самой страницы,
    // иначе кириллический макет «не находит» шрифт, у которого просто не загружался латинский поднабор
    const fams = new Map();
    document.querySelectorAll('span[class^="t-"]').forEach((el) => {
      const cs = getComputedStyle(el);
      const f = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const sample = (el.textContent || '').replace(/\s+/g, '').slice(0, 40);
      if (!fams.has(f)) fams.set(f, { sample: '', font: `${cs.fontStyle} ${cs.fontWeight} 16px "${f}"` });
      const e = fams.get(f);
      if (e.sample.length < 40) e.sample += sample;
    });
    // check() == false значит «шрифт недоступен», браузер подставит запасной
    // шрифта нет ни в @font-face, ни в системе — check() всё равно true; тогда сравниваем ширину с запасными
    const faces = new Set([...document.fonts].map((f) => f.family.replace(/["']/g, '')));
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (font, text) => { ctx.font = font; return ctx.measureText(text).width; };
    const inSystem = (f, text) => ['monospace', 'serif', 'sans-serif'].some((g) => width(`16px "${f}", ${g}`, text) !== width(`16px ${g}`, text));
    return [...fams].map(([family, e]) => ({ family,
      available: faces.has(family) ? document.fonts.check(e.font, e.sample || 'a') : inSystem(family, e.sample || 'abcxyz') }));
  });
  // Геометрия каждого элемента, привязанного к слою Figma
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-figma-id]')].map((el) => {
      const r = el.getBoundingClientRect();
      // текст слоя: высота самого текста (внутренний span) — если больше блока, текст вылез за свою рамку
      const inner = el.firstElementChild && el.firstElementChild.tagName === 'SPAN' && !el.firstElementChild.dataset.figmaId ? el.firstElementChild.getBoundingClientRect() : null;
      return { id: el.dataset.figmaId, x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height, ...(inner ? { ih: inner.height } : {}) };
    }),
  );
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 0.5);
  if (out) fs.writeFileSync(out, await screenshot(page, { x: 0, y: 0, width, height }));
  if (keepPage) return { fonts, boxes, overflowX, page }; // вызывающий закроет сам (check: найти элементы по месту)
  await page.close();
  return { fonts, boxes, overflowX };
}

/**
 * Снимок области страницы. Большой кадр (длинный экран в 2x) Chromium иногда снимает дольше таймаута или
 * не снимает вовсе — тогда снимаем полосами и склеиваем. Результат тот же PNG, пиксель в пиксель.
 */
export async function screenshot(page, clip, { timeout = 60000, firstTimeout = timeout, band = 2048 } = {}) {
  const opts = { animations: 'disabled', caret: 'hide' };
  const scale = await page.evaluate(() => devicePixelRatio).catch(() => 1);
  // очень большой кадр (больше ~16 тыс. пикселей по стороне) — сразу полосами
  const huge = Math.max(clip.width, clip.height) * scale > 16000;
  if (!huge) {
    try { return await page.screenshot({ ...opts, clip, timeout: firstTimeout }); } catch (e) { if (!/Timeout|timed out/i.test(e.message)) throw e; }
  }
  const W = Math.round(clip.width * scale), H = Math.round(clip.height * scale);
  const outPng = new PNG({ width: W, height: H });
  for (let y = 0; y < clip.height; y += band) {
    const h = Math.min(band, clip.height - y);
    const part = PNG.sync.read(await page.screenshot({ ...opts, clip: { x: clip.x, y: clip.y + y, width: clip.width, height: h }, timeout }));
    const dy = Math.round(y * scale);
    const rows = Math.min(part.height, H - dy);
    PNG.bitblt(part, outPng, 0, 0, Math.min(part.width, W), rows, 0, dy);
  }
  return PNG.sync.write(outPng);
}

/**
 * Какой элемент страницы стоит на месте слоя Figma: для каждого прямоугольника (координаты макета) —
 * элемент с наибольшим перекрытием (при равенстве — более глубокий). Работает для любой вёрстки, в том числе
 * правленой вручную: служебные атрибуты не нужны. Ответ — короткий селектор вида div.card__image.
 */
export async function elementsAt(page, rects) {
  return page.evaluate((rects) => {
    const els = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'svg', 'path', 'g'].includes(e.tagName) && !(e instanceof SVGElement));
    const boxes = els.map((e) => { const r = e.getBoundingClientRect(); return { e, x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height, d: 0 }; });
    for (const b of boxes) { let d = 0; for (let p = b.e; p; p = p.parentElement) d++; b.d = d; }
    const sel = (e) => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => `.${c}`).join('');
    return rects.map((r) => {
      let best = null, score = 0;
      for (const b of boxes) {
        const ix = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x), iy = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
        if (ix <= 0 || iy <= 0) continue;
        const inter = ix * iy, iou = inter / (r.w * r.h + b.w * b.h - inter);
        if (iou > score + 1e-6 || (Math.abs(iou - score) <= 1e-6 && best && b.d > best.d)) { score = iou; best = b; }
      }
      return best && score >= 0.5 ? sel(best.e) : null;
    });
  }, rects);
}
