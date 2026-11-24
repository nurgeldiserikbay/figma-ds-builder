// HTML-отчёт: эталон / вёрстка / разница + наложение с ползунком.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildReport({ file, threshold, textThreshold, textAreaThreshold = 4, results, responsive = [], failed = [] }) {
  const passed = results.filter((r) => r.pass).length;
  const cards = results
    .map((r) => {
      const badge = r.pass === null ? '<span class="badge">без проверки</span>'
        : `<span class="badge ${r.pass ? 'ok' : 'fail'}">${r.pass ? 'pixel perfect ✓' : 'не прошло ✗'}</span>`;
      const g = r.geometry;
      const geo = g ? `<p class="meta">Геометрия: ${g.checked - g.failed} из ${g.checked} элементов совпадают с макетом (допуск ±${g.tolerance}px, макс. отклонение ${g.maxDelta}px)` +
        (r.diff ? ` · pixel diff: ${r.diff.percent.toFixed(3)}%` + (r.pixels ? ` (текст ${r.pixels.textPct.toFixed(3)}%${r.pixels.textAreaPct != null ? ` = ${r.pixels.textAreaPct.toFixed(1)}% площади текстов` : ''}, остальное ${r.pixels.otherPct.toFixed(3)}%)` : '') : '') + '</p>' +
        (g.issues.length ? '<ul class="warn">' + g.issues.slice(0, 10).map((i) => `<li>${esc(i.name)} (${esc(i.id)}): Δ ${i.delta}px — Figma ${i.figma.x},${i.figma.y} ${i.figma.w}×${i.figma.h}, вёрстка ${i.html.x},${i.html.y} ${i.html.w}×${i.html.h}</li>`).join('') + '</ul>' : '') : '';
      const tries = (r.attempts || [])
        .map((a) => `<li>${esc(a.mode === 'hybrid' ? `flow с закреплёнными блоками (${a.pinned})` : a.mode)}: pixel diff ${!Number.isFinite(a.percent) ? '—' : a.percent.toFixed(3) + '%'}, ошибок геометрии ${a.geometryFailed ?? '—'}${a.chosen ? ' — <b>выбран</b>' : ''}</li>`)
        .join('');
      const fonts = (r.fonts || []).filter((f) => !f.available).map((f) => esc(f.family));
      return `
<section class="card frame${r.pass === false ? ' failed' : ''}" id="f-${esc(r.dir)}">
  <header><h2>${esc(r.name)}</h2>${badge}</header>
  <p class="meta">${r.width}×${r.height} · раскладка: <b>${esc(r.mode === 'hybrid' ? `flow, координаты закреплены у блоков: ${r.pinned.length}` : r.mode)}</b> ·
    блоков: ${r.stats.nodes} · flex Auto Layout: ${r.stats.figma || 0} · колонок/строк по геометрии: ${(r.stats.col || 0) + (r.stats.row || 0)} ·
    absolute: ${r.stats.abs || 0} · классов: ${r.stats.classes}${r.stats.tags ? ' · теги: ' + Object.entries(r.stats.tags).map(([t, n]) => `${t} ${n}`).join(', ') : ''}
    · <a href="${esc(r.dir)}/index.html">открыть вёрстку</a></p>
  ${geo}
  ${r.stats.missing?.length ? `<p class="warn">Не свёрстаны слои (${r.stats.missing.length}): ${r.stats.missing.slice(0, 10).map((m) => esc(m.name)).join(', ')}</p>` : ''}
  ${r.frameworks ? `<p class="meta">${Object.entries(r.frameworks).map(([fw, x]) => `${fw === 'react' ? 'React' : 'Vue'}: ${x.same ? 'совпадает с HTML ✓' : `<b>отличается</b> (${x.percent.toFixed(3)}%, геометрия ${x.geometry})`}`).join(' · ')}</p>` : ''}
  ${r.refine ? `<p class="meta">Автодоработка: ${r.refine.before.toFixed(3)}% → ${r.refine.after.toFixed(3)}%, поправок: ${r.refine.patches.length} (${r.refine.patches.map((p) => esc(p.name)).join(', ')})</p>` : ''}
  ${tries ? `<ul class="meta">${tries}</ul>` : ''}
  ${fonts.length ? `<p class="warn">Не найдены шрифты: ${fonts.join(', ')} — установите их, иначе текст будет отличаться.</p>` : ''}
  ${r.diff?.sources ? `<p class="meta">Источники расхождений: ${Object.entries(r.diff.sources.byType).map(([k, v]) => `${esc(k)} ${Math.round((v / r.diff.sources.total) * 100)}%`).join(' · ')}</p>
  <ul class="meta">${r.diff.sources.top.slice(0, 6).map((s) => `<li>${esc(s.name)} <small>(${esc(s.type)}, ${esc(s.id)})</small>: ${s.pixels} px</li>`).join('')}</ul>` : ''}
  ${r.diff?.bbox ? `<p class="meta">Область расхождений: x ${r.diff.bbox.x}, y ${r.diff.bbox.y}, ${r.diff.bbox.w}×${r.diff.bbox.h}</p>` : ''}
  ${r.diff ? `
  <div class="overlay" style="aspect-ratio:${r.width}/${r.height}">
    <img loading="lazy" decoding="async" src="${esc(r.dir)}/reference.png" alt="эталон">
    <img loading="lazy" decoding="async" src="${esc(r.dir)}/render.png" alt="вёрстка" class="top">
  </div>
  <label class="meta">Эталон ← <input type="range" min="0" max="100" value="50" class="mix"> → вёрстка</label>
  <div class="grid">
    <figure><img loading="lazy" decoding="async" src="${esc(r.dir)}/reference.png"><figcaption>Эталон (Figma)</figcaption></figure>
    <figure><img loading="lazy" decoding="async" src="${esc(r.dir)}/render.png"><figcaption>Вёрстка</figcaption></figure>
    <figure><img loading="lazy" decoding="async" src="${esc(r.dir)}/diff.png"><figcaption>Разница (красное)</figcaption></figure>
  </div>` : `<figure><img loading="lazy" decoding="async" src="${esc(r.dir)}/render.png"><figcaption>Вёрстка</figcaption></figure>`}
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
  .toc a { white-space: nowrap; } .only { font-size: 14px; display: flex; gap: 8px; align-items: center; }
  body.only-failed .frame:not(.failed) { display: none; }
</style></head>
<body><main>
<h1>Pixel diff: ${esc(file)}</h1>
<p class="summary"><a href="design-system/design-system.md">Дизайн-система</a> · <a href="design-system/tokens.json">tokens.json</a> (импорт в Figma — кнопкой в плагине)</p>
<p class="summary">Критерий: геометрия каждого элемента ±0.5px; несовпадающих пикселей вне текста не больше ${threshold}%, в тексте — не больше ${textThreshold}% экрана или ${textAreaThreshold}% площади текстов (сглаживание букв в Figma и браузере различается) · прошли ${passed} из ${results.length} фреймов</p>
${failed.length ? `<div class="warn"><p><b>Не собраны: ${failed.length}.</b> Остальные экраны собраны; эти можно пересобрать кнопкой «Собрать снова».</p><ul>${failed.map((f) => `<li>${esc(f.page ? `${f.page} / ${f.name}` : f.name)} — ${esc(f.error)}</li>`).join('')}</ul></div>` : ''}
${results.length > 6 ? `<nav class="card toc">
  <label class="only"><input type="checkbox" id="onlyFailed"${results.some((r) => r.pass === false) ? '' : ' disabled'}> показывать только фреймы с расхождениями</label>
  ${results.some((r) => r.pass === false) ? `<p class="meta"><b>Не прошли (${results.filter((r) => r.pass === false).length}):</b> ${results.filter((r) => r.pass === false).map((r) => `<a href="#f-${esc(r.dir)}">${esc(r.name)}</a>`).join(' · ')}</p>` : '<p class="meta">Все фреймы прошли проверку.</p>'}
  <details><summary class="meta">Все фреймы (${results.length})</summary><p class="meta">${results.map((r) => `<a href="#f-${esc(r.dir)}">${esc(r.name)}</a>${r.pass === false ? ' ✗' : ''}`).join(' · ')}</p></details>
</nav>
<script>document.getElementById('onlyFailed')?.addEventListener('change', (e) => document.body.classList.toggle('only-failed', e.target.checked));</script>` : ''}
${responsive.length ? `<section class="card"><header><h2>Адаптивные страницы</h2></header>
${responsive.map((r) => `<p class="meta"><b>${esc(r.name)}</b> — макеты ${r.widths.join(' / ')} px · <a href="${esc(r.dir)}/index.html">открыть</a><br>
На ширине макета: ${r.exact.map((e) => `${e.width}px ${e.same ? '✓' : '✗ ' + e.percent.toFixed(3) + '%'}`).join(' · ') || '—'}<br>
Между макетами: ${r.overflow.map((e) => `${e.width}px ${e.ok ? '✓' : `✗ ${esc((e.why || []).join(', '))}`}`).join(' · ') || '—'}<br>
${(r.fluid || []).map((f, i) => `${r.widths[i]}px → ${f ? 'тянется до следующего макета' : `по центру, фиксированной ширины${r.rejected?.[r.widths[i]] ? ` (растянутая версия отклонена — ${esc(r.rejected[r.widths[i]])})` : ''}`}`).join('<br>')}</p>`).join('\n')}
<p class="meta">«Тянется» — блоки растягиваются по constraints Figma и Fill в Auto Layout, а без них — по геометрии;
на ширине макета страница совпадает с ним пиксель в пиксель. Если растянутая версия где-то ломается (текст налезает или
вылезает за край, фон секции не на всю ширину), остаётся фиксированная по центру. Уже самого узкого макета — пропорциональное уменьшение.</p></section>` : ''}
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
