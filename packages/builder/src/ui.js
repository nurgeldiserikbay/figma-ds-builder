// Окно программы: локальный сервер на 127.0.0.1 + страница в браузере.
// Без зависимостей и без сети: тот же ds-build build, запущенный дочерним процессом,
// журнал идёт в окно потоком (SSE), результаты — из папки сборок.
//
// Защита: слушает только 127.0.0.1; одноразовый ключ в адресе → cookie SameSite=Strict
// (чужие сайты не могут дергать API); проверка Host против DNS rebinding; пути не выходят из папки сборок.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { guidePage } from './design-audit.js';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'cli.js');

export function defaultHome() {
  return process.env.DS_BUILD_HOME || path.join(os.homedir(), 'ds-build');
}

const slug = (s) => String(s).replace(/\.zip$/i, '').replace(/\s*[—–-]\s*ds-package$/i, '')
  .normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'build';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8',
};

/** Оценка анализа макета (design-audit.json), если он есть. */
function auditScore(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'design-audit.json'), 'utf8')).score; } catch { return null; }
}

/** Сводка по готовой сборке — из report.json; только анализ макета — из design-audit.json. */
function summary(home, name) {
  const dir = path.join(home, name);
  const file = path.join(dir, 'report.json');
  if (!fs.existsSync(file)) {
    const af = path.join(dir, 'design-audit.json');
    if (!fs.existsSync(af)) return null;
    try {
      const a = JSON.parse(fs.readFileSync(af, 'utf8'));
      return { name, file: a.file || name, when: fs.statSync(af).mtime.toISOString(), kind: 'audit', frames: a.frames, audit: a.score, passed: 0, failed: 0 };
    } catch { return null; }
  }
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    const results = r.results || r;
    return {
      name, file: r.file || name,
      when: fs.statSync(file).mtime.toISOString(),
      frames: results.length,
      passed: results.filter((x) => x.pass === true).length,
      failed: results.filter((x) => x.pass === false).length,
      html: fs.existsSync(path.join(dir, 'html', 'index.html')),
      react: fs.existsSync(path.join(dir, 'react', 'package.json')),
      vue: fs.existsSync(path.join(dir, 'vue', 'package.json')),
      ds: fs.existsSync(path.join(dir, 'design-system', 'design-system.md')),
      audit: auditScore(dir),
    };
  } catch { return null; }
}

function openPath(p) {
  const [cmd, a] = process.platform === 'darwin' ? ['open', [p]] : process.platform === 'win32' ? ['explorer', [p]] : ['xdg-open', [p]];
  execFile(cmd, a, () => {});
}

/** Аргументы ds-build build из настроек окна (только известные ключи). */
export function buildArgs(zips, out, o = {}) {
  const a = ['build', ...[].concat(zips), '--out', out];
  const fw = ['html', 'react', 'vue'].filter((f) => o[f]);
  if (fw.length) a.push('--framework', fw.join(','));
  if (o.ai) a.push('--ai');
  if (o.semantic === false) a.push('--no-semantic');
  if (o.responsive === false) a.push('--no-responsive');
  if (o.layout && ['auto', 'flow', 'absolute'].includes(o.layout)) a.push('--layout', o.layout);
  const jobs = parseInt(o.jobs, 10);
  if (jobs >= 1 && jobs <= 16) a.push('--jobs', String(jobs));
  if (Number.isFinite(+o.threshold) && o.threshold !== '' && o.threshold !== undefined) a.push('--threshold', String(+o.threshold));
  if (Number.isFinite(+o.textThreshold) && o.textThreshold !== '' && o.textThreshold !== undefined) a.push('--text-threshold', String(+o.textThreshold));
  return a;
}

export async function startUi({ port = 0, open = true, home = defaultHome(), log = console.log, pluginDir = null } = {}) {
  fs.mkdirSync(path.join(home, '.uploads'), { recursive: true });
  const token = crypto.randomBytes(18).toString('base64url');
  const jobs = new Map();
  const uploads = new Map(); // session → [{ zip, file }]
  const page = fs.readFileSync(path.join(here, 'ui.html'), 'utf8');

  const server = http.createServer(async (req, res) => {
    const addr = server.address();
    const okHosts = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
    const send = (code, body, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (!okHosts.includes(req.headers.host)) return send(403, { error: 'host' });
    const u = new URL(req.url, `http://${req.headers.host}`);
    const cookie = /(?:^|;\s*)dsb=([^;]+)/.exec(req.headers.cookie || '')?.[1];

    // вход: ключ из адреса → cookie, адрес без ключа
    if (u.pathname === '/' && u.searchParams.get('t') === token) {
      return send(302, '', 'text/plain', { 'set-cookie': `dsb=${token}; Path=/; HttpOnly; SameSite=Strict`, location: '/' });
    }
    if (cookie !== token) return send(403, '<p style="font:16px system-ui;margin:40px">Откройте окно по ссылке из терминала (в ней одноразовый ключ).</p>', 'text/html; charset=utf-8');

    try {
      if (req.method === 'GET' && u.pathname === '/') {
        const htmlText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return send(200, page.replace('__HOME__', () => htmlText(home))
          .replace('__PLUGIN__', pluginDir ? '1' : ''), 'text/html; charset=utf-8');
      }
      // памятка дизайнеру — страницей в окне программы
      if (req.method === 'GET' && u.pathname === '/guide') return send(200, guidePage(), 'text/html; charset=utf-8');
      if (req.method === 'POST' && u.pathname === '/api/plugin') {
        if (!pluginDir) return send(404, { error: 'плагин не входит в эту установку' });
        openPath(pluginDir);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && u.pathname === '/api/builds') {
        const list = fs.readdirSync(home, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.includes('.try-'))
          .map((d) => summary(home, d.name)).filter(Boolean)
          .sort((a, b) => b.when.localeCompare(a.when));
        return send(200, { home, builds: list, running: [...jobs.values()].filter((j) => !j.done).map((j) => ({ id: j.id, name: j.name })) });
      }
      // удалить сборку из списка вместе с папкой (только папку сборки внутри home и не ту, что сейчас идёт)
      if (req.method === 'DELETE' && u.pathname === '/api/builds') {
        const name = u.searchParams.get('name') || '';
        const dir = path.resolve(home, name);
        if (!name || /[\\/]/.test(name) || name.startsWith('.') || path.dirname(dir) !== home) return send(400, { error: 'неверное имя сборки' });
        if (!fs.existsSync(path.join(dir, 'report.json')) && !fs.existsSync(path.join(dir, 'design-audit.json'))) return send(404, { error: 'нет такой сборки' });
        if ([...jobs.values()].some((j) => !j.done && j.name === name)) return send(409, { error: 'сборка ещё идёт' });
        try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch (e) {
          return send(500, { error: 'Не удалось удалить: какой-то файл открыт в другой программе. Закройте его и попробуйте снова.' });
        }
        return send(200, { ok: true });
      }
      // большой файл плагин выгружает частями: части загружаются по одной (upload), затем — одна сборка
      if (req.method === 'POST' && u.pathname === '/api/upload') {
        const session = (u.searchParams.get('session') || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
        const file = u.searchParams.get('file') || 'package.zip';
        if (!session) return send(400, { error: 'нет session' });
        if (!/\.zip$/i.test(file)) return send(400, { error: `«${file}» — не zip-архив. Нужны архивы «… — ds-package.zip» из плагина` });
        const list = uploads.get(session) || [];
        const zip = path.join(home, '.uploads', `${session}-${list.length}.zip`);
        await new Promise((ok, fail) => { const w = fs.createWriteStream(zip); req.pipe(w); w.on('finish', ok); w.on('error', fail); req.on('error', fail); });
        list.push({ zip, file });
        uploads.set(session, list);
        return send(200, { ok: true, count: list.length });
      }
      if (req.method === 'POST' && u.pathname === '/api/build') {
        const opts = JSON.parse(u.searchParams.get('opts') || '{}');
        let parts;
        const session = (u.searchParams.get('session') || '').replace(/[^a-z0-9]/gi, '');
        if (session) {
          parts = uploads.get(session) || [];
          uploads.delete(session);
          if (!parts.length) return send(400, { error: 'Архивы не загрузились — добавьте их ещё раз' });
        } else {
          // один архив прямо в теле запроса
          const file = u.searchParams.get('file') || 'package.zip';
          if (!/\.zip$/i.test(file)) return send(400, { error: 'Нужен zip-архив, который выгружает плагин' });
          const zip = path.join(home, '.uploads', `${crypto.randomBytes(6).toString('hex')}.zip`);
          await new Promise((ok, fail) => { const w = fs.createWriteStream(zip); req.pipe(w); w.on('finish', ok); w.on('error', fail); req.on('error', fail); });
          parts = [{ zip, file }];
        }
        const base = parts[0].file.replace(/\s*\(часть \d+ из \d+\)/i, '');
        const auditOnly = opts.mode === 'audit'; // «Только проверить макет»: анализ для дизайнера, без вёрстки
        const name = `${slug(base)}${auditOnly ? '-analiz' : ''}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
        const out = path.join(home, name);
        const id = crypto.randomBytes(6).toString('hex');
        const job = { id, name, lines: [], listeners: new Set(), done: false, code: null };
        const push = (line) => { job.lines.push(line); for (const l of job.listeners) l(line); };
        // в установленной программе (Electron) тот же исполняемый файл работает как Node
        const cliArgs = auditOnly ? ['audit', ...parts.map((p) => p.zip), '--out', out] : buildArgs(parts.map((p) => p.zip), out, opts);
        const child = spawn(process.execPath, [CLI, ...cliArgs], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
        let buf = '';
        const onData = (d) => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(push); };
        child.stdout.setEncoding('utf8').on('data', onData);
        child.stderr.setEncoding('utf8').on('data', onData);
        child.on('close', (code) => {
          if (buf) push(buf);
          job.done = true; job.code = code;
          for (const p of parts) fs.rm(p.zip, { force: true }, () => {});
          for (const l of job.listeners) l(null);
        });
        jobs.set(id, job);
        log(`  сборка ${name}`);
        return send(200, { id, name });
      }
      const ev = /^\/api\/jobs\/([a-f0-9]+)\/events$/.exec(u.pathname);
      if (req.method === 'GET' && ev) {
        const job = jobs.get(ev[1]);
        if (!job) return send(404, { error: 'нет такой сборки' });
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const emit = (line) => {
          if (line === null) { res.write(`event: done\ndata: ${JSON.stringify({ code: job.code, name: job.name, summary: summary(home, job.name) })}\n\n`); res.end(); return; }
          res.write(`data: ${JSON.stringify(line)}\n\n`);
        };
        job.lines.forEach(emit);
        if (job.done) return emit(null);
        job.listeners.add(emit);
        req.on('close', () => job.listeners.delete(emit));
        return;
      }
      if (req.method === 'POST' && u.pathname === '/api/open') {
        const target = path.resolve(home, u.searchParams.get('path') || '.');
        if (target !== home && !target.startsWith(home + path.sep)) return send(400, { error: 'вне папки сборок' });
        if (!fs.existsSync(target)) return send(404, { error: 'нет такой папки' });
        openPath(target);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && u.pathname.startsWith('/out/')) {
        const rel = decodeURIComponent(u.pathname.slice(5));
        let target = path.resolve(home, rel);
        if (!target.startsWith(home + path.sep) || rel.split(/[\\/]/).some((s) => s.startsWith('.'))) return send(403, { error: 'запрещено' });
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
        if (!fs.existsSync(target)) return send(404, 'не найдено', 'text/plain; charset=utf-8');
        res.writeHead(200, { 'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        return fs.createReadStream(target).pipe(res);
      }
      return send(404, { error: 'не найдено' });
    } catch (e) {
      return send(500, { error: e.message });
    }
  });

  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/?t=${token}`;
  log([
    '',
    open ? '  Окно программы открылось в браузере.' : '  Окно программы:',
    open ? `  Если не открылось — скопируйте ссылку в браузер: ${url}` : `  ${url}`,
    '',
    '  Не закрывайте этот терминал, пока работаете с окном. Выйти — Ctrl+C.',
    `  Сборки сохраняются в ${home}`,
    '',
  ].join('\n'));
  if (open) openPath(url);
  return { server, url, token, home };
}
