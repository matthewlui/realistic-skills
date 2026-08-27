import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, assignBlockIdsByContent } from '../lib/render-markdown.mjs';
import { collectBlocks } from '../lib/render-prose.mjs';

test('headings become h tags at the right level', () => {
  assert.match(markdownToHtml('# One\n\n## Two'), /<h1>One<\/h1>[\s\S]*<h2>Two<\/h2>/);
});

test('paragraphs are separated by blank lines and joined within', () => {
  const h = markdownToHtml('first line\nsame para\n\nsecond para');
  assert.match(h, /<p>first line same para<\/p>/);
  assert.match(h, /<p>second para<\/p>/);
});

test('unordered and ordered lists render as list items', () => {
  assert.match(markdownToHtml('- a\n- b'), /<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/);
  assert.match(markdownToHtml('1. a\n2. b'), /<ol>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ol>/);
});

test('fenced code keeps its content verbatim and is not treated as markdown', () => {
  const h = markdownToHtml('```\n- not a list\n**not bold**\n```');
  assert.match(h, /<pre><code>- not a list\n\*\*not bold\*\*<\/code><\/pre>/);
});

test('a fence language drives syntax highlighting', () => {
  const h = markdownToHtml('```js\nconst x = 1;\n```');
  assert.match(h, /tk-kw">const</);
});

test('inline emphasis, code and links render', () => {
  const h = markdownToHtml('**bold** and *it* and `co` and [text](http://x)');
  assert.match(h, /<strong>bold<\/strong>/);
  assert.match(h, /<em>it<\/em>/);
  assert.match(h, /<code>co<\/code>/);
  assert.match(h, /<a href="http:\/\/x">text<\/a>/);
});

test('inline code is not further parsed for emphasis', () => {
  assert.match(markdownToHtml('`a **b** c`'), /<code>a \*\*b\*\* c<\/code>/);
});

test('html in markdown text is escaped', () => {
  assert.match(markdownToHtml('a <script>x()</script> b'), /&lt;script&gt;/);
});

test('a javascript link is refused', () => {
  const h = markdownToHtml('[click](javascript:alert(1))');
  assert.ok(!h.includes('href="javascript'));
});

test('blockquotes and tables render', () => {
  assert.match(markdownToHtml('> quoted'), /<blockquote>[\s\S]*quoted/);
  const t = markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(t, /<th>a<\/th>/);
  assert.match(t, /<td>1<\/td>/);
});

test('a horizontal rule renders and does not become a heading', () => {
  assert.match(markdownToHtml('a\n\n---\n\nb'), /<hr\s*\/?>/);
});

// --- id stability: a .md file has nowhere to store data-b, so ids come from a registry ---

test('assignBlockIdsByContent assigns and records ids', () => {
  const { html, registry, nextBlock } = assignBlockIdsByContent(markdownToHtml('# T\n\npara'), {});
  assert.match(html, /data-b="b1"/);
  assert.equal(Object.keys(registry).length, 2);
  assert.equal(nextBlock, 3);
});

test('re-rendering unchanged markdown reuses every id', () => {
  const md = '# Title\n\nfirst\n\nsecond';
  const one = assignBlockIdsByContent(markdownToHtml(md), {});
  const two = assignBlockIdsByContent(markdownToHtml(md), one.registry, one.nextBlock);
  assert.deepEqual(collectBlocks(two.html).map((b) => b.id), collectBlocks(one.html).map((b) => b.id));
});

test('inserting a paragraph at the top does not renumber the rest', () => {
  const one = assignBlockIdsByContent(markdownToHtml('first\n\nsecond'), {});
  const two = assignBlockIdsByContent(
    markdownToHtml('brand new\n\nfirst\n\nsecond'), one.registry, one.nextBlock);
  const byText = Object.fromEntries(collectBlocks(two.html).map((b) => [b.text, b.id]));
  const before = Object.fromEntries(collectBlocks(one.html).map((b) => [b.text, b.id]));
  assert.equal(byText.first, before.first);
  assert.equal(byText.second, before.second);
  assert.equal(byText['brand new'], 'b3');
});

test('editing one block leaves its neighbours ids untouched', () => {
  const one = assignBlockIdsByContent(markdownToHtml('keep me\n\nedit me'), {});
  const two = assignBlockIdsByContent(
    markdownToHtml('keep me\n\nedited now'), one.registry, one.nextBlock);
  const before = Object.fromEntries(collectBlocks(one.html).map((b) => [b.text, b.id]));
  const after = Object.fromEntries(collectBlocks(two.html).map((b) => [b.text, b.id]));
  assert.equal(after['keep me'], before['keep me']);
  assert.notEqual(after['edited now'], before['edit me'], 'edited text is a new block id');
});

test('two blocks with identical text get distinct ids', () => {
  const { html } = assignBlockIdsByContent(markdownToHtml('same\n\nsame'), {});
  const ids = collectBlocks(html).map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `collided: ${ids.join(',')}`);
});

test('duplicate blocks keep their ids across a re-render', () => {
  const md = 'same\n\nother\n\nsame';
  const one = assignBlockIdsByContent(markdownToHtml(md), {});
  const two = assignBlockIdsByContent(markdownToHtml(md), one.registry, one.nextBlock);
  assert.deepEqual(collectBlocks(two.html).map((b) => b.id), collectBlocks(one.html).map((b) => b.id));
});
