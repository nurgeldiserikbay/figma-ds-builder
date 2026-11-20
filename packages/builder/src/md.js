// Небольшой markdown → HTML для страниц программы (памятка дизайнеру): заголовки, абзацы, списки,
// чек-листы, таблицы, код, ссылки, жирный. Якоря заголовков — как у GitHub, чтобы ссылки совпадали.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Якорь заголовка, как его строит GitHub: нижний регистр, без знаков препинания, пробел → дефис. */
export function slugify(text) {
  return String(text).trim().toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => `<a href="${href.replace(/"/g, '%22')}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`);
  return t;
}

export function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join(' ');
    // пометки памятки: «**Уже работает:** …», «**В планах:** …»
    const cls = /^\*\*Уже работает:\*\*/.test(text) ? ' class="note ok"' : /^\*\*В планах:\*\*/.test(text) ? ' class="note plan"' : '';
    out.push(`<p${cls}>${inline(text)}</p>`);
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flush(); i++; continue; }
    if (/^```/.test(line)) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      i++; continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const lvl = h[1].length;
      out.push(`<h${lvl} id="${esc(slugify(h[2]))}">${inline(h[2])}</h${lvl}>`);
      i++; continue;
    }
    if (/^---+\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\|/.test(line) && /^\|?\s*:?-+/.test(lines[i + 1] || '')) {
      flush();
      const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push(`<ul>${items.map((t) => {
        const cb = t.match(/^\[( |x)\]\s+(.*)$/i);
        return cb ? `<li class="check"><label><input type="checkbox"${cb[1] !== ' ' ? ' checked' : ''}> ${inline(cb[2])}</label></li>` : `<li>${inline(t)}</li>`;
      }).join('')}</ul>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}
