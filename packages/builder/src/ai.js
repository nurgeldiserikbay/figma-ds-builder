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
  if (env.DS_AI_URL) return [{ name: 'свой сервер', url: trim(env.DS_AI_URL), model: env.DS_AI_MODEL || 'qwen2.5-coder:7b', key: env.DS_AI_KEY || '', local: true }];
  const list = [
    { name: 'Ollama', url: trim(env.OLLAMA_URL || 'http://localhost:11434/v1'), model: env.OLLAMA_MODEL || 'qwen2.5-coder:7b', key: '', local: true },
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

async function chat(cfg, messages, { timeout = cfg.local ? 120000 : 60000 } = {}) {
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
