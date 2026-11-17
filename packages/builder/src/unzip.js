// Распаковка zip без внешних программ (unzip / PowerShell есть не везде, а в установленной программе — тем более).
// Поддерживает то, что делают плагин и обычные архиваторы: без сжатия (stored) и deflate.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function unzipFile(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  // конец центрального каталога: ищем сигнатуру с конца (после неё может быть комментарий)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не zip-архив или он повреждён');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(destDir);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Повреждён каталог zip-архива');
    const method = buf.readUInt16LE(p + 10);
    const flags = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? rawName.toString('utf8') : rawName.toString('utf8')).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Опасный путь в архиве: ${name}`);
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    let out;
    if (method === 0) out = data;
    else if (method === 8) out = zlib.inflateRawSync(data);
    else throw new Error(`Неподдерживаемое сжатие в архиве (метод ${method}): пересохраните архив обычным zip`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out);
  }
}
