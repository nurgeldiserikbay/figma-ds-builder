// ИИ-рецензент смысла вёрстки: алгоритм уже расставил теги (кнопки, поля, заголовки, списки), ИИ смотрит на экран
// целиком и исправляет то, что требует понимания: где кнопка, где ссылка, уровни заголовков, подписи для экранного
// диктора, понятные имена классов. Вид страницы он не меняет — только теги, атрибуты и имена. Правки проверяются:
// страница выглядит так же (сверка с макетом не хуже) и стала правильнее (проверка HTML и доступности не хуже).
import { askJson } from './ai.js';
import { className } from './semantic.js';

export const SEM_TAGS = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'a', 'ul', 'ol', 'li', 'nav', 'header', 'footer', 'main', 'section', 'article', 'aside', 'form', 'figure', 'figcaption', 'strong', 'em', 'small']);
const ROLES = new Set(['dialog', 'img', 'search', 'tab', 'tablist', 'tabpanel', 'switch', 'checkbox', 'radio', 'radiogroup', 'progressbar', 'status', 'alert', 'group', 'toolbar', 'menu', 'menuitem']);
const TYPES = { button: new Set(['button', 'submit', 'reset']), input: new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number']) };

const SYSTEM = `Ты опытный верстальщик и специалист по доступности. Вёрстка экрана уже совпадает с макетом Figma по пикселям,
но теги расставлены алгоритмом и могут быть нелогичны. Тебе дана схема экрана: каждая строка — элемент
(id, текущий тег, класс, имя слоя в Figma, компонент и его вариант, текст, размер). Исправь смысл:
- что нажимают — <button> (действие) или <a> (переход); иконка-действие без текста — button с aria-label;
- заголовки: один h1 на экран, дальше по порядку без пропусков; подписи и мелкий текст — не заголовки;
- списки одинаковых карточек/пунктов — ul > li; окно — role="dialog" с aria-label; группа вкладок — tablist/tab;
- у полей ввода (input/textarea) — тип и aria-label, если нет подписи; placeholder/value менять только местами;
- понятные имена классов вместо «frame-18952» (латиница, по смыслу: card, toolbar, upload-zone).
Не меняй то, что уже правильно. Не придумывай тексты, кроме aria-label. Только элементы из схемы.
Ответ — только JSON: {"edits": [{"id": "<id>", "tag": "<тег>", "name": "<класс>", "attrs": {"aria-label": "…"}, "why": "коротко"}]}
(поля tag, name, attrs — по необходимости).`;

const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** Схема экрана для ИИ: дерево с текущими тегами, компактно (иконки внутри не раскрываем). */
export function semanticOutline(tree, sem, { max = 260 } = {}) {
  const L = [];
  (function walk(n, depth) {
    if (n.visible === false || L.length >= max) return;
    const e = sem.get(n.id);
    const comp = n.component ? ` [${n.component.name}${Object.keys(n.component.variant || {}).length ? `: ${Object.entries(n.component.variant).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}]` : '';
    const text = n.text ? ` «${short(n.text.characters, 50)}»` : '';
    const attrs = e?.attrs ? Object.entries(e.attrs).filter(([k]) => /aria-label|type|role|placeholder|value|href/.test(k)).map(([k, v]) => ` ${k}="${short(v, 30)}"`).join('') : '';
    const link = n.link ? ' (ссылка в прототипе)' : '';
    L.push(`${'  '.repeat(depth)}${n.id} <${e?.tag || 'div'}${attrs}> .${e?.name || className(n.name)} «${short(n.name, 30)}»${comp}${text} ${Math.round(n.w)}×${Math.round(n.h)}${link}`);
    if (n.svg) return; // векторы иконки — неважны
    const kids = (n.children || []).filter((c) => c.visible !== false);
    if (kids.length && kids.every((c) => c.svg || c.type === 'VECTOR' || c.type === 'BOOLEAN_OPERATION')) return;
    kids.forEach((c) => walk(c, depth + 1));
  })(tree, 0);
  return L.join('\n');
}

/** Правки ИИ → проверенные изменения тегов/атрибутов/имён (только известные id, теги и атрибуты из белого списка). */
export function sanitizeEdits(edits, tree, sem) {
  const nodes = new Map();
  (function walk(n) { nodes.set(n.id, n); (n.children || []).forEach(walk); })(tree);
  const out = new Map();
  for (const e of edits || []) {
    const n = nodes.get(e?.id);
    if (!n) continue;
    const isRoot = n === tree; // у самого экрана — только роль (окно) и подпись, тег не меняется
    const cur = sem.get(n.id) || { tag: 'div', name: className(n.name), attrs: {} };
    const isField = cur.tag === 'input' || cur.tag === 'textarea';
    const ch = {};
    const tag = String(e.tag || '').toLowerCase().trim();
    // поля ввода строит генератор из слоя текста — их тег не меняем и в поле ничего не превращаем
    if (tag && tag !== cur.tag && !isField && !isRoot && SEM_TAGS.has(tag)) {
      if (n.type === 'TEXT' && /^(ul|ol|nav|header|footer|main|section|article|aside|form|figure)$/.test(tag)) continue;
      ch.tag = tag;
    }
    const name = e.name ? className(e.name) : '';
    if (name && name !== cur.name && name.length <= 40) ch.name = name;
    const attrs = {};
    const text = (n.text?.characters || '').replace(/\s*[|│▏]\s*$/, '').trim();
    for (const [k0, v0] of Object.entries(e.attrs || {})) {
      const k = String(k0).toLowerCase(), v = String(v0 ?? '').trim();
      if (/[<>"]/.test(v) || v.length > 80) continue;
      if (isRoot && k !== 'role' && k !== 'aria-label') continue;
      const tagNow = ch.tag || cur.tag;
      if (k === 'aria-label' && v) attrs[k] = v;
      else if (k === 'role' && ROLES.has(v) && (!isRoot || v === 'dialog')) attrs[k] = v;
      else if (k === 'type' && TYPES[tagNow]?.has(v)) attrs[k] = v;
      else if ((k === 'placeholder' || k === 'value') && isField && v === text) attrs[k] = v;
      else if (k === 'href' && tagNow === 'a' && (v === '#' || /^#[\w-]+$/.test(v))) attrs[k] = v;
    }
    if (Object.keys(attrs).length) ch.attrs = attrs;
    if (Object.keys(ch).length) out.set(n.id, { ...ch, why: short(e.why, 120), was: cur.tag, layer: n.name });
  }
  return out;
}

/** Применить правки к карте смысла (generateFrame: semEdits). Возвращает новую карту, исходную не трогает. */
export function applySemEdits(sem, tree, edits) {
  if (!edits?.size) return sem;
  const nodes = new Map();
  (function walk(n) { nodes.set(n.id, n); (n.children || []).forEach(walk); })(tree);
  const next = new Map([...sem].map(([k, v]) => [k, { ...v, attrs: v.attrs ? { ...v.attrs } : undefined }]));
  for (const k of ['anchors']) if (sem[k]) next[k] = sem[k];
  for (const [id, ch] of edits) {
    const n = nodes.get(id);
    if (!n) continue;
    const e = next.get(id) || { tag: 'div', name: className(n.name), attrs: {} };
    if (ch.tag) {
      e.tag = ch.tag;
      const attrs = { ...(e.attrs || {}) };
      if (ch.tag === 'button') attrs.type = attrs.type && TYPES.button.has(attrs.type) ? attrs.type : 'button';
      else delete attrs.type;
      if (ch.tag === 'a') attrs.href = attrs.href || '#'; else if (!ch.attrs?.href) delete attrs.href;
      if (ch.tag !== 'label') delete attrs.for;
      e.attrs = attrs;
    }
    if (ch.name) e.name = ch.name;
    if (ch.attrs) {
      const { placeholder, value, ...rest } = ch.attrs;
      e.attrs = { ...(e.attrs || {}), ...rest };
      // placeholder ↔ value: тот же текст, только другая роль
      if (placeholder !== undefined) { delete e.attrs.value; e.attrs.placeholder = placeholder; }
      if (value !== undefined) { delete e.attrs.placeholder; e.attrs.value = value; }
    }
    next.set(id, e);
  }
  return next;
}

/**
 * Проверка смысла страницы в браузере: кнопка/ссылка внутри кнопки/ссылки, поле без имени, кнопка без названия,
 * картинка без подписи, несколько h1, пропуск уровня заголовка, li вне списка. Меньше — лучше.
 */
export async function lintSemantics(page) {
  return page.evaluate(() => {
    const issues = [];
    const name = (el) => (el.getAttribute('aria-label') || '').trim() || (el.textContent || '').trim()
      || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim()) || (el.getAttribute('placeholder') || '').trim()
      || (el.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim();
    const where = (el) => el.getAttribute('data-figma-id') || el.className || el.tagName;
    document.querySelectorAll('button, a').forEach((el) => { if (el.parentElement?.closest('button, a')) issues.push(['вложенная кнопка или ссылка', where(el)]); });
    document.querySelectorAll('input, textarea, select, [role="combobox"]').forEach((el) => { if (!name(el) && !(el.value || '').trim()) issues.push(['поле без имени', where(el)]); });
    document.querySelectorAll('input, textarea').forEach((el) => { if (!(el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)))) issues.push(['поле без подписи (label или aria-label)', where(el)]); });
    document.querySelectorAll('button, a').forEach((el) => { if (!name(el)) issues.push(['кнопка или ссылка без названия', where(el)]); });
    document.querySelectorAll('[role="img"]').forEach((el) => { if (!(el.getAttribute('aria-label') || '').trim()) issues.push(['картинка без подписи', where(el)]); });
    document.querySelectorAll('[role="dialog"]').forEach((el) => { if (!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) issues.push(['окно без названия', where(el)]); });
    const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    if (hs.filter((h) => h.tagName === 'H1').length > 1) issues.push(['несколько h1', '']);
    let prev = 0;
    for (const h of hs) { const l = +h.tagName[1]; if (prev && l > prev + 1) issues.push([`пропуск уровня заголовка h${prev} → h${l}`, where(h)]); prev = l; }
    document.querySelectorAll('li').forEach((el) => { if (!/^(UL|OL|MENU)$/.test(el.parentElement?.tagName || '')) issues.push(['li вне списка', where(el)]); });
    document.querySelectorAll('ul, ol').forEach((el) => { if ([...el.children].some((c) => c.tagName !== 'LI' && c.tagName !== 'SCRIPT' && c.tagName !== 'TEMPLATE')) issues.push(['в списке не только li', where(el)]); });
    return issues.map(([what, at]) => ({ what, at: String(at).slice(0, 60) }));
  });
}

/**
 * Один экран: спросить ИИ, применить правки, проверить. regenerate(edits) — пересобрать страницу с правками и
 * вернуть { percent, geometryFailed, issues } (или откатить при rollback()).
 * @returns { before, after, edits: [...], rejected, by, issuesBefore, issuesAfter } | { error } | null
 */
export async function aiSemanticFrame({ tree, sem, base, regenerate, rollback, providers, cacheDir, log = () => {}, rounds = 2, maxSingle = 12 }) {
  let accepted = new Map();
  let cur = base; // { percent, geometryFailed, issues }
  let by = null, rejected = 0;
  const tried = [];
  for (let round = 0; round < rounds; round++) {
    const semNow = applySemEdits(sem, tree, accepted);
    const issues = cur.issues.length ? `\nНайденные проверкой проблемы: ${JSON.stringify(cur.issues.slice(0, 20))}` : '';
    const payload = `Экран «${tree.name}» ${Math.round(tree.w)}×${Math.round(tree.h)}.${issues}\nСхема:\n${semanticOutline(tree, semNow)}`
      + (tried.length ? `\nУже пробовали и откатили (не повторяй): ${JSON.stringify(tried.slice(-10))}` : '');
    const r = await askJson(providers, [{ role: 'system', content: SYSTEM }, { role: 'user', content: payload }], { cacheDir, log, what: `смысл «${tree.name}»${round ? `, раунд ${round + 1}` : ''}` });
    if (!r.parsed) { if (round === 0) return { error: (r.errors || []).join('; ') || 'ИИ не ответил' }; break; }
    by = r.by;
    const edits = sanitizeEdits(r.parsed.edits, tree, semNow);
    if (!edits.size) break;
    const all = new Map([...accepted, ...edits]);
    const next = await regenerate(all);
    const okPixels = next.percent <= cur.percent + 0.02 && next.geometryFailed <= cur.geometryFailed;
    const okLint = next.issues.length <= cur.issues.length;
    if (okPixels && okLint) { accepted = all; cur = next; }
    else {
      // вместе не прошли — пробуем по одной (одна неудачная правка не должна топить остальные)
      const bad = [];
      if (edits.size > 1 && edits.size <= maxSingle) {
        for (const [id, e] of edits) {
          const one = new Map([...accepted, [id, e]]);
          const t = await regenerate(one);
          if (t.percent <= cur.percent + 0.02 && t.geometryFailed <= cur.geometryFailed && t.issues.length <= cur.issues.length) { accepted = one; cur = t; }
          else bad.push([id, e, t.percent > cur.percent + 0.02 || t.geometryFailed > cur.geometryFailed]);
        }
      } else bad.push(...[...edits].map(([id, e]) => [id, e, !okPixels]));
      await rollback(accepted);
      rejected += bad.length;
      tried.push(...bad.map(([id, e, look]) => ({ id, tag: e.tag, name: e.name, why: look ? 'страница стала выглядеть иначе' : 'проверка HTML стала хуже' })));
      if (bad.length === edits.size) continue;
    }
    if (!cur.issues.length) break;
  }
  return { before: base.percent, after: cur.percent, issuesBefore: base.issues, issuesAfter: cur.issues, edits: [...accepted].map(([id, e]) => ({ id, ...e })), rejected, by };
}
