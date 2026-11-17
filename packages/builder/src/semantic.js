// Семантическая разметка без ИИ: теги и понятные имена классов по структуре макета.
//
// Результат — карта id слоя → { tag, name, attrs }. Генератор использует её вместо <div>
// и имени слоя. Проверка pixel perfect после этого та же: если тег что-то сдвинул, это видно.

const GENERIC = /^(frame|group|rectangle|rect|ellipse|vector|line|text|layer|union|subtract|intersect|exclude|component|instance|image|polygon|star|boolean|фрейм|группа|прямоугольник|эллипс|вектор|слой|текст)(\s*\d+)?$/i;
export const isGenericName = (name) => !name || GENERIC.test(String(name).trim()) || /^\d+$/.test(String(name).trim());

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', қ: 'q', ғ: 'g', ү: 'u', ұ: 'u', ң: 'n', ө: 'o', һ: 'h', ә: 'a', і: 'i' };

/** Имя класса: латиница, kebab-case, начинается с буквы. */
export function className(name) {
  const t = String(name || '').toLowerCase().replace(/[а-яёқғүұңөһәі]/g, (c) => TRANSLIT[c] ?? '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return /^[a-z]/.test(t) ? t : t ? `n-${t}` : 'node';
}

const visible = (n) => n.visible !== false;
const hasPaint = (n) => (n.fills || []).some((f) => f.visible !== false) || (n.strokes || []).some((f) => f.visible !== false);
const texts = (n, out = []) => {
  if (!visible(n)) return out;
  if (n.type === 'TEXT') out.push(n);
  (n.children || []).forEach((c) => texts(c, out));
  return out;
};
const firstSize = (t) => t.text?.segments?.[0]?.fontSize || 0;
const chars = (t) => (t.text?.characters || '').trim().length;

/** Структурная подпись узла (без текста и положения) — для поиска одинаковых элементов списка. */
function signature(n, depth = 0) {
  const kids = (n.children || []).filter(visible);
  const own = [n.type, n.layout?.mode || '', Math.round(n.w / 4), Math.round(n.h / 4), kids.length].join(':');
  if (depth >= 2 || !kids.length) return own;
  return own + '[' + kids.map((k) => signature(k, depth + 1)).join(',') + ']';
}

function isButtonLike(n) {
  if (n.type === 'TEXT' || !visible(n) || n.transform) return false;
  if (/button|btn|кнопк/i.test(n.name || '') || /button|btn/i.test(n.component?.name || '')) return true;
  const t = texts(n);
  if (t.length !== 1 || chars(t[0]) > 40 || chars(t[0]) === 0) return false;
  if (n.h < 36 || n.h > 80 || n.w > 420) return false; // ниже 36px — скорее бейдж или тег
  // своё оформление или прямоугольник-фон во весь размер (кнопка, собранная группой)
  const kids = (n.children || []).filter(visible);
  const bg = kids.find((k) => k.type !== 'TEXT' && Math.abs(k.w - n.w) < 1 && Math.abs(k.h - n.h) < 1 && hasPaint(k));
  const painted = hasPaint(n) || !!bg;
  const rounded = (n.radius && [].concat(n.radius).some((r) => r > 0)) || (bg && bg.radius && [].concat(bg.radius).some((r) => r > 0));
  const nonText = kids.filter((k) => k.type !== 'TEXT' && k !== bg);
  return painted && (rounded || n.h <= 56) && nonText.length <= 2;
}

/**
 * @param {object} tree — дерево фрейма
 * @returns {Map<string, {tag:string, name:string, attrs?:object}>}
 */
export function analyzeSemantics(tree) {
  const out = new Map();
  const set = (n, tag, name, attrs) => out.set(n.id, { tag, name: name || className(n.name), attrs });

  const phrasing = new Set(); // внутри button/a — только строчные элементы
  const markPhrasing = (n) => (n.children || []).forEach((c) => { phrasing.add(c.id); markPhrasing(c); });
  const within = new Map(); // id текста → 'header' | 'footer' | 'small'

  // каркас страницы: прямые дети фрейма во всю ширину
  for (const c of (tree.children || []).filter(visible)) {
    if (c.type === 'TEXT') continue;
    const wide = c.w >= tree.w * 0.9;
    if (!wide) continue;
    if (c.y <= tree.h * 0.04 && c.h <= 220) set(c, 'header', isGenericName(c.name) ? 'header' : null);
    else if (c.y + c.h >= tree.h - 4 && c.h <= 600) set(c, 'footer', isGenericName(c.name) ? 'footer' : null);
    else if (c.h >= 160) set(c, 'section', isGenericName(c.name) ? 'section' : null);
  }

  for (const [id, e] of out) {
    if (e.tag !== 'header' && e.tag !== 'footer') continue;
    const node = (tree.children || []).find((c) => c.id === id);
    texts(node).forEach((t) => within.set(t.id, e.tag));
  }
  // текст в маленьком контейнере (бейдж, тег, счётчик) — не заголовок
  (function small(n) {
    for (const c of n.children || []) {
      if (c.type === 'TEXT' && n !== tree && n.w <= 140 && n.h <= 140) within.set(c.id, within.get(c.id) || 'small');
      small(c);
    }
  })(tree);

  // заголовок: короткий текст (≤ 80 символов, ≤ 3 строк) крупнее основного, не в шапке/подвале/бейдже/кнопке
  const lineH = (t) => { const s0 = t.text?.segments?.[0]; const lh = s0?.lineHeight; return lh?.unit === 'PIXELS' ? lh.value : (s0?.fontSize || 16) * 1.25; };
  const isHeadingCandidate = (t) => chars(t) <= 80 && t.h / lineH(t) <= 3.2 && !within.has(t.id) && !phrasing.has(t.id);
  let headCache = null;
  const H = () => {
    if (headCache) return headCache;
    const all = texts(tree);
    const bySize = new Map();
    all.forEach((t) => bySize.set(Math.round(firstSize(t)), (bySize.get(Math.round(firstSize(t))) || 0) + chars(t)));
    const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 16;
    const cands = all.filter((t) => isHeadingCandidate(t) && Math.round(firstSize(t)) > body + 1);
    const headSizes = [...new Set(cands.map((t) => Math.round(firstSize(t))))].sort((a, b) => b - a);
    const biggest = cands.filter((t) => Math.round(firstSize(t)) === headSizes[0]).sort((a, b) => a.y - b.y)[0];
    headCache = { headSizes, biggest };
    return headCache;
  };

  (function walk(n, parent) {
    if (!visible(n)) return;
    const kids = (n.children || []).filter(visible);

    if (n !== tree && !out.has(n.id) && isButtonLike(n)) {
      set(n, 'button', isGenericName(n.name) ? 'button' : null, { type: 'button' });
      markPhrasing(n);
    }

    // навигация: строка из ≥3 коротких текстов (или групп с одним текстом), одна высота
    if (kids.length >= 3) {
      const linkish = kids.filter((k) => { const t = texts(k); return t.length === 1 && chars(t[0]) <= 24 && !isButtonLike(k); });
      const row = linkish.length >= 3 && Math.max(...linkish.map((k) => k.y)) - Math.min(...linkish.map((k) => k.y)) < 8;
      if (row && !out.has(n.id) && linkish.length >= kids.length * 0.6 && n.y < tree.h * 0.25) {
        set(n, 'nav', isGenericName(n.name) ? 'nav' : null, { 'aria-label': 'Навигация' });
        linkish.forEach((k) => { set(k, 'a', isGenericName(k.name) ? 'link' : null, { href: '#' }); markPhrasing(k); });
      } else if (row && linkish.length >= 3) {
        // строка ссылок, не сгруппированная отдельно (частый случай в шапке без Auto Layout)
        const top = linkish.every((k) => k.y < tree.h * 0.12);
        // в шапке ссылки — это пункты меню; первый слева крупный текст — логотип
        if (top) {
          const sorted = [...linkish].sort((a, b) => a.x - b.x);
          const logo = sorted.length > 3 && firstSize(texts(sorted[0])[0]) > firstSize(texts(sorted[1])[0]) + 2 ? sorted.shift() : null;
          if (logo && !out.has(logo.id)) { set(logo, 'a', isGenericName(logo.name) ? 'logo' : null, { href: '#' }); markPhrasing(logo); }
          sorted.forEach((k) => { if (!out.has(k.id)) { set(k, 'a', isGenericName(k.name) ? 'link' : null, { href: '#' }); markPhrasing(k); } });
        }
      }
    }

    // список: ≥3 соседа одинаковой структуры
    if (!out.has(n.id) && kids.length >= 3 && kids.every((k) => k.type !== 'TEXT')) {
      const sig = signature(kids[0]);
      if (kids.every((k) => signature(k) === sig) && !kids.some((k) => out.get(k.id)?.tag === 'button')) {
        set(n, 'ul', isGenericName(n.name) ? 'list' : null);
        kids.forEach((k) => { if (!out.has(k.id)) set(k, 'li', isGenericName(k.name) ? 'item' : null); });
      }
    }

    // текст
    if (n.type === 'TEXT') {
      if (!out.has(n.id)) {
        const size = Math.round(firstSize(n));
        const inPhr = phrasing.has(n.id);
        const level = H().headSizes.indexOf(size);
        const ctxWhere = within.get(n.id);
        if (inPhr) set(n, 'span', isGenericName(n.name) ? 'label' : null);
        else if (ctxWhere === 'small' || ctxWhere === 'header') set(n, 'span', isGenericName(n.name) ? 'label' : null);
        else if (ctxWhere === 'footer') set(n, 'p', isGenericName(n.name) ? 'text' : null);
        else if (!isHeadingCandidate(n)) set(n, 'p', isGenericName(n.name) ? 'text' : null);
        else if (n === H().biggest) set(n, 'h1', isGenericName(n.name) ? 'title' : null);
        else if (level >= 0) set(n, `h${Math.min(6, level === 0 ? 2 : level + 1)}`, isGenericName(n.name) ? 'heading' : null);
        else set(n, 'p', isGenericName(n.name) ? 'text' : null);
      }
      return;
    }

    // картинка
    if (!out.has(n.id) && (n.fills || []).some((f) => f.type === 'IMAGE' && f.visible !== false) && !kids.length) {
      set(n, 'div', isGenericName(n.name) ? 'image' : null, { role: 'img', 'aria-label': isGenericName(n.name) ? 'Изображение' : n.name });
    }
    // элементы внутри button/a — строчные
    if (phrasing.has(n.id) && !out.has(n.id)) set(n, 'span', isGenericName(n.name) ? (n.svg ? 'icon' : 'part') : null);
    if (!out.has(n.id) && n !== tree && isGenericName(n.name)) {
      // безликое имя → по роли: карточка (окрашенный контейнер с текстом) или блок
      const role = kids.length && hasPaint(n) && texts(n).length >= 2 ? 'card' : n.svg ? 'icon' : kids.length ? 'block' : 'shape';
      out.set(n.id, { tag: phrasing.has(n.id) ? 'span' : 'div', name: role });
    }
    kids.forEach((k) => walk(k, n));
  })(tree, null);

  return out;
}

/** Сброс стилей для семантических тегов: чтобы теги не меняли вид. */
export const SEMANTIC_RESET = [
  'h1, h2, h3, h4, h5, h6, p, ul, ol, li, figure { margin: 0; padding: 0; font: inherit; }',
  'ul, ol { list-style: none; }',
  'header, footer, section, nav, main, article, li { display: block; }',
  'a { color: inherit; text-decoration: none; display: block; }',
  'button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; text-align: inherit; cursor: pointer; display: block; }',
].join('\n');
