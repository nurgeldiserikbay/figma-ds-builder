// Анализ макета для дизайнера и памятка: ссылки из отчёта ведут в существующие разделы памятки.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPackage } from '../src/package.js';
import { analyzeDesignSystem } from '../src/ds/analyze.js';
import { auditDesign, auditHtml, guidePage } from '../src/design-audit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// памятка в программе = памятка в репозитории
assert.equal(fs.readFileSync(path.join(here, '../src/designer-guide.md'), 'utf8'), fs.readFileSync(path.join(here, '../../../docs/designer-guide.md'), 'utf8'),
  'src/designer-guide.md отличается от docs/designer-guide.md — скопируйте docs → src');

const pkg = loadPackage(path.join(here, '../fixtures/sample'));
const ds = analyzeDesignSystem(pkg.frames.map((f) => ({ name: f.name, tree: f.tree() })));
const a = auditDesign(pkg, ds, { missingFonts: ['Brand Sans'] });
assert.equal(a.frames, 2);
assert.ok(a.score >= 0 && a.score <= 100);
const ids = ['autolayout', 'structure', 'names', 'components', 'states', 'tokens', 'responsive', 'media'];
assert.deepEqual(a.sections.map((s) => s.id), ids);
const sec = (id) => a.sections.find((s) => s.id === id);
assert.equal(sec('responsive').status, 'ok', 'Desktop и Mobile одной страницы найдены');
assert.match(sec('structure').summary, /Групп \(Group\): \d+/);
assert.ok(sec('media').items.some((i) => /Brand Sans/.test(i.text)), 'ненайденный шрифт — в отчёте');
assert.ok(sec('autolayout').items[0]?.examples?.length, 'примеры слоёв без Auto Layout');

const anchors = new Set([...guidePage().matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
for (const s of a.sections) assert.ok(anchors.has(s.guide), `раздел памятки «${s.guide}» существует`);
const html = auditHtml(a, { guideHref: (id) => `designer-guide.html#${id}` });
assert.ok(!/undefined|NaN/.test(html), 'без undefined/NaN в отчёте');
console.log(`анализ макета: ${a.score}/100, ${a.sections.length} разделов, ссылки на памятку — OK`);

// ряды, которые не поместятся на планшете (нет макета между телефоном и компьютером)
{
  const { squeezedRows } = await import('../src/design-audit.js');
  const card = (id) => ({ id, name: 'Card', type: 'FRAME', w: 360, h: 200, visible: true, sizing: { h: 'FIXED', v: 'HUG' }, children: [] });
  const row = { id: 'row', name: 'Cards', type: 'FRAME', w: 1200, h: 200, visible: true, layout: { mode: 'HORIZONTAL', gap: 24, padding: [0, 0, 0, 0] }, children: [card('a'), card('b'), card('c')] };
  const wrapRow = { ...row, id: 'w', name: 'Wrap', layout: { ...row.layout, wrap: true } };
  const fillRow = { ...row, id: 'f', name: 'Fill', children: row.children.map((c) => ({ ...c, sizing: { h: 'FILL', v: 'HUG' } })) };
  const page = { id: 'p', name: 'Desktop', type: 'FRAME', w: 1440, h: 900, visible: true, children: [row, wrapRow, fillRow] };
  const r = squeezedRows(page, 1440, 768);
  assert.deepEqual(r.map((x) => x.where), ['Desktop / Cards'], 'три карточки 360px в ряд на 768 не влезут; с переносом и Fill — влезут');
  assert.equal(r[0].need, 1128);
  console.log('планшет: ряды без переноса, которые не поместятся на 768px — OK');
}
