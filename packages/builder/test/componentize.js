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
const own = r.pages[1].html.match(/class="button button--primary (button-[\w]+)"/);
assert.ok(own, 'у широкой копии свой класс');
assert.match(r.pages[1].css['b.css'], new RegExp(`\\.${own[1]}\\.${own[1]} \\{ width: 300px; background: red; \\}`));
assert.doesNotMatch(r.pages[0].css['a.css'], /\.p-def/, 'старые классы копий убраны из CSS страницы');
assert.match(r.pages[0].css['a.css'], /\.row \{/, 'остальное на месте');
assert.deepEqual(r.components.map((c) => c.block), ['button']);
console.log('компоненты в CSS: варианты, состояния, своё у копий — OK');
