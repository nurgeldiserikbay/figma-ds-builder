// «Резиновая» вёрстка между двумя макетами одной страницы (например, 390 и 1440): по парам одинаковых слоёв
// узкого и широкого макета значения плавно переходят от одного к другому (clamp), а списки одинаковых блоков,
// которые на широком макете стоят в ряд, становятся сеткой (1 → 2 → 3 колонки).
// На ширине узкого макета всё совпадает с ним до пикселя: clamp даёт его значения, сетка — одну колонку.

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const hasAL = (n) => !!n.layout && n.layout.mode !== 'NONE';

/**
 * Слои, которые можно менять плавно: вся цепочка родителей — Auto Layout (иначе блоки стоят по координатам
 * и выросший текст налезет на соседа), текст — с автовысотой.
 */
function index(tree) {
  const byText = new Map(), byPath = new Map();
  (function walk(n, path, flow) {
    if (n.visible === false) return;
    if (n.type === 'TEXT') {
      const k = norm(n.text?.characters);
      const ok = flow && ['HEIGHT', 'WIDTH_AND_HEIGHT'].includes(n.text?.autoResize);
      if (k) byText.set(k, byText.has(k) || !ok ? null : n); // повтор — не пара
    }
    if (path) byPath.set(path, byPath.has(path) || !flow ? null : n);
    const kidsFlow = flow && hasAL(n);
    for (const c of n.children || []) walk(c, path ? `${path}/${c.name}` : c.name, kidsFlow && c.layoutPositioning !== 'ABSOLUTE');
  })(tree, '', true);
  return { byText, byPath };
}

const segOf = (t) => t.text?.segments?.[0] || t.text?.style || {};
const lhPx = (s) => (s.lineHeight?.unit === 'PIXELS' ? s.lineHeight.value : null);

/**
 * @param tree  узкий макет (тот, что растягивается)
 * @param peer  следующий по ширине макет той же страницы
 * @returns {{ w0, w1, text: Map, frame: Map, grid: Map }}
 */
export function peerMaps(tree, peer) {
  const w0 = tree.w, w1 = peer.w;
  const a = index(tree), b = index(peer);
  const text = new Map(), frame = new Map(), grid = new Map();
  for (const [k, n] of a.byText) {
    const m = n && b.byText.get(k);
    if (!m) continue;
    const s0 = segOf(n), s1 = segOf(m);
    if (!(s0.fontSize > 0 && s1.fontSize > 0)) continue;
    // один сегмент — кегль меняется целиком; несколько — не трогаем (смешанный текст)
    if ((n.text?.segments || []).length > 1 || (m.text?.segments || []).length > 1) continue;
    const fs = [s0.fontSize, s1.fontSize];
    const lh = lhPx(s0) && lhPx(s1) ? [lhPx(s0), lhPx(s1)] : null;
    if (fs[0] !== fs[1] || (lh && lh[0] !== lh[1])) text.set(n.id, { fs, lh });
  }
  for (const [p, n] of a.byPath) {
    const m = n && b.byPath.get(p);
    if (!m || !n.layout || !m.layout || n.layout.mode === 'NONE' || m.layout.mode === 'NONE') continue;
    const P0 = n.layout.designPadding || n.layout.padding || [0, 0, 0, 0];
    const P1 = m.layout.designPadding || m.layout.padding || [0, 0, 0, 0];
    // к отступу прибавлена обводка — разница отступов та же
    const add = (n.layout.padding || [0, 0, 0, 0]).map((x, i) => x - (P0[i] || 0));
    const pad = P0.map((x, i) => [x + add[i], (P1[i] || 0) + add[i]]);
    const g0 = typeof n.layout.gap === 'number' ? n.layout.gap : null, g1 = typeof m.layout.gap === 'number' ? m.layout.gap : null;
    const gap = g0 !== null && g1 !== null && g0 !== g1 ? [g0, g1] : null;
    if (pad.some(([x, y]) => x !== y) || gap) frame.set(n.id, { pad, gap });
    // список: на узком — колонка из одинаковых блоков, на широком — те же блоки в ряд
    const kids = (n.children || []).filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
    const kids1 = (m.children || []).filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
    const same = (c) => c.component?.name || c.name;
    if (n.layout.mode === 'VERTICAL' && m.layout.mode === 'HORIZONTAL' && kids.length >= 2 && kids.length === kids1.length
      && kids.every((c) => same(c) === same(kids[0]) && c.type !== 'TEXT')) {
      const colGap = [g0 ?? 0, g1 ?? 0];
      const rowGap = [g0 ?? 0, m.layout.wrap ? m.layout.counterGap || g1 || 0 : g1 ?? 0];
      // минимальная ширина колонки — чуть меньше блока на узком и на широком макете (85%): на планшете
      // помещаются две колонки, а на ширине узкого макета остаётся одна (две туда не влезают)
      const inner = n.w - (n.layout.padding?.[1] || 0) - (n.layout.padding?.[3] || 0);
      let min = Math.round(Math.min(Math.max(...kids.map((c) => c.w)), Math.max(...kids1.map((c) => c.w))) * 0.85);
      if (min * 2 + colGap[0] <= inner) min = Math.ceil((inner - colGap[0]) / 2) + 1;
      grid.set(n.id, { min, colGap, rowGap });
    }
  }
  return { w0, w1, text, frame, grid };
}

const r2 = (v) => Math.round(v * 100) / 100;
/** Значение от a (на ширине w0) до b (на w1), дальше — без изменений. */
export function clampPx([a, b], w0, w1) {
  if (a === b) return `${r2(a)}px`;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return `clamp(${r2(lo)}px, calc(${r2(a)}px + ${r2(b - a)} * (100vw - ${r2(w0)}px) / ${r2(w1 - w0)}), ${r2(hi)}px)`;
}
