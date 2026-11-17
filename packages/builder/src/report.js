// HTML-отчёт: эталон / вёрстка / разница + наложение с ползунком.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildReport({ file, threshold, textThreshold, results }) {
  const passed = results.filter((r) => r.pass).length;
  const cards = results
    .map((r) => {
      const badge = r.pass === null ? '<span class="badge">без проверки</span>'
        : `<span class="badge ${r.pass ? 'ok' : 'fail'}">${r.pass ? 'pixel perfect ✓' : 'не прошло ✗'}</span>`;
      const g = r.geometry;
      const geo = g ? `<p class="meta">Геометрия: ${g.checked - g.failed} из ${g.checked} элементов совпадают с макетом (допуск ±${g.tolerance}px, макс. отклонение ${g.maxDelta}px)` +
        (r.diff ? ` · pixel diff: ${r.diff.percent.toFixed(3)}%` + (r.pixels ? ` (текст ${r.pixels.textPct.toFixed(3)}%, остальное ${r.pixels.otherPct.toFixed(3)}%)` : '') : '') + '</p>' +
        (g.issues.length ? '<ul class="warn">' + g.issues.slice(0, 10).map((i) => `<li>${esc(i.name)} (${esc(i.id)}): Δ ${i.delta}px — Figma ${i.figma.x},${i.figma.y} ${i.figma.w}×${i.figma.h}, вёрстка ${i.html.x},${i.html.y} ${i.html.w}×${i.html.h}</li>`).join('') + '</ul>' : '') : '';
      const tries = (r.attempts || [])
        .map((a) => `<li>${esc(a.mode)}: pixel diff ${Number.isNaN(a.percent) ? '—' : a.percent.toFixed(3) + '%'}, ошибок геометрии ${a.geometryFailed ?? '—'}${a.chosen ? ' — <b>выбран</b>' : ''}</li>`)
        .join('');
      const fonts = (r.fonts || []).filter((f) => !f.available).map((f) => esc(f.family));
      return `
<section class="card">
  <header><h2>${esc(r.name)}</h2>${badge}</header>
  <p class="meta">${r.width}×${r.height} · раскладка: <b>${esc(r.mode)}</b> ·
    блоков: ${r.stats.nodes} · flex Auto Layout: ${r.stats.figma || 0} · колонок/строк по геометрии: ${(r.stats.col || 0) + (r.stats.row || 0)} ·
    absolute: ${r.stats.abs || 0} · классов: ${r.stats.classes}
    · <a href="${esc(r.dir)}/index.html">открыть вёрстку</a></p>
  ${geo}
  ${r.refine ? `<p class="meta">Автодоработка: ${r.refine.before.toFixed(3)}% → ${r.refine.after.toFixed(3)}%, поправок: ${r.refine.patches.length} (${r.refine.patches.map((p) => esc(p.name)).join(', ')})</p>` : ''}
  ${tries ? `<ul class="meta">${tries}</ul>` : ''}
  ${fonts.length ? `<p class="warn">Не найдены шрифты: ${fonts.join(', ')} — установите их, иначе текст будет отличаться.</p>` : ''}
  ${r.diff?.sources ? `<p class="meta">Источники расхождений: ${Object.entries(r.diff.sources.byType).map(([k, v]) => `${esc(k)} ${Math.round((v / r.diff.sources.total) * 100)}%`).join(' · ')}</p>
  <ul class="meta">${r.diff.sources.top.slice(0, 6).map((s) => `<li>${esc(s.name)} <small>(${esc(s.type)}, ${esc(s.id)})</small>: ${s.pixels} px</li>`).join('')}</ul>` : ''}
  ${r.diff?.bbox ? `<p class="meta">Область расхождений: x ${r.diff.bbox.x}, y ${r.diff.bbox.y}, ${r.diff.bbox.w}×${r.diff.bbox.h}</p>` : ''}
  ${r.diff ? `
  <div class="overlay" style="aspect-ratio:${r.width}/${r.height}">
    <img src="${esc(r.dir)}/reference.png" alt="эталон">
    <img src="${esc(r.dir)}/render.png" alt="вёрстка" class="top">
  </div>
  <label class="meta">Эталон ← <input type="range" min="0" max="100" value="50" class="mix"> → вёрстка</label>
  <div class="grid">
    <figure><img src="${esc(r.dir)}/reference.png"><figcaption>Эталон (Figma)</figcaption></figure>
    <figure><img src="${esc(r.dir)}/render.png"><figcaption>Вёрстка</figcaption></figure>
    <figure><img src="${esc(r.dir)}/diff.png"><figcaption>Разница (красное)</figcaption></figure>
  </div>` : `<figure><img src="${esc(r.dir)}/render.png"><figcaption>Вёрстка</figcaption></figure>`}
</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Отчёт — ${esc(file)}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; background: #f4f4f5; color: #18181b; }
  main { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  .summary { color: #52525b; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 2px rgb(0 0 0 / .06); }
  .card header { display: flex; align-items: center; gap: 12px; }
  .card h2 { margin: 0; font-size: 17px; }
  .badge { padding: 2px 10px; border-radius: 999px; background: #e4e4e7; font-weight: 600; font-size: 13px; }
  .badge.ok { background: #dcfce7; color: #166534; } .badge.fail { background: #fee2e2; color: #991b1b; }
  .meta { color: #52525b; font-size: 13px; } .warn { color: #b45309; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; }
  figure { margin: 0; } figure img { width: 100%; border: 1px solid #e4e4e7; display: block; }
  figcaption { font-size: 12px; color: #71717a; margin-top: 4px; }
  .overlay { position: relative; max-width: 100%; border: 1px solid #e4e4e7; margin-top: 12px; }
  .overlay img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .overlay img.top { opacity: .5; }
</style></head>
<body><main>
<h1>Pixel diff: ${esc(file)}</h1>
<p class="summary"><a href="design-system/design-system.md">Дизайн-система</a> · <a href="design-system/tokens.json">tokens.json</a> (импорт в Figma — кнопкой в плагине)</p>
<p class="summary">Критерий: геометрия каждого элемента ±0.5px; несовпадающих пикселей вне текста не больше ${threshold}%, в тексте — не больше ${textThreshold}% · прошли ${passed} из ${results.length} фреймов</p>
${cards}
</main>
<script>
document.querySelectorAll('.card').forEach(function (c) {
  var r = c.querySelector('.mix'), t = c.querySelector('.overlay .top');
  if (r && t) r.addEventListener('input', function () { t.style.opacity = r.value / 100; });
});
</script>
</body></html>
`;
}
