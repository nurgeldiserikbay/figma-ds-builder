// Собирает fonts.css из установленных пакетов @fontsource/* (бесплатные Google-шрифты из npm).
// Пути к файлам — абсолютные file://, страницы открываются локально.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildFontsCss(cacheDir) {
  const root = path.join(cacheDir, 'node_modules', '@fontsource');
  if (!fs.existsSync(root)) return '';
  const out = [];
  for (const pkg of fs.readdirSync(root)) {
    const dir = path.join(root, pkg);
    for (const f of fs.readdirSync(dir).filter((n) => /^\d{3}(-italic)?\.css$/.test(n))) {
      const css = fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) => `url(${pathToFileURL(path.join(dir, 'files', file)).href})`);
      out.push(css);
    }
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cache, outFile] = process.argv.slice(2);
  fs.writeFileSync(outFile, buildFontsCss(cache));
  console.log('fonts.css:', outFile);
}
