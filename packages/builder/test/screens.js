// Карта экранов: переходы из прототипа, состояния одного экрана, общий каркас (шапка / подвал), безликие имена.
import assert from 'node:assert/strict';
import { screenMap, screenMapMd, genericScreenName } from '../src/screens.js';

const T = (t, y = 0) => ({ id: `t${t}${y}`, name: 't', type: 'TEXT', x: 0, y, w: 100, h: 20, text: { characters: t } });
const header = () => ({ id: 'h', name: 'Header', type: 'FRAME', x: 0, y: 0, w: 1440, h: 80, children: [T('Логотип'), T('Тарифы'), T('Войти')] });
const footer = (y) => ({ id: 'f', name: 'Footer', type: 'FRAME', x: 0, y, w: 1440, h: 200, children: [T('© 2026', y), T('Контакты', y)] });
const frame = (id, name, page, body, link) => ({ id, name, page, width: 1440, height: 1000, tree: { id, name, type: 'FRAME', x: 0, y: 0, w: 1440, h: 1000, children: [
  header(), { id: `${id}b`, name: 'Body', type: 'FRAME', x: 0, y: 100, w: 1440, h: 600, children: body.map((t, i) => T(t, 100 + i * 30)) },
  ...(link ? [{ id: `${id}btn`, name: 'Button', type: 'FRAME', x: 0, y: 700, w: 200, h: 48, link, children: [T('Подробнее', 700)] }] : []),
  footer(800)] } });

const frames = [
  frame('1', 'Сотрудники', 'Кабинет', ['Сотрудники', 'Иван Петров', 'Мария Иванова', 'Добавить сотрудника', 'Поиск']),
  frame('2', 'Сотрудники / пусто', 'Кабинет', ['Сотрудники', 'Добавить сотрудника', 'Поиск', 'Пока никого нет']),
  frame('3', 'Desktop - 3', 'Кабинет', ['Тарифы и цены', 'Базовый', 'Про', 'Компания', 'Выбрать тариф'], { type: 'frame', id: '1' }),
];
const map = screenMap(frames);
assert.deepEqual(map.links.map((l) => [l.from, l.to, l.label]), [['3', '1', 'Подробнее']], 'переход из прототипа с текстом кнопки');
assert.equal(map.states.length, 1, 'список и пустой список — один экран в двух состояниях');
assert.equal(map.states[0].base, '1', 'основное — полное состояние');
assert.deepEqual(map.states[0].members.find((m) => m.id === '2').only, ['пока никого нет']);
assert.deepEqual(map.shells.map((s) => [s.part, s.frames.length]), [['header', 3], ['footer', 3]], 'шапка и подвал на всех трёх экранах');
const md = screenMapMd(map, (id) => frames.find((f) => f.id === id).name).join('\n');
assert.match(md, /Desktop - 3: «Подробнее» → Сотрудники/);
assert.match(md, /Сотрудники \(основное\) — ещё: Сотрудники \/ пусто \(своё: «пока никого нет»\)/);
assert.ok(genericScreenName('Desktop - 3') && genericScreenName('iPhone 14 Pro Max - 2') && genericScreenName('Frame 427') && genericScreenName('Copy'));
assert.ok(!genericScreenName('Сотрудники') && !genericScreenName('Главная — Desktop'));
console.log('карта экранов: переходы, состояния, общий каркас, безликие имена — OK');
