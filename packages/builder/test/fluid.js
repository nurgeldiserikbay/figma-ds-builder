// Плавный переход между макетами: пары слоёв → clamp(), колонка одинаковых блоков → сетка.
import assert from 'node:assert/strict';
import { peerMaps, clampPx } from '../src/fluid-peer.js';

const txt = (id, s, size, lh) => ({ id, name: 'Title', type: 'TEXT', x: 0, y: 0, w: 300, h: lh, visible: true, layoutPositioning: 'AUTO',
  text: { characters: s, autoResize: 'HEIGHT', segments: [{ start: 0, end: s.length, fontSize: size, lineHeight: { unit: 'PIXELS', value: lh } }] } });
const card = (id, w) => ({ id, name: 'Card', type: 'INSTANCE', component: { name: 'Card' }, x: 0, y: 0, w, h: 100, visible: true, children: [] });
const mobile = { id: 'm', name: 'Home — Mobile', type: 'FRAME', w: 390, h: 800, layout: { mode: 'VERTICAL' }, children: [
  txt('mt', 'Заголовок', 36, 44),
  { id: 'mg', name: 'Grid', type: 'FRAME', w: 390, h: 400, layout: { mode: 'VERTICAL', gap: 16, padding: [0, 24, 0, 24] }, children: [card('c1', 342), card('c2', 342), card('c3', 342)] },
] };
const desktop = { id: 'd', name: 'Home — Desktop', type: 'FRAME', w: 1440, h: 800, layout: { mode: 'VERTICAL' }, children: [
  txt('dt', 'Заголовок', 60, 68),
  { id: 'dg', name: 'Grid', type: 'FRAME', w: 1440, h: 300, layout: { mode: 'HORIZONTAL', gap: 24, padding: [0, 120, 0, 120], wrap: true, counterGap: 24 }, children: [card('d1', 384), card('d2', 384), card('d3', 384)] },
] };
const P = peerMaps(mobile, desktop);
assert.deepEqual(P.text.get('mt'), { fs: [36, 60], lh: [44, 68] }, 'тексты сопоставлены по содержимому');
assert.deepEqual(P.frame.get('mg').pad, [[0, 0], [24, 120], [0, 0], [24, 120]], 'отступы по имени слоя');
assert.deepEqual(P.frame.get('mg').gap, [16, 24]);
const g = P.grid.get('mg');
assert.ok(g && g.min * 2 + 16 > 342 && g.min <= 342, 'на 390 — одна колонка');
assert.equal(clampPx([36, 60], 390, 1440), 'clamp(36px, calc(36px + 24 * (100vw - 390px) / 1050), 60px)');
assert.equal(clampPx([24, 24], 390, 1440), '24px');
console.log('плавный адаптив: кегль, отступы, сетка из колонки — OK');
{
  // текст в блоке без Auto Layout (по координатам) — кегль не трогаем: выросший заголовок налез бы на соседей
  const m2 = { ...mobile, layout: undefined }, d2 = { ...desktop, layout: undefined };
  assert.equal(peerMaps(m2, d2).text.size, 0);
  console.log('плавный кегль только в Auto Layout — OK');
}
