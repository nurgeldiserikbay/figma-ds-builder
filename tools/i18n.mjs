// Переводы сайта, окна программы и плагина: выгрузить тексты со страниц и собрать словари.
// npm run i18n — после правки текстов; npm run i18n -- --check — проверка (тест): всё переведено и собрано.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const check = process.argv.includes('--check');
const run = (args, out) => { const r = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }); if (out) fs.writeFileSync(out, r); return r; };
execFileSync(process.execPath, ['packages/plugin/build.js'], { stdio: 'ignore' });
const sets = [
  ['landing', ['tools/i18n-keys.mjs', 'docs/index.html', 'tools/landing-extra.json'], 'tools/landing-keys.json', 'docs/i18n-data.js'],
  ['app', ['tools/app-i18n-keys.mjs'], 'tools/app-keys.json', 'packages/builder/src/app-i18n-data.js'],
  ['plugin', ['tools/plugin-i18n-keys.mjs'], 'tools/plugin-keys.json', 'packages/plugin/src/i18n-data.js'],
];
let failed = false;
for (const [name, cmd, keys, out] of sets) {
  const fresh = run(cmd);
  if (check) {
    if (fresh !== fs.readFileSync(keys, 'utf8')) {
      const was = new Set(JSON.parse(fs.readFileSync(keys, 'utf8')));
      const added = JSON.parse(fresh).filter((k) => !was.has(k));
      console.error(`${name}: тексты на странице изменились${added.length ? `, новые: ${added.slice(0, 5).join(' | ')}` : ''} — запустите npm run i18n`);
      failed = true; continue;
    }
  } else fs.writeFileSync(keys, fresh);
  try { execFileSync(process.execPath, ['tools/i18n-build.mjs', name, keys, out, ...(check ? ['--check'] : [])], { stdio: 'inherit' }); } catch { failed = true; }
}
// движок переводов один: сайт, программа, плагин (плагин берёт его из docs при сборке)
if (fs.readFileSync('docs/i18n.js', 'utf8') !== fs.readFileSync('packages/builder/src/i18n.js', 'utf8')) {
  if (check) { console.error('packages/builder/src/i18n.js отличается от docs/i18n.js'); failed = true; } else fs.copyFileSync('docs/i18n.js', 'packages/builder/src/i18n.js');
}
if (!check) execFileSync(process.execPath, ['packages/plugin/build.js'], { stdio: 'ignore' });
process.exit(failed ? 1 : 0);
