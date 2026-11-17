// Рендер сгенерированной страницы в Chromium через Playwright.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

/**
 * Браузер: системный Chrome (channel "chrome") или путь из CHROME_PATH.
 * Отдельно скачивать Chromium не нужно.
 */
export async function openBrowser() {
  const executablePath = process.env.CHROME_PATH;
  try {
    // sRGB без управления цветом: скриншоты одинаковы на любом мониторе и совпадают с Figma
    const args = ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'];
    return await chromium.launch(executablePath ? { executablePath, args } : { channel: 'chrome', args });
  } catch (e) {
    throw new Error(
      'Не удалось запустить Chrome. Установите Google Chrome или укажите путь в переменной CHROME_PATH.\n' + e.message,
    );
  }
}

export async function renderPage(browser, htmlPath, { width, height, scale = 1, out }) {
  const page = await browser.newPage({
    viewport: { width: Math.ceil(width), height: Math.ceil(height) },
    deviceScaleFactor: scale,
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => {
    const fams = new Set();
    document.querySelectorAll('span[class^="t-"]').forEach((el) => {
      fams.add(getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim());
    });
    // check() == false значит «шрифт недоступен», браузер подставит запасной
    return [...fams].map((f) => ({ family: f, available: document.fonts.check(`16px "${f}"`) }));
  });
  // Геометрия каждого элемента, привязанного к слою Figma
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-figma-id]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.figmaId, x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    }),
  );
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  await page.close();
  return { fonts, boxes };
}
