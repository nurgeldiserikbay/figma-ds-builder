// Карта экранов без ИИ — по данным, которые плагин уже выгружает:
//   переходы  — связи прототипа (Navigate to, Open overlay, Back/Close) с текстом кнопки;
//   состояния — экраны одной ширины на одной странице Figma почти с теми же текстами («список», «список — пусто»);
//   каркас    — одинаковая шапка / подвал (по текстам внутри) на нескольких экранах.
// Результат — screens.json и раздел в AGENTS.md: агент и разработчик видят структуру продукта, а не россыпь фреймов.
import { isGenericName } from './semantic.js';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Тексты фрейма (короткие — заголовки, кнопки, пункты меню), без чисел. */
function textsOf(n, out = new Set()) {
  if (!n || n.visible === false) return out;
  if (n.type === 'TEXT') {
    const t = norm(n.text?.characters);
    if (t && t.length <= 60 && !/^[\d\s.,:%$€₽+−-]+$/.test(t)) out.add(t);
  }
  for (const c of n.children || []) textsOf(c, out);
  return out;
}
const firstText = (n) => (n.type === 'TEXT' ? String(n.text?.characters || '').trim() : (n.children || []).filter((c) => c.visible !== false).map(firstText).find(Boolean));
const jaccard = (a, b) => {
  if (!a.size && !b.size) return 1;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};

/** Безликое имя экрана: «Frame 12», «Desktop - 3», «iPhone 14 - 2», «Copy». */
export function genericScreenName(name) {
  const s = String(name || '').trim();
  return isGenericName(s) || /^(frame|desktop|mobile|tablet|iphone|android|macbook|screen|page|artboard|экран|фрейм|страница|copy|копия)[\s\d\-–—_().,]*(\b(pro|max|plus|mini|air)\b[\s\d\-–—_().,]*)*$/i.test(s) || /^(copy|копия)( of)? /i.test(s);
}

/** Шапка и подвал верхнего уровня фрейма (как их находит семантика: у верхнего / нижнего края). */
function shellParts(tree) {
  const kids = (tree.children || []).filter((c) => c.visible !== false);
  const top = kids.find((c) => c.y - tree.y <= tree.h * 0.04 && c.h <= 220 && c.w >= tree.w * 0.6);
  const bottom = kids.find((c) => c !== top && c.y + c.h >= tree.y + tree.h - 4 && c.h <= 600 && c.w >= tree.w * 0.6);
  return { header: top, footer: bottom };
}

/**
 * @param frames [{ id, name, page, width, height, tree }]
 * @returns {{ screens, links, states, shells }}
 */
export function screenMap(frames) {
  const byId = new Map(frames.map((f) => [f.id, f]));
  const screens = frames.map((f) => ({ id: f.id, name: f.name, page: f.page || '', width: Math.round(f.width), height: Math.round(f.height), title: firstText(f.tree) || '' }));

  // переходы
  const links = [];
  for (const f of frames) {
    (function walk(n) {
      if (!n || n.visible === false) return;
      const label = (firstText(n) || n.name || '').trim().slice(0, 60);
      if (n.link && n.link.type !== 'scroll') {
        const to = n.link.id ? byId.get(n.link.id) : null;
        links.push({ from: f.id, to: to ? to.id : null, toName: to ? to.name : null, type: n.link.type, label, url: n.link.url });
      }
      for (const sg of n.text?.segments || []) if (sg.link?.id && byId.has(sg.link.id) && sg.link.id !== f.id) links.push({ from: f.id, to: sg.link.id, toName: byId.get(sg.link.id).name, type: 'frame', label: String(n.text.characters || '').slice(sg.start, sg.end).trim() });
      (n.children || []).forEach(walk);
    })(f.tree);
  }

  // состояния одного экрана: одна страница Figma, та же ширина, тексты похожи (≥ 60%), но экраны не одинаковые
  const texts = new Map(frames.map((f) => [f.id, textsOf(f.tree)]));
  const parent = new Map(frames.map((f) => [f.id, f.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i], b = frames[j];
      if ((a.page || '') !== (b.page || '') || Math.abs(a.width - b.width) > 2) continue;
      const ta = texts.get(a.id), tb = texts.get(b.id);
      if (ta.size < 3 || tb.size < 3) continue;
      if (jaccard(ta, tb) >= 0.6) parent.set(find(b.id), find(a.id));
    }
  }
  const groups = new Map();
  for (const f of frames) {
    const r = find(f.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(f);
  }
  const states = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // основной экран — с наибольшим числом текстов (полное состояние), остальные — его состояния
    const base = g.reduce((x, y) => (texts.get(y.id).size > texts.get(x.id).size ? y : x));
    const common = [...texts.get(base.id)].filter((t) => g.every((f) => texts.get(f.id).has(t)));
    states.push({
      base: base.id,
      name: base.name,
      members: g.map((f) => {
        const own = [...texts.get(f.id)].filter((t) => !common.includes(t));
        const missing = f === base ? [] : [...texts.get(base.id)].filter((t) => !texts.get(f.id).has(t));
        return { id: f.id, name: f.name, only: own.slice(0, 4), without: missing.slice(0, 4) };
      }),
    });
  }

  // общий каркас: одинаковая шапка / подвал (тот же набор текстов) у ≥ 2 экранов
  const shells = [];
  for (const part of ['header', 'footer']) {
    const by = new Map();
    for (const f of frames) {
      const n = shellParts(f.tree)[part];
      if (!n) continue;
      const t = [...textsOf(n)].sort();
      if (t.length < 2) continue;
      const key = `${Math.round(f.width / 100)}|${t.join('\u0000')}`;
      if (!by.has(key)) by.set(key, { part, texts: t.slice(0, 8), frames: [] });
      by.get(key).frames.push(f.id);
    }
    for (const s of by.values()) if (s.frames.length >= 2) shells.push(s);
  }
  return { screens, links, states, shells };
}

/** Раздел AGENTS.md: переходы, состояния, общий каркас. */
export function screenMapMd(map, nameOf = (id) => id) {
  const L = [];
  const nm = (id) => nameOf(id);
  const nav = map.links.filter((l) => l.to && (l.type === 'frame' || l.type === 'node'));
  const ovl = map.links.filter((l) => l.type === 'overlay');
  const ext = map.links.filter((l) => l.type === 'url');
  if (!nav.length && !ovl.length && !map.states.length && !map.shells.length) return L;
  L.push('', '## Карта экранов', '', 'Собрано из макета без догадок: переходы — из прототипа Figma, состояния — экраны одной страницы с почти теми же текстами, каркас — одинаковая шапка или подвал. Полные данные — `screens.json`.');
  if (nav.length) {
    L.push('', '### Переходы', '');
    const byFrom = new Map();
    for (const l of nav) { if (!byFrom.has(l.from)) byFrom.set(l.from, []); byFrom.get(l.from).push(l); }
    for (const [from, list] of byFrom) {
      const uniq = [...new Map(list.map((l) => [`${l.to}|${l.label}`, l])).values()];
      L.push(`- ${nm(from)}: ${uniq.map((l) => `«${l.label}» → ${nm(l.to)}`).join('; ')}`);
    }
  }
  if (ovl.length) L.push('', `Окна (Open overlay): ${[...new Set(ovl.map((l) => `«${l.label}» → ${l.toName || 'окно не выгружено'}`))].join('; ')}.`);
  if (ext.length) L.push('', `Внешние ссылки: ${[...new Set(ext.map((l) => `«${l.label}» → ${l.url}`))].slice(0, 20).join('; ')}.`);
  if (map.states.length) {
    L.push('', '### Состояния одного экрана', '', 'Это не разные страницы, а один экран в разных состояниях: сделай одну страницу и переключай состояние данными (пусто, загрузка, ошибка, шаг).', '');
    for (const s of map.states) {
      L.push(`- ${nm(s.base)} (основное) — ещё: ${s.members.filter((m) => m.id !== s.base).map((m) => `${nm(m.id)}${m.only.length ? ` (своё: «${m.only.join('», «')}»)` : m.without.length ? ` (нет: «${m.without.join('», «')}»)` : ''}`).join('; ')}`);
    }
  }
  if (map.shells.length) {
    L.push('', '### Общий каркас', '', 'Одинаковые шапка и подвал — один общий компонент (Layout), а не копия на каждой странице.', '');
    for (const s of map.shells) L.push(`- ${s.part === 'header' ? 'Шапка' : 'Подвал'} («${s.texts.slice(0, 4).join('», «')}»): ${s.frames.length} экранов — ${s.frames.slice(0, 8).map(nm).join(', ')}${s.frames.length > 8 ? '…' : ''}`);
  }
  return L;
}
