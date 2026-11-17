# Выпуск и публикация

Всё, что можно автоматизировать, делает workflow «Выпуск» (`.github/workflows/release.yml`).
Действия на npm и в Figma Community требуют ваших учётных записей. Их можно сделать только вручную, ниже — шаги.

## Выпуск версии

**Проще всего:** поднимите версию в `packages/builder/package.json` и `packages/desktop/package.json`, отправьте в main,
затем *Actions → «Программа с окном» → Run workflow* и введите номер версии (например `0.2.1`).
GitHub соберёт установщики для Windows, macOS и Linux, проверит каждый на тестовом макете и создаст выпуск
`v0.2.1` с установщиками и архивом плагина. Кнопки на лендинге ведут на последний выпуск.

**Через тег** (ещё и публикация в npm, если задан `NPM_TOKEN`):

1. Поднимите версию программы: в `packages/builder` выполните `npm version 0.2.1 --no-git-tag-version`.
2. Сделайте коммит и поставьте тег с той же версией:
   ```bash
   git commit -am "Версия 0.2.1"
   git tag v0.2.1
   git push && git push --tags
   ```
3. Workflow проверит, что тег совпадает с версией в `package.json`, прогонит тесты и создаст GitHub Release.
   К релизу будет приложен архив плагина `ds-builder-figma-plugin-v0.2.1.zip`.
   Если задан секрет `NPM_TOKEN`, workflow также опубликует пакет `figma-ds-build` в npm.

## npm (один раз)

1. Зарегистрируйтесь на [npmjs.com](https://www.npmjs.com) и включите двухфакторную защиту.
2. Создайте токен: *Access Tokens → Generate New Token → Granular*, право *Read and write* на пакет `figma-ds-build`.
   Пока пакета нет, выберите «All packages».
3. Добавьте токен в репозиторий: *Settings → Secrets and variables → Actions → New repository secret*, имя `NPM_TOKEN`.
4. После первого выпуска программа ставится так: `npx figma-ds-build ui` или `npm i -g figma-ds-build`.

Имя `ds-build` на npm уже занято, поэтому пакет называется `figma-ds-build`. Команда после установки — `ds-build`.

## Figma Community (вручную, из десктопной Figma)

Без публикации плагин работает так: распакуйте архив из релиза и выберите
*Plugins → Development → Import plugin from manifest*. Этого достаточно для вас и вашей команды.

Чтобы плагин находили все пользователи Figma (нужны десктопная Figma для macOS или Windows и включённая
двухфакторная защита аккаунта):

1. В десктопной Figma: *Plugins → Development → New plugin…* → создайте любой шаблон.
   Figma выдаст числовой `id`. Скопируйте его в `id` файла `packages/plugin/manifest.json` вместо `figma-ds-builder-export`,
   затем выполните `npm --prefix packages/plugin run build` и снова импортируйте плагин из `packages/plugin/dist/manifest.json`.
2. *Plugins → Development → DS Builder → Publish*. Понадобятся:
   - иконка 128×128;
   - обложка 1920×1080;
   - название, короткое описание, описание, категория (Design tools / Development);
   - контакт для поддержки.
3. Плагин не обращается к сети (`networkAccess: none`). Это стоит указать в описании: макеты не покидают компьютер.
4. Figma проверяет плагин перед публикацией. Сроки и требования смотрите в
   [правилах публикации Figma](https://help.figma.com/hc/en-us/articles/360042293394-Publish-plugins-to-the-Figma-Community).

### Готовые материалы

- Иконка и обложка: `packages/plugin/publish/icon.png` (128×128) и `cover.png` (1920×1080).
  Пересобрать: `node packages/plugin/publish/make-assets.js`.
- Короткое описание (tagline): *Макеты, токены, шрифты и стили — для вёрстки с проверкой pixel perfect.*
- Описание:

  > Плагин выгружает всё, что нужно для вёрстки: PNG каждого фрейма (эталон для сверки), дерево слоёв
  > с геометрией и Auto Layout, шрифты, переменные, стили и векторы — одним архивом. Бесплатная программа
  > figma-ds-build строит из него дизайн-систему, верстает страницы (HTML/CSS, React, Vue) и сверяет каждую
  > с макетом: положение элементов ±0.5px и попиксельно. Обратно в Figma можно импортировать найденные токены
  > как переменные и стили. Плагин не обращается к сети: макеты не покидают ваш компьютер.
