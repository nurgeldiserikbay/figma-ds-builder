// Сборка плагина в dist/: code.js (склейка src/*.js), ui.html, manifest.json.
// Figma загружает плагин из папки dist (Plugins → Development → Import plugin from manifest…).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });

const parts = ['export-package.js', 'import-tokens.js', 'main.js'].map((f) => `// ---- ${f} ----\n` + fs.readFileSync(path.join(src, f), 'utf8'));
const code = parts.join('\n');
// песочница Figma отклоняет код с «import» + «(» подряд, даже в строках и комментариях
if (/import\s*\(/.test(code)) throw new Error('В коде есть «import(» — Figma его не загрузит');
fs.writeFileSync(path.join(dist, 'code.js'), code);
fs.copyFileSync(path.join(src, 'ui.html'), path.join(dist, 'ui.html'));
fs.copyFileSync(path.join(here, 'manifest.json'), path.join(dist, 'manifest.json'));
console.log('Собрано: dist/ (code.js, ui.html, manifest.json)');
