// Проверка геометрии: положение и размер каждого элемента вёрстки против слоя Figma.
// Не зависит от растеризации шрифтов, поэтому ловит сдвиги даже на 1px,
// которые теряются в общем проценте pixel diff.

export function checkGeometry(tree, boxes, { tolerance = 0.5 } = {}) {
  const nodes = new Map();
  (function walk(n) {
    nodes.set(n.id, n);
    (n.children || []).forEach(walk);
  })(tree);

  const issues = [];
  let maxDelta = 0;
  for (const b of boxes) {
    const n = nodes.get(b.id);
    if (!n) continue;
    const d = Math.max(Math.abs(b.x - n.x), Math.abs(b.y - n.y), Math.abs(b.w - n.w), Math.abs(b.h - n.h));
    maxDelta = Math.max(maxDelta, d);
    if (d > tolerance) {
      issues.push({
        id: n.id, name: n.name, delta: Math.round(d * 100) / 100,
        figma: { x: n.x, y: n.y, w: n.w, h: n.h },
        html: { x: round(b.x), y: round(b.y), w: b.w, h: b.h },
      });
    }
  }
  issues.sort((a, b) => b.delta - a.delta);
  return { checked: boxes.length, failed: issues.length, maxDelta: Math.round(maxDelta * 100) / 100, issues: issues.slice(0, 50), tolerance };
}

const round = (v) => Math.round(v * 100) / 100;
