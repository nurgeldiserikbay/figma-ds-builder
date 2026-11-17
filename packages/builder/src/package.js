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

/** Копирует ассеты пакета (vectors/, images/) в папку сборки. */
export function copyAssets(pkg, outDir) {
  for (const sub of ['vectors', 'images']) {
    const src = path.join(pkg.dir, sub);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(outDir, 'assets', sub), { recursive: true });
  }
}
