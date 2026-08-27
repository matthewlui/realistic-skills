import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, plainTextOf } from '../lib/highlight.mjs';

test('marks keywords, strings and numbers in js', () => {
  const h = highlight("const x = 'hi'; // note", 'js');
  assert.match(h, /<span class="tk-kw">const<\/span>/);
  assert.match(h, /<span class="tk-str">&#39;hi&#39;<\/span>/);
  assert.match(h, /<span class="tk-com">\/\/ note<\/span>/);
});

test('marks numbers and booleans', () => {
  const h = highlight('let n = 42; let ok = true;', 'js');
  assert.match(h, /<span class="tk-num">42<\/span>/);
  assert.match(h, /<span class="tk-lit">true<\/span>/);
});

test('escapes markup so code cannot inject html', () => {
  const h = highlight('const a = "<img onerror=x>";', 'js');
  assert.ok(!h.includes('<img'));
  assert.match(h, /&lt;img/);
});

test('a string containing a comment marker stays one string', () => {
  const h = highlight("const u = 'http://x'; // real", 'js');
  assert.match(h, /<span class="tk-str">&#39;http:\/\/x&#39;<\/span>/);
  assert.equal((h.match(/tk-com/g) || []).length, 1);
});

test('a comment containing a quote does not open a string', () => {
  const h = highlight("a(); // don't do this\nb();", 'js');
  assert.equal((h.match(/tk-str/g) || []).length, 0);
});

test('block comments span lines', () => {
  const h = highlight('/* one\n two */ x', 'js');
  assert.match(h, /<span class="tk-com">\/\* one\n two \*\/<\/span>/);
});

test('template literals are strings', () => {
  assert.match(highlight('const s = `a${b}c`;', 'js'), /<span class="tk-str">`a\$\{b\}c`<\/span>/);
});

test('css marks selectors, properties and comments', () => {
  const h = highlight('.a{color:red} /* c */', 'css');
  assert.match(h, /tk-prop">color/);
  assert.match(h, /tk-com">\/\* c \*\//);
});

test('json marks keys and values distinctly', () => {
  const h = highlight('{"a": 1, "b": "two"}', 'json');
  assert.match(h, /tk-key">&quot;a&quot;/);
  assert.match(h, /tk-num">1/);
  assert.match(h, /tk-str">&quot;two&quot;/);
});

test('an unknown language falls back to escaped plain text', () => {
  assert.equal(highlight('a < b && c', 'brainfuck'), 'a &lt; b &amp;&amp; c');
});

test('highlighting never changes the underlying text', () => {
  // Anchors resolve against textContent, so inserting spans must not alter the text.
  const samples = [
    ["const x = 'hi'; // note", 'js'],
    ['{"a": 1, "b": "two"}', 'json'],
    ['.a{color:red}', 'css'],
    ['/* one\n two */ x', 'js'],
    ['plain text here', 'txt'],
  ];
  for (const [code, lang] of samples) {
    assert.equal(plainTextOf(highlight(code, lang)), code, `text changed for ${lang}`);
  }
});
