import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFile(join(here, '..', ...p), 'utf8');

// The engine renders #rv-app's children from the SHELL string, so the grid must
// declare a row for each of them. Declaring fewer drops the overflow child into
// an implicit auto row and hands the 1fr row to the wrong element - which made
// the notice banner stretch to fill the viewport and killed the doc pane's
// scroll containment.
function shellChildCount(engineSrc) {
  const block = engineSrc.match(/var SHELL = \[([\s\S]*?)\]\.join\(''\);/);
  assert.ok(block, 'SHELL array not found in engine/review.js');
  const markup = block[1].split('\n')
    .map((l) => (l.match(/'([^']*)'/) || [, ''])[1]).join('');
  let depth = 0, top = 0;
  for (const tag of markup.match(/<\/?[a-z]+[^>]*>/g) || []) {
    if (tag.startsWith('</')) { depth--; continue; }
    if (depth === 0) top++;
    if (!/\/>$/.test(tag)) depth++;
    if (/<\/[a-z]+>/.test(tag)) depth--;
  }
  return top;
}

test('#rv-app declares a grid row for every shell child', async () => {
  const css = await read('templates', 'shell.html');
  const engine = await read('engine', 'review.js');

  const decl = css.match(/#rv-app\{[^}]*grid-template-rows:([^;}]+)/);
  assert.ok(decl, 'grid-template-rows not declared on #rv-app');
  const rows = decl[1].trim().split(/\s+(?![^(]*\))/).length;

  const children = shellChildCount(engine);
  assert.ok(rows >= children,
    `#rv-app has ${children} children but declares ${rows} rows: the extra child ` +
    `falls into an implicit auto row and the 1fr row goes to the wrong element`);
});

test('the notice banner collapses fully when hidden', async () => {
  const css = await read('templates', 'shell.html');
  assert.match(css, /\.rv-note\[hidden\]\{display:none\}/,
    'a hidden banner must not hold its grid row open');
});

test('the document pane owns its own scroll', async () => {
  const css = await read('templates', 'shell.html');
  assert.match(css, /\.rv-docwrap\{[^}]*overflow-y:auto/);
  assert.match(css, /\.rv-main\{[^}]*min-height:0/,
    'without min-height:0 the grid row refuses to shrink and the pane never scrolls');
});
