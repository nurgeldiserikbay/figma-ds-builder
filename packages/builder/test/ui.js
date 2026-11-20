// Окно программы: ключ доступа, загрузка архива, ход сборки потоком, отчёт, защита путей.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startUi, buildArgs } from '../src/ui.js';
import { zipDir } from './zip.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ui-'));
const { server, url, token } = await startUi({ open: false, home, log: () => {} });
const base = new URL(url).origin;

// http.request, а не fetch: fetch не даёт подменить Host
function req(p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const r = http.request(base + p, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', fail);
    if (body) r.write(body);
    r.end();
  });
}

assert.deepEqual(buildArgs('a.zip', 'o', { html: true, jobs: '6' }).slice(-2), ['--jobs', '6'], 'число фреймов одновременно');
assert.ok(!buildArgs('a.zip', 'o', { jobs: '' }).includes('--jobs'), 'авто — без --jobs');
assert.ok(!buildArgs('a.zip', 'o', { jobs: '999; rm' }).includes('--jobs'), 'мусор — без --jobs');
assert.equal((await req('/')).status, 403, 'без ключа — нельзя');
assert.equal((await req(`/?t=${token}`, { headers: { host: `evil.example:${new URL(url).port}` } })).status, 403, 'чужой Host — нельзя');
const login = await req(`/?t=${token}`);
assert.equal(login.status, 302);
const cookie = login.headers['set-cookie'][0].split(';')[0];
assert.match(login.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
const H = { cookie };

const page = await req('/', { headers: H });
assert.equal(page.status, 200);
assert.ok(page.text.includes(home.split(path.sep).pop()), 'папка сборок показана');

assert.equal((await req('/api/build?file=x.txt', { method: 'POST', headers: H, body: 'x' })).status, 400, 'не zip');

const zip = zipDir(path.join(here, '..', 'fixtures', 'sample'));
const start = await req(`/api/build?file=${encodeURIComponent('Sample — ds-package.zip')}&opts=${encodeURIComponent(JSON.stringify({ responsive: true, threshold: '0.1' }))}`,
  { method: 'POST', headers: { ...H, 'content-type': 'application/zip' }, body: zip });
assert.equal(start.status, 200, start.text);
const { id, name } = JSON.parse(start.text);

// поток журнала до конца
const events = await new Promise((ok, fail) => {
  http.get(`${base}/api/jobs/${id}/events`, { headers: H }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => (buf += d));
    res.on('end', () => ok(buf));
  }).on('error', fail);
});
assert.match(events, /Landing \/ Desktop: (flow|без изменений)/);
const done = JSON.parse(/event: done\ndata: (.*)/.exec(events)[1]);
assert.equal(done.code, 0, events.slice(-2000));
assert.equal(done.summary.frames, 2);
assert.equal(done.summary.passed, 2);

// большой файл частями: две части загружаются по одной, сборка — одна
{
  const src = path.join(here, '..', 'fixtures', 'sample');
  const man = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  const session = 'test' + Date.now().toString(36);
  for (const [i, fr] of man.frames.entries()) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-part-'));
    fs.cpSync(src, d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ ...man, frames: [fr], part: { id: 'p1', index: i + 1, total: man.frames.length } }));
    const up = await req(`/api/upload?session=${session}&file=${encodeURIComponent(`Sample — ds-package (часть ${i + 1} из ${man.frames.length}).zip`)}`,
      { method: 'POST', headers: { ...H, 'content-type': 'application/zip' }, body: zipDir(d) });
    assert.equal(up.status, 200, up.text);
    fs.rmSync(d, { recursive: true, force: true });
  }
  const b = await req(`/api/build?session=${session}&opts=${encodeURIComponent('{}')}`, { method: 'POST', headers: H });
  assert.equal(b.status, 200, b.text);
  const ev2 = await new Promise((ok, fail) => {
    http.get(`${base}/api/jobs/${JSON.parse(b.text).id}/events`, { headers: H }, (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', (d) => (t += d)); res.on('end', () => ok(t)); }).on('error', fail);
  });
  assert.match(ev2, /Частей пакета: 2/);
  const d2 = JSON.parse(/event: done\ndata: (.*)/.exec(ev2)[1]);
  assert.equal(d2.summary.frames, 2, 'обе части свёрстаны');
  assert.equal(d2.summary.passed, 2);
}

// «Только проверить макет»: анализ для дизайнера, без вёрстки
{
  const a = await req(`/api/build?file=${encodeURIComponent('Sample — ds-package.zip')}&opts=${encodeURIComponent(JSON.stringify({ mode: 'audit' }))}`,
    { method: 'POST', headers: { ...H, 'content-type': 'application/zip' }, body: zip });
  assert.equal(a.status, 200, a.text);
  const ev3 = await new Promise((ok, fail) => {
    http.get(`${base}/api/jobs/${JSON.parse(a.text).id}/events`, { headers: H }, (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', (d) => (t += d)); res.on('end', () => ok(t)); }).on('error', fail);
  });
  assert.match(ev3, /Анализ макета: \d+\/100/);
  const d3 = JSON.parse(/event: done\ndata: (.*)/.exec(ev3)[1]);
  assert.equal(d3.summary.kind, 'audit');
  assert.ok(Number.isFinite(d3.summary.audit), 'оценка анализа');
  assert.ok(!fs.existsSync(path.join(home, d3.name, 'html')), 'без вёрстки');
  const page = await req(`/out/${encodeURIComponent(d3.name)}/design-audit.html`, { headers: H });
  assert.equal(page.status, 200);
  assert.match(page.text, /href="designer-guide\.html#1-auto-layout/);
}
const guide = await req('/guide', { headers: H });
assert.equal(guide.status, 200);
assert.match(guide.text, /id="5-состояния--вариантами-компонента"/, 'памятка в окне программы');

const builds = JSON.parse((await req('/api/builds', { headers: H })).text);
assert.ok(builds.builds.some((b) => b.name === name));
assert.ok(Number.isFinite(builds.builds.find((b) => b.name === name).audit), 'у сборки есть анализ макета');
const report = await req(`/out/${encodeURIComponent(name)}/report.html`, { headers: H });
assert.equal(report.status, 200);
assert.match(report.headers['content-type'], /text\/html/);
assert.equal((await req(`/out/${encodeURIComponent(name)}/report.html`)).status, 403, 'отчёт без ключа — нельзя');
assert.equal((await req('/out/..%2F..%2Fetc%2Fpasswd', { headers: H })).status, 403, 'выход из папки — нельзя');
assert.equal((await req(`/api/open?path=${encodeURIComponent('../..')}`, { method: 'POST', headers: H })).status, 400);
assert.ok(!fs.readdirSync(path.join(home, '.uploads')).length, 'загруженный архив удалён');

// удаление сборки: только папка сборки внутри home
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ui-outside-'));
fs.writeFileSync(path.join(outside, 'report.json'), '[]');
for (const bad of ['', '..', '../' + path.basename(outside), '.uploads', 'нет-такой'])
  assert.notEqual((await req(`/api/builds?name=${encodeURIComponent(bad)}`, { method: 'DELETE', headers: H })).status, 200, `нельзя удалить «${bad}»`);
assert.ok(fs.existsSync(outside), 'папка вне home цела');
fs.rmSync(outside, { recursive: true, force: true });
assert.equal((await req(`/api/builds?name=${encodeURIComponent(name)}`, { method: 'DELETE' })).status, 403, 'без ключа — нельзя удалить');
assert.equal((await req(`/api/builds?name=${encodeURIComponent(name)}`, { method: 'DELETE', headers: H })).status, 200);
assert.ok(!fs.existsSync(path.join(home, name)), 'папка сборки удалена');
assert.ok(!JSON.parse((await req('/api/builds', { headers: H })).text).builds.some((b) => b.name === name), 'сборки нет в списке');

server.close();
fs.rmSync(home, { recursive: true, force: true });
console.log('Окно ds-build: ключ, загрузка, ход сборки, отчёт, анализ макета, памятка, удаление, защита путей — OK');
