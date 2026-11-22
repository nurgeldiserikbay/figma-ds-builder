// Памятка дизайнеру страницей сайта: docs/designer-guide.html из docs/designer-guide.md (тот же вид, что в программе).
import fs from 'node:fs';
import { guidePage } from '../packages/builder/src/design-audit.js';
fs.writeFileSync(new URL('../docs/designer-guide.html', import.meta.url), guidePage());
console.log('docs/designer-guide.html обновлена');
