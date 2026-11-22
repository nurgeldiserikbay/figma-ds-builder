// Словари переводов: tools/i18n/<имя>.<язык>.json — «русский текст → перевод».
// Список текстов берётся из самих страниц (tools/*-keys.mjs), поэтому новый текст без перевода сразу виден.
// node tools/i18n-build.mjs <имя> <keys.json> <выход.js> [--check]
import fs from 'node:fs';
const [name, keysFile, out] = process.argv.slice(2);
const check = process.argv.includes('--check');
const LANGS = ['en', 'zh', 'es', 'pt', 'de', 'fr', 'kk'];
const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
const tags = (s) => (s.match(/<\/?([a-z0-9]+)/gi) || []).map((t) => t.toLowerCase().replace(/[^a-z0-9/]/g, '')).sort().join(',');
const ph = (x) => [...new Set(x.match(/\{\w+\}/g) || [])].sort().join(',');
const data = { keys };
const problems = [];
for (const l of LANGS) {
  const dict = JSON.parse(fs.readFileSync(`tools/i18n/${name}.${l}.json`, 'utf8'));
  data[l] = keys.map((k) => {
    const t = dict[k];
    if (!t || !t.trim()) { problems.push(`${l}: нет перевода: ${k}`); return ''; }
    if (tags(t) !== tags(k)) problems.push(`${l}: теги не совпадают\n  ru: ${k}\n  ${l}: ${t}`);
    if (ph(t) !== ph(k)) problems.push(`${l}: подстановки не совпадают: ${ph(k)} → ${ph(t)}\n  ru: ${k}`);
    return t;
  });
  const extra = Object.keys(dict).filter((k) => !keys.includes(k));
  if (extra.length && !check) console.log(`${l}: переводы без текста на странице (можно удалить): ${extra.length}`);
}
if (problems.length) { console.error(`${name}: ${problems.length} проблем\n` + problems.slice(0, 30).join('\n')); process.exit(1); }
const js = `/* создано tools/i18n-build.mjs из tools/i18n/${name}.*.json — правьте их, а не этот файл */\nwindow.I18N_DATA = ${JSON.stringify(data)};\n`;
if (check) {
  if (fs.readFileSync(out, 'utf8') !== js) { console.error(`${out} устарел: запустите npm run i18n`); process.exit(1); }
  console.log(`${name}: ${keys.length} текстов, переводы на ${LANGS.length} языков — OK`);
} else {
  fs.writeFileSync(out, js);
  console.log(`${out}: ${keys.length} строк × ${LANGS.length + 1} языков`);
}
