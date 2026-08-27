import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeScriptText, unescapeScriptText, assembleDocument, extractBlock } from '../lib/assemble.mjs';

const fixture = (over = {}) => ({
  title: 'Auth flow',
  css: 'body{color:red}',
  docSource: '<p data-b="b1">Hello</p>',
  engine: 'console.log(1)',
  state: { schema: 1, doc: { slug: 'a', title: 'Auth flow', rev: 1, kind: 'prose' },
    anchors: {}, comments: [], nextAnchor: 1, nextComment: 1, nextBlock: 2 },
  ...over,
});

test('escapeHtml escapes the five dangerous characters', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('escapeScriptText neutralises a script terminator', () => {
  assert.equal(escapeScriptText('a</script>b'), 'a<\\/script>b');
});

test('escapeScriptText is case insensitive and covers style', () => {
  assert.equal(escapeScriptText('</SCRIPT </style'), '<\\/SCRIPT <\\/style');
});

test('escapeScriptText deepens an existing escape rather than colliding with it', () => {
  // Collapsing these two inputs to one output is what made recovery impossible.
  assert.notEqual(escapeScriptText('a</script>b'), escapeScriptText('a<\\/script>b'));
  assert.equal(escapeScriptText('a<\\/script>b'), 'a<\\\\/script>b');
});

test('assembleDocument emits a complete document, doctype first', () => {
  const out = assembleDocument(fixture());
  assert.match(out, /^<!doctype html>/);
  assert.match(out, /<\/html>$/);
  assert.match(out, /<title>Auth flow<\/title>/);
  assert.match(out, /<div id="rv-app"><\/div>/);
});

test('assembleDocument round-trips the state block', () => {
  const f = fixture();
  const parsed = JSON.parse(extractBlock(assembleDocument(f), 'rv-state'));
  assert.deepEqual(parsed, f.state);
});

test('assembleDocument round-trips the document source', () => {
  const f = fixture();
  assert.equal(extractBlock(assembleDocument(f), 'rv-doc-source'), f.docSource);
});

test('a document source containing a script terminator does not truncate the page', () => {
  const f = fixture({ docSource: '<pre data-b="b1">&lt;/script&gt; and </script> raw</pre>' });
  const out = assembleDocument(f);
  assert.ok(!out.includes('</script> raw'), 'raw terminator must be escaped');
  assert.equal(extractBlock(out, 'rv-engine'), f.engine, 'later blocks survive intact');
});

test('a stylesheet containing a style terminator does not truncate the head', () => {
  const f = fixture({ css: 'body{color:red}</style><script>evil()' });
  const out = assembleDocument(f);
  assert.ok(!out.includes('</style><script>evil()'));
  assert.equal(extractBlock(out, 'rv-doc-source'), f.docSource);
});

test('extractBlock returns null for an absent id', () => {
  assert.equal(extractBlock(assembleDocument(fixture()), 'nope'), null);
});

test('escaping is injective: a literal backslash-escaped terminator survives', () => {
  const f = fixture({ docSource: "<pre data-b=\"b1\">document.write('<\\/script>')</pre>" });
  assert.equal(extractBlock(assembleDocument(f), 'rv-doc-source'), f.docSource,
    'JS source using the <\\/script> idiom must round-trip unchanged');
});

test('escape then unescape is identity for every terminator shape', () => {
  for (const s of ['</script', '<\\/script', '<\\\\/script', 'plain', '</style', '<\\/style']) {
    assert.equal(unescapeScriptText(escapeScriptText(s)), s, `failed for ${JSON.stringify(s)}`);
  }
});

test('an engine body using the terminator idiom round-trips', () => {
  const f = fixture({ engine: "var x = '<\\/script>';" });
  assert.equal(extractBlock(assembleDocument(f), 'rv-engine'), f.engine);
});
