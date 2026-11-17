// Разложение расхождений pixel diff по слоям: какой слой (верхний в этой точке) даёт больше всего
// несовпадающих пикселей. Подсказывает, что чинить в первую очередь — и человеку, и ИИ.
import fs from 'node:fs';
import { PNG } from 'pngjs';

function leaves(tree) {
  const out = [];
  (function walk(n, clip) {
    if (n.visible === false) return;
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    const c = clip ? intersect(clip, box) : null;
    const kids = (n.children || []).filter((k) => k.visible !== false);
    // фон контейнера тоже может отличаться: учитываем как отдельный «слой» под детьми
    if (kids.length && (n.fills || []).some((f) => f.visible !== false)) out.push({ node: n, box: clip ? c : box, depth: out.length });
    if (!kids.length) out.push({ node: n, box: clip ? intersect(clip, box) : box });
    const childClip = n.clipsContent ? (clip ? c : box) : clip;
    kids.forEach((k) => walk(k, childClip));
  })(tree, null);
  return out.filter((l) => l.box && l.box.w > 0 && l.box.h > 0);
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export function attributeDiff(tree, diffPath, { scale = 1, top = 10 } = {}) {
  const diff = PNG.sync.read(fs.readFileSync(diffPath));
  const L = leaves(tree);
  const counts = new Map();
  let total = 0;
  for (let y = 0; y < diff.height; y++) {
    for (let x = 0; x < diff.width; x++) {
      const i = (y * diff.width + x) * 4;
      if (!(diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0)) continue;
      total++;
      const fx = x / scale, fy = y / scale;
      let hit = null;
      for (let k = L.length - 1; k >= 0; k--) {
        const b = L[k].box;
        if (fx >= b.x && fx < b.x + b.w && fy >= b.y && fy < b.y + b.h) { hit = L[k].node; break; }
      }
      const key = hit ? hit.id : '(вне слоёв)';
      const e = counts.get(key) || { id: key, name: hit ? hit.name : key, type: hit ? hit.type : '', pixels: 0 };
      e.pixels++;
      counts.set(key, e);
    }
  }
  const list = [...counts.values()].sort((a, b) => b.pixels - a.pixels);
  const byType = {};
  for (const e of list) {
    const t = e.type === 'TEXT' ? 'текст' : e.type === 'VECTOR' || e.type === 'BOOLEAN_OPERATION' ? 'векторы' : e.type ? 'фигуры и фон' : 'вне слоёв';
    byType[t] = (byType[t] || 0) + e.pixels;
  }
  return { total, byType, top: list.slice(0, top) };
}
