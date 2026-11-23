// Общий CSS компонентов: варианты → модификаторы, состояния → :hover/:active/:disabled, своё у копии — отдельно.
import assert from 'node:assert/strict';
import { componentize } from '../src/componentize.js';

const btn = (cls, variant, extra = '') => `<button class="${cls}" type="button" data-figma-id="x" data-name="Button" data-component="Button" data-variant="${variant}"${extra}>
  <span class="lab" data-name="Label"><span class="t-${variant.includes('Secondary') ? 'dark' : 'light'}">Купить</span></span>
</button>`;
const page1 = {
  html: `<body>\n<div class="row">\n${btn('p-def', 'Variant=Primary, State=Default')}\n${btn('p-hov', 'Variant=Primary, State=Hover')}\n${btn('s-def', 'Variant=Secondary, State=Default')}\n${btn('s-dis', 'Variant=Secondary, State=Disabled')}\n</div>\n</body>`,
  css: { 'a.css': [
    '.row { display: flex; }',
    '.p-def { display: flex; width: 120px; background: blue; }',
    '.p-hov { display: flex; width: 120px; background: navy; }',
    '.s-def { display: flex; width: 120px; background: white; }',
    '.s-dis { display: flex; width: 120px; background: gray; }',
    '.lab { display: block; }',
    '.t-light { color: white; }',
    '.t-dark { color: black; }',
  ].join('\n') + '\n' },
};
// копия на другой странице: шире и с переопределённым фоном
const page2 = { html: `<body>\n${btn('p-wide', 'Variant=Primary, State=Default')}\n${btn('p-def', 'Variant=Primary, State=Default')}\n</body>`, css: { 'b.css': '.p-wide { display: flex; width: 300px; background: red; }\n.p-def { display: flex; width: 120px; background: blue; }\n.lab { display: block; }\n.t-light { color: white; }\n' } };

const r = componentize([page1, page2]);
const css = r.css;
assert.match(css, /^\.button \{ display: flex; width: 120px; \}$/m, 'общее всех вариантов (по большинству копий)');
assert.match(css, /^\.button\.button--primary \{ background: blue; \}$/m);
assert.match(css, /^\.button\.button--secondary \{ background: white; \}$/m);
assert.match(css, /\.button\.button--primary:hover, \.button\.button--primary\.is-hover \{ background: navy; \}/, 'наведение');
assert.match(css, /\.button\.button--secondary:disabled, .*\.is-disabled \{ background: gray; \}/, 'неактивная');
assert.match(css, /\.button--secondary \.button__label-text \{ color: black; \}/, 'часть компонента по варианту');
assert.match(r.pages[0].html, /class="button button--primary is-hover"/, 'показ состояния без наведения');
assert.match(r.pages[0].html, /class="button__label"/);
// своё у копии — класс страницы с удвоенной специфичностью (сильнее модификатора)
const own = r.pages[1].html.match(/class="button button--primary (button--own-[\w]+)"/);
assert.ok(own, 'у широкой копии свой класс');
assert.match(r.pages[1].css['b.css'], new RegExp(`\\.${own[1]}\\.${own[1]} \\{ width: 300px; background: red; \\}`));
assert.doesNotMatch(r.pages[0].css['a.css'], /\.p-def/, 'старые классы копий убраны из CSS страницы');
assert.match(r.pages[0].css['a.css'], /\.row \{/, 'остальное на месте');
assert.deepEqual(r.components.map((c) => c.block), ['button']);
assert.match(r.pages[0].html, /class="button button--secondary is-disabled" disabled="" type="button"/, 'неактивная кнопка — disabled');
assert.doesNotMatch(r.pages[0].html, /class="button button--primary is-hover"[^>]*disabled/);
console.log('компоненты в CSS: варианты, состояния, своё у копий — OK');

// свойства-переключатели: Selected=true/false → aria-selected и модификатор --selected (не --true)
{
  const tab = (cls, v) => `<div class="${cls}" data-figma-id="x" data-name="Tab" data-component="Tab" data-variant="${v}"><span class="tt">Вкладка</span></div>`;
  const chk = (cls, v) => `<div class="${cls}" data-figma-id="y" data-name="Checkbox" data-component="Checkbox" data-variant="${v}"><span class="tt">Да</span></div>`;
  const pg = { html: `<body>\n${tab('a1', 'Selected=true')}\n${tab('a2', 'Selected=false')}\n${tab('a3', 'Selected=false')}\n${chk('c1', 'Checked=true')}\n${chk('c2', 'Checked=false')}\n</body>`,
    css: { 'p.css': '.a1 { display: block; color: blue; }\n.a2 { display: block; color: gray; }\n.a3 { display: block; color: gray; }\n.c1 { display: block; background: green; }\n.c2 { display: block; background: white; }\n.tt { display: block; }\n' } };
  const r2 = componentize([pg]);
  assert.match(r2.css, /\.tab\.tab--selected \{ color: blue; \}/, 'модификатор по имени свойства');
  assert.match(r2.pages[0].html, /class="tab tab--selected" aria-selected="true"/);
  assert.match(r2.pages[0].html, /class="tab" aria-selected="false"/);
  assert.match(r2.pages[0].html, /class="checkbox checkbox--checked" aria-checked="true" role="checkbox" tabindex="0"/, 'чекбокс — роль и фокус');
  console.log('Selected/Checked/Open из вариантов → aria-атрибуты — OK');
}

// имена классов без хеша: уникальные — как есть, повторы — с номером, имена компонентов не занимаем
{
  const { plainNames } = await import('../src/export-html.js');
  const pg = { html: '<div class="hero-abc12"><p class="title-aaaaa">a</p><p class="title-bbbbb">b</p><b class="button-ccccc button"></b></div>',
    css: { 'p.css': '.hero-abc12 { display: flex; }\n.title-aaaaa { color: red; }\n.title-bbbbb { color: blue; }\n.button-ccccc { width: 1px; }\n' } };
  const r = plainNames(pg, '.button { display: flex; }');
  assert.equal(r.html, '<div class="hero"><p class="title">a</p><p class="title-2">b</p><b class="button-2 button"></b></div>');
  assert.match(r.css['p.css'], /^\.title-2 \{ color: blue; \}$/m);
  console.log('имена классов без хеша — OK');
}
