// Необязательный ИИ-слой: понятные имена классов для слоёв с безликими именами («Frame 237»).
//
// Принципы проекта: ИИ только там, где без него нельзя, и его результат проверяется.
// Здесь ИИ меняет лишь имена классов (на вид не влияют); теги остаются алгоритмическими.
// После генерации страница проходит ту же проверку геометрии и пикселей.
//
// Любой OpenAI-совместимый сервер: Ollama (по умолчанию), LM Studio, OpenRouter, Groq, Gemini…
//   DS_AI_URL   — базовый адрес API, по умолчанию http://localhost:11434/v1 (Ollama)
//   DS_AI_MODEL — модель, по умолчанию qwen2.5-coder:7b
//   DS_AI_KEY   — ключ, если нужен
// Ответы кэшируются на диске: повторная сборка не тратит лимиты.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isGenericName, className } from './semantic.js';

export function aiConfig(env = process.env) {
  return {
    url: (env.DS_AI_URL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
    model: env.DS_AI_MODEL || 'qwen2.5-coder:7b',
    key: env.DS_AI_KEY || '',
  };
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

async function chat(cfg, messages, { timeout = 90000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0, response_format: { type: 'json_object' } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = `Ты помогаешь верстальщику. Для каждого элемента страницы придумай короткое имя CSS-класса
на английском в kebab-case (1–3 слова), по смыслу: hero, card, card-title, price, feature-list, cta-button…
Опирайся на текст, тег, роль и родителя. Не повторяй тег (не "div-1"), не используй номера.
Ответ — только JSON: {"names": {"<id>": "<имя>", ...}}.`;

/**
 * @returns {Promise<{ names: Map<string,string>, asked: number, used: number, error?: string }>}
 */
export async function suggestNames(tree, sem, { cfg = aiConfig(), cacheDir, batch = 30, log = () => {} } = {}) {
  const items = candidates(tree, sem);
  const names = new Map();
  if (!items.length) return { names, asked: 0, used: 0 };
  let error;
  for (let i = 0; i < items.length; i += batch) {
    const chunk = items.slice(i, i + batch);
    const payload = JSON.stringify(chunk);
    const key = crypto.createHash('sha256').update(cfg.model + '\n' + SYSTEM + '\n' + payload).digest('hex').slice(0, 32);
    const cacheFile = cacheDir ? path.join(cacheDir, 'ai', `${key}.json`) : null;
    let parsed = null;
    if (cacheFile && fs.existsSync(cacheFile)) parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    else {
      try {
        log(`  ИИ (${cfg.model}): имена для ${chunk.length} слоёв…`);
        const content = await chat(cfg, [{ role: 'system', content: SYSTEM }, { role: 'user', content: payload }]);
        parsed = JSON.parse(content.replace(/^```(json)?|```$/g, '').trim());
        if (cacheFile) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(parsed)); }
      } catch (e) {
        error = e.message;
        break; // сервер недоступен — дальше без ИИ
      }
    }
    for (const [id, name] of Object.entries(parsed?.names || {})) {
      if (!chunk.find((c) => c.id === id)) continue; // только запрошенные слои
      const cls = className(name);
      if (cls && cls !== 'node' && cls.length <= 32) names.set(id, cls);
    }
  }
  return { names, asked: items.length, used: names.size, error };
}
