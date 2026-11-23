// La pagina /samsung deve restare leggibile da Tizen 3/4: niente sintassi ES6+ e niente
// CSS che quei motori ignorano. Questo test è la rete di sicurezza contro una regressione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/samsung.html', import.meta.url), 'utf8');

// via i commenti: contengono le parole vietate e non sono codice
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
  .join('\n');
const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  .map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, ''))
  .join('\n');

const JS_VIETATI = [
  ['arrow function', /=>/],
  ['template literal', /`/],
  ['optional chaining', /\?\./],
  ['nullish coalescing', /\?\?/],
  ['const/let', /\b(const|let)\s+[a-z$_]/i],
  ['class', /\bclass\s+[A-Z]/],
  ['spread', /\.\.\./],
  ['async/await', /\b(async|await)\b/],
  ['replaceAll', /\.replaceAll\(/],
  ['flatMap', /\.flatMap\(/],
  ['structuredClone', /structuredClone/],
  ['Array.at', /\.at\(-?\d/],
];

const CSS_VIETATI = [
  ['display: grid', /display\s*:\s*grid/],
  ['grid-template', /grid-template/],
  ['aspect-ratio', /aspect-ratio/],
  ['inset', /\binset\s*:/],
  ['gap', /\bgap\s*:/],
  [':has()', /:has\(/],
];

test('niente sintassi moderna nel JS di /samsung', () => {
  for (const [nome, re] of JS_VIETATI) assert.ok(!re.test(js), `trovato ${nome}`);
});

test('niente CSS che i Tizen vecchi ignorano', () => {
  for (const [nome, re] of CSS_VIETATI) assert.ok(!re.test(css), `trovato ${nome}`);
});

test('/samsung usa XHR e non fetch', () => {
  assert.match(js, /XMLHttpRequest/);
  assert.ok(!/\bfetch\s*\(/.test(js), 'fetch su Tizen 2.x non esiste');
});
