// Необязательный ИИ-слой: понятные имена классов для слоёв с безликими именами («Frame 237»).
//
// Принципы проекта: ИИ только там, где без него нельзя, и его результат проверяется.
// Здесь ИИ меняет лишь имена классов (на вид не влияют); теги остаются алгоритмическими.
// После генерации страница проходит ту же проверку геометрии и пикселей.
//
// Порядок (CLAUDE.md): локальная модель → бесплатные API → платные только по явному флагу.
// Цепочка провайдеров, каждый — OpenAI-совместимый /chat/completions; кончился лимит (429),
// нет сети или ключа — следующий:
//   1. Ollama (локально, без ключа)            OLLAMA_URL, OLLAMA_MODEL (qwen2.5-coder:7b)
//   2. Groq (бесплатный план)                  GROQ_API_KEY, GROQ_MODEL (openai/gpt-oss-120b)
//   3. Google Gemini (бесплатный план)         GEMINI_API_KEY, GEMINI_MODEL (gemini-2.5-flash)
//   4. OpenRouter (бесплатные модели :free)    OPENROUTER_API_KEY, OPENROUTER_MODEL (openrouter/free)
//   5. Платный — только с --ai-paid:           DS_AI_PAID_URL, DS_AI_PAID_KEY, DS_AI_PAID_MODEL
// DS_AI_URL (+ DS_AI_MODEL, DS_AI_KEY) — один свой сервер вместо цепочки (LM Studio и т. п.).
// Ответы кэшируются на диске: повторная сборка не тратит лимиты.
// Бесплатные облачные планы могут сохранять запросы: туда уходят имена слоёв и до 3 фрагментов текста.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isGenericName, className } from './semantic.js';

const trim = (u) => u.replace(/\/+$/, '');

/** Провайдеры по порядку. Облачные — только при наличии ключа; платный — только с paid. */
export function aiProviders(env = process.env, { paid = false } = {}) {
  // DS_AI_ONLY=1 — только свой сервер (как раньше); иначе свой — первым, дальше обычная цепочка
  const own = env.DS_AI_URL && { name: 'свой сервер', url: trim(env.DS_AI_URL), model: env.DS_AI_MODEL || 'qwen2.5-coder:7b', key: env.DS_AI_KEY || '', local: !env.DS_AI_KEY };
  if (own && env.DS_AI_ONLY === '1') return [own];
  const list = [
    own,
    env.DS_NO_OLLAMA !== '1' && { name: 'Ollama', url: trim(env.OLLAMA_URL || 'http://localhost:11434/v1'), model: env.OLLAMA_MODEL || 'qwen2.5-coder:7b', key: '', local: true },
    env.GROQ_API_KEY && { name: 'Groq', url: 'https://api.groq.com/openai/v1', model: env.GROQ_MODEL || 'openai/gpt-oss-120b', key: env.GROQ_API_KEY, free: true },
    env.GEMINI_API_KEY && { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: env.GEMINI_MODEL || 'gemini-2.5-flash', key: env.GEMINI_API_KEY, free: true },
    env.OPENROUTER_API_KEY && { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: env.OPENROUTER_MODEL || 'openrouter/free', key: env.OPENROUTER_API_KEY, free: true },
    paid && env.DS_AI_PAID_URL && env.DS_AI_PAID_MODEL && { name: 'платный', url: trim(env.DS_AI_PAID_URL), model: env.DS_AI_PAID_MODEL, key: env.DS_AI_PAID_KEY || '', paid: true },
  ];
  return list.filter(Boolean);
}

/** Совместимость: первый провайдер цепочки. */
export function aiConfig(env = process.env) {
  return aiProviders(env)[0];
}

function describe(n, parent, sem) {
  const kids = (n.children || []).filter((k) => k.visible !== false);
  const text = [];
  (function t(x) { if (x.type === 'TEXT') text.push((x.text?.characters || '').slice(0, 40)); (x.children || []).forEach(t); })(n);
  return {
    id: n.id,
    tag: sem.get(n.id)?.tag || 'div',
    role: sem.get(n.id)?.name || '',
    size: `${Math.round(n.w)}x${Math.round(n.h)}`,
    parent: parent ? (isGenericName(parent.name) ? sem.get(parent.id)?.name || '' : parent.name) : '',
    children: kids.length,
    text: text.slice(0, 3).join(' | '),
  };
}

/** Слои с безликими именами, которым имеет смысл дать имя (контейнеры и текст). */
function candidates(tree, sem) {
  const out = [];
  (function walk(n, parent) {
    if (n.visible === false) return;
    if (n !== tree && isGenericName(n.name) && (n.children?.length || n.type === 'TEXT')) out.push(describe(n, parent, sem));
    (n.children || []).forEach((c) => walk(c, n));
  })(tree, null);
  return out;
}

export async function chat(cfg, messages, { timeout = cfg.local ? 120000 : 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0, response_format: { type: 'json_object' } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${cfg.name}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    throw e.name === 'AbortError' ? new Error(`${cfg.name}: нет ответа за ${Math.round(timeout / 1000)} с`)
      : e.message.startsWith(cfg.name) ? e : new Error(`${cfg.name}: ${e.cause?.code || e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = `Ты помогаешь верстальщику. Для каждого элемента страницы придумай короткое имя CSS-класса
на английском в kebab-case (1–3 слова), по смыслу: hero, card, card-title, price, feature-list, cta-button…
Опирайся на текст, тег, роль и родителя. Не повторяй тег (не "div-1"), не используй номера.
Ответ — только JSON: {"names": {"<id>": "<имя>", ...}}.`;

/**
 * @param providers — цепочка из aiProviders(); при ошибке провайдера оставшиеся пачки идут к следующему
 * @returns {Promise<{ names: Map<string,string>, asked: number, used: number, error?: string, by: Record<string, number> }>}
 */
export async function suggestNames(tree, sem, { providers, cfg, cacheDir, batch = 30, log = () => {} } = {}) {
  const chain = providers || (cfg ? [cfg] : aiProviders());
  const items = candidates(tree, sem);
  const names = new Map();
  const by = {};
  if (!items.length) return { names, asked: 0, used: 0, by };
  const errors = [];
  let pi = 0;
  for (let i = 0; i < items.length; i += batch) {
    const chunk = items.slice(i, i + batch);
    const payload = JSON.stringify(chunk);
    let parsed = null;
    // кэш: ответ любого провайдера цепочки
    for (const p of chain) {
      const f = cacheDir && path.join(cacheDir, 'ai', `${crypto.createHash('sha256').update(p.model + '\n' + SYSTEM + '\n' + payload).digest('hex').slice(0, 32)}.json`);
      if (f && fs.existsSync(f)) { parsed = JSON.parse(fs.readFileSync(f, 'utf8')); by[p.name] = (by[p.name] || 0) + chunk.length; break; }
    }
    while (!parsed && pi < chain.length) {
      const p = chain[pi];
      try {
        log(`  ИИ (${p.name}, ${p.model}): имена для ${chunk.length} слоёв…${p.free ? ' [бесплатный облачный план]' : p.paid ? ' [ПЛАТНЫЙ]' : ''}`);
        const content = await chat(p, [{ role: 'system', content: SYSTEM }, { role: 'user', content: payload }]);
        const json = content.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1'); // модели любят обрамлять JSON текстом
        parsed = JSON.parse(json);
        by[p.name] = (by[p.name] || 0) + chunk.length;
        const f = cacheDir && path.join(cacheDir, 'ai', `${crypto.createHash('sha256').update(p.model + '\n' + SYSTEM + '\n' + payload).digest('hex').slice(0, 32)}.json`);
        if (f) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(parsed)); }
      } catch (e) {
        errors.push(e.message.slice(0, 200));
        pi++; // лимит, нет сети, мусор в ответе — следующий провайдер
      }
    }
    if (!parsed) break; // цепочка кончилась — дальше без ИИ
    for (const [id, name] of Object.entries(parsed?.names || {})) {
      if (!chunk.find((c) => c.id === id)) continue; // только запрошенные слои
      const cls = className(name);
      if (cls && cls !== 'node' && cls.length <= 32) names.set(id, cls);
    }
  }
  const error = names.size || Object.keys(by).length ? undefined : errors.join('; ') || 'нет доступных провайдеров';
  if (errors.length && !error) log(`  ИИ: часть провайдеров недоступна (${errors.join('; ')})`);
  return { names, asked: items.length, used: names.size, error, by };
}

// ---------------------------------------------------------------------------------------------
// Настройки ИИ из окна программы: ключи и модели хранятся на компьютере (<папка сборок>/.ai.json)
// ---------------------------------------------------------------------------------------------

export const AI_DEFAULTS = { ollama: { enabled: true, url: 'http://localhost:11434', model: 'qwen2.5-coder:7b' }, gemini: { key: '', model: '' }, groq: { key: '', model: '' }, openrouter: { key: '', model: '' }, custom: { url: '', model: '', key: '' } };

export function readAiSettings(file) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* нет настроек — по умолчанию */ }
  const out = {};
  for (const [k, d] of Object.entries(AI_DEFAULTS)) out[k] = { ...d, ...(s[k] || {}) };
  return out;
}

export function writeAiSettings(file, s) {
  fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

/** Настройки → переменные среды, которые понимает aiProviders (для запуска сборки). */
export function aiEnv(s) {
  const e = {};
  const ou = trim(s.ollama.url || AI_DEFAULTS.ollama.url).replace(/\/v1$/, '');
  if (s.ollama.enabled === false) e.DS_NO_OLLAMA = '1';
  else { e.OLLAMA_URL = `${ou}/v1`; if (s.ollama.model) e.OLLAMA_MODEL = s.ollama.model; }
  if (s.gemini.key) { e.GEMINI_API_KEY = s.gemini.key; if (s.gemini.model) e.GEMINI_MODEL = s.gemini.model; }
  if (s.groq.key) { e.GROQ_API_KEY = s.groq.key; if (s.groq.model) e.GROQ_MODEL = s.groq.model; }
  if (s.openrouter.key) { e.OPENROUTER_API_KEY = s.openrouter.key; if (s.openrouter.model) e.OPENROUTER_MODEL = s.openrouter.model; }
  if (s.custom.url) { e.DS_AI_URL = s.custom.url; if (s.custom.model) e.DS_AI_MODEL = s.custom.model; if (s.custom.key) e.DS_AI_KEY = s.custom.key; }
  return e;
}

/** Ключи для показа в окне: только последние 4 символа. */
export function maskAi(s) {
  const m = JSON.parse(JSON.stringify(s));
  for (const k of ['gemini', 'groq', 'openrouter', 'custom']) if (m[k].key) m[k].key = `••••${m[k].key.slice(-4)}`;
  return m;
}

/** Сохранение из окна: «••••abcd» — ключ не меняли, остаётся прежний. */
export function mergeAi(old, inc) {
  const out = readAiSettingsFrom(old);
  for (const [k, d] of Object.entries(AI_DEFAULTS)) {
    for (const f of Object.keys(d)) {
      if (!inc?.[k] || !(f in inc[k])) continue;
      const v = inc[k][f];
      if (f === 'key' && typeof v === 'string' && v.startsWith('••••')) continue;
      out[k][f] = typeof d[f] === 'boolean' ? !!v : String(v ?? '').trim().slice(0, 500);
    }
  }
  return out;
}
const readAiSettingsFrom = (s) => Object.fromEntries(Object.entries(AI_DEFAULTS).map(([k, d]) => [k, { ...d, ...(s?.[k] || {}) }]));

/** Ollama на компьютере: запущена ли и какие модели скачаны. */
export async function ollamaStatus(url = AI_DEFAULTS.ollama.url) {
  const base = trim(url).replace(/\/v1$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { running: false };
    const data = await res.json();
    return { running: true, models: (data.models || []).map((m) => m.name) };
  } catch { return { running: false }; }
}

/** Скачать модель в Ollama; onProgress({ status, percent }). */
export async function ollamaPull(url, model, onProgress = () => {}) {
  const base = trim(url || AI_DEFAULTS.ollama.url).replace(/\/v1$/, '');
  const res = await fetch(`${base}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
  if (!res.ok || !res.body) throw new Error(`Ollama: HTTP ${res.status}`);
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      const j = JSON.parse(l);
      if (j.error) throw new Error(`Ollama: ${j.error}`);
      onProgress({ status: j.status, percent: j.total ? Math.round((j.completed || 0) / j.total * 100) : null });
    }
  }
}

/** Проверка: каждому подключённому ИИ — короткий запрос; ответ и время или ошибка. */
export async function testProviders(providers) {
  const out = [];
  for (const p of providers) {
    const t0 = Date.now();
    try {
      const txt = await chat(p, [{ role: 'system', content: 'Ответь только JSON.' }, { role: 'user', content: 'Верни {"ok": true}' }], { timeout: p.local ? 60000 : 20000 });
      const ok = /"ok"\s*:\s*true/.test(txt);
      out.push({ name: p.name, model: p.model, ok, ms: Date.now() - t0, error: ok ? undefined : `неожиданный ответ: ${txt.slice(0, 80)}` });
    } catch (e) {
      // понятнее для человека: без повтора имени и с объяснением частых ошибок
      const m = e.message.replace(new RegExp(`^${p.name}: `), '');
      const why = /ECONNREFUSED/.test(m) ? 'не запущен (нет ответа по адресу)' : /HTTP 401|HTTP 403/.test(m) ? 'ключ не подходит' : /HTTP 429/.test(m) ? 'лимит на сегодня исчерпан' : /HTTP 404/.test(m) ? 'нет такой модели или адреса' : /ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(m) ? 'нет связи с сервером' : m;
      out.push({ name: p.name, model: p.model, ok: false, error: why });
    }
  }
  return out;
}
