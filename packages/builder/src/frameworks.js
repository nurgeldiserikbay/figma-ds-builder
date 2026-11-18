// Экспорт в React и Vue из того же дерева элементов, что и HTML: разметка совпадает до элемента.
// Компоненты — из components.js. Проверка: страницы рендерятся на сервере (React SSR, Vue SSR)
// и сравниваются с уже проверенной HTML-версией — пиксели и геометрия.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pascal } from './components.js';
import { responsiveCss } from './responsive.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const ASSET_PREFIX = '../assets/';
const camelCss = (k) => k.trim().replace(/^-(webkit|moz|ms)-/, (m, v) => v[0].toUpperCase() + v.slice(1) + '-').replace(/-([a-z])/g, (m, c) => c.toUpperCase());

function styleEntries(str) {
  return (str || '').split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return [camelCss(d.slice(0, i)), d.slice(i + 1).trim()];
  });
}
const styleObjJs = (str) => `{ ${styleEntries(str).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }`;
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const jsStr = (s) => JSON.stringify(s).replace(/</g, '\\u003c');
const assetRel = (src) => (src.startsWith(ASSET_PREFIX) ? src.slice(ASSET_PREFIX.length) : null);

function pathKey(p) { return p.join('.'); }

/**
 * Векторы (inline SVG) — в одном модуле icons.js, одинаковые один раз; в коде страниц — icons.имя.
 * Агенту не нужно читать килобайты путей SVG, чтобы понять страницу.
 */
function iconRegistry() {
  const byText = new Map();
  const used = new Set();
  return {
    ref(svg, hint) {
      if (!byText.has(svg)) {
        let base = String(hint || 'icon').replace(/-[a-z0-9]{4,6}$/, '').replace(/[^a-zA-Z0-9]+(.)?/g, (m, ch) => (ch ? ch.toUpperCase() : '')).replace(/^[^a-zA-Z]+/, '');
        base = base ? base[0].toLowerCase() + base.slice(1) : 'icon';
        let n = base, k = 2;
        while (used.has(n)) n = `${base}${k++}`;
        used.add(n);
        byText.set(svg, n);
      }
      return byText.get(svg);
    },
    get size() { return byText.size; },
    object() { return Object.fromEntries([...byText].map(([t, n]) => [n, t])); },
    module() {
      return `// Векторы из макета (SVG). Страницы и компоненты ссылаются на них как icons.имя.\n// Файл большой: читать целиком не нужно — заменить иконку можно, поправив одну строку.\nexport const icons = {\n${[...byText].map(([t, n]) => `  ${n}: ${jsStr(t)},`).join('\n')}\n};\n`;
    },
  };
}

/**
 * Какие слои Figma нужны отдаваемому коду: только те, на которые ссылается CSS поправок ([data-figma-id="…"]).
 * Остальные data-figma-id и все data-name — служебные, в коде проекта они только тратят токены.
 */
export function keptIds(css) {
  return new Set([...css.matchAll(/\[data-figma-id="([^"]+)"\]/g)].map((m) => m[1]));
}
const shipCss = (css) => css.replace(/\[data-figma-id\] > span:has\(/g, 'span:has(');

function propMap(comp) {
  const m = new Map();
  for (const pr of comp.props) {
    if (!m.has(pr.path)) m.set(pr.path, {});
    m.get(pr.path)[pr.kind] = pr.name;
  }
  return m;
}

/** Значение параметра в месте использования (React — JS-выражение). */
function reactPropValue(kind, v) {
  if (kind === 'style') return styleObjJs(v);
  if (kind === 'src') { const rel = assetRel(v || ''); return rel ? `asset(${jsStr(rel)})` : jsStr(v || ''); }
  return jsStr(v ?? '');
}
/** Vue — выражение для :prop. */
function vuePropValue(kind, v) {
  if (kind === 'src') { const rel = assetRel(v || ''); return rel ? `asset(${jsStr(rel)})` : jsStr(v || ''); }
  return jsStr(v ?? '');
}

/** c.keep = null — проверка (все метки слоёв); Set — отдаваемый код (только нужные CSS поправок). */
function keepAttr(k, v, pk, c) {
  if (!c.keep) return true;
  if (k === 'data-name') return false;
  if (k !== 'data-figma-id') return true;
  return c.mode === 'comp' ? c.keepIdx.has(c.idIndex.get(pk)) : c.keep.has(v);
}
/** Индексы слоёв компонента, нужные хотя бы одному его экземпляру. */
function keepIdxOf(comp, keep, instanceOf) {
  if (!keep) return new Set(comp.idPaths.map((p, i) => i));
  const out = new Set();
  for (const el of comp.instances || []) {
    const ids = instanceOf?.get(el)?.ids || [];
    ids.forEach((id, i) => { if (keep.has(id)) out.add(i); });
  }
  return out;
}
function idsFor(inst, keep) {
  if (!keep) return inst.ids;
  if (!inst.ids.some((id) => keep.has(id))) return null;
  return inst.ids.map((id) => (keep.has(id) ? id : null));
}
const dataName = (el) => (el.attrs || []).find(([k]) => k === 'data-name')?.[1];
/** Значение html-параметра компонента: ссылка на icons.js. */
function htmlProp(v, c, hint) {
  c.usesIcons = true;
  return `icons.${c.icons.ref(v ?? '', hint)}`;
}

// ---------------------------------------------------------------------------------------------
// React (JSX)
// ---------------------------------------------------------------------------------------------

function jsx(el, c, depth, p = []) {
  const pad = '  '.repeat(depth);
  const pk = pathKey(p);
  if (c.mode === 'page' && c.instanceOf.has(el)) {
    const inst = c.instanceOf.get(el);
    c.used.add(inst.comp.name);
    const props = inst.comp.props.map((pr) => {
      if (pr.kind === 'src' && assetRel(inst.values[pr.name] || '')) c.usesAsset = true;
      if (pr.kind === 'html') return `${pr.name}={${htmlProp(inst.values[pr.name], c, pr.name)}}`;
      return `${pr.name}={${reactPropValue(pr.kind, inst.values[pr.name])}}`;
    });
    const ids = idsFor(inst, c.keep);
    if (ids) props.push(`ids={${JSON.stringify(ids)}}`);
    if (el.style) props.push(`style={${styleObjJs(el.style)}}`);
    return `${pad}<${inst.comp.name} ${props.join(' ')} />`;
  }
  const pp = c.propAt?.get(pk) || {};
  if (el.text !== undefined) {
    return `${pad}<span className=${pp.cls ? `{${pp.cls}}` : `"${el.cls}"`}>{${pp.text || jsStr(el.text)}}</span>`;
  }
  const attrs = [];
  if (pp.cls) attrs.push(`className={${pp.cls}}`);
  else if (el.cls) attrs.push(`className="${el.cls}"`);
  if (el.html !== undefined) {
    attrs.push(pp.style ? `style={${pp.style}}` : `style={${styleObjJs(el.style)}}`);
    c.usesIcons ||= !pp.html;
    attrs.push(`dangerouslySetInnerHTML={{ __html: ${pp.html || `icons.${c.icons.ref(el.html, c.hint || el.cls)}`} }}`);
    return `${pad}<span ${attrs.join(' ')} />`;
  }
  if (el.tag === 'img') {
    const src = el.attrs.find(([k]) => k === 'src')[1];
    const rel = assetRel(src);
    if (pp.src) attrs.unshift(`src={${pp.src}}`);
    else { c.usesAsset ||= !!rel; attrs.unshift(rel ? `src={asset(${jsStr(rel)})}` : `src=${jsStr(src)}`); }
    attrs.push('alt=""');
    attrs.push(pp.style ? `style={${pp.style}}` : `style={${styleObjJs(el.style)}}`);
    return `${pad}<img ${attrs.join(' ')} />`;
  }
  const isRoot = p.length === 0;
  if (c.mode === 'comp' && isRoot) attrs.push('style={style}');
  else if (pp.style) attrs.push(`style={${pp.style}}`);
  else if (el.style) attrs.push(`style={${styleObjJs(el.style)}}`);
  for (const [k, v] of el.attrs || []) {
    if (!keepAttr(k, v, pk, c)) continue;
    if (k === 'data-figma-id' && c.mode === 'comp') attrs.push(`data-figma-id={ids?.[${c.idIndex.get(pk)}]}`);
    else attrs.push(`${k}=${jsStr(v)}`);
  }
  const kids = el.children || [];
  if (!kids.length) return `${pad}<${el.tag} ${attrs.join(' ')} />`;
  const prevHint = c.hint;
  c.hint = dataName(el) || prevHint; // имя иконки — по слою Figma вокруг неё («icon/check» → iconCheck)
  const inner = kids.map((k, i) => jsx(k, c, depth + 1, [...p, i])).join('\n');
  c.hint = prevHint;
  return `${pad}<${el.tag} ${attrs.join(' ')}>\n${inner}\n${pad}</${el.tag}>`;
}

function reactComponent(comp, o = {}) {
  const keepIdx = keepIdxOf(comp, o.keep, o.instanceOf);
  const c = { mode: 'comp', propAt: propMap(comp), idIndex: new Map(comp.idPaths.map((p, i) => [p, i])), used: new Set(), keep: o.keep, keepIdx, icons: o.icons };
  const body = jsx(comp.template, c, 2);
  const withIds = keepIdx.size > 0;
  const args = [...comp.props.map((p) => p.name), ...(withIds ? ['ids'] : []), 'style'].join(', ');
  const imports = [c.usesAsset && "import { asset } from '../assets.js';", c.usesIcons && "import { icons } from '../icons.js';"].filter(Boolean);
  return `${imports.length ? imports.join('\n') + '\n\n' : ''}/** Компонент из макета: ${comp.instances.length} использований.${withIds ? ' ids — слои Figma, к которым привязаны поправки в CSS.' : ''} */
export default function ${comp.name}({ ${args} }) {
  return (
${body}
  );
}
`;
}

function reactPage(page, comps, o = {}) {
  const c = { mode: 'page', instanceOf: comps.instanceOf, used: new Set(), keep: o.keep, icons: o.icons };
  const body = jsx(page.root, c, 2);
  const imports = [...c.used].sort().map((n) => `import ${n} from '../components/${n}.jsx';`);
  if (c.usesIcons) imports.unshift("import { icons } from '../icons.js';");
  if (c.usesAsset) imports.unshift("import { asset } from '../assets.js';");
  return `${imports.join('\n')}${imports.length ? '\n\n' : ''}export default function ${page.component}() {
  return (
${body}
  );
}
`;
}

// ---------------------------------------------------------------------------------------------
// Vue (SFC)
// ---------------------------------------------------------------------------------------------

function vueTpl(el, c, depth, p = []) {
  const pad = '  '.repeat(depth);
  const pk = pathKey(p);
  if (c.mode === 'page' && c.instanceOf.has(el)) {
    const inst = c.instanceOf.get(el);
    c.used.add(inst.comp.name);
    const props = inst.comp.props.map((pr) => {
      if (pr.kind === 'src' && assetRel(inst.values[pr.name] || '')) c.usesAsset = true;
      if (pr.kind === 'html') return `:${pr.name}="${htmlProp(inst.values[pr.name], c, pr.name)}"`;
      return `:${pr.name}="${escAttr(vuePropValue(pr.kind, inst.values[pr.name]))}"`;
    });
    const ids = idsFor(inst, c.keep);
    if (ids) props.push(`:ids="${escAttr(JSON.stringify(ids))}"`);
    if (el.style) props.push(`style="${escAttr(el.style)}"`);
    return `${pad}<${inst.comp.name} ${props.join(' ')} />`;
  }
  const pp = c.propAt?.get(pk) || {};
  if (el.text !== undefined) {
    return `${pad}<span ${pp.cls ? `:class="${pp.cls}"` : `class="${el.cls}"`}>{{ ${pp.text || escAttr(jsStr(el.text))} }}</span>`;
  }
  const attrs = [];
  if (pp.cls) attrs.push(`:class="${pp.cls}"`);
  else if (el.cls) attrs.push(`class="${el.cls}"`);
  if (el.html !== undefined) {
    attrs.push(pp.style ? `:style="${pp.style}"` : `style="${escAttr(el.style)}"`);
    c.usesIcons ||= !pp.html;
    attrs.push(`v-html="${pp.html || `icons.${c.icons.ref(el.html, c.hint || el.cls)}`}"`);
    return `${pad}<span ${attrs.join(' ')}></span>`;
  }
  if (el.tag === 'img') {
    const src = el.attrs.find(([k]) => k === 'src')[1];
    const rel = assetRel(src);
    if (pp.src) attrs.unshift(`:src="${pp.src}"`);
    else { c.usesAsset ||= !!rel; attrs.unshift(rel ? `:src="asset(${escAttr(jsStr(rel))})"` : `src="${escAttr(src)}"`); }
    attrs.push('alt=""', pp.style ? `:style="${pp.style}"` : `style="${escAttr(el.style)}"`);
    return `${pad}<img ${attrs.join(' ')} />`;
  }
  const isRoot = p.length === 0;
  if (c.mode === 'comp' && isRoot) attrs.push(':style="style"');
  else if (pp.style) attrs.push(`:style="${pp.style}"`);
  else if (el.style) attrs.push(`style="${escAttr(el.style)}"`);
  for (const [k, v] of el.attrs || []) {
    if (!keepAttr(k, v, pk, c)) continue;
    if (k === 'data-figma-id' && c.mode === 'comp') attrs.push(`:data-figma-id="ids?.[${c.idIndex.get(pk)}]"`);
    else attrs.push(`${k}="${escAttr(v)}"`);
  }
  const kids = el.children || [];
  if (!kids.length) return `${pad}<${el.tag} ${attrs.join(' ')}></${el.tag}>`;
  const prevHint = c.hint;
  c.hint = dataName(el) || prevHint;
  const inner = kids.map((k, i) => vueTpl(k, c, depth + 1, [...p, i])).join('\n');
  c.hint = prevHint;
  return `${pad}<${el.tag} ${attrs.join(' ')}>\n${inner}\n${pad}</${el.tag}>`;
}

function vueComponentParts(comp, o = {}) {
  const keepIdx = keepIdxOf(comp, o.keep, o.instanceOf);
  const c = { mode: 'comp', propAt: propMap(comp), idIndex: new Map(comp.idPaths.map((p, i) => [p, i])), used: new Set(), keep: o.keep, keepIdx, icons: o.icons };
  const template = vueTpl(comp.template, c, 1);
  const props = [...comp.props.map((p) => p.name), ...(keepIdx.size ? ['ids'] : []), 'style'];
  return { template, props, usesAsset: c.usesAsset, usesIcons: c.usesIcons, withIds: keepIdx.size > 0 };
}

function vueComponent(comp, o = {}) {
  const { template, props, usesAsset, usesIcons, withIds } = vueComponentParts(comp, o);
  const kinds = Object.fromEntries(comp.props.map((p) => [p.name, p.kind]));
  const defs = props.map((p) => (p === 'ids' ? 'ids: Array' : p === 'style' || kinds[p] === 'style' ? `${p}: [String, Object]` : `${p}: String`)).join(', ');
  return `<script setup>
${usesAsset ? "import { asset } from '../assets.js';\n" : ''}${usesIcons ? "import { icons } from '../icons.js';\n" : ''}// Компонент из макета: ${comp.instances.length} использований.${withIds ? ' ids — слои Figma, к которым привязаны поправки в CSS.' : ''}
defineProps({ ${defs} });
</script>

<template>
${template}
</template>
`;
}

function vuePageParts(page, comps, o = {}) {
  const c = { mode: 'page', instanceOf: comps.instanceOf, used: new Set(), keep: o.keep, icons: o.icons };
  const template = vueTpl(page.root, c, 1);
  return { template, used: [...c.used].sort(), usesAsset: c.usesAsset, usesIcons: c.usesIcons };
}

function vuePage(page, comps, o = {}) {
  const { template, used, usesAsset, usesIcons } = vuePageParts(page, comps, o);
  return `<script setup>
${usesAsset ? "import { asset } from '../assets.js';\n" : ''}${usesIcons ? "import { icons } from '../icons.js';\n" : ''}${used.map((n) => `import ${n} from '../components/${n}.vue';`).join('\n')}
</script>

<template>
${template}
</template>
`;
}

// ---------------------------------------------------------------------------------------------
// Проекты
// ---------------------------------------------------------------------------------------------

/**
 * Общий CSS: токены и стили страниц без повторов; шрифты (@font-face, с копированием файлов) — отдельно,
 * в fonts.css: там сотни строк диапазонов символов, агенту их читать незачем.
 */
function siteCss(siteDir, pages, fontsOut) {
  const parts = [];
  let fonts = '';
  const fontsCss = path.join(siteDir, 'fonts.css');
  if (fs.existsSync(fontsCss)) {
    fs.mkdirSync(fontsOut, { recursive: true });
    fonts = (fs.readFileSync(fontsCss, 'utf8').replace(/url\((file:[^)]+)\)/g, (m, u) => {
      const file = fileURLToPath(u);
      const name = path.basename(file);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(fontsOut, name));
      return `url(/fonts/${name})`;
    }));
  }
  for (const f of fs.readdirSync(siteDir).filter((n) => /^extra-\d+\.css$/.test(n))) fonts += '\n' + fs.readFileSync(path.join(siteDir, f), 'utf8');
  parts.push(fs.readFileSync(path.join(siteDir, 'tokens.css'), 'utf8'));
  const seen = new Set();
  for (const p of pages) {
    for (const line of fs.readFileSync(path.join(siteDir, p.dir, 'styles.css'), 'utf8').split('\n')) {
      if (!line.trim() || seen.has(line)) continue;
      seen.add(line);
      parts.push(line.replace(/url\("\.\.\/assets\//g, 'url("/assets/'));
    }
  }
  return { fonts: fonts ? fonts + '\n' : '', css: parts.join('\n') + '\n' };
}

/** Общее для React и Vue: CSS проекта, нужные метки слоёв, реестр иконок. */
function shipOptions(siteDir, pages, comps, root, resp) {
  const sc = siteCss(siteDir, pages, path.join(root, 'public/fonts'));
  const raw = sc.css + resp.map((r) => r.css).join('\n') + '\n';
  return { fonts: sc.fonts, css: shipCss(raw), keep: keptIds(raw), icons: iconRegistry(), instanceOf: comps.instanceOf };
}

function writeFiles(root, files) {
  for (const [rel, data] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
}

const pageKey = (p) => pascal(p.title).replace(/^C(?=\d)/, 'Page');

export function preparePages(pages) {
  const used = new Set();
  return pages.map((p) => {
    let n = pageKey(p), k = 2;
    while (used.has(n)) n = `${pageKey(p)}${k++}`;
    used.add(n);
    return { ...p, component: n, route: n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() };
  });
}

function respInfo(groups) {
  return groups.map((g) => {
    const name = `${pascal(g.name)}Responsive`;
    const prefix = `bp-${pascal(g.name).toLowerCase()}`;
    return { ...g, component: name, route: name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(), prefix, css: responsiveCss(g.widths, prefix) };
  });
}

function reactResponsive(r) {
  const smallest = r.widths[0];
  return `import { useEffect, useRef } from 'react';
${r.members.map((m) => `import ${m.component} from './${m.component}.jsx';`).join('\n')}

/** Адаптивная страница: макеты ${r.widths.join(' / ')} px, переключение — в site.css (@media). */
export default function ${r.component}() {
  const first = useRef(null);
  useEffect(() => {
    // уже самого узкого макета — пропорциональное уменьшение
    const fit = () => { const el = first.current?.firstElementChild; if (el) el.style.zoom = innerWidth < ${smallest} ? String(innerWidth / ${smallest}) : ''; };
    fit(); addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return (
    <>
${r.members.map((m, i) => `      <div className="${r.prefix} ${r.prefix}-${i}"${i === 0 ? ' ref={first}' : ''}><${m.component} /></div>`).join('\n')}
    </>
  );
}
`;
}

function vueResponsive(r) {
  const smallest = r.widths[0];
  return `<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
${r.members.map((m) => `import ${m.component} from './${m.component}.vue';`).join('\n')}
// Адаптивная страница: макеты ${r.widths.join(' / ')} px, переключение — в site.css (@media).
const first = ref(null);
const fit = () => { const el = first.value?.firstElementChild; if (el) el.style.zoom = innerWidth < ${smallest} ? String(innerWidth / ${smallest}) : ''; };
onMounted(() => { fit(); addEventListener('resize', fit); });
onUnmounted(() => removeEventListener('resize', fit));
</script>

<template>
${r.members.map((m, i) => `  <div class="${r.prefix} ${r.prefix}-${i}"${i === 0 ? ' ref="first"' : ''}><${m.component} /></div>`).join('\n')}
</template>
`;
}

export function exportReact(siteDir, pages, comps, groups = [], meta = {}) {
  const root = path.join(siteDir, 'react');
  fs.rmSync(root, { recursive: true, force: true });
  const resp = respInfo(groups);
  const routesList = [...resp, ...pages];
  const o = shipOptions(siteDir, pages, comps, root, resp);
  const files = {
    'package.json': JSON.stringify({ name: 'figma-ds-site-react', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.0' } }, null, 2) + '\n',
    'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
    'index.html': `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0]?.title || 'Сайт'}</title>\n</head>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>\n</body>\n</html>\n`,
    'src/assets.js': "export const asset = (p) => import.meta.env.BASE_URL + 'assets/' + p;\n",
    'src/main.jsx': "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles/fonts.css';\nimport './styles/site.css';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
    'src/App.jsx': `import { useEffect, useState } from 'react';
${routesList.map((p) => `import ${p.component} from './pages/${p.component}.jsx';`).join('\n')}

// Страницы из макетов; переключение — #${routesList[0]?.route}
const routes = { ${routesList.map((p) => `'${p.route}': ${p.component}`).join(', ')} };
const first = '${routesList[0]?.route}';

export default function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || first);
  useEffect(() => {
    const on = () => setRoute(location.hash.slice(1) || first);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const Page = routes[route] || routes[first];
  return <Page />;
}
`,
    'src/styles/site.css': o.css,
    'src/styles/fonts.css': o.fonts,
    'README.md': `# Вёрстка из Figma — React\n\nСгенерировано DS Builder. Компонентов: ${comps.components.length}, страниц: ${pages.length}.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nСтраницы: ${routesList.map((p) => `#${p.route}`).join(', ')}.\nКарта проекта для ИИ-агента — AGENTS.md.\n`,
  };
  for (const r of resp) files[`src/pages/${r.component}.jsx`] = reactResponsive(r);
  for (const c of comps.components) files[`src/components/${c.name}.jsx`] = reactComponent(c, o);
  for (const p of pages) files[`src/pages/${p.component}.jsx`] = reactPage(p, comps, o);
  if (o.icons.size) files['src/icons.js'] = o.icons.module();
  files['AGENTS.md'] = agentsMd('react', { pages, comps, resp, routesList, css: o.css, icons: o.icons.size, meta });
  writeFiles(root, files);
  if (fs.existsSync(path.join(siteDir, 'assets'))) fs.cpSync(path.join(siteDir, 'assets'), path.join(root, 'public/assets'), { recursive: true });
  return { dir: root, keep: o.keep };
}

export function exportVue(siteDir, pages, comps, groups = [], meta = {}) {
  const root = path.join(siteDir, 'vue');
  fs.rmSync(root, { recursive: true, force: true });
  const resp = respInfo(groups);
  const routesList = [...resp, ...pages];
  const o = shipOptions(siteDir, pages, comps, root, resp);
  const files = {
    'package.json': JSON.stringify({ name: 'figma-ds-site-vue', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { vue: '^3.5.0' },
      devDependencies: { vite: '^6.0.0', '@vitejs/plugin-vue': '^5.2.0' } }, null, 2) + '\n',
    'vite.config.js': "import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({ plugins: [vue()] });\n",
    'index.html': `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0]?.title || 'Сайт'}</title>\n</head>\n<body>\n<div id="app"></div>\n<script type="module" src="/src/main.js"></script>\n</body>\n</html>\n`,
    'src/assets.js': "export const asset = (p) => import.meta.env.BASE_URL + 'assets/' + p;\n",
    'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\nimport './styles/fonts.css';\nimport './styles/site.css';\n\ncreateApp(App).mount('#app');\n",
    'src/App.vue': `<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
${routesList.map((p) => `import ${p.component} from './pages/${p.component}.vue';`).join('\n')}

// Страницы из макетов; переключение — #${routesList[0]?.route}
const routes = { ${routesList.map((p) => `'${p.route}': ${p.component}`).join(', ')} };
const first = '${routesList[0]?.route}';
const route = ref(location.hash.slice(1) || first);
const on = () => (route.value = location.hash.slice(1) || first);
onMounted(() => addEventListener('hashchange', on));
onUnmounted(() => removeEventListener('hashchange', on));
const Page = computed(() => routes[route.value] || routes[first]);
</script>

<template>
  <component :is="Page" />
</template>
`,
    'src/styles/site.css': o.css,
    'src/styles/fonts.css': o.fonts,
    'README.md': `# Вёрстка из Figma — Vue\n\nСгенерировано DS Builder. Компонентов: ${comps.components.length}, страниц: ${pages.length}.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nСтраницы: ${routesList.map((p) => `#${p.route}`).join(', ')}.\nКарта проекта для ИИ-агента — AGENTS.md.\n`,
  };
  for (const r of resp) files[`src/pages/${r.component}.vue`] = vueResponsive(r);
  for (const c of comps.components) files[`src/components/${c.name}.vue`] = vueComponent(c, o);
  for (const p of pages) files[`src/pages/${p.component}.vue`] = vuePage(p, comps, o);
  if (o.icons.size) files['src/icons.js'] = o.icons.module();
  files['AGENTS.md'] = agentsMd('vue', { pages, comps, resp, routesList, css: o.css, icons: o.icons.size, meta });
  writeFiles(root, files);
  if (fs.existsSync(path.join(siteDir, 'assets'))) fs.cpSync(path.join(siteDir, 'assets'), path.join(root, 'public/assets'), { recursive: true });
  return { dir: root, keep: o.keep };
}

// ---------------------------------------------------------------------------------------------
// Серверный рендер для проверки
// ---------------------------------------------------------------------------------------------

/** React: те же .jsx-файлы, asset → ../assets/, бандл esbuild, renderToStaticMarkup. */
export async function renderReact(pages, comps, opt = {}) {
  const esbuild = require('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-react-'));
  const files = { 'assets.js': `export const asset = (p) => ${jsStr(opt.assetPrefix || ASSET_PREFIX)} + p;\n` };
  // keep: null — с метками всех слоёв (проверка геометрии); Set — ровно как в отдаваемом проекте
  const o = { keep: opt.keep || null, icons: iconRegistry(), instanceOf: comps.instanceOf };
  for (const c of comps.components) files[`components/${c.name}.jsx`] = reactComponent(c, o);
  for (const p of pages) files[`pages/${p.component}.jsx`] = reactPage(p, comps, o);
  files['icons.js'] = o.icons.module();
  files['entry.jsx'] = `import { renderToStaticMarkup } from 'react-dom/server';
${pages.map((p) => `import ${p.component} from './pages/${p.component}.jsx';`).join('\n')}
export const out = { ${pages.map((p) => `${jsStr(p.component)}: renderToStaticMarkup(<${p.component} />)`).join(', ')} };
`;
  writeFiles(tmp, files);
  const outFile = path.join(tmp, 'bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(tmp, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: outFile,
    // где лежит react: в репозитории — packages/builder/node_modules, в установленной программе — выше
    jsx: 'automatic', nodePaths: [path.dirname(path.dirname(createRequire(import.meta.url).resolve('react/package.json')))], logLevel: 'silent',
  });
  const { out } = require(outFile);
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

/** Vue: те же шаблоны, компиляция в рантайме, renderToString. */
export async function renderVue(pages, comps, opt = {}) {
  const vue = require('vue');
  const { renderToString } = require('@vue/server-renderer');
  const out = {};
  const o = { keep: opt.keep || null, icons: iconRegistry(), instanceOf: comps.instanceOf };
  for (const p of pages) {
    const { template, used } = vuePageParts(p, comps, o);
    const app = vue.createSSRApp({ template });
    app.config.globalProperties.asset = (x) => (opt.assetPrefix || ASSET_PREFIX) + x;
    app.config.compilerOptions.whitespace = 'condense';
    const parts = comps.components.filter((c) => used.includes(c.name)).map((c) => [c.name, vueComponentParts(c, o)]);
    app.config.globalProperties.icons = o.icons.object();
    for (const [name, pt] of parts) app.component(name, { props: pt.props, template: pt.template });
    out[p.component] = await renderToString(app);
  }
  return out;
}

/** HTML-страница проверки: разметка фреймворка в том же окружении (CSS, шрифты), что и HTML-версия. */
export function checkPageHtml(htmlPage, markup, frameDir) {
  return htmlPage
    .replace(/<body>[\s\S]*<\/body>/, () => `<body>\n${markup}\n</body>`)
    .replace('href="styles.css"', `href="../${frameDir}/styles.css"`);
}

/**
 * Проверка отдаваемого проекта: его разметка (без служебных меток) с его же CSS (fonts.css + site.css).
 * Пути /fonts/ и /assets/ (корень сайта в Vite) → файлы public/ проекта.
 */
export function shippedCheckPage(htmlPage, markup, projectRoot, chkDir) {
  const pub = pathToFileURL(path.join(projectRoot, 'public')).href;
  const css = ['fonts.css', 'site.css'].map((f) => fs.readFileSync(path.join(projectRoot, 'src/styles', f), 'utf8')).join('\n')
    .replace(/url\((["']?)\/(fonts|assets)\//g, (m, q, d) => `url(${q}${pub}/${d}/`);
  fs.writeFileSync(path.join(chkDir, 'ship.css'), css);
  return htmlPage
    .replace(/<link rel="stylesheet"[^>]*>\n?/g, '')
    .replace('</head>', '<link rel="stylesheet" href="ship.css">\n</head>')
    .replace(/<body>[\s\S]*<\/body>/, () => `<body>\n${markup}\n</body>`);
}
export const projectAssetPrefix = (projectRoot) => pathToFileURL(path.join(projectRoot, 'public/assets')).href + '/';

export { pathToFileURL };

// ---------------------------------------------------------------------------------------------
// AGENTS.md — карта проекта для ИИ-агента: прочитать один файл вместо всего проекта
// ---------------------------------------------------------------------------------------------

/** Переменные :root из CSS: имя → значение. */
function cssVars(css) {
  const out = [];
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.push([d[1], d[2].trim()]);
  }
  return out;
}

export function agentsMd(kind, { pages, comps, resp = [], routesList, css, icons = 0, meta = {} }) {
  const ext = kind === 'react' ? 'jsx' : kind === 'vue' ? 'vue' : 'html';
  const L = [];
  L.push(`# ${meta.file || 'Сайт'} — вёрстка из Figma`);
  L.push('');
  const ck = meta.check;
  const verdict = !ck || !ck.total ? 'Сгенерировано DS Builder из макетов Figma.'
    : ck.passed === ck.total ? `Сгенерировано DS Builder из макетов Figma и сверено с макетами: совпадают все (${ck.total}).`
    : `Сгенерировано DS Builder из макетов Figma и сверено с макетами: совпадают ${ck.passed} из ${ck.total} макетов${ck.failed?.length ? ` (расходятся: ${ck.failed.slice(0, 8).join(', ')}${ck.failed.length > 8 ? '…' : ''})` : ''}; подробности — report.html в папке сборки.`;
  L.push(`${verdict} ` +
    `${kind === 'html' ? 'Обычные HTML и CSS.' : `${kind === 'react' ? 'React' : 'Vue'} + Vite: \`npm install && npm run dev\`.`}`);
  L.push('');
  L.push('## Страницы');
  L.push('');
  L.push(`| ${kind === 'html' ? 'файл' : 'маршрут'} | ${kind === 'html' ? 'стили' : 'файл'} | макет Figma | ширина |`);
  L.push('|---|---|---|---|');
  for (const r of resp) {
    L.push(kind === 'html'
      ? `| ${r.file || r.component} | — | ${r.name} (адаптивная) | ${r.widths.join(' / ')} |`
      : `| #${r.route} | src/pages/${r.component}.${ext} | ${r.name} (адаптивная: ${r.members.map((m) => m.component).join(', ')}) | ${r.widths.join(' / ')} |`);
  }
  for (const p of pages) {
    const src = p.page && !String(p.title).startsWith(p.page) ? `${p.page} / ${p.title}` : p.title;
    L.push(kind === 'html'
      ? `| ${p.file} | css/${p.css || ''} | ${src} | ${Math.round(p.width)} |`
      : `| #${p.route} | src/pages/${p.component}.${ext} | ${src} | ${Math.round(p.width)} |`);
  }
  if (comps?.components?.length && kind !== 'html') {
    L.push('');
    L.push('## Компоненты');
    L.push('');
    L.push('Повторяющиеся блоки макета. Параметры: text — текст, src — картинка, html — иконка из icons.js, cls — вариант оформления, style — положение.');
    L.push('');
    L.push('| компонент | параметры | использований |');
    L.push('|---|---|---|');
    for (const c of comps.components) {
      const props = c.props.map((p) => `${p.name}:${p.kind}`).join(', ') || '—';
      L.push(`| src/components/${c.name}.${ext} | ${props} | ${c.instances.length} |`);
    }
  }
  const vars = cssVars(css || '');
  if (vars.length) {
    L.push('');
    L.push(`## Дизайн-токены (${kind === 'html' ? 'css/tokens.css' : 'начало src/styles/site.css'})`);
    L.push('');
    const groups = new Map();
    for (const [k, v] of vars) {
      const g = k.replace(/^--/, '').split('-')[0];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(`${k}: ${v}`);
    }
    for (const [g, list] of groups) {
      const shown = list.slice(0, 40);
      L.push(`- ${g}: ${shown.map((x) => `\`${x}\``).join(', ')}${list.length > shown.length ? ` … ещё ${list.length - shown.length}` : ''}`);
    }
  }
  L.push('');
  L.push('## Как работать с проектом');
  L.push('');
  L.push('- Цвета, шрифты, тени — только через токены `var(--…)`, новые значения не вписывать.');
  L.push('- Размеры и отступы блоков взяты из макета и проверены. Не меняй их, если задача не об этом.');
  L.push(`- Классы с суффиксом (\`card-1x2y3\`) — стили конкретного блока ${kind === 'html' ? 'в css/<страница>.css' : 'в src/styles/site.css'}; найти стиль — поиском по имени класса.`);
  if (kind === 'html') L.push('- Иконки вставлены в страницы как <svg>: правь их там же или вынеси в файлы, если нужно.');
  if (icons) L.push(`- Иконки (${icons}) — в \`src/icons.js\`, в коде — \`icons.имя\`. Файл большой (SVG), читать его целиком не нужно.`);
  L.push(`- Не нужно читать: ${kind === 'html' ? '`css/fonts.css`' : '`src/styles/fonts.css`'} (шрифты)${icons ? ', `src/icons.js` (векторы)' : ''}, ${kind === 'html' ? '`assets/`' : '`public/`'} (файлы картинок и шрифтов).`);
  if (kind !== 'html') L.push('- Атрибуты `data-figma-id` и проп `ids` остаются только там, где к слою привязана поправка в CSS (`[data-figma-id="…"]`). Удалишь — поправка перестанет действовать.');
  L.push('');
  return L.join('\n');
}
