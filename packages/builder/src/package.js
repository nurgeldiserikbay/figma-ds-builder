// Чтение пакета ds-package (папка). Zip распаковывается заранее (см. cli.js).
import fs from 'node:fs';
import path from 'node:path';

export function loadPackage(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Не найден manifest.json в ${dir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'ds-package') throw new Error('manifest.json: format должен быть "ds-package"');
  if (manifest.version !== 1) throw new Error(`Неподдерживаемая версия пакета: ${manifest.version}`);

  const readJson = (rel) => (rel && fs.existsSync(path.join(dir, rel)) ? JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')) : null);

  return {
    dir,
    manifest,
    scale: manifest.scale || 1,
    tokens: readJson(manifest.tokens || 'tokens.json'),
    frames: (manifest.frames || []).map((f) => ({
      ...f,
      tree: () => readJson(f.tree),
      pngPath: f.png ? path.join(dir, f.png) : null,
    })),
  };
}

/**
 * Копирует ассеты пакета (vectors/, images/) в папку сборки.
 * Figma по умолчанию показывает картинки без цветового профиля («Unmanaged»), а браузер профиль применяет —
 * красные и зелёные заметно бледнеют. Поэтому профили из PNG/JPEG убираем (keepProfiles — оставить).
 */
export function copyAssets(pkg, outDir, { keepProfiles = false } = {}) {
  for (const sub of ['vectors', 'images']) {
    const src = path.join(pkg.dir, sub);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(outDir, 'assets', sub);
    fs.cpSync(src, dst, { recursive: true });
    if (sub === 'images' && !keepProfiles) {
      for (const f of fs.readdirSync(dst)) {
        const p = path.join(dst, f);
        const buf = fs.readFileSync(p);
        const out = stripColorProfile(buf);
        if (out !== buf) fs.writeFileSync(p, out);
      }
    }
  }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function stripColorProfile(buf) {
  if (buf.subarray(0, 8).equals(PNG_SIG)) {
    const parts = [buf.subarray(0, 8)];
    let i = 8, changed = false;
    while (i + 8 <= buf.length) {
      const len = buf.readUInt32BE(i);
      const type = buf.toString('latin1', i + 4, i + 8);
      const end = i + 12 + len;
      if (['iCCP', 'sRGB', 'gAMA', 'cHRM'].includes(type)) changed = true;
      else parts.push(buf.subarray(i, end));
      i = end;
    }
    return changed ? Buffer.concat(parts) : buf;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: убираем сегменты APP2 с ICC_PROFILE
    const parts = [buf.subarray(0, 2)];
    let i = 2, changed = false;
    while (i + 4 <= buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda) { parts.push(buf.subarray(i)); i = buf.length; break; }
      const len = buf.readUInt16BE(i + 2);
      const seg = buf.subarray(i, i + 2 + len);
      if (marker === 0xe2 && seg.toString('latin1', 4, 15) === 'ICC_PROFILE') changed = true;
      else parts.push(seg);
      i += 2 + len;
    }
    if (i < buf.length) parts.push(buf.subarray(i));
    return changed ? Buffer.concat(parts) : buf;
  }
  return buf;
}
