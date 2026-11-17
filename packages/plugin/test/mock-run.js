// Проверка плагина без Figma: имитация Plugin API на тестовом макете.
// Запускает dist/code.js, жмёт «Пакет для вёрстки» и «Только PNG», сохраняет файлы
// и сверяет экспортированное дерево с исходным. Затем пакет можно собрать ds-build.
//
//   node test/mock-run.js [дерево.json эталон.png] [--out папка]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(here, '../../../.bench/plugin-mock'));
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const fixture = path.join(here, '../../builder/fixtures/sample');
const treePath = pos[0] || path.join(fixture, 'frames/1_1.json');
const pngPath = pos[1] || path.join(fixture, 'frames/1_1.png');
const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
const pngBytes = new Uint8Array(fs.readFileSync(pngPath));

const MIXED = Symbol('mixed');
// как Figma: жирность из начертания
const styleWeight = (st = '') => ({ thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 })[st.toLowerCase().replace(/[\s-]|italic/g, '')] || 400;

function figmaPaint(p) {
  if (p.type === 'SOLID') return { type: 'SOLID', visible: p.visible !== false, opacity: (p.opacity ?? 1) * (p.color.a ?? 1), color: { r: p.color.r, g: p.color.g, b: p.color.b } };
  if (p.type === 'GRADIENT_LINEAR' && p.css) {
    // из CSS обратно в стопы и матрицу (угол → направление первой строки)
    const ang = parseFloat((p.css.match(/(-?[\d.]+)deg/) || [0, 90])[1]);
    const a = ((ang - 90) * Math.PI) / 180;
    const stops = [...p.css.matchAll(/#([0-9a-f]{6})\s+([\d.]+)%/gi)].map((m) => ({
      position: parseFloat(m[2]) / 100,
      color: { r: parseInt(m[1].slice(0, 2), 16) / 255, g: parseInt(m[1].slice(2, 4), 16) / 255, b: parseInt(m[1].slice(4, 6), 16) / 255, a: 1 },
    }));
    return { type: 'GRADIENT_LINEAR', visible: true, opacity: 1, gradientStops: stops, gradientTransform: [[Math.cos(a), Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0]] };
  }
  return null;
}

function mockNode(t, parent) {
  const n = {
    id: t.id, name: t.name, type: t.type, parent, visible: t.visible !== false, opacity: t.opacity ?? 1, blendMode: t.blendMode || 'PASS_THROUGH',
    absoluteTransform: t.transform ? [[t.transform[0][0], t.transform[0][1], t.transform[0][2]], [t.transform[1][0], t.transform[1][1], t.transform[1][2]]] : [[1, 0, t.x], [0, 1, t.y]],
    width: t.size ? t.size.w : t.w, height: t.size ? t.size.h : t.h, rotation: t.rotation || 0,
    absoluteBoundingBox: { x: t.x, y: t.y, width: t.w, height: t.h },
    absoluteRenderBounds: { x: t.x, y: t.y, width: t.w, height: t.h },
    fills: (t.fills || []).map(figmaPaint).filter(Boolean),
    strokes: (t.strokes || []).map(figmaPaint).filter(Boolean),
    strokeWeight: t.strokeWeight ?? 0, strokeAlign: t.strokeAlign || 'INSIDE',
    effects: (t.effects || []).map((e) => (e.type.endsWith('SHADOW')
      ? { type: e.type, visible: true, offset: { x: e.x, y: e.y }, radius: e.blur, spread: e.spread, color: e.color }
      : { type: e.type, visible: true, radius: e.radius })),
    clipsContent: !!t.clipsContent, isMask: !!t.isMask,
    layoutMode: t.layout ? t.layout.mode : 'NONE',
    layoutPositioning: t.layoutPositioning || 'AUTO',
    async exportAsync(o) {
      if (o.format === 'PNG') return pngBytes;
      return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    },
  };
  if (t.radius) {
    const [a, b, c, d] = Array.isArray(t.radius) ? t.radius : [t.radius, t.radius, t.radius, t.radius];
    if (a === b && b === c && c === d) n.cornerRadius = a;
    else Object.assign(n, { cornerRadius: MIXED, topLeftRadius: a, topRightRadius: b, bottomRightRadius: c, bottomLeftRadius: d });
  } else if (t.type !== 'TEXT') n.cornerRadius = 0;
  if (t.layout) {
    const L = t.layout;
    Object.assign(n, {
      itemSpacing: L.gap === 'auto' ? 0 : L.gap, paddingTop: L.padding[0], paddingRight: L.padding[1], paddingBottom: L.padding[2], paddingLeft: L.padding[3],
      primaryAxisAlignItems: L.primaryAlign, counterAxisAlignItems: L.counterAlign, layoutWrap: L.wrap ? 'WRAP' : 'NO_WRAP', counterAxisSpacing: L.counterGap || 0,
    });
  }
  if (t.type === 'TEXT') {
    n.characters = t.text.characters;
    n.textAlignHorizontal = t.text.align; n.textAlignVertical = t.text.verticalAlign; n.textAutoResize = t.text.autoResize;
    n.getStyledTextSegments = () => t.text.segments.map((s) => ({
      start: s.start, end: s.end, characters: t.text.characters.slice(s.start, s.end),
      fontName: { family: s.fontFamily, style: s.fontStyle }, fontWeight: s.fontWeight || styleWeight(s.fontStyle), fontSize: s.fontSize,
      lineHeight: s.lineHeight.unit === 'AUTO' ? { unit: 'AUTO' } : s.lineHeight, letterSpacing: s.letterSpacing,
      fills: (s.fills || []).map(figmaPaint).filter(Boolean), textDecoration: s.textDecoration || 'NONE', textCase: s.textCase || 'ORIGINAL',
    }));
  }
  if (t.children) n.children = t.children.map((c) => mockNode(c, n));
  return n;
}

const page = { type: 'PAGE', name: 'Landing', children: [], selection: [] };
const frame = mockNode(tree, page);
page.children = [frame];
const posted = [];
const ui = { postMessage: (m) => posted.push(m), onmessage: null };
const figma = {
  mixed: MIXED, root: { name: 'Mock file', children: [page] }, currentPage: page, ui,
  showUI() {}, notify() {}, loadAllPagesAsync: async () => {},
  getImageByHash: () => null,
  getLocalPaintStylesAsync: async () => [], getLocalTextStylesAsync: async () => [], getLocalEffectStylesAsync: async () => [],
  variables: { getLocalVariableCollectionsAsync: async () => [], getLocalVariablesAsync: async () => [] },
};
const code = fs.readFileSync(path.join(here, '../dist/code.js'), 'utf8');
const ctx = vm.createContext({ figma, __html__: '', console, Promise, Date, JSON, Math, Object, Array, String, Number, Symbol, TextEncoder });
vm.runInContext(code, ctx);

async function press(what) {
  posted.length = 0;
  await ui.onmessage({ type: 'export', what, scope: 'page', scale: 1 });
  const err = posted.find((m) => m.type === 'error');
  if (err) throw new Error(err.text);
  return posted.filter((m) => m.type === 'file');
}

const pkgFiles = await press('pkg');
fs.rmSync(outDir, { recursive: true, force: true });
for (const f of pkgFiles) {
  const p = path.join(outDir, 'package', f.path);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof f.data === 'string' ? f.data : Buffer.from(f.data));
}
const pngFiles = await press('png');
for (const f of pngFiles) {
  const p = path.join(outDir, 'png', f.path);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(f.data));
}

// сверка: геометрия и текст каждого узла после экспорта
const exported = JSON.parse(fs.readFileSync(path.join(outDir, 'package/frames', fs.readdirSync(path.join(outDir, 'package/frames')).find((f) => f.endsWith('.json'))), 'utf8'));
const flat = (t, m = new Map()) => { m.set(t.id, t); (t.children || []).forEach((c) => flat(c, m)); return m; };
const A = flat(tree), B = flat(exported);
const problems = [];
for (const [id, a] of A) {
  const b = B.get(id);
  if (!b) { problems.push(`нет узла ${id}`); continue; }
  for (const k of ['x', 'y', 'w', 'h']) if (Math.abs(a[k] - b[k]) > 0.01) problems.push(`${a.name}.${k}: ${a[k]} → ${b[k]}`);
  if (a.text && a.text.characters !== b.text?.characters) problems.push(`${a.name}: текст`);
}
const fonts = JSON.parse(fs.readFileSync(path.join(outDir, 'package/fonts.json'), 'utf8'));
console.log(`пакет: файлов ${pkgFiles.length}; PNG: ${pngFiles.map((f) => f.path).join(', ')}`);
console.log(`узлов ${A.size}, расхождений после экспорта: ${problems.length}${problems.length ? '\n  ' + problems.slice(0, 10).join('\n  ') : ''}`);
console.log(`шрифты: ${fonts.map((f) => `${f.family} ${f.style} (${f.uses})`).join(', ')}`);
if (problems.length) process.exitCode = 1;
