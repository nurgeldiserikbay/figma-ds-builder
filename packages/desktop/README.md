# DS Builder — программа с окном

Та же программа вёрстки, что и `ds-build`, но устанавливается как обычное приложение
(Windows — установщик `.exe`, macOS — `.dmg` для Apple Silicon, Linux — `.AppImage`) и включает плагин для Figma.

Для пользователя: скачайте установщик со страницы Releases репозитория.

Для разработки:

```bash
npm install
npm start                       # окно программы
npm run smoke -- путь/к/пакету.zip   # проверка без окна (как в CI)
npm run dist                    # установщик для текущей системы → release/
```

Нужен Google Chrome или Microsoft Edge: программа проверяет вёрстку в нём.
