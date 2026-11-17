// Простой zip без сжатия — тот же формат, что собирает плагин.
import fs from 'node:fs';
import path from 'node:path';

const T = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zipDir(dir) {
  const files = [];
  (function walk(d, p = '') {
    for (const n of fs.readdirSync(d)) {
      if (n.startsWith('.')) continue;
      const f = path.join(d, n), r = p ? `${p}/${n}` : n;
      fs.statSync(f).isDirectory() ? walk(f, r) : files.push([r, fs.readFileSync(f)]);
    }
  })(dir);
  const parts = [], cen = [];
  let off = 0;
  for (const [n, d] of files) {
    const nm = Buffer.from(n), h = Buffer.alloc(30), c = crc(d);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt32LE(c, 14);
    h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(nm.length, 26);
    parts.push(h, nm, d);
    const e = Buffer.alloc(46);
    e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(20, 4); e.writeUInt16LE(20, 6); e.writeUInt16LE(0x800, 8); e.writeUInt32LE(c, 16);
    e.writeUInt32LE(d.length, 20); e.writeUInt32LE(d.length, 24); e.writeUInt16LE(nm.length, 28); e.writeUInt32LE(off, 42);
    cen.push(e, nm);
    off += 30 + nm.length + d.length;
  }
  const cs = Buffer.concat(cen), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cs.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cs, end]);
}
