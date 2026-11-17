// Вывод раскладки: дерево узлов Figma → дерево блоков с типом потока.
//
// flow:
//   'figma' — у узла есть Auto Layout: переносим его 1:1 во flex;
//   'col' / 'row' — Auto Layout нет, но дети раскладываются в колонку/строку
//                   без перекрытий (рекурсивный XY-cut по геометрии);
//   'abs'  — дети перекрываются: абсолютное позиционирование (точно, но не «резиново»).
//
// Режим 'absolute' (запасной) ставит 'abs' везде.

const EPS = 0.01;

export const isVisible = (n) => n.visible !== false;

export function rectOf(n) {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

function bbox(boxes) {
  const x1 = Math.min(...boxes.map((b) => b.rect.x));
  const y1 = Math.min(...boxes.map((b) => b.rect.y));
  const x2 = Math.max(...boxes.map((b) => b.rect.x + b.rect.w));
  const y2 = Math.max(...boxes.map((b) => b.rect.y + b.rect.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Делит блоки на полосы вдоль оси: внутри полосы проекции пересекаются, между полосами — нет. */
function bands(boxes, axis) {
  const s = axis === 'y' ? 'y' : 'x';
  const d = axis === 'y' ? 'h' : 'w';
  const sorted = [...boxes].sort((a, b) => a.rect[s] - b.rect[s]);
  const out = [];
  let cur = null;
  let end = -Infinity;
  for (const b of sorted) {
    if (cur && b.rect[s] < end - EPS) {
      cur.push(b);
      end = Math.max(end, b.rect[s] + b.rect[d]);
    } else {
      cur = [b];
      out.push(cur);
      end = b.rect[s] + b.rect[d];
    }
  }
  return out;
}

function wrap(items, opts) {
  const rect = bbox(items);
  const inner = cut(items, opts);
  return { kind: 'wrap', rect, flow: inner.flow, children: inner.children };
}

/** XY-cut: сначала пробуем разрезать по вертикали (строки), потом по горизонтали (колонки). */
function cut(items, opts) {
  if (items.length <= 1) return { flow: 'col', children: items };
  if (opts.mode === 'absolute') return { flow: 'abs', children: items };
  const rows = bands(items, 'y');
  if (rows.length > 1) {
    return { flow: 'col', children: rows.map((r) => (r.length === 1 ? r[0] : wrap(r, opts))) };
  }
  const cols = bands(items, 'x');
  if (cols.length > 1) {
    return { flow: 'row', children: cols.map((c) => (c.length === 1 ? c[0] : wrap(c, opts))) };
  }
  return { flow: 'abs', children: items };
}

const near = (a, b) => Math.abs(a - b) <= 0.5;
const noPaint = (n) => !(n.fills || []).some((f) => f.visible !== false) && !(n.effects || []).length && !(n.strokes || []).length;

function isBackgroundRect(child, parent) {
  return child && (child.type === 'RECTANGLE' || child.type === 'ELLIPSE') && !child.children?.length && !child.svg &&
    !child.rotation && (child.opacity ?? 1) === 1 && noPaint(parent) && !parent.radius &&
    near(child.x, parent.x) && near(child.y, parent.y) && near(child.w, parent.w) && near(child.h, parent.h);
}

const hasAutoLayout =(n) => n.layout && (n.layout.mode === 'HORIZONTAL' || n.layout.mode === 'VERTICAL');

/** Строит дерево блоков для узла. */
export function buildBox(node, opts) {
  const box = { kind: 'node', node, rect: rectOf(node), flow: 'col', children: [], absChildren: [] };
  if (node.type === 'TEXT' || node.svg) return box; // листья
  const kids = (node.children || []).filter(isVisible).filter((k) => !k.isMask);
  if (!kids.length) return box;
  const childBoxes = kids.map((k) => buildBox(k, opts));

  if (opts.mode !== 'absolute' && hasAutoLayout(node)) {
    box.flow = 'figma';
    box.children = childBoxes.filter((b) => b.node.layoutPositioning !== 'ABSOLUTE');
    box.absChildren = childBoxes.filter((b) => b.node.layoutPositioning === 'ABSOLUTE');
    return box;
  }
  // «Прямоугольник + текст» в группе: нижний прямоугольник во весь размер группы
  // становится фоном самой группы (типичная кнопка/карточка без Auto Layout).
  const first = childBoxes[0]?.node;
  if (opts.mode !== 'absolute' && childBoxes.length > 1 && isBackgroundRect(first, node)) {
    box.bg = first;
    childBoxes.shift();
  }
  const r = cut(childBoxes, opts);
  box.flow = r.flow;
  box.children = r.children;
  return box;
}

/** Считает отступы детей относительно контейнера для потоков col/row/abs. */
export function placements(container) {
  const { rect, flow, children } = container;
  if (flow === 'abs') {
    return children.map((c) => ({ position: 'absolute', left: c.rect.x - rect.x, top: c.rect.y - rect.y }));
  }
  const out = [];
  if (flow === 'col') {
    let cursor = rect.y;
    for (const c of children) {
      out.push({ mt: c.rect.y - cursor, ml: c.rect.x - rect.x });
      cursor = c.rect.y + c.rect.h;
    }
  } else if (flow === 'row') {
    let cursor = rect.x;
    for (const c of children) {
      out.push({ ml: c.rect.x - cursor, mt: c.rect.y - rect.y });
      cursor = c.rect.x + c.rect.w;
    }
  }
  return out;
}
