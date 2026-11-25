// Нарисованный в макете скроллбар → настоящая прокрутка. Без ИИ, по форме:
// узкая дорожка со скруглением и ползунок той же ширины внутри неё, прижатые к правому краю блока,
// у которого есть содержимое рядом. Блок прокручивается (системная полоса скрыта), нарисованная полоса
// остаётся на месте (sticky) и показывает положение прокрутки — небольшим скриптом SCROLLBAR_JS.

const visible = (n) => n.visible !== false;
const solid = (n) => (n.fills || []).some((f) => f.visible !== false && f.type === 'SOLID');
const hasText = (n) => n.type === 'TEXT' || (n.children || []).some(hasText);
const near = (a, b, d = 1.5) => Math.abs(a - b) <= d;

/** Полоса: дорожка + ползунок (или только ползунок, если слой назван scroll…). */
function barParts(b) {
  if (hasText(b) || b.w > 14 || b.h < 40 || b.h < b.w * 5) return null;
  const kids = (b.children || []).filter(visible);
  const thin = (k) => k.type !== 'TEXT' && !(k.children || []).length && k.w <= 14 && solid(k);
  if (kids.length === 2 && kids.every(thin)) {
    const [track, thumb] = [...kids].sort((x, y) => y.h - x.h);
    if (near(track.w, thumb.w) && near(track.x, thumb.x) && near(track.h, b.h, 2) && thumb.h < track.h * 0.95
      && thumb.y >= track.y - 0.5 && thumb.y + thumb.h <= track.y + track.h + 0.5) return { track, thumb };
  }
  if (/scroll|скролл|прокрут/i.test(b.name || '') && kids.length === 1 && thin(kids[0]) && kids[0].h < b.h * 0.95) return { track: null, thumb: kids[0] };
  return null;
}

/** id блока с прокруткой → { bar, thumb } для всех найденных в макете полос. */
export function findScrollbars(tree) {
  const out = new Map();
  (function walk(p) {
    const kids = (p.children || []).filter(visible);
    for (const b of kids) {
      const parts = barParts(b);
      if (!parts) continue;
      const right = p.x + p.w - (b.x + b.w);
      const content = kids.filter((k) => k !== b && k.x + k.w <= b.x + 1 && k.h >= b.h * 0.5);
      if (right < -0.5 || right > 16 || !content.length || b.h < p.h * 0.5) continue;
      out.set(p.id, { bar: b.id, thumb: parts.thumb.id });
    }
    kids.forEach(walk);
  })(tree);
  return out;
}

/** Ползунок едет вслед за прокруткой (одна общая подписка на всю страницу). */
export const SCROLLBAR_JS = `document.addEventListener('scroll', function (e) {
  var s = e.target;
  if (!s || !s.hasAttribute || !s.hasAttribute('data-scroll')) return;
  var bar = s.querySelector('[data-scrollbar]'), thumb = bar && bar.querySelector('[data-scroll-thumb]');
  if (!thumb) return;
  var max = s.scrollHeight - s.clientHeight, room = bar.clientHeight - thumb.offsetHeight;
  thumb.style.transform = 'translateY(' + (max > 0 ? Math.round(s.scrollTop / max * room) : 0) + 'px)';
}, true);`;

export const SCROLLBAR_CSS = '[data-scroll] { scrollbar-width: none; }\n[data-scroll]::-webkit-scrollbar { display: none; }';
