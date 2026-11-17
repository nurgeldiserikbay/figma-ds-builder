// Скачать пакет из npm без самого npm: метаданные → tarball → распаковка в <dir>/node_modules/<name>.
// Запускается отдельным процессом (ensureFonts синхронный): node fetch-npm.js <dir> <name>
// Нужен установленной программе, где npm нет.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [dir, name] = process.argv.slice(2);
const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/+$/, '');

const res = await fetch(`${registry}/${name.replace('/', '%2F')}/latest`);
if (!res.ok) { console.error(`${name}: ${res.status}`); process.exit(2); }
const meta = await res.json();
const tgz = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
const tar = zlib.gunzipSync(tgz);
const dest = path.join(dir, 'node_modules', ...name.split('/'));
fs.rmSync(dest, { recursive: true, force: true });

// tar: блоки по 512 байт; путь «package/…» → в папку пакета
for (let p = 0; p + 512 <= tar.length;) {
  const h = tar.subarray(p, p + 512);
  if (h.every((b) => b === 0)) break;
  const str = (o, l) => h.subarray(o, o + l).toString('utf8').replace(/\0.*$/s, '');
  let file = str(0, 100);
  const prefix = str(345, 155);
  if (prefix) file = `${prefix}/${file}`;
  const size = parseInt(str(124, 12).trim() || '0', 8);
  const type = String.fromCharCode(h[156] || 48);
  p += 512;
  if (type === '0' || type === '\0') {
    const rel = file.replace(/^[^/]+\//, '');
    const target = path.resolve(dest, rel);
    if (target.startsWith(path.resolve(dest) + path.sep)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, tar.subarray(p, p + size));
    }
  }
  p += Math.ceil(size / 512) * 512;
}
