// Анализ дизайн-системы по всем фреймам пакета (без ИИ, только алгоритмы).
//
// Работает на «грязных» макетах: без стилей, компонентов и Auto Layout, с почти одинаковыми цветами
// и случайными размерами. Результат — нормализованные токены, семантика и аудит.
import {
  toHex, fromHex, toLab, chroma, hue, deltaE, contrast, over, familyOf, assignSteps,
} from './color.js';

const r2 = (v) => Math.round(v * 100) / 100;
const WHITE = { r: 1, g: 1, b: 1 };

function visiblePaints(list) {
  return (list || []).filter((p) => p.visible !== false && (p.opacity ?? 1) > 0.001);
}

/** Верхний видимый сплошной цвет (с учётом прозрачности краски и цвета). */
function topSolid(list) {
  const p = visiblePaints(list).reverse().find((x) => x.type === 'SOLID');
  return p ? { color: p.color, alpha: (p.opacity ?? 1) * (p.color.a ?? 1) } : null;
}

const area = (n) => Math.max(0, n.w) * Math.max(0, n.h);

function isScaledFrame(tree) {
  // масштабированная копия экрана: заметная доля дробных кеглей (9.8, 13.3…)
  let total = 0, frac = 0;
  (function walk(n) {
    if (n.visible === false) return;
    for (const s of n.text?.segments || []) {
      total++;
      if (Math.abs(s.fontSize - Math.round(s.fontSize)) > 0.05) frac++;
    }
    (n.children || []).forEach(walk);
  })(tree);
  return total >= 5 && frac / total > 0.3;
}

function lineHeightPx(s) {
  const lh = s.lineHeight;
  if (!lh || lh.unit === 'AUTO') return null;
  if (lh.unit === 'PIXELS') return lh.value;
  if (lh.unit === 'PERCENT') return (s.fontSize * lh.value) / 100;
  return null;
}

function letterSpacingPx(s) {
  const ls = s.letterSpacing;
  if (!ls || !ls.value) return 0;
  return ls.unit === 'PERCENT' ? (s.fontSize * ls.value) / 100 : ls.value;
}

// ---------------------------------------------------------------------------------------------
// 1. Сбор
// ---------------------------------------------------------------------------------------------

function collect(frames) {
  const C = {
    colors: new Map(), gradients: new Map(), segments: [], spacing: [], radii: [], shadows: new Map(), blurs: [],
    borders: [], opacity: [], widths: [], textChecks: [], frames: [], totalArea: 0,
  };
  const useColor = (c, alpha, kind, weight) => {
    const hex = toHex(c, alpha);
    const e = C.colors.get(hex) || { hex, rgb: { r: c.r, g: c.g, b: c.b }, alpha, area: 0, text: 0, stroke: 0, uses: 0, bgArea: 0, kinds: {} };
    e.uses++;
    e.kinds[kind] = (e.kinds[kind] || 0) + 1;
    if (kind === 'fill') e.area += weight;
    if (kind === 'bg') e.bgArea += weight;
    if (kind === 'text') e.text += weight;
    if (kind === 'stroke') e.stroke += weight;
    C.colors.set(hex, e);
  };

  for (const f of frames) {
    const tree = f.tree;
    const scaled = isScaledFrame(tree);
    C.frames.push({ name: tree.name, w: tree.w, h: tree.h, scaled });
    if (!scaled) C.widths.push(tree.w);
    const frameArea = area(tree);
    C.totalArea += frameArea;
    const base = topSolid(tree.fills);
    // фрейм без заливки прозрачен (под ним — фон страницы Figma): фон неизвестен
    const frameBg = base && base.alpha > 0.99 ? base.color : null;
    // окрашенные прямоугольные области в порядке отрисовки — чтобы знать фон под текстом
    const painted = [{ x: 0, y: 0, w: tree.w, h: tree.h, color: frameBg }];
    const bgAt = (n) => {
      const cx = n.x + n.w / 2, cy = n.y + Math.min(n.h, 40) / 2;
      for (let i = painted.length - 1; i >= 0; i--) {
        const p = painted[i];
        if (cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h) return p.color;
      }
      return frameBg;
    };
    void WHITE;

    (function walk(n, parent, depth) {
      if (n.visible === false) return;
      const isText = n.type === 'TEXT';
      const shapeLike = !isText && !n.svg && !n.vectorPlaceholder;
      // заливки
      for (const p of visiblePaints(n.fills)) {
        if (p.type === 'SOLID') {
          const a = (p.opacity ?? 1) * (p.color.a ?? 1);
          if (!isText) {
            const big = area(n) >= frameArea * 0.25 || depth === 0;
            useColor(p.color, a, big ? 'bg' : 'fill', area(n));
          }
        } else if (p.type?.startsWith('GRADIENT') && p.css) {
          C.gradients.set(p.css, (C.gradients.get(p.css) || 0) + 1);
        }
      }
      const top = topSolid(n.fills);
      const vis = visiblePaints(n.fills);
      const topPaint = vis[vis.length - 1];
      if (shapeLike && depth > 0 && topPaint) {
        // картинка или градиент сверху — фон под текстом неизвестен (контраст не проверяем)
        if (topPaint.type !== 'SOLID') painted.push({ x: n.x, y: n.y, w: n.w, h: n.h, color: null });
        else if (top) painted.push({ x: n.x, y: n.y, w: n.w, h: n.h, color: over(top.color, top.alpha, bgAt(n) || WHITE) });
      }
      // обводки
      const st = topSolid(n.strokes);
      if (st && n.strokeWeight) {
        const sw = Array.isArray(n.strokeWeight) ? Math.max(...n.strokeWeight) : n.strokeWeight;
        useColor(st.color, st.alpha, 'stroke', (n.w + n.h) * 2 * sw);
        if (!n.svg && !scaled) C.borders.push(r2(sw));
      }
      // текст
      if (isText && n.text) {
        const bg = bgAt(n); // null — под текстом картинка или градиент
        for (const s of n.text.segments || []) {
          const chars = Math.max(1, s.end - s.start);
          const tc = topSolid(s.fills);
          if (tc) {
            useColor(tc.color, tc.alpha, 'text', chars);
          }
          if (tc && bg) {
            const fg = over(tc.color, tc.alpha, bg);
            C.textChecks.push({ name: n.name, id: n.id, frame: tree.name, size: s.fontSize, weight: s.fontWeight || 400, fg, bg, chars, ratio: contrast(fg, bg) });
          }
          if (!scaled) {
            C.segments.push({
              family: s.fontFamily, weight: s.fontWeight || 400, style: s.fontStyle, size: s.fontSize,
              lh: lineHeightPx(s), ls: letterSpacingPx(s), case: s.textCase, chars,
            });
          }
        }
      }
      if (scaled) { (n.children || []).forEach((c) => walk(c, n, depth + 1)); return; } // с копий берём только цвета
      // радиусы
      if (n.radius && shapeLike) {
        const arr = Array.isArray(n.radius) ? n.radius : [n.radius, n.radius, n.radius, n.radius];
        const min = Math.min(n.w, n.h) / 2;
        if (arr.every((v) => v === arr[0]) && arr[0] > 0) C.radii.push(arr[0] >= min - 0.5 ? 'full' : r2(arr[0]));
        else arr.filter((v) => v > 0).forEach((v) => C.radii.push(r2(v)));
      } else if (n.type === 'ELLIPSE') C.radii.push('full');
      // эффекты
      for (const e of n.effects || []) {
        if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
          const k = [e.type, r2(e.x), r2(e.y), r2(e.blur), r2(e.spread || 0), toHex(e.color, e.color.a ?? 1)].join('|');
          C.shadows.set(k, (C.shadows.get(k) || 0) + 1);
        } else if (e.radius) C.blurs.push(r2(e.radius));
      }
      if (n.opacity !== undefined && n.opacity < 0.999 && depth > 0) C.opacity.push(r2(n.opacity));

      // отступы
      if (!scaled && n.children?.length) collectSpacing(n, C);
      (n.children || []).forEach((c) => walk(c, n, depth + 1));
    })(tree, null, 0);
  }
  return C;
}

function collectSpacing(n, C) {
  const kids = n.children.filter((k) => k.visible !== false && k.layoutPositioning !== 'ABSOLUTE');
  const L = n.layout;
  if (L && (L.mode === 'HORIZONTAL' || L.mode === 'VERTICAL')) {
    // Auto Layout — точные значения, вес ×3
    if (typeof L.gap === 'number' && L.gap > 0 && kids.length > 1) C.spacing.push({ v: L.gap, w: 3, exact: true });
    for (const p of L.designPadding || L.padding || []) if (p > 0) C.spacing.push({ v: p, w: 3, exact: true });
    return;
  }
  // без Auto Layout: расстояния между соседями по геометрии
  for (const a of kids) {
    let below = null, right = null;
    for (const b of kids) {
      if (a === b) continue;
      const ovX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const ovY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const gy = b.y - (a.y + a.h), gx = b.x - (a.x + a.w);
      if (gy > 0.5 && ovX >= Math.min(a.w, b.w) * 0.5 && (!below || gy < below)) below = gy;
      if (gx > 0.5 && ovY >= Math.min(a.h, b.h) * 0.5 && (!right || gx < right)) right = gx;
    }
    if (below && below <= 160) C.spacing.push({ v: below, w: 1 });
    if (right && right <= 160) C.spacing.push({ v: right, w: 1 });
  }
  // внутренние отступы у окрашенных контейнеров (карточки, кнопки)
  const painted = topSolid(n.fills) || topSolid(n.strokes);
  if (painted && kids.length && n.type !== 'TEXT') {
    const minX = Math.min(...kids.map((k) => k.x)), minY = Math.min(...kids.map((k) => k.y));
    const left = minX - n.x, topPad = minY - n.y;
    if (left > 0.5 && left <= 120) C.spacing.push({ v: left, w: 1 });
    if (topPad > 0.5 && topPad <= 120) C.spacing.push({ v: topPad, w: 1 });
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Цвета
// ---------------------------------------------------------------------------------------------

function weightOf(e) {
  return e.uses + e.area / 2000 + e.bgArea / 20000 + e.text / 5 + e.stroke / 500;
}

function clusterColors(C, opts) {
  const list = [...C.colors.values()].map((e) => ({ ...e, lab: toLab(e.rgb), weight: weightOf(e) }));
  list.sort((a, b) => b.weight - a.weight);
  const clusters = [];
  for (const e of list) {
    const t = e.lab.L > 92 ? Math.min(1, opts.deltaE) : opts.deltaE; // почти белые фоны (#FAFAFA) не сливаем с белым
    const c = clusters.find((k) => Math.abs(k.alpha - e.alpha) < 0.04 && deltaE(k.lab, e.lab) < t);
    if (c) {
      c.members.push(e);
      for (const k of ['area', 'bgArea', 'text', 'stroke', 'uses', 'weight']) c[k] += e[k];
    } else {
      clusters.push({ hex: e.hex, rgb: e.rgb, lab: e.lab, alpha: e.alpha, members: [e], area: e.area, bgArea: e.bgArea, text: e.text, stroke: e.stroke, uses: e.uses, weight: e.weight });
    }
  }
  // редкие оттенки (<0.5% веса) вливаются в ближайший основной цвет
  // редкость считаем по числу использований: вес по площади занижает обводки и мелкие элементы
  const total = clusters.reduce((s, c) => s + c.uses, 0) || 1;
  const major = clusters.filter((c) => c.uses / total >= opts.rareShare);
  const rare = [];
  const keep = [...major];
  for (const c of clusters) {
    if (major.includes(c)) continue;
    const near = major.filter((m) => Math.abs(m.alpha - c.alpha) < 0.04)
      .map((m) => ({ m, d: deltaE(m.lab, c.lab) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < opts.rareMergeDeltaE) {
      near.m.members.push(...c.members);
      for (const k of ['area', 'bgArea', 'text', 'stroke', 'uses', 'weight']) near.m[k] += c[k];
      rare.push({ hex: c.hex, into: near.m.hex, deltaE: r2(near.d), uses: c.uses });
    } else keep.push(c);
  }
  return { clusters: keep, rare, mergedFrom: C.colors.size };
}

function nameColors(clusters) {
  const opaque = clusters.filter((c) => c.alpha >= 0.995);
  for (const c of opaque) {
    const ch = chroma(c.lab);
    if (c.lab.L > 99 && ch < 2) c.name = 'white';
    else if (c.lab.L < 1.5 && ch < 2) c.name = 'black';
    else c.family = familyOf(c.lab);
  }
  const byFam = new Map();
  for (const c of opaque.filter((x) => x.family)) {
    if (!byFam.has(c.family)) byFam.set(c.family, []);
    byFam.get(c.family).push(c);
  }
  for (const [fam, list] of byFam) {
    list.sort((a, b) => b.lab.L - a.lab.L);
    const steps = assignSteps(list, fam);
    list.forEach((c, i) => { c.step = steps[i]; c.name = steps[i] ? `${fam}-${steps[i]}` : `${fam}-${i + 1}`; });
  }
  // полупрозрачные: имя ближайшего непрозрачного + доля
  for (const c of clusters.filter((x) => x.alpha < 0.995)) {
    const near = opaque.map((o) => ({ o, d: deltaE(o.lab, c.lab) })).sort((a, b) => a.d - b.d)[0];
    const own = familyOf(c.lab);
    const base = near && near.d < 10 ? near.o.name : own !== 'gray' ? own : c.lab.L > 50 ? 'white' : 'black';
    c.name = `${base}-a${Math.round(c.alpha * 100)}`;
    c.family = near && near.d < 10 ? near.o.family || near.o.name : own;
  }
  // уникальность имён
  const seen = new Map();
  for (const c of clusters) {
    const k = seen.get(c.name) || 0;
    seen.set(c.name, k + 1);
    if (k) c.name = `${c.name}-${k + 1}`;
  }
}

function semantic(clusters, C) {
  const roles = [];
  const opaque = clusters.filter((c) => c.alpha >= 0.995);
  const set = (role, c, why) => { if (c && !roles.find((r) => r.role === role)) roles.push({ role, token: c.name, hex: c.hex, why }); };
  const find = (hex) => clusters.find((c) => c.members.some((m) => m.hex === hex));

  // фон: самая большая площадь крупных заливок
  const bg = [...opaque].sort((a, b) => b.bgArea - a.bgArea)[0];
  set('background', bg, 'наибольшая площадь фона');
  // поверхность: второй крупный фон, близкий по светлоте к основному
  const surface = [...opaque].filter((c) => c !== bg && c.bgArea + c.area > 0 && bg && Math.abs(c.lab.L - bg.lab.L) < 10 && chroma(c.lab) < 12)
    .sort((a, b) => (b.bgArea + b.area) - (a.bgArea + a.area))[0];
  set('surface', surface, 'второй по площади фон, близкий к основному');

  // текст: среди массовых цветов текста — самый контрастный к фону; вторичный — приглушённый
  const bgRgb = bg ? bg.rgb : WHITE;
  const textTotal = clusters.reduce((s, c) => s + c.text, 0) || 1;
  const texts = opaque.filter((c) => c.text / textTotal >= 0.05 && chroma(c.lab) < 25)
    .map((c) => ({ c, k: contrast(c.rgb, bgRgb) })).filter((x) => x.k >= 3);
  const primaryText = [...texts].sort((a, b) => b.k - a.k)[0];
  set('text-primary', primaryText?.c, 'самый контрастный из массовых цветов текста');
  const rest = texts.filter((x) => x.c !== primaryText?.c).sort((a, b) => b.c.text - a.c.text);
  set('text-secondary', rest[0]?.c, 'приглушённый массовый цвет текста');
  set('text-tertiary', rest[1]?.c, 'следующий по объёму цвет текста');

  // граница: самый частый цвет обводок
  const border = [...opaque].filter((c) => c.stroke > 0 && chroma(c.lab) < 20).sort((a, b) => b.stroke - a.stroke)[0];
  set('border', border, 'самый частый цвет обводок');

  // фирменный: самый используемый насыщенный цвет (по числу использований, не по площади)
  const chromatic = opaque.filter((c) => chroma(c.lab) >= 30).sort((a, b) => (b.uses + b.text / 20) - (a.uses + a.text / 20));
  const primary = chromatic[0];
  set('primary', primary, 'самый используемый насыщенный цвет');
  if (primary) {
    // текст на фирменном: самый частый цвет текста, лежащего на primary
    const onP = new Map();
    for (const t of C.textChecks) {
      if (deltaE(toLab(t.bg), primary.lab) < 3) {
        const cl = find(toHex(t.fg));
        if (cl) onP.set(cl, (onP.get(cl) || 0) + t.chars);
      }
    }
    const on = [...onP.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || (contrast(primary.rgb, WHITE) >= 3 ? clusters.find((c) => c.name === 'white') : null);
    set('on-primary', on, 'цвет текста на фирменном');
    const subtle = opaque.filter((c) => c.family === primary.family && c.lab.L > 88).sort((a, b) => b.lab.L - a.lab.L)[0];
    set('primary-subtle', subtle, 'светлый оттенок фирменного');
  }
  const used = new Set(roles.map((r) => r.token));
  const accent = chromatic.find((c) => c !== primary && (!primary || deltaE(c.lab, primary.lab) > 15) && !['red'].includes(c.family));
  set('accent', accent, 'второй насыщенный цвет');
  // статусы по тону
  const status = (role, fams) => {
    const c = chromatic.find((x) => fams.includes(x.family) && !used.has(x.name) && x !== accent);
    set(role, c, `насыщенный цвет семейства ${fams.join('/')}`);
  };
  status('error', ['red', 'pink']);
  status('success', ['green', 'teal', 'lime']);
  status('warning', ['orange', 'yellow']);
  status('info', ['blue', 'cyan', 'indigo']);
  return roles;
}

// ---------------------------------------------------------------------------------------------
// 3. Типографика
// ---------------------------------------------------------------------------------------------

function mode(values, key = (v) => v) {
  const m = new Map();
  for (const v of values) m.set(key(v), (m.get(key(v)) || 0) + (v.chars || 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function typography(C, opts) {
  const segs = C.segments;
  const totalChars = segs.reduce((s, x) => s + x.chars, 0) || 1;
  // семейства
  const fam = new Map();
  for (const s of segs) fam.set(s.family, (fam.get(s.family) || 0) + s.chars);
  const famList = [...fam.entries()].sort((a, b) => b[1] - a[1]);
  const families = [];
  const mono = famList.find(([f]) => /mono|code|courier|consolas/i.test(f));
  famList.filter(([f]) => f !== mono?.[0]).slice(0, 2).forEach(([f, n], i) => families.push({ role: i ? 'secondary' : 'primary', family: f, share: r2(n / totalChars) }));
  if (mono) families.push({ role: 'mono', family: mono[0], share: r2(mono[1] / totalChars) });

  // размеры: объединение ±0.5px
  const sizes = [];
  for (const s of [...segs].sort((a, b) => a.size - b.size)) {
    const last = sizes[sizes.length - 1];
    if (last && s.size - last.max <= opts.fontSizeMerge) { last.items.push(s); last.max = s.size; } else sizes.push({ items: [s], max: s.size });
  }
  const groups = sizes.map((g) => {
    const chars = g.items.reduce((s, x) => s + x.chars, 0);
    return { size: mode(g.items, (x) => x.size), chars, items: g.items };
  }).filter((g) => g.chars >= opts.minUses || g.items.length >= opts.minUses);
  if (!groups.length) return { families, styles: [], sizes: [], ratio: null, rare: [] };

  // body — самый массовый кегль в диапазоне 12–20 (или вообще самый массовый)
  const bodyCands = groups.filter((g) => g.size >= 12 && g.size <= 20);
  const body = (bodyCands.length ? bodyCands : groups).reduce((a, b) => (b.chars > a.chars ? b : a));
  const above = groups.filter((g) => g.size > body.size).sort((a, b) => b.size - a.size);
  const below = groups.filter((g) => g.size < body.size).sort((a, b) => b.size - a.size);
  const roles = new Map();
  roles.set(body, 'body');
  // крупнее body: h6 — ближайший, h1 — крупнейший; лишние сверху → display
  const heads = [...above];
  let bodyLg = null;
  if (heads.length && heads[heads.length - 1].size - body.size <= 2.5) bodyLg = heads.pop();
  if (bodyLg) roles.set(bodyLg, 'body-lg');
  const extra = Math.max(0, heads.length - 6);
  heads.forEach((g, i) => roles.set(g, i < extra ? (extra > 1 ? `display-${i + 1}` : 'display') : `h${i - extra + 1}`));
  const smallNames = ['body-sm', 'caption', 'overline', 'micro'];
  below.forEach((g, i) => {
    const upper = g.items.filter((x) => x.case === 'UPPER').reduce((s, x) => s + x.chars, 0) > g.chars * 0.5;
    roles.set(g, upper && !roles.has('overline') ? 'overline' : smallNames[Math.min(i, smallNames.length - 1)] + (i >= smallNames.length ? `-${i}` : ''));
  });

  const styles = [];
  for (const g of groups) {
    const role = roles.get(g);
    // варианты по начертанию: заметная (≥20%) доля другого веса
    const byW = new Map();
    for (const x of g.items) byW.set(x.weight, (byW.get(x.weight) || 0) + x.chars);
    const ws = [...byW.entries()].sort((a, b) => b[1] - a[1]);
    ws.forEach(([w, n], i) => {
      if (i > 0 && n < g.chars * 0.2) return;
      const items = g.items.filter((x) => x.weight === w);
      const lhs = items.filter((x) => x.lh);
      styles.push({
        name: i === 0 ? role : `${role}-${weightName(w)}`,
        role, size: g.size, weight: w,
        family: mode(items, (x) => x.family),
        lineHeight: lhs.length ? r2(mode(lhs, (x) => r2(x.lh))) : null,
        letterSpacing: r2(mode(items, (x) => r2(x.ls)) || 0),
        uses: items.length, chars: n,
      });
    });
  }
  styles.sort((a, b) => b.size - a.size || a.weight - b.weight);
  // модульная шкала: среднее геометрическое отношений соседних заголовков
  const hs = [...heads.map((h) => h.size), body.size].sort((a, b) => b - a);
  const ratios = hs.slice(1).map((v, i) => hs[i] / v).filter((x) => x > 1);
  const ratio = ratios.length ? r2(Math.exp(ratios.reduce((s, x) => s + Math.log(x), 0) / ratios.length)) : null;
  const rare = sizes.map((g) => g.items).filter((items) => items.reduce((s, x) => s + x.chars, 0) < opts.minUses && items.length < opts.minUses)
    .map((items) => items[0].size);
  const weights = [...new Set(styles.map((s) => s.weight))].sort((a, b) => a - b).map((w) => ({ name: weightName(w), value: w }));
  return { families, styles, weights, ratio, rare: [...new Set(rare)] };
}

function weightName(w) {
  return { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' }[Math.round(w / 100) * 100] || String(w);
}

// ---------------------------------------------------------------------------------------------
// 4. Отступы, радиусы, тени, прочее
// ---------------------------------------------------------------------------------------------

/** Имена шкалы: «md» — значение, ближайшее к anchor; дальше sm/xs/2xs… и lg/xl/2xl… без пропусков. */
function scaleNames(values, anchor) {
  if (!values.length) return [];
  let mid = 0;
  values.forEach((v, i) => { if (Math.abs(v - anchor) < Math.abs(values[mid] - anchor)) mid = i; });
  return values.map((v, i) => {
    const k = i - mid;
    if (k === 0) return 'md';
    if (k === 1) return 'lg';
    if (k === -1) return 'sm';
    if (k === 2) return 'xl';
    if (k === -2) return 'xs';
    return k > 0 ? `${k - 1}xl` : `${-k - 1}xs`;
  });
}

function spacing(C, opts) {
  const vals = C.spacing.filter((s) => s.v >= 1);
  const totalW = vals.reduce((s, x) => s + x.w, 0) || 1;
  // базовая единица: наибольшая из 8/6/5/4/3/2, на которую ложится ≥ 70% веса значений
  let base = 1;
  for (const b of [8, 6, 5, 4, 3, 2]) {
    const share = vals.filter((s) => Math.abs(s.v - Math.round(s.v / b) * b) <= 0.5).reduce((a, x) => a + x.w, 0) / totalW;
    if (share >= opts.baseShare) { base = b; break; }
  }
  // «примагничивание» геометрических значений к сетке; значения из Auto Layout — как есть
  // точные значения Auto Layout вне сетки остаются, только если встречаются часто (иначе — к сетке, в «редкие»)
  const exactW = new Map();
  for (const s of vals) if (s.exact) exactW.set(r2(s.v), (exactW.get(r2(s.v)) || 0) + s.w);
  const counts = new Map();
  const offGrid = new Set();
  for (const s of vals) {
    const snapped = Math.max(base, Math.round(s.v / base) * base);
    const onGrid = Math.abs(s.v - snapped) <= 0.5;
    let v = snapped;
    if (s.exact && !onGrid && exactW.get(r2(s.v)) >= opts.offGridKeep) v = r2(s.v);
    else if (!onGrid) offGrid.add(r2(s.v));
    counts.set(v, (counts.get(v) || 0) + s.w);
  }
  const values = [...counts.entries()].filter(([, w]) => w >= opts.minUses).map(([v]) => v).sort((a, b) => a - b);
  const names = scaleNames(values, 16);
  return {
    base,
    onGridShare: r2(vals.filter((s) => Math.abs(s.v - Math.round(s.v / base) * base) <= 0.5).reduce((a, x) => a + x.w, 0) / totalW),
    tokens: values.map((v, i) => ({ name: names[i], value: v, weight: r2(counts.get(v)) })),
    rare: [...new Set([...offGrid, ...[...counts.entries()].filter(([, w]) => w < opts.minUses).map(([v]) => v)])].sort((a, b) => a - b),
  };
}

function radii(C, opts) {
  const nums = C.radii.filter((v) => v !== 'full').sort((a, b) => a - b);
  const groups = [];
  for (const v of nums) {
    const g = groups[groups.length - 1];
    if (g && v - g.max <= opts.radiusMerge) { g.items.push(v); g.max = v; } else groups.push({ items: [v], max: v });
  }
  const vals = groups.filter((g) => g.items.length >= opts.minUses).map((g) => ({ value: mode(g.items), uses: g.items.length }));
  const names = scaleNames(vals.map((v) => v.value), 8);
  const tokens = vals.map((v, i) => ({ name: names[i], ...v }));
  const full = C.radii.filter((v) => v === 'full').length;
  if (full) tokens.push({ name: 'full', value: 9999, uses: full });
  return tokens;
}

function shadows(C) {
  const list = [...C.shadows.entries()].map(([k, uses]) => {
    const [type, x, y, blur, spread, hex] = k.split('|');
    return { type, x: +x, y: +y, blur: +blur, spread: +spread, hex, uses };
  });
  const drop = list.filter((s) => s.type === 'DROP_SHADOW').sort((a, b) => a.blur - b.blur || a.y - b.y);
  const names = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];
  const start = drop.length <= 4 ? 1 : 0;
  const out = drop.map((s, i) => ({ name: names[start + i] || `${i + 1}`, ...s }));
  list.filter((s) => s.type === 'INNER_SHADOW').forEach((s, i) => out.push({ name: i ? `inner-${i + 1}` : 'inner', ...s }));
  return out.map((s) => ({ ...s, css: `${s.type === 'INNER_SHADOW' ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${cssColor(s.hex)}` }));
}

function cssColor(hex) {
  const c = fromHex(hex);
  return c.a >= 0.995 ? hex : `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${r2(c.a)})`;
}

function simpleScale(values, minUses) {
  const m = new Map();
  values.forEach((v) => m.set(v, (m.get(v) || 0) + 1));
  return [...m.entries()].filter(([, n]) => n >= minUses).sort((a, b) => a[0] - b[0]).map(([value, uses]) => ({ value, uses }));
}

function breakpoints(C) {
  const names = [[600, 'mobile'], [900, 'tablet'], [1200, 'laptop'], [1700, 'desktop'], [Infinity, 'wide']];
  const by = new Map();
  for (const w of C.widths) {
    const name = names.find(([lim]) => w < lim)[1];
    if (!by.has(name)) by.set(name, []);
    by.get(name).push(w);
  }
  return [...by.entries()].map(([name, ws]) => ({ name, value: Math.min(...ws), frames: ws.length })).sort((a, b) => a.value - b.value);
}

// ---------------------------------------------------------------------------------------------
// 5. Аудит
// ---------------------------------------------------------------------------------------------

function audit(C, colors, typo, space) {
  const issues = [];
  const fails = C.textChecks.filter((t) => {
    const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
    return t.ratio < (large ? 3 : 4.5);
  });
  const uniq = new Map();
  for (const f of fails) {
    const k = `${toHex(f.fg)}|${toHex(f.bg)}`;
    const e = uniq.get(k) || { fg: toHex(f.fg), bg: toHex(f.bg), ratio: r2(f.ratio), count: 0, examples: [] };
    e.count++;
    const ex = `${f.frame} / ${f.name.length > 40 ? f.name.slice(0, 40) + '…' : f.name}`;
    if (e.examples.length < 3 && !e.examples.includes(ex)) e.examples.push(ex);
    uniq.set(k, e);
  }
  const contrastIssues = [...uniq.values()].sort((a, b) => b.count - a.count);
  if (contrastIssues.length) issues.push({ kind: 'contrast', text: `Недостаточный контраст текста (WCAG AA): ${fails.length} фрагментов, ${contrastIssues.length} сочетаний цветов` });
  if (colors.rare.length) issues.push({ kind: 'colors', text: `${colors.rare.length} редких оттенков можно заменить основными цветами` });
  if (typo.rare.length) issues.push({ kind: 'type', text: `Редкие кегли: ${typo.rare.slice(0, 10).join(', ')} px` });
  if (space.onGridShare < 0.9) issues.push({ kind: 'spacing', text: `Только ${Math.round(space.onGridShare * 100)}% отступов лежат на сетке ${space.base}px` });
  const scaled = C.frames.filter((f) => f.scaled);
  if (scaled.length) issues.push({ kind: 'scaled', text: `Масштабированные копии экранов (не учтены в шрифтах и отступах): ${scaled.map((f) => f.name).join(', ')}` });

  const checks = C.textChecks.length || 1;
  const metrics = {
    contrastPass: r2(1 - fails.length / checks),
    colorsRaw: colors.mergedFrom, colorsTokens: colors.tokens.length,
    fontSizes: typo.styles.length, spacingOnGrid: space.onGridShare,
  };
  // оценка 0–100: понятные штрафы
  let score = 100;
  score -= Math.round((1 - metrics.contrastPass) * 40);
  score -= Math.min(15, colors.rare.length);
  score -= Math.min(15, Math.max(0, colors.tokens.length - 24));
  score -= Math.min(10, typo.rare.length * 2);
  score -= Math.round((1 - space.onGridShare) * 20);
  return { score: Math.max(0, score), metrics, issues, contrast: contrastIssues.slice(0, 30) };
}

// ---------------------------------------------------------------------------------------------

export const DEFAULTS = { offGridKeep: 9, deltaE: 3, rareShare: 0.005, rareMergeDeltaE: 10, minUses: 2, fontSizeMerge: 0.5, radiusMerge: 1, baseShare: 0.7 };

/**
 * @param {{ name: string, tree: object }[]} frames
 */
export function analyzeDesignSystem(frames, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const C = collect(frames);
  const cl = clusterColors(C, opts);
  nameColors(cl.clusters);
  const tokens = cl.clusters
    .sort((a, b) => (a.family || '').localeCompare(b.family || '') || (a.step || 0) - (b.step || 0) || b.weight - a.weight)
    .map((c) => ({
      name: c.name, hex: c.hex, family: c.family || c.name, step: c.step || null, alpha: r2(c.alpha),
      uses: c.uses, members: c.members.map((m) => m.hex),
    }));
  const colors = {
    tokens, semantic: semantic(cl.clusters, C), rare: cl.rare, mergedFrom: cl.mergedFrom,
    gradients: [...C.gradients.entries()].sort((a, b) => b[1] - a[1]).map(([css, uses], i) => ({ name: `gradient-${i + 1}`, css, uses })),
  };
  const typo = typography(C, opts);
  const space = spacing(C, opts);
  const result = {
    meta: { frames: C.frames, date: new Date().toISOString().slice(0, 10), options: opts },
    colors,
    typography: typo,
    spacing: space,
    radius: radii(C, opts),
    shadows: shadows(C),
    borders: simpleScale(C.borders, opts.minUses),
    opacity: simpleScale(C.opacity, opts.minUses),
    blurs: simpleScale(C.blurs, 1),
    breakpoints: breakpoints(C),
  };
  result.audit = audit(C, colors, typo, space);
  return result;
}
