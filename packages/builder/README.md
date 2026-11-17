# figma-ds-build

Вёрстка из Figma с гарантией pixel perfect. Плагин [DS Builder](https://github.com/nurgeldiserikbay/figma-ds-builder/tree/main/packages/plugin)
выгружает архив (`… — ds-package.zip`): PNG каждого макета, дерево слоёв, шрифты, переменные, стили.
Эта программа строит из него дизайн-систему, верстает страницы (HTML/CSS, по желанию React и Vue),
сверяет каждую с макетом и дорабатывает до совпадения.

Нужны Node.js 20+ и Google Chrome (или путь к Chromium в `CHROME_PATH`).

```bash
npx figma-ds-build ui                     # окно программы в браузере
npx figma-ds-build build "Файл — ds-package.zip" --out out/site --open
npx figma-ds-build analyze "Файл — ds-package.zip" --out out/ds   # только дизайн-система
```

Или установить: `npm i -g figma-ds-build`, затем `ds-build ui`.

Что проверяется: положение и размер каждого элемента ±0.5px, пиксели вне текста ≤0.1%, пиксели текста ≤0.5%,
все видимые слои на месте. Всё работает без ИИ; `--ai` — имена классов от локальной модели (Ollama) или
бесплатных API (Groq, Gemini, OpenRouter), платные — только с `--ai-paid`.

Документация, плагин и лендинг: https://github.com/nurgeldiserikbay/figma-ds-builder
