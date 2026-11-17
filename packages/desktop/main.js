// DS Builder — программа с окном. Внутри — тот же локальный сервер, что у «ds-build ui»,
// окно Electron вместо браузера, и плагин Figma в папке программы.
import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, 'app');
const smoke = process.argv.includes('--smoke');

if (!smoke && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let ui = null;

async function start() {
  const { startUi } = await import(pathToFileURL(path.join(appDir, 'builder', 'src', 'ui.js')).href);
  ui = await startUi({ open: false, log: () => {}, pluginDir: path.join(appDir, 'plugin'), home: process.env.DS_BUILD_HOME || undefined });
  if (smoke) return runSmoke();
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  win = new BrowserWindow({
    width: 1100, height: 900, minWidth: 720, minHeight: 600, title: 'DS Builder',
    icon: path.join(here, 'build', 'icon.png'), backgroundColor: '#F5F6F8',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const origin = new URL(ui.url).origin;
  // отчёт, вёрстка — в окнах программы (тот же ключ доступа); внешние ссылки — в браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 900, icon: path.join(here, 'build', 'icon.png') } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); shell.openExternal(url); } });
  await win.loadURL(ui.url);
}

// Проверка установленной программы без окна: сборка архива и вывод итога (для CI)
async function runSmoke() {
  const zip = process.argv[process.argv.indexOf('--smoke') + 1];
  const base = new URL(ui.url);
  const req = (p, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, fail) => {
    const r = http.request(new URL(p, base), { method, headers }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', fail);
    if (body) r.write(body);
    r.end();
  });
  try {
    const login = await req(base.pathname + base.search);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const page = await req('/', { headers: { cookie } });
    if (!page.text.includes("'1' === '1'")) throw new Error('плагин не найден в программе');
    const start = await req(`/api/build?file=${encodeURIComponent(path.basename(zip))}&opts=${encodeURIComponent(JSON.stringify({ html: true, react: true }))}`,
      { method: 'POST', headers: { cookie }, body: fs.readFileSync(zip) });
    const { id } = JSON.parse(start.text);
    const events = await new Promise((ok, fail) => {
      http.get(new URL(`/api/jobs/${id}/events`, base), { headers: { cookie } }, (res) => {
        let b = ''; res.setEncoding('utf8'); res.on('data', (d) => (b += d)); res.on('end', () => ok(b));
      }).on('error', fail);
    });
    const lines = [...events.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]));
    console.log(lines.filter((l) => typeof l === 'string').join('\n'));
    const done = JSON.parse(/event: done\ndata: (.*)/.exec(events)[1]);
    const ok = done.code === 0 && done.summary && done.summary.failed === 0 && done.summary.html;
    console.log(ok ? `SMOKE OK: ${done.summary.passed}/${done.summary.frames}, html, react` : `SMOKE FAIL: ${JSON.stringify(done)}`);
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('SMOKE FAIL:', e);
    app.exit(1);
  }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { ui?.server.close(); app.quit(); });
app.whenReady().then(start).catch((e) => { console.error(e); app.exit(1); });
