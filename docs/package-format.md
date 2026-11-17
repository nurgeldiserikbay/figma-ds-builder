# Формат пакета `ds-package` v1

Пакет — это папка (или `.zip` с ней), которую плагин Figma отдаёт локальной программе.
В нём всё, что нужно для вёрстки и проверки: дерево слоёв каждого фрейма, эталонные PNG,
векторы, картинки и токены дизайн-системы.

```
package/
├── manifest.json          — описание пакета (обязательно)
├── tokens.json            — токены DTCG из анализа дизайн-системы (необязательно)
├── analysis.json          — полный анализ плагина (необязательно)
├── frames/
│   ├── <id>.json          — дерево слоёв фрейма
│   └── <id>.png           — эталонный рендер фрейма из Figma (exportAsync PNG)
├── vectors/<id>.svg       — векторные слои (exportAsync SVG)
└── images/<hash>.<ext>    — растровые заливки (getImageByHash → getBytesAsync)
```

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
  "rotation": 0,              // градусы; ≠0 → программа ставит слой absolute
  "visible": true,
  "opacity": 1,
  "blendMode": "NORMAL",
  "clipsContent": false,
  "isMask": false,

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
    "counterGap": 0
  },
  // как узел ведёт себя внутри Auto Layout родителя
  "layoutPositioning": "AUTO",          // AUTO | ABSOLUTE
  "sizing": { "h": "FIXED", "v": "HUG" }, // FIXED | HUG | FILL

  // только для TEXT
  "text": {
    "characters": "Купить",
    "align": "CENTER",        // LEFT | CENTER | RIGHT | JUSTIFIED
    "verticalAlign": "CENTER",// TOP | CENTER | BOTTOM
    "autoResize": "WIDTH_AND_HEIGHT", // NONE | HEIGHT | WIDTH_AND_HEIGHT | TRUNCATE
    "segments": [
      { "start": 0, "end": 6,
        "fontFamily": "Inter", "fontStyle": "Semi Bold", "fontWeight": 600,
        "fontSize": 16,
        "lineHeight": { "unit": "PIXELS", "value": 24 },   // PIXELS | PERCENT | AUTO
        "letterSpacing": { "unit": "PIXELS", "value": 0 }, // PIXELS | PERCENT
        "textDecoration": "NONE", "textCase": "ORIGINAL",
        "fills": [ /* Paint */ ] }
    ]
  },

  "svg": "vectors/12_41.svg", // для векторов, булевых операций и иконок
  "component": { "name": "Button", "mainId": "5:10", "variant": { "State": "Default" } },
  "children": []
}
```

### Paint

```jsonc
{ "type": "SOLID", "color": { "r": 0.23, "g": 0.51, "b": 0.96, "a": 1 }, "opacity": 1, "visible": true }
{ "type": "GRADIENT_LINEAR", "css": "linear-gradient(90deg, #3B82F6 0%, #8B5CF6 100%)", "opacity": 1 }
{ "type": "IMAGE", "src": "images/ab12cd.png", "scaleMode": "FILL", "opacity": 1 }  // FILL | FIT | CROP | TILE
```

Цвета — в диапазоне 0..1, как в Figma API. Градиенты плагин сразу переводит в CSS
(в анализаторе это уже есть).

## Что программа делает с пакетом

1. Читает `manifest.json`, для каждого фрейма — дерево и эталон.
2. Генерирует HTML/CSS (`--layout flow` — flex по Auto Layout и геометрии, `--layout absolute` —
   абсолютное позиционирование, точный запасной вариант).
3. Подставляет токены: цвет, совпавший со значением токена, пишется как `var(--color-…)`.
4. Рендерит страницу в Chromium с размером фрейма и `deviceScaleFactor = scale`.
5. Сравнивает с эталоном попиксельно, пишет `diff.png` и отчёт.
