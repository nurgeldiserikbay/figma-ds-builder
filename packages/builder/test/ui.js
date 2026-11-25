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
assert.ok(buildArgs('a.zip', 'o', { aiFix: true }).includes('--ai-fix'), 'доводка ИИ');
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

// «проверить правки»: сверка той же сборки с макетом, журнал — тем же потоком
{
  assert.equal(done.summary.check, true, 'у сборки есть check.json');
  assert.equal((await req('/api/check?name=..%2Fx', { method: 'POST', headers: H })).status, 400, 'чужой путь — нельзя');
  const c = await req(`/api/check?name=${encodeURIComponent(name)}`, { method: 'POST', headers: H });
  assert.equal(c.status, 200, c.text);
  const log = await new Promise((ok, fail) => {
    http.get(`${base}/api/jobs/${JSON.parse(c.text).id}/events`, { headers: H }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => (b += d)); res.on('end', () => ok(b)); }).on('error', fail);
  });
  assert.match(log, /Итог: совпадают с макетом 2 из 2/, log.slice(-1500));
}

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

// сборка хранит пакет (.package): собрать снова без выгрузки, дополнить новой выгрузкой
{
  assert.ok(fs.existsSync(path.join(home, name, '.package', 'manifest.json')), 'пакет сохранён рядом со сборкой');
  assert.ok(JSON.parse((await req('/api/builds', { headers: H })).text).builds.find((b) => b.name === name).pkg, 'в списке — можно дополнить');
  for (const bad of ['..', '../x', '.uploads', 'нет-такой'])
    assert.equal((await req(`/api/build?base=${encodeURIComponent(bad)}&opts=%7B%7D`, { method: 'POST', headers: H })).status, 400, `base «${bad}» — нельзя`);
  const follow = async (t) => new Promise((ok, fail) => {
    http.get(`${base}/api/jobs/${JSON.parse(t).id}/events`, { headers: H }, (res) => { let x = ''; res.setEncoding('utf8'); res.on('data', (d) => (x += d)); res.on('end', () => ok(x)); }).on('error', fail);
  });
  const again = await req(`/api/build?base=${encodeURIComponent(name)}&opts=%7B%7D`, { method: 'POST', headers: H });
  assert.equal(again.status, 200, again.text);
  const ev4 = await follow(again.text);
  assert.match(ev4, /Без изменений \(из кэша\): 2 из 2/, 'пересборка — экраны из кэша');
  const d4 = JSON.parse(/event: done\ndata: (.*)/.exec(ev4)[1]);
  assert.equal(d4.code, 0);
  assert.equal(d4.summary.frames, 2);
  // дополнить: та же выгрузка ещё раз (тот же фрейм заменяется, не дублируется)
  const session = 'ext' + Date.now().toString(36);
  assert.equal((await req(`/api/upload?session=${session}&file=${encodeURIComponent('Sample — ds-package.zip')}`, { method: 'POST', headers: { ...H, 'content-type': 'application/zip' }, body: zip })).status, 200);
  const ext = await req(`/api/build?session=${session}&base=${encodeURIComponent(name)}&opts=%7B%7D`, { method: 'POST', headers: H });
  assert.equal(ext.status, 200, ext.text);
  const ev5 = await follow(ext.text);
  assert.match(ev5, /Частей пакета: 2 — собраны в один/);
  const d5 = JSON.parse(/event: done\ndata: (.*)/.exec(ev5)[1]);
  assert.equal(d5.code, 0, ev5.slice(-1500));
  assert.equal(d5.summary.frames, 2, 'тот же фрейм из новой выгрузки — заменяет, а не дублирует');
}

// окно «ИИ»: ключи хранятся на компьютере, наружу — только последние 4 символа
{
  const save = await req('/api/ai', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ gemini: { key: 'AIzaTEST1234' }, custom: { url: 'http://127.0.0.1:9/v1', model: 'm' }, ollama: { enabled: false } }) });
  assert.equal(save.status, 200, save.text);
  const got = JSON.parse((await req('/api/ai', { headers: H })).text);
  assert.equal(got.settings.gemini.key, '••••1234', 'ключ не показывается целиком');
  assert.equal(got.settings.ollama.enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.ai.json'), 'utf8')).gemini.key, 'AIzaTEST1234', 'ключ сохранён');
  // сохранение с маской — ключ не затирается
  await req('/api/ai', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ gemini: { key: '••••1234' } }) });
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.ai.json'), 'utf8')).gemini.key, 'AIzaTEST1234');
  assert.equal((await req('/api/ai', { method: 'POST', body: '{}' })).status, 403, 'без ключа доступа — нельзя');
  const test = JSON.parse((await req('/api/ai/test', { method: 'POST', headers: H })).text);
  assert.equal(test.results[0].name, 'свой сервер', 'свой ИИ — первым');
  assert.equal(test.results[0].ok, false, 'недоступный сервер — ошибка, а не зависание');
  assert.ok(test.results.some((r) => r.name === 'Gemini'));
  assert.ok(!test.results.some((r) => r.name === 'Ollama'), 'выключенная Ollama не проверяется');
  assert.equal((await req('/api/ai/pull?model=' + encodeURIComponent('a; rm -rf'), { method: 'POST', headers: H })).status, 400);
}

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
