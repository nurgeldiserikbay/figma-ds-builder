// Анализ макета для дизайнера: что в файле Figma мешает хорошей вёрстке и что добавить.
// Только по выгрузке плагина — без вёрстки и браузера, за секунды. Разделы совпадают с памяткой
// (docs/designer-guide.md): у каждого замечания — ссылка на то, как сделать правильно.
import fs from 'node:fs';
import path from 'node:path';
import { isGenericName } from './semantic.js';
import { groupFrames, textsOf } from './responsive.js';
import { mdToHtml } from './md.js';

const CONTAINER = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE', 'ELLIPSE']);
const visible = (n) => n && n.visible !== false;
const kids = (n) => (n.children || []).filter(visible);
const area = (n) => (n.w || 0) * (n.h || 0);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const hasPaint = (n) => (n.fills || []).some((f) => f.visible !== false) || (n.strokes || []).length || (n.effects || []).length;

/** Обход с путём: «Экран / Блок / Слой». В экземпляры компонентов не заходим — их устройство правится в компоненте. */
function walk(tree, frameName, fn) {
  (function go(n, trail, inInstance) {
    fn(n, trail, inInstance);
    if (!n.children) return;
    for (const c of n.children) go(c, [...trail, c.name], inInstance || n.type === 'INSTANCE');
  })(tree, [frameName], false);
}
const where = (trail) => trail.slice(0, 1).concat(trail.length > 4 ? ['…', ...trail.slice(-2)] : trail.slice(1)).join(' / ');

function examples(list, n = 5) {
  return list.sort((a, b) => b.area - a.area).slice(0, n).map((x) => x.where);
}

/** Подпись строения блока: одинаковые подписи у нескольких блоков — повтор, который стоит сделать компонентом. */
function signature(n, depth = 0) {
  const k = kids(n);
  const own = `${n.type}:${n.layout?.mode || '-'}:${k.length}`;
  if (depth >= 2 || !k.length) return own;
  return `${own}(${k.map((c) => signature(c, depth + 1)).join(',')})`;
}

/**
 * Ряды Auto Layout без переноса, которые не поместятся на более узком экране (targetW): ширина детей, которые
 * не тянутся (Fixed/Hug), плюс промежутки и отступы — больше места, которое останется у ряда. Ряд считаем
 * «резиновым»: он теряет столько же, сколько страница (frameW − targetW), или сжимается пропорционально.
 */
export function squeezedRows(tree, frameW, targetW) {
  const out = [];
  const lose = frameW - targetW;
  if (lose <= 0) return out;
  (function go(n, trail) {
    if (!visible(n)) return;
    const k = kids(n).filter((c) => c.layoutPositioning !== 'ABSOLUTE');
    if (n.layout?.mode === 'HORIZONTAL' && !n.layout.wrap && k.length >= 2 && n !== tree) {
      const pad = n.layout.padding || [0, 0, 0, 0];
      const gap = typeof n.layout.gap === 'number' ? n.layout.gap : 0;
      const need = pad[1] + pad[3] + gap * (k.length - 1) + k.reduce((s, c) => s + (c.sizing?.h === 'FILL' ? 0 : c.w), 0);
      // ряд теряет столько же, сколько страница, или сжимается пропорционально (блок по центру) — что больше
      const room = Math.max(n.w - lose, (n.w * targetW) / frameW);
      if (need > room + 1 && k.some((c) => c.w >= 120)) out.push({ where: where(trail), area: area(n), need: Math.round(need), room: Math.max(0, Math.round(room)) });
      return; // вложенные ряды сожмутся вместе с этим — достаточно внешнего
    }
    if (n.type === 'INSTANCE') return;
    for (const c of n.children || []) go(c, [...trail, c.name]);
  })(tree, [tree.name]);
  return out.sort((a, b) => b.area - a.area);
}

/**
 * @param pkg пакет (loadPackage)
 * @param ds  результат analyzeDesignSystem — для цветов, шрифтов, отступов, контраста
 */
export function auditDesign(pkg, ds, extra = {}) {
  const frames = pkg.frames.map((f) => ({ name: f.name, page: f.page, width: f.width, height: f.height, tree: f.tree() })).filter((f) => f.tree);
  const readJson = (rel) => { const p = rel && path.join(pkg.dir, rel); return p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  const variables = readJson(pkg.manifest.variables || 'variables.json');
  const styles = readJson(pkg.manifest.styles || 'styles.json');
  const fonts = readJson(pkg.manifest.fonts || 'fonts.json');

  const S = {
    containers: 0, noLayout: [], groups: [], spacers: [], hidden: 0, empty: [], masks: 0,
    named: 0, generic: [], copies: [], instances: 0, variantProps: new Map(), buttons: [], buttonsWithState: 0,
    repeats: new Map(), texts: 0, lhAuto: 0, textNoStyle: 0, effects: new Map(), illustrations: [], families: new Set(),
  };

  for (const f of frames) {
    if (/\b(copy|копия)\b/i.test(f.name)) S.copies.push(f.name);
    walk(f.tree, f.name, (n, trail, inInstance) => {
      if (!visible(n)) { S.hidden++; return; }
      const w = { where: where(trail), area: area(n) };
      if (n.isMask) S.masks++;
      if (n.type === 'TEXT') {
        S.texts++;
        const segs = n.text?.segments || [];
        if (segs.some((s) => s.lineHeight?.unit === 'AUTO')) S.lhAuto++;
        segs.forEach((s) => s.fontFamily && S.families.add(s.fontFamily));
        return;
      }
      for (const e of n.effects || []) if (e.visible !== false) S.effects.set(e.type, (S.effects.get(e.type) || 0) + 1);
      if (n.type === 'INSTANCE') {
        S.instances++;
        const v = n.component?.variant;
        if (v) for (const [k, val] of Object.entries(v)) {
          if (!S.variantProps.has(k)) S.variantProps.set(k, new Set());
          S.variantProps.get(k).add(String(val));
        }
        if (/button|btn|кнопк/i.test(`${n.name} ${n.component?.name || ''}`)) {
          S.buttons.push(w);
          if (v && Object.keys(v).some((k) => /state|состояни/i.test(k))) S.buttonsWithState++;
        }
      }
      if (inInstance) return;
      const k = kids(n);
      if (n.type === 'GROUP' && k.length >= 2) S.groups.push(w);
      if ((CONTAINER.has(n.type) || n.type === 'GROUP') && k.length >= 2 && n !== f.tree) {
        S.named++;
        if (isGenericName(n.name)) S.generic.push(w);
      }
      if (CONTAINER.has(n.type) && n.type !== 'INSTANCE') {
        const flow = k.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
        if (flow.length >= 2) {
          S.containers++;
          if (!n.layout) S.noLayout.push(w);
        }
        if (!k.length && !hasPaint(n) && n !== f.tree) S.empty.push(w);
        if (n.layout && flow.length >= 2) {
          // пустые прямоугольники/фреймы внутри Auto Layout — распорки вместо gap/padding
          for (const c of flow) if ((c.type === 'RECTANGLE' || (c.type === 'FRAME' && !kids(c).length)) && !hasPaint(c)) S.spacers.push({ where: where([...trail, c.name]), area: area(c) });
        }
      }
      // иллюстрация из множества векторов — лучше картинкой
      if (k.length && n !== f.tree) {
        let vec = 0, txt = 0;
        (function cnt(m) { for (const c of kids(m)) { if (VECTORISH.has(c.type)) vec++; if (c.type === 'TEXT') txt++; cnt(c); } })(n);
        if (vec >= 40 && !txt && !(trail.length > 1 && S.illustrations.some((x) => w.where.startsWith(x.where)))) S.illustrations.push({ ...w, vec });
      }
      // повторы: одинаковое строение, не экземпляр компонента
      if (n.type !== 'INSTANCE' && k.length >= 2 && n !== f.tree) {
        const sig = signature(n);
        if (sig.length > 30) {
          const r = S.repeats.get(sig) || { count: 0, where: [], name: n.name };
          r.count++;
          if (r.where.length < 3) r.where.push(w.where);
          S.repeats.set(sig, r);
        }
      }
    });
  }

  const sections = [];
  const sec = (id, title, guide, status, summary, items = []) => sections.push({ id, title, guide, status, summary, items });

  // 1. Auto Layout
  const nl = pct(S.noLayout.length, S.containers);
  sec('autolayout', 'Auto Layout', '1-auto-layout-везде-где-элементы-выстроены-в-ряд-или-колонку',
    nl <= 20 ? 'ok' : nl <= 50 ? 'warn' : 'bad',
    S.containers ? `Без Auto Layout ${S.noLayout.length} из ${S.containers} блоков с несколькими элементами (${nl}%).` : 'Блоков с несколькими элементами нет.',
    [
      S.noLayout.length && { text: 'Самые крупные блоки без Auto Layout — с них начать:', examples: examples(S.noLayout) },
      S.spacers.length && { text: `Пустые прямоугольники-распорки внутри Auto Layout: ${S.spacers.length}. Отступы лучше задать через padding и gap.`, examples: examples(S.spacers, 3) },
    ].filter(Boolean));

  // 2. Структура слоёв
  const structIssues = S.groups.length + S.empty.length + S.copies.length;
  sec('structure', 'Структура слоёв', '2-никаких-group-вместо-фреймов',
    structIssues === 0 && S.hidden < 20 ? 'ok' : structIssues > 30 || S.hidden > 200 ? 'bad' : 'warn',
    `Групп (Group): ${S.groups.length}, пустых фреймов: ${S.empty.length}, скрытых слоёв: ${S.hidden}.`,
    [
      S.groups.length && { text: 'Group вместо Frame — у группы нет отступов и правил раскладки:', examples: examples(S.groups) },
      S.empty.length && { text: 'Пустые фреймы без содержимого и оформления:', examples: examples(S.empty, 3) },
      S.hidden >= 20 && { text: `Скрытых слоёв ${S.hidden}. Программа их пропускает, но они путают при разборе файла — старые варианты лучше удалить.` },
      S.copies.length && { text: 'Экраны с «Copy»/«Копия» в имени — черновики лучше перенести на страницу «Архив» или переименовать:', examples: S.copies.slice(0, 5) },
      S.masks && { text: `Масок: ${S.masks}. Часто хватает «Clip content» у фрейма.` },
    ].filter(Boolean));

  // 3. Имена
  const gn = pct(S.generic.length, S.named);
  sec('names', 'Имена слоёв', '3-названия-слоёв--по-смыслу',
    gn <= 20 ? 'ok' : gn <= 50 ? 'warn' : 'bad',
    S.named ? `Безликие имена (Frame 12, Group 7…) у ${S.generic.length} из ${S.named} значимых блоков (${gn}%). Из имён получаются классы и компоненты в коде.` : 'Значимых блоков нет.',
    S.generic.length ? [{ text: 'Крупные блоки без имени по смыслу:', examples: examples(S.generic) }] : []);

  // 4. Компоненты
  const repeats = [...S.repeats.values()].filter((r) => r.count >= 3).sort((a, b) => b.count - a.count);
  sec('components', 'Компоненты', '4-компоненты-для-всего-что-повторяется',
    !repeats.length ? 'ok' : repeats.length <= 3 ? 'warn' : 'bad',
    `Экземпляров компонентов на экранах: ${S.instances}. Повторяющихся блоков, которые не являются компонентами: ${repeats.length}.`,
    [
      repeats.length && { text: 'Одинаковые по строению блоки, нарисованные копиями (сделать компонентом, экраны — экземплярами):',
        examples: repeats.slice(0, 6).map((r) => `«${r.name}» — ${r.count} раз, например ${r.where[0]}`) },
      (pkg.manifest.warnings || []).length && { text: 'Плагин не смог прочитать часть слоёв (чаще всего — набор вариантов компонента с ошибкой, красное предупреждение в Figma):', examples: pkg.manifest.warnings.slice(0, 5) },
    ].filter(Boolean));

  // 5. Состояния
  const stateKey = [...S.variantProps.keys()].find((k) => /state|состояни/i.test(k));
  const propsList = [...S.variantProps].map(([k, v]) => `${k}: ${[...v].slice(0, 8).join(', ')}`);
  sec('states', 'Состояния', '5-состояния--вариантами-компонента',
    stateKey ? 'ok' : S.buttons.length ? 'bad' : 'warn',
    stateKey
      ? `Свойство состояния «${stateKey}» есть: ${[...S.variantProps.get(stateKey)].join(', ')}.${S.buttons.length ? ` Кнопок с вариантом состояния: ${S.buttonsWithState} из ${S.buttons.length}.` : ''}`
      : S.variantProps.size ? 'Варианты компонентов есть, но свойства состояния (State: Default / Hover / Pressed / Disabled) нет.' : 'Вариантов компонентов на экранах нет — состояний (наведение, нажатие, неактивно, ошибка) в макете не видно.',
    [
      propsList.length && { text: 'Свойства вариантов, которые встречаются на экранах:', examples: propsList.slice(0, 8) },
      !stateKey && S.buttons.length && { text: `Кнопок на экранах: ${S.buttons.length}, ни у одной нет варианта состояния. Без него в коде не будет :hover, :active, :disabled из макета.`, examples: examples(S.buttons, 3) },
      { text: 'Учтите: плагин видит только варианты, которые стоят на экранах. Варианты, которые есть лишь в наборе компонента, в этот анализ не попадают.' },
    ].filter(Boolean));

  // 6. Токены: переменные и стили
  const varCount = (variables || []).reduce((s, c) => s + (c.variables || []).length, 0);
  const colorVars = (variables || []).reduce((s, c) => s + (c.variables || []).filter((v) => v.type === 'COLOR').length, 0);
  const numVars = (variables || []).reduce((s, c) => s + (c.variables || []).filter((v) => v.type === 'FLOAT').length, 0);
  const textStyles = styles?.text?.length || 0, effectStyles = styles?.effect?.length || 0;
  const a = ds.audit;
  const gridOk = ds.spacing.base >= 4 && a.metrics.spacingOnGrid >= 0.9;
  const gridText = ds.spacing.base >= 4 ? `отступы на сетке ${ds.spacing.base}px: ${Math.round(a.metrics.spacingOnGrid * 100)}%` : 'общего шага отступов (4 или 8px) нет';
  const tokScore = (varCount ? 1 : 0) + (textStyles ? 1 : 0) + (gridOk ? 1 : 0) + (ds.colors.rare.length <= 5 ? 1 : 0);
  sec('tokens', 'Переменные и стили', '6-переменные-variables-и-стили-вместо-просто-цветов',
    tokScore >= 4 ? 'ok' : tokScore >= 2 ? 'warn' : 'bad',
    `Переменных: ${varCount} (цвета ${colorVars}, числа ${numVars}); текстовых стилей: ${textStyles}; стилей эффектов: ${effectStyles}. ` +
    (ds.figma ? `Разных цветов в макетах: ${ds.colors.mergedFrom}, цветов в палитре Figma: ${ds.colors.tokens.length}; ${gridText}.`
      : `Разных цветов в макетах: ${ds.colors.mergedFrom} → после объединения близких ${ds.colors.tokens.length}; ${gridText}.`),
    [
      !varCount && { text: 'Локальных переменных нет. Цвета, отступы и радиусы стоит завести переменными (палитра + смысловые). Переменные из подключённой командной библиотеки плагин пока не видит.' },
      varCount && !numVars && { text: 'Переменных для отступов и радиусов нет — только цвета.' },
      !textStyles && { text: 'Текстовых стилей нет — шрифт задан вручную на каждом тексте.' },
      ds.colors.rare.length && { text: `Редкие, почти одинаковые оттенки (${ds.colors.rare.length}) — заменить основными цветами:`, examples: ds.colors.rare.slice(0, 6).map((r) => `${r.hex} → ${r.into} (ΔE ${r.deltaE})`) },
      ds.typography.rare?.length && { text: `Редкие кегли: ${ds.typography.rare.slice(0, 10).join(', ')} px — привести к шкале текстовых стилей.` },
      ds.spacing.base >= 4 && a.metrics.spacingOnGrid < 0.9 && { text: `Отступы вне сетки ${ds.spacing.base}px: ${100 - Math.round(a.metrics.spacingOnGrid * 100)}% (например, 15 вместо 16).` },
      ds.spacing.base < 4 && { text: 'Отступы не кратны общему шагу. Выберите шкалу (4, 8, 12, 16, 24, 32…) и заведите её переменными space/….' },
      a.contrast?.length && { text: `Недостаточный контраст текста (WCAG AA) — ${a.contrast.length} сочетаний цветов:`, examples: a.contrast.slice(0, 4).map((c) => `${c.fg} на ${c.bg}: ${c.ratio}:1 (${c.count} раз, например ${c.examples[0]})`) },
    ].filter(Boolean));

  // 7. Адаптивность
  const groups = groupFrames(frames.map((f) => ({ name: f.name, page: f.page, width: f.width, texts: textsOf(f.tree) })));
  const multi = groups.filter((g) => new Set(g.members.map((i) => Math.round(frames[i].width))).size >= 2);
  const widths = [...new Set(frames.map((f) => Math.round(f.width)))].sort((x, y) => y - x);
  // между телефоном и компьютером нет планшетного макета: какие ряды на ~768px сожмутся или вылезут
  const TABLET = 768;
  const tablet = multi.map((g) => {
    const ws = g.members.map((i) => frames[i].width);
    if (ws.some((w) => w >= 600 && w <= 1024) || Math.min(...ws) >= 600 || Math.max(...ws) <= 1024) return null;
    const wide = frames[g.members.reduce((a, i) => (frames[i].width > frames[a].width ? i : a), g.members[0])];
    return { name: g.name, rows: squeezedRows(wide.tree, wide.width, TABLET) };
  }).filter(Boolean);
  sec('responsive', 'Адаптивность', '7-адаптивность', multi.length ? 'ok' : widths.length > 1 ? 'warn' : 'info',
    multi.length ? `Экранов, нарисованных в нескольких ширинах: ${multi.length} (${multi.slice(0, 4).map((g) => g.name).join(', ')}${multi.length > 4 ? '…' : ''}).`
      : `Ширины экранов: ${widths.join(', ')}px. Пар «один экран — разные ширины» не найдено.`,
    [
      !multi.length && widths.length > 1 && { text: 'Если экран нужен на нескольких ширинах, у версий должны совпадать тексты и порядок блоков — так программа поймёт, что это одна страница.' },
      !multi.length && widths.length === 1 && { text: 'Все экраны одной ширины. Если сайт должен работать на телефоне, нужны и мобильные макеты — или хотя бы ключевые экраны.' },
      tablet.length && { text: `Нет макета для планшета (около ${TABLET}px) у ${tablet.map((t) => `«${t.name}»`).join(', ')}. Между телефоном и компьютером страница тянется по правилам Auto Layout; как перестроить блоки, программа не придумывает.` },
      tablet.some((t) => t.rows.length) && { text: `На ${TABLET}px не поместятся ряды без переноса — их стоит нарисовать в планшетном макете или включить перенос (Wrap). В скобках — сколько ряду нужно и сколько останется:`,
        examples: tablet.flatMap((t) => t.rows).sort((a, b) => b.area - a.area).slice(0, 5).map((r) => `${r.where} (${r.need} → ${r.room}px)`) },
    ].filter(Boolean));

  // 8. Тексты, картинки, эффекты
  const blur = (S.effects.get('BACKGROUND_BLUR') || 0) + (S.effects.get('LAYER_BLUR') || 0);
  const special = [...S.effects].filter(([t]) => !['DROP_SHADOW', 'INNER_SHADOW', 'BACKGROUND_BLUR', 'LAYER_BLUR'].includes(t));
  const famList = fonts?.length ? [...new Set(fonts.map((x) => x.family))] : [...S.families];
  sec('media', 'Тексты, картинки, эффекты', '8-тексты-картинки-иконки',
    !S.illustrations.length && blur < 10 && !special.length && pct(S.lhAuto, S.texts) <= 30 && !extra.missingFonts?.length ? 'ok' : 'warn',
    `Текстов: ${S.texts}, с высотой строки «Auto»: ${S.lhAuto}. Шрифты: ${famList.join(', ') || '—'}.`,
    [
      pct(S.lhAuto, S.texts) > 30 && { text: 'У многих текстов высота строки «Auto» — задайте её в текстовых стилях числом или процентом.' },
      extra.missingFonts?.length && { text: `Шрифты не найдены в открытых каталогах: ${extra.missingFonts.join(', ')}. Без файлов шрифта браузер подставит другой — передайте файлы разработчику или выберите веб-шрифт.` },
      S.illustrations.length && { text: 'Иллюстрации из десятков векторов — лучше вставить картинкой (Image fill) или одним SVG:', examples: S.illustrations.slice(0, 4).map((x) => `${x.where} (${x.vec} векторов)`) },
      blur && { text: `Размытий (blur): ${blur}. Браузер рисует их иначе, чем Figma, — там будут расхождения с макетом.` },
      special.length && { text: `Особые эффекты (${special.map(([t, c]) => `${t} ×${c}`).join(', ')}) — в браузере не повторить точно.` },
    ].filter(Boolean));

  const weight = { ok: 1, info: 1, warn: 0.5, bad: 0 };
  const scored = sections.filter((s) => s.status !== 'info');
  const score = Math.round((100 * scored.reduce((s, x) => s + weight[x.status], 0)) / (scored.length || 1));
  return { file: pkg.manifest.file, frames: frames.length, pages: new Set(frames.map((f) => f.page)).size, score, sections };
}

// ---------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LABEL = { ok: 'хорошо', warn: 'можно лучше', bad: 'мешает вёрстке', info: 'к сведению' };
export const GUIDE_URL = 'designer-guide.html';

/** Отчёт для дизайнера (самостоятельная страница). guideHref(anchor) — ссылка на раздел памятки. */
export function auditHtml(a, { guideHref = (id) => `${GUIDE_URL}#${id}` } = {}) {
  const verdict = a.score >= 80 ? 'Макет хорошо подготовлен к вёрстке.' : a.score >= 50 ? 'Макет можно сверстать, но часть придётся угадывать.' : 'В макете много того, что мешает точной и понятной вёрстке.';
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Анализ макета — ${esc(a.file)}</title>
<style>
  :root { --ink:#1b2130; --muted:#5d6577; --line:#e3e6ec; --ok:#1f7a4d; --warn:#9a5b00; --bad:#b3261e; --info:#3c5a99; }
  body { margin:0; font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:#f6f7f9; }
  main { max-width:860px; margin:0 auto; padding:40px 24px 64px; }
  h1 { font-size:26px; margin:0 0 6px; } .sub { color:var(--muted); margin:0 0 24px; }
  .score { display:flex; gap:20px; align-items:center; background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px 22px; margin-bottom:24px; }
  .score b { font-size:40px; line-height:1; } .score p { margin:0; }
  section { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px 22px; margin-bottom:14px; }
  h2 { font-size:17px; margin:0 0 6px; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .st { font-size:12px; font-weight:600; padding:2px 8px; border-radius:99px; }
  .st.ok { color:var(--ok); background:#e6f4ec; } .st.warn { color:var(--warn); background:#fdf1dc; }
  .st.bad { color:var(--bad); background:#fbe7e5; } .st.info { color:var(--info); background:#e8eef9; }
  .sum { margin:0 0 8px; } ul { margin:6px 0 0; padding-left:20px; } li { margin:4px 0; }
  .ex { color:var(--muted); font-size:13px; margin:2px 0 0; padding-left:18px; } .ex li { margin:1px 0; }
  a { color:#0a63c9; } .how { font-size:14px; }
</style></head><body><main>
<h1>Анализ макета: ${esc(a.file)}</h1>
<p class="sub">Экранов: ${a.frames}, страниц Figma: ${a.pages}. Отчёт для дизайнера: что в файле помогает и что мешает перевести макет в код.</p>
<div class="score"><b>${a.score}</b><p>${esc(verdict)}<br><span style="color:var(--muted)">Оценка из 100 по разделам ниже. Как исправить — по ссылке «Как сделать» в каждом разделе.</span></p></div>
${a.sections.map((s) => `<section id="${s.id}">
  <h2>${esc(s.title)} <span class="st ${s.status}">${LABEL[s.status]}</span></h2>
  <p class="sum">${esc(s.summary)}</p>
  ${s.items.length ? `<ul>${s.items.map((i) => `<li>${esc(i.text)}${i.examples?.length ? `<ul class="ex">${i.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>` : ''}
  <p class="how"><a href="${esc(guideHref(s.guide))}" target="_blank" rel="noopener">Как сделать — памятка для дизайнера</a></p>
</section>`).join('\n')}
</main></body></html>`;
}

/** Короткий текст для консоли. */
export function auditText(a) {
  const mark = { ok: '✓', warn: '~', bad: '✗', info: 'i' };
  return [`Анализ макета: ${a.score}/100`, ...a.sections.map((s) => `  ${mark[s.status]} ${s.title}: ${s.summary}`)].join('\n');
}

/** Памятка дизайнеру отдельной страницей — рядом с отчётом, ссылки из отчёта ведут в её разделы. */
export function guidePage() {
  const md = fs.readFileSync(new URL('./designer-guide.md', import.meta.url), 'utf8');
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Памятка дизайнеру — DS Builder</title>
<style>${GUIDE_CSS}</style></head><body><main>
${mdToHtml(md)}
</main></body></html>`;
}
export const GUIDE_CSS = `
  body { margin:0; font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#1b2130; background:#fff; }
  main { max-width:780px; margin:0 auto; padding:40px 24px 72px; }
  h1 { font-size:28px; line-height:1.25; margin:0 0 16px; } h2 { font-size:20px; margin:36px 0 10px; scroll-margin-top:16px; }
  p, li { max-width:72ch; } ul { padding-left:22px; } li { margin:4px 0; } li.check { list-style:none; margin-left:-22px; }
  code { font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; background:#f1f3f6; padding:1px 5px; border-radius:4px; }
  table { border-collapse:collapse; margin:12px 0; font-size:14px; } th, td { border:1px solid #e3e6ec; padding:6px 10px; text-align:left; vertical-align:top; }
  th { background:#f6f7f9; } hr { border:0; border-top:1px solid #e3e6ec; margin:28px 0; } a { color:#0a63c9; }
  :target { background:#fff8db; }
  .note { padding:8px 12px; border-radius:8px; font-size:14px; } .note.ok { background:#e9f6ef; } .note.plan { background:#f1f3f6; color:#4a5263; }`;
