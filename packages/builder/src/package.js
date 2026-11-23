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
      tree: () => normalizeTree(readJson(f.tree)),
      pngPath: f.png ? path.join(dir, f.png) : null,
    })),
  };
}

/** Толщина внутренней обводки по сторонам [top, right, bottom, left]. */
function insideStroke(n) {
  if ((n.strokeAlign || 'INSIDE') !== 'INSIDE' || !(n.strokes || []).some((s) => s.visible !== false)) return null;
  const w = n.strokeWeight;
  const sides = Array.isArray(w) ? w.map((x) => x || 0) : [w || 0, w || 0, w || 0, w || 0];
  return sides.some(Boolean) ? sides : null;
}

/**
 * Старые пакеты: включена ли обводка в раскладку — по тому, где стоят дети. Для каждой оси с обводкой
 * проверяем обе гипотезы по выравниванию (начало, конец, центр); подходит ровно одна — она и верна.
 */
function guessIncluded(n, st) {
  const L = n.layout;
  const p = L.padding || [0, 0, 0, 0];
  const kids = (n.children || []).filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
  if (!kids.length) return undefined;
  const H = L.mode === 'HORIZONTAL';
  const near = (a, b) => Math.abs(a - b) <= 0.25;
  const fits = (inc) => {
    const s = inc ? st : [0, 0, 0, 0];
    const res = [];
    for (const isX of [true, false]) {
      if (!(isX ? st[1] || st[3] : st[0] || st[2])) continue; // на этой оси обводки нет — гипотезы не различить
      const start = isX ? n.x : n.y, end = isX ? n.x + n.w : n.y + n.h;
      const ps = isX ? p[3] + s[3] : p[0] + s[0], pe = isX ? p[1] + s[1] : p[2] + s[2];
      const ks = (k) => (isX ? k.x : k.y), ke = (k) => (isX ? k.x + k.w : k.y + k.h);
      const check = (align, first, last) => {
        const a = ks(first) - start - ps, b = end - ke(last) - pe;
        if (align === 'MIN') res.push(near(a, 0));
        else if (align === 'MAX') res.push(near(b, 0));
        else if (align === 'CENTER') res.push(near(a, b));
        else if (align === 'SPACE_BETWEEN') res.push(near(a, 0) && near(b, 0));
      };
      if (H === isX) check(L.primaryAlign, kids[0], kids[kids.length - 1]);
      else if (!L.wrap) for (const k of kids) check(L.counterAlign, k, k);
    }
    return res.length ? res.every(Boolean) : null;
  };
  const yes = fits(true), no = fits(false);
  if (yes && !no) return true;
  if (no && !yes) return false;
  return undefined;
}

/**
 * Обводка, включённая в раскладку (Figma: strokesIncludedInLayout — так по умолчанию у новых Auto Layout),
 * сдвигает детей на свою толщину. В CSS обводка рисуется outline/inset-тенью и места не занимает,
 * поэтому толщину переносим в padding. Старые пакеты флага не знают — смотрим, где стоят дети.
 */
export function normalizeTree(tree) {
  (function walk(n) {
    const L = n.layout, st = L && insideStroke(n);
    if (st && !L.strokesApplied) {
      let inc = L.strokesIncluded;
      if (inc === undefined) inc = guessIncluded(n, st);
      if (inc) {
        L.designPadding = L.padding; // как в макете — для шкалы отступов дизайн-системы
        L.padding = (L.padding || [0, 0, 0, 0]).map((x, i) => (x || 0) + st[i]);
        L.strokesApplied = true;
      }
    }
    (n.children || []).forEach(walk);
  })(tree);
  return tree;
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
