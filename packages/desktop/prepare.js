// Собирает в app/ то, что войдёт в установленную программу: исходники программы вёрстки и собранный плагин Figma.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, 'app');
fs.rmSync(app, { recursive: true, force: true });

// программа вёрстки: только src (зависимости — в node_modules этой папки)
fs.cpSync(path.join(here, '..', 'builder', 'src'), path.join(app, 'builder', 'src'), { recursive: true });
fs.writeFileSync(path.join(app, 'builder', 'package.json'), JSON.stringify({ type: 'module', private: true }, null, 2));

// плагин: собрать и положить рядом — пользователь импортирует его в Figma из папки программы
execFileSync(process.execPath, ['build.js'], { cwd: path.join(here, '..', 'plugin'), stdio: 'inherit' });
fs.cpSync(path.join(here, '..', 'plugin', 'dist'), path.join(app, 'plugin'), { recursive: true });
console.log('app/ готова: программа вёрстки и плагин');
