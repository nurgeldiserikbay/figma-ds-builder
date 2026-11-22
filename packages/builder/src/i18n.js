/* Переводы сайта. Исходный язык — русский в разметке; словарь (i18n-data.js): I18N_DATA = { keys: [...русские тексты],
   en: [...], zh: [...], … } — переводы по тем же индексам. Тексты находятся по совпадению с русским оригиналом,
   поэтому разметку не нужно размечать ключами. Список текстов страницы выгружает tools/i18n-keys.mjs —
   тем же collect(), что и перевод, поэтому они не расходятся. */
(function () {
  var LANGS = ['ru', 'en', 'zh', 'es', 'pt', 'de', 'fr', 'kk'];
  // текстовый блок переводится целиком (вместе с <b>, <a>, <code> внутри); встроенный элемент вне блока — сам по себе
  var BLOCK = 'title,h1,h2,h3,p,li,td,th,summary,figcaption,option,button,label,legend,dt,dd';
  var INLINE = 'a,b,span,code,strong';
  var SEL = BLOCK + ',' + INLINE;
  var ATTRS = ['alt', 'aria-label', 'title', 'placeholder'];
  var CYR = /[А-Яа-яЁё]/;
  var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
  var hasCyr = function (s) { return CYR.test(s); };

  /** Переводимые места страницы: элемент целиком (innerHTML) или отдельный текстовый узел, если внутри есть поля ввода и т. п. */
  function collect(root) {
    var out = [], taken = [];
    var inTaken = function (el) { for (var p = el.parentElement; p; p = p.parentElement) if (taken.indexOf(p) >= 0) return true; return false; };
    var all = root.querySelectorAll(SEL);
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest('[data-i18n-skip]') || !hasCyr(el.textContent) || inTaken(el)) continue;
      if (el.querySelector('input,select,textarea,img,svg,[id]')) {
        // внутри поле ввода или элемент со своим id: его нельзя пересоздавать — переводятся свои тексты, вложенное — отдельно
        for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && hasCyr(n.nodeValue)) out.push({ node: n, key: norm(n.nodeValue), mode: 'text' });
        continue;
      }
      // внутри есть свой текстовый блок с русским текстом — переводятся они, а не обёртка
      var kids = el.querySelectorAll(BLOCK), container = false;
      for (var j = 0; j < kids.length; j++) if (hasCyr(kids[j].textContent)) { container = true; break; }
      if (container) continue;
      taken.push(el);
      out.push({ el: el, key: norm(el.innerHTML), mode: 'html' });
    }
    var withAttr = root.querySelectorAll('[alt],[aria-label],[title],[placeholder]');
    for (var k = 0; k < withAttr.length; k++) {
      for (var a = 0; a < ATTRS.length; a++) {
        var v = withAttr[k].getAttribute(ATTRS[a]);
        if (v && hasCyr(v)) out.push({ el: withAttr[k], attr: ATTRS[a], key: norm(v), mode: 'attr' });
      }
    }
    var meta = document.querySelector('meta[name="description"]');
    if (meta) out.push({ el: meta, attr: 'content', key: norm(meta.getAttribute('content')), mode: 'attr' });
    return out;
  }

  var data = window.I18N_DATA || { keys: [] };
  var index = {};
  data.keys.forEach(function (k, i) { index[k] = i; });
  var units = null, current = 'ru';

  /** Перевод строки для скриптов страницы: t('Скопировано'). */
  function t(ru) {
    if (current === 'ru') return ru;
    var i = index[norm(ru)];
    var tr = i !== undefined && data[current] && data[current][i];
    return tr || ru;
  }

  function apply(lang) {
    if (LANGS.indexOf(lang) < 0) lang = 'en';
    if (!units) units = collect(document).map(function (u) { u.orig = u.mode === 'text' ? u.node.nodeValue : u.mode === 'attr' ? u.el.getAttribute(u.attr) : u.el.innerHTML; return u; });
    current = lang;
    units.forEach(function (u) {
      var i = index[u.key];
      var tr = lang === 'ru' || i === undefined || !data[lang] || !data[lang][i] ? null : data[lang][i];
      if (u.mode === 'text') u.node.nodeValue = tr ? u.orig.replace(/\S[\s\S]*\S|\S/, tr) : u.orig;
      else if (u.mode === 'attr') u.el.setAttribute(u.attr, tr || u.orig);
      else u.el.innerHTML = tr || u.orig;
    });
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    var sel = document.getElementById('lang');
    if (sel) sel.value = lang;
    try { localStorage.setItem('lang', lang); } catch (e) { /* без памяти — не страшно */ }
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  }

  function detect() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q && LANGS.indexOf(q) >= 0) return q;
    try { var s = localStorage.getItem('lang'); if (s && LANGS.indexOf(s) >= 0) return s; } catch (e) { /* нет */ }
    var list = navigator.languages || [navigator.language || 'en'];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i]).toLowerCase().split('-')[0];
      if (code === 'kz') code = 'kk';
      if (LANGS.indexOf(code) >= 0) return code;
    }
    return 'en';
  }

  window.I18N = { collect: collect, apply: apply, t: t, langs: LANGS, get lang() { return current; } };
  window.t = t;
  function init() {
    var sel = document.getElementById('lang');
    if (sel) sel.addEventListener('change', function () { apply(sel.value); });
    var lang = detect();
    if (lang !== 'ru') apply(lang); else if (sel) sel.value = 'ru';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
