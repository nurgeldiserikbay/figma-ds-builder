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
      return `${pr.name}={${reactPropValue(pr.kind, inst.values[pr.name])}}`;
    });
    props.push(`ids={${JSON.stringify(inst.ids)}}`);
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
    if (k === 'data-figma-id' && c.mode === 'comp') attrs.push(`data-figma-id={ids?.[${c.idIndex.get(pk)}]}`);
    else attrs.push(`${k}=${jsStr(v)}`);
  }
  const kids = el.children || [];
  if (!kids.length) return `${pad}<${el.tag} ${attrs.join(' ')} />`;
  const inner = kids.map((k, i) => jsx(k, c, depth + 1, [...p, i])).join('\n');
  return `${pad}<${el.tag} ${attrs.join(' ')}>\n${inner}\n${pad}</${el.tag}>`;
}

function reactComponent(comp) {
  const c = { mode: 'comp', propAt: propMap(comp), idIndex: new Map(comp.idPaths.map((p, i) => [p, i])), used: new Set() };
  const body = jsx(comp.template, c, 2);
  const args = [...comp.props.map((p) => p.name), 'ids', 'style'].join(', ');
  return `${c.usesAsset ? "import { asset } from '../assets.js';\n\n" : ''}/** Компонент из макета: ${comp.instances.length} использований. ids — слои Figma (для сверки), можно не передавать. */
export default function ${comp.name}({ ${args} }) {
  return (
${body}
  );
}
`;
}

function reactPage(page, comps) {
  const c = { mode: 'page', instanceOf: comps.instanceOf, used: new Set() };
  const body = jsx(page.root, c, 2);
  const imports = [...c.used].sort().map((n) => `import ${n} from '../components/${n}.jsx';`);
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
      return `:${pr.name}="${escAttr(vuePropValue(pr.kind, inst.values[pr.name]))}"`;
    });
    props.push(`:ids="${escAttr(JSON.stringify(inst.ids))}"`);
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
    if (k === 'data-figma-id' && c.mode === 'comp') attrs.push(`:data-figma-id="ids?.[${c.idIndex.get(pk)}]"`);
    else attrs.push(`${k}="${escAttr(v)}"`);
  }
  const kids = el.children || [];
  if (!kids.length) return `${pad}<${el.tag} ${attrs.join(' ')}></${el.tag}>`;
  const inner = kids.map((k, i) => vueTpl(k, c, depth + 1, [...p, i])).join('\n');
  return `${pad}<${el.tag} ${attrs.join(' ')}>\n${inner}\n${pad}</${el.tag}>`;
}

function vueComponentParts(comp) {
  const c = { mode: 'comp', propAt: propMap(comp), idIndex: new Map(comp.idPaths.map((p, i) => [p, i])), used: new Set() };
  const template = vueTpl(comp.template, c, 1);
  const props = [...comp.props.map((p) => p.name), 'ids', 'style'];
  return { template, props, usesAsset: c.usesAsset };
}

function vueComponent(comp) {
  const { template, props, usesAsset } = vueComponentParts(comp);
  const kinds = Object.fromEntries(comp.props.map((p) => [p.name, p.kind]));
  const defs = props.map((p) => (p === 'ids' ? 'ids: Array' : p === 'style' || kinds[p] === 'style' ? `${p}: [String, Object]` : `${p}: String`)).join(', ');
  return `<script setup>
${usesAsset ? "import { asset } from '../assets.js';\n" : ''}// Компонент из макета: ${comp.instances.length} использований. ids — слои Figma (для сверки), можно не передавать.
defineProps({ ${defs} });
</script>

<template>
${template}
</template>
`;
}

function vuePageParts(page, comps) {
  const c = { mode: 'page', instanceOf: comps.instanceOf, used: new Set() };
  const template = vueTpl(page.root, c, 1);
  return { template, used: [...c.used].sort(), usesAsset: c.usesAsset };
}

function vuePage(page, comps) {
  const { template, used, usesAsset } = vuePageParts(page, comps);
  return `<script setup>
${usesAsset ? "import { asset } from '../assets.js';\n" : ''}${used.map((n) => `import ${n} from '../components/${n}.vue';`).join('\n')}
</script>

<template>
${template}
</template>
`;
}

// ---------------------------------------------------------------------------------------------
// Проекты
// ---------------------------------------------------------------------------------------------

/** Общий CSS: шрифты (с копированием файлов), токены, стили страниц — без повторов. */
function siteCss(siteDir, pages, fontsOut) {
  const parts = [];
  const fontsCss = path.join(siteDir, 'fonts.css');
  if (fs.existsSync(fontsCss)) {
    fs.mkdirSync(fontsOut, { recursive: true });
    parts.push(fs.readFileSync(fontsCss, 'utf8').replace(/url\((file:[^)]+)\)/g, (m, u) => {
      const file = fileURLToPath(u);
      const name = path.basename(file);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(fontsOut, name));
      return `url(/fonts/${name})`;
    }));
  }
  for (const f of fs.readdirSync(siteDir).filter((n) => /^extra-\d+\.css$/.test(n))) parts.push(fs.readFileSync(path.join(siteDir, f), 'utf8'));
  parts.push(fs.readFileSync(path.join(siteDir, 'tokens.css'), 'utf8'));
  const seen = new Set();
  for (const p of pages) {
    for (const line of fs.readFileSync(path.join(siteDir, p.dir, 'styles.css'), 'utf8').split('\n')) {
      if (!line.trim() || seen.has(line)) continue;
      seen.add(line);
      parts.push(line.replace(/url\("\.\.\/assets\//g, 'url("/assets/'));
    }
  }
  return parts.join('\n') + '\n';
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

export function exportReact(siteDir, pages, comps, groups = []) {
  const root = path.join(siteDir, 'react');
  fs.rmSync(root, { recursive: true, force: true });
  const resp = respInfo(groups);
  const routesList = [...resp, ...pages];
  const files = {
    'package.json': JSON.stringify({ name: 'figma-ds-site-react', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.0' } }, null, 2) + '\n',
    'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
    'index.html': `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0]?.title || 'Сайт'}</title>\n</head>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>\n</body>\n</html>\n`,
    'src/assets.js': "export const asset = (p) => import.meta.env.BASE_URL + 'assets/' + p;\n",
    'src/main.jsx': "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles/site.css';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
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
    'src/styles/site.css': siteCss(siteDir, pages, path.join(root, 'public/fonts')) + resp.map((r) => r.css).join('\n') + '\n',
    'README.md': `# Вёрстка из Figma — React\n\nСгенерировано figma-ds-builder. Компонентов: ${comps.components.length}, страниц: ${pages.length}.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nСтраницы: ${routesList.map((p) => `#${p.route}`).join(', ')}.\nПроп \`ids\` у компонентов связывает элементы со слоями Figma (нужен для сверки), его можно удалить.\n`,
  };
  for (const r of resp) files[`src/pages/${r.component}.jsx`] = reactResponsive(r);
  for (const c of comps.components) files[`src/components/${c.name}.jsx`] = reactComponent(c);
  for (const p of pages) files[`src/pages/${p.component}.jsx`] = reactPage(p, comps);
  writeFiles(root, files);
  if (fs.existsSync(path.join(siteDir, 'assets'))) fs.cpSync(path.join(siteDir, 'assets'), path.join(root, 'public/assets'), { recursive: true });
  return root;
}

export function exportVue(siteDir, pages, comps, groups = []) {
  const root = path.join(siteDir, 'vue');
  fs.rmSync(root, { recursive: true, force: true });
  const resp = respInfo(groups);
  const routesList = [...resp, ...pages];
  const files = {
    'package.json': JSON.stringify({ name: 'figma-ds-site-vue', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { vue: '^3.5.0' },
      devDependencies: { vite: '^6.0.0', '@vitejs/plugin-vue': '^5.2.0' } }, null, 2) + '\n',
    'vite.config.js': "import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({ plugins: [vue()] });\n",
    'index.html': `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0]?.title || 'Сайт'}</title>\n</head>\n<body>\n<div id="app"></div>\n<script type="module" src="/src/main.js"></script>\n</body>\n</html>\n`,
    'src/assets.js': "export const asset = (p) => import.meta.env.BASE_URL + 'assets/' + p;\n",
    'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\nimport './styles/site.css';\n\ncreateApp(App).mount('#app');\n",
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
    'src/styles/site.css': siteCss(siteDir, pages, path.join(root, 'public/fonts')) + resp.map((r) => r.css).join('\n') + '\n',
    'README.md': `# Вёрстка из Figma — Vue\n\nСгенерировано figma-ds-builder. Компонентов: ${comps.components.length}, страниц: ${pages.length}.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nСтраницы: ${routesList.map((p) => `#${p.route}`).join(', ')}.\nПроп \`ids\` у компонентов связывает элементы со слоями Figma (нужен для сверки), его можно удалить.\n`,
  };
  for (const r of resp) files[`src/pages/${r.component}.vue`] = vueResponsive(r);
  for (const c of comps.components) files[`src/components/${c.name}.vue`] = vueComponent(c);
  for (const p of pages) files[`src/pages/${p.component}.vue`] = vuePage(p, comps);
  writeFiles(root, files);
  if (fs.existsSync(path.join(siteDir, 'assets'))) fs.cpSync(path.join(siteDir, 'assets'), path.join(root, 'public/assets'), { recursive: true });
  return root;
}

// ---------------------------------------------------------------------------------------------
// Серверный рендер для проверки
// ---------------------------------------------------------------------------------------------

/** React: те же .jsx-файлы, asset → ../assets/, бандл esbuild, renderToStaticMarkup. */
export async function renderReact(pages, comps) {
  const esbuild = require('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-react-'));
  const files = { 'assets.js': `export const asset = (p) => ${jsStr(ASSET_PREFIX)} + p;\n` };
  for (const c of comps.components) files[`components/${c.name}.jsx`] = reactComponent(c);
  for (const p of pages) files[`pages/${p.component}.jsx`] = reactPage(p, comps);
  files['entry.jsx'] = `import { renderToStaticMarkup } from 'react-dom/server';
${pages.map((p) => `import ${p.component} from './pages/${p.component}.jsx';`).join('\n')}
export const out = { ${pages.map((p) => `${jsStr(p.component)}: renderToStaticMarkup(<${p.component} />)`).join(', ')} };
`;
  writeFiles(tmp, files);
  const outFile = path.join(tmp, 'bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(tmp, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: outFile,
    jsx: 'automatic', nodePaths: [path.join(here, '../node_modules')], logLevel: 'silent',
  });
  const { out } = require(outFile);
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

/** Vue: те же шаблоны, компиляция в рантайме, renderToString. */
export async function renderVue(pages, comps) {
  const vue = require('vue');
  const { renderToString } = require('@vue/server-renderer');
  const out = {};
  for (const p of pages) {
    const { template, used } = vuePageParts(p, comps);
    const app = vue.createSSRApp({ template });
    app.config.globalProperties.asset = (x) => ASSET_PREFIX + x;
    app.config.compilerOptions.whitespace = 'condense';
    for (const c of comps.components) {
      if (!used.includes(c.name)) continue;
      const parts = vueComponentParts(c);
      app.component(c.name, { props: parts.props, template: parts.template });
    }
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

export { pathToFileURL };
