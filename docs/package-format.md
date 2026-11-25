# Формат пакета `ds-package` v1

Пакет — это папка (или `.zip` с ней), которую плагин Figma отдаёт локальной программе.
В нём всё, что нужно для вёрстки и проверки: дерево слоёв каждого фрейма, эталонные PNG,
векторы, картинки и токены дизайн-системы.

```
package/
├── manifest.json          — описание пакета (обязательно)
├── tokens.json            — токены DTCG из анализа дизайн-системы (необязательно)
├── analysis.json          — полный анализ плагина (необязательно)
├── fonts.json             — шрифты, используемые в выгруженных фреймах (семейство, начертание, кегли)
├── variables.json         — локальные переменные: коллекции, режимы, значения, алиасы
├── styles.json            — локальные стили: цвета, текст, эффекты
├── components.json        — описания компонентов (Description), если есть: [{ "name": "Button", "description": "…" }]
├── frames/
│   ├── <id>.json          — дерево слоёв фрейма
│   └── <id>.png           — эталонный рендер фрейма из Figma (exportAsync PNG)
├── vectors/<id>.svg       — векторные слои (exportAsync SVG)
└── images/<hash>.<ext>    — растровые заливки (getImageByHash → getBytesAsync)
```

PNG фрейма выгружается строго в границах фрейма (`useAbsoluteBounds`), даже если содержимое выступает.
Картинки в браузере показываются без цветового профиля — как в Figma по умолчанию.

ID узлов Figma содержат `:` и `;` — в именах файлов они заменяются на `_`.

## manifest.json

```json
{
  "format": "ds-package",
  "version": 1,
  "file": "Название файла Figma",
  "createdAt": "2026-11-17T10:00:00Z",
  "scale": 1,
  "tokens": "tokens.json",
  "components": "components.json",
  // время этапов выгрузки, мс (для поиска медленного): дерево, имена, PNG, SVG, картинки; пять самых долгих фреймов
  "timing": { "tree": 0, "names": 0, "png": 0, "svg": 0, "svgExported": 0, "svgCached": 0, "images": 0,
    "slowest": [{ "name": "Home", "ms": 0, "layers": 0, "vectors": 0 }] },
  "frames": [
    { "id": "12:34", "name": "Home / Desktop", "page": "Landing",
      "width": 1440, "height": 3200,
      "tree": "frames/12_34.json", "png": "frames/12_34.png" }
  ]
}
```

`scale` — во сколько раз эталонные PNG больше макета (1 или 2). Программа рендерит вёрстку
с тем же `deviceScaleFactor`.

## Узел дерева

Все координаты — в пикселях макета **относительно левого верхнего угла корневого фрейма**
(не родителя). Так генератору не нужно пересчитывать трансформации.

```jsonc
{
  "id": "12:40",
  "name": "Button / Primary",
  "type": "FRAME",            // FRAME | GROUP | SECTION | COMPONENT | INSTANCE | RECTANGLE |
                              // ELLIPSE | LINE | VECTOR | BOOLEAN_OPERATION | STAR | POLYGON | TEXT
  "x": 120, "y": 640, "w": 160, "h": 48,
  "rotation": 0,              // градусы, справочно
  // повёрнутый или отражённый слой (матрица не единичная):
  //   x,y,w,h — видимая рамка (по ней раскладка и проверка геометрии),
  //   "size": { "w": 96, "h": 32 } — исходный размер,
  //   "transform": [[a, c, tx], [b, d, ty]] — матрица Figma (absoluteTransform) относительно фрейма.
  //   Дети повёрнутого слоя несут свои абсолютные матрицы.
  "visible": true,
  "opacity": 1,
  "blendMode": "NORMAL",
  "clipsContent": false,
  "isMask": false,            // маска обрезает слои, лежащие над ней в том же родителе (форма, скругление или SVG)

  "fills":   [ /* Paint, снизу вверх, как в Figma */ ],
  "strokes": [ /* Paint */ ],
  "strokeWeight": 1,          // или [top, right, bottom, left]
  "strokeAlign": "INSIDE",    // INSIDE | CENTER | OUTSIDE
  "radius": [8, 8, 8, 8],     // top-left, top-right, bottom-right, bottom-left
  "effects": [
    { "type": "DROP_SHADOW", "x": 0, "y": 4, "blur": 12, "spread": 0,
      "color": { "r": 0, "g": 0, "b": 0, "a": 0.12 } }
    // INNER_SHADOW | LAYER_BLUR { radius } | BACKGROUND_BLUR { radius }
  ],

  // Auto Layout (если есть)
  "layout": {
    "mode": "HORIZONTAL",     // HORIZONTAL | VERTICAL | NONE (GRID — пока как NONE)
    "gap": 8,                 // itemSpacing; "auto" для SPACE_BETWEEN
    "padding": [12, 24, 12, 24],
    "primaryAlign": "CENTER", // MIN | CENTER | MAX | SPACE_BETWEEN
    "counterAlign": "CENTER", // MIN | CENTER | MAX | BASELINE
    "wrap": false,
    "counterGap": 0,
    "strokesIncluded": true   // обводка занимает место в раскладке (strokesIncludedInLayout): дети сдвинуты на её толщину.
                              // Нет поля (старые пакеты) — программа понимает это по положению детей
  },
  // переменные Figma, привязанные к свойствам слоя (имена переменных; и локальные, и из библиотеки)
  "vars": { "gap": "space/md", "counterGap": "space/md",
            "padding": ["space/sm", "space/lg", "space/sm", "space/lg"],   // null — сторона без переменной
            "radius": ["radius/md", "radius/md", "radius/md", "radius/md"],
            "strokeWeight": ["stroke/thin", "stroke/thin", "stroke/thin", "stroke/thin"],
            "opacity": "opacity/muted", "width": "size/icon", "height": "size/icon" },
  "effectStyle": "Shadow/Card", // стиль эффекта Figma, если подключён
  "fillStyle": "Brand/Accent",  // цветовой стиль (Color style) на заливке
  "strokeStyle": "Brand/Line",  // цветовой стиль на обводке
  "modes": { "Color": "Dark" }, // режим переменных, выбранный на слое (коллекция → режим)
  // переход из прототипа по нажатию (On click / On press), если есть:
  //   { "type": "url", "url": "https://…", "newTab": true } — Open link
  //   { "type": "frame", "id": "4:3" }  — Navigate to (верхний фрейм)
  //   { "type": "scroll", "id": "7:12" } — Scroll to (слой на той же странице)
  //   { "type": "overlay", "id": "8:1" } — Open overlay (окно — верхний фрейм)
  //   { "type": "back" }                 — Back
  //   { "type": "close" }                — Close overlay
  // программа делает из слоя ссылку <a href>; наведение и Change to не берутся
  "link": { "type": "frame", "id": "4:3" },
  // свойства компонента у копии (кроме вариантов): { "Label": { "type": "TEXT", "value": "Купить" }, "Show icon": { "type": "BOOLEAN", "value": true }, "Icon": { "type": "INSTANCE_SWAP" } }
  //   — в "component": { "name", "variant", "props" }
  // слой связан со свойством компонента: что задаёт свойство (текст, показ, замену)
  "propRefs": { "characters": "Label", "visible": "Show icon", "mainComponent": "Icon" },
  // аннотации Dev Mode на слое: текст и отмеченные свойства (если есть)
  "notes": [{ "text": "Поле обязательное" }, { "text": "", "properties": ["width"] }],
  // как узел ведёт себя внутри Auto Layout родителя
  "layoutPositioning": "AUTO",          // AUTO | ABSOLUTE
  "sizing": { "h": "FIXED", "v": "HUG" }, // FIXED | HUG | FILL
  "dashPattern": [4, 4],                // пунктир обводки (длины штриха и промежутка), если есть
  "constraints": { "h": "STRETCH", "v": "MIN" }, // MIN | CENTER | MAX | STRETCH | SCALE — поведение при растяжении родителя

  // только для TEXT
  "text": {
    "characters": "Купить",
    "align": "CENTER",        // LEFT | CENTER | RIGHT | JUSTIFIED
    "verticalAlign": "CENTER",// TOP | CENTER | BOTTOM
    "autoResize": "WIDTH_AND_HEIGHT", // NONE | HEIGHT | WIDTH_AND_HEIGHT | TRUNCATE
    "truncation": "ENDING",            // «Truncate text» — многоточие в конце (нет поля — не обрезается)
    "maxLines": 3,                      // число строк при обрезке, если задано в Figma
    "segments": [
      { "start": 0, "end": 6,
        "fontFamily": "Inter", "fontStyle": "Semi Bold", "fontWeight": 600,
        "fontSize": 16,
        "lineHeight": { "unit": "PIXELS", "value": 24 },   // PIXELS | PERCENT | AUTO
        "letterSpacing": { "unit": "PIXELS", "value": 0 }, // PIXELS | PERCENT
        "textDecoration": "NONE", "textCase": "ORIGINAL",
        "fills": [ /* Paint */ ],
        "textStyle": "Body/Medium",   // текстовый стиль Figma, если подключён
        "fillStyle": "Brand/Accent",  // цветовой стиль на тексте
        "vars": { "fontSize": "size/body", "lineHeight": "…", "letterSpacing": "…", "fontFamily": "…", "fontWeight": "…" },
        "link": { "type": "url", "url": "https://…" } } // ссылка на части текста (Link): url или { "type": "node", "id": "4:3" }
    ]
  },

  "svg": "vectors/12_41.svg", // для векторов, булевых операций и иконок
  "svgBox": { "x": -2, "y": -2, "w": 28, "h": 28 }, // рамка SVG относительно видимой рамки слоя, если рисунок шире (обводки снаружи)
  "svgSpace": "box",          // "box" — SVG уже отрисован с поворотом (плагин); по умолчанию — в системе координат слоя
  "component": { "name": "Button", "mainId": "5:10", "variant": { "State": "Default" } },
  "children": []
}
```

### Paint

```jsonc
{ "type": "SOLID", "color": { "r": 0.23, "g": 0.51, "b": 0.96, "a": 1 }, "opacity": 1, "visible": true,
  "variable": "color/bg/accent" }  // имя локальной переменной, если цвет к ней привязан
{ "type": "GRADIENT_LINEAR", "css": "linear-gradient(90deg, #3B82F6 0%, #8B5CF6 100%)", "opacity": 1,
  "stopVariables": ["brand/blue", null] }  // переменные на точках градиента (по порядку), если есть
{ "type": "IMAGE", "src": "images/ab12cd.png", "scaleMode": "FILL", "opacity": 1 }  // FILL | FIT | CROP | TILE
{ "type": "IMAGE", "src": "images/cd34ef.png", "scaleMode": "CROP",
  "imageTransform": [[0.5, 0, 0.25], [0, 0.6, 0.1]] }  // Crop: видимая часть в долях картинки (x от 0.25 до 0.75…)
{ "type": "IMAGE", "src": "images/ef56ab.png", "scaleMode": "TILE", "scalingFactor": 0.5 }  // масштаб плитки
```

Цвета — в диапазоне 0..1, как в Figma API. В `variables.json` у переменной есть `codeSyntax`
(Code syntax из Figma, например `{ "WEB": "var(--bg-accent)" }`) — по нему программа называет CSS-переменные.
Переменные и стили из подключённых библиотек плагин называет так же, как локальные: в `variables.json` они
лежат коллекциями с `"remote": true` (вместе с переменными, на которые ссылаются), в `styles.json` — с `"remote": true`.
Если библиотека недоступна (нет доступа), остаётся значение без имени. Градиенты плагин сразу переводит в CSS
(в анализаторе это уже есть).

## Что программа делает с пакетом

1. Читает `manifest.json`, для каждого фрейма — дерево и эталон.
2. Генерирует HTML/CSS (`--layout flow` — flex по Auto Layout и геометрии, `--layout absolute` —
   абсолютное позиционирование, точный запасной вариант).
3. Подставляет токены: цвет, совпавший со значением токена, пишется как `var(--color-…)`.
4. Рендерит страницу в Chromium с размером фрейма и `deviceScaleFactor = scale`.
5. Сравнивает с эталоном попиксельно, пишет `diff.png` и отчёт.
