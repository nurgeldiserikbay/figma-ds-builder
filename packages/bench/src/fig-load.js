// Чтение .fig (zip → canvas.fig → kiwi-схема + сообщение NODE_CHANGES).
import fs from 'node:fs';
import { unzipSync, inflateSync } from 'fflate';
import { decompress as zstd } from 'fzstd';
import { decodeBinarySchema, compileSchema } from 'kiwi-schema';

function unpack(chunk) {
  // zstd (новые файлы) или raw deflate (старые)
  if (chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd) return zstd(chunk);
  return inflateSync(chunk);
}

// Контейнер fig-kiwi: "fig-kiwi" + uint32 версия + [uint32 размер + данные]…
function parseArchive(buf) {
  const prelude = Buffer.from(buf.slice(0, 8)).toString('latin1');
  if (prelude !== 'fig-kiwi') throw new Error('Не fig-kiwi: ' + prelude);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12;
  const files = [];
  while (off + 4 < buf.length) {
    const size = view.getUint32(off, true);
    off += 4;
    files.push(buf.subarray(off, off + size));
    off += size;
  }
  return { files };
}

export function loadFig(path) {
  const buf = new Uint8Array(fs.readFileSync(path));
  let canvas = buf;
  let images = {};
  let meta = null;
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const z = unzipSync(buf);
    canvas = z['canvas.fig'];
    if (z['meta.json']) meta = JSON.parse(Buffer.from(z['meta.json']).toString());
    for (const [k, v] of Object.entries(z)) if (k.startsWith('images/') && v.length) images[k.slice(7)] = v;
  }
  const { files } = parseArchive(canvas);
  const schema = compileSchema(decodeBinarySchema(unpack(files[0])));
  const message = schema.decodeMessage(unpack(files[1]));
  return { message, images, meta };
}
