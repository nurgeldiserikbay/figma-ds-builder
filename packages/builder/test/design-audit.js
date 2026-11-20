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
