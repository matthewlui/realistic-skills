import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPage } from '../lib/build-page.mjs';
import { extractBlock } from '../lib/assemble.mjs';
import { emptyState } from '../lib/review-state.mjs';
import { collectBlocks } from '../lib/render-prose.mjs';

const args = (over = {}) => ({
  docMarkdown: '# Retry policy\n\nCapped at 30s.\n\n- first\n- second',
  state: emptyState({ slug: 'spec', title: 'Retry policy', kind: 'markdown' }),
  transport: 'local', shellCss: 'body{}', engineJs: 'E', transportJs: 'T',
  ...over,
});

test('markdown input renders to anchored blocks', () => {
  const { html } = buildPage(args());
  const src = extractBlock(html, 'rv-doc-source');
  assert.match(src, /<h1 data-b="b\d+">Retry policy<\/h1>/);
  assert.deepEqual(collectBlocks(src).map((b) => b.text),
    ['Retry policy', 'Capped at 30s.', 'first', 'second']);
});

test('the id registry is carried in the returned state', () => {
  const { state } = buildPage(args());
  assert.equal(Object.keys(state.blockIds).length, 4);
});

test('rebuilding unchanged markdown is a fixed point', () => {
  const first = buildPage(args());
  const second = buildPage(args({ state: first.state }));
  assert.equal(extractBlock(second.html, 'rv-doc-source'), extractBlock(first.html, 'rv-doc-source'));
  assert.deepEqual(second.state.blockIds, first.state.blockIds);
});

test('inserting a section at the top preserves every existing id', () => {
  const first = buildPage(args());
  const grown = buildPage(args({
    state: first.state,
    docMarkdown: 'A new opening line.\n\n# Retry policy\n\nCapped at 30s.\n\n- first\n- second',
  }));
  const before = Object.fromEntries(collectBlocks(extractBlock(first.html, 'rv-doc-source')).map((b) => [b.text, b.id]));
  const after = Object.fromEntries(collectBlocks(extractBlock(grown.html, 'rv-doc-source')).map((b) => [b.text, b.id]));
  for (const text of Object.keys(before)) {
    assert.equal(after[text], before[text], `id moved for ${JSON.stringify(text)}`);
  }
});

test('passing both markdown and html is refused rather than guessed at', () => {
  assert.throws(() => buildPage(args({ docHtml: '<p>x</p>' })), /both/i);
});

test('html input still works and ignores the registry', () => {
  const { html } = buildPage({ ...args(), docMarkdown: undefined, docHtml: '<p>plain</p>',
    state: emptyState({ slug: 's', title: 'T' }) });
  assert.match(extractBlock(html, 'rv-doc-source'), /<p data-b="b1">plain<\/p>/);
});

test('a fenced code block in markdown is highlighted and stays commentable', () => {
  const { html } = buildPage(args({ docMarkdown: '```js\nconst x = 1;\n```' }));
  const src = extractBlock(html, 'rv-doc-source');
  assert.match(src, /tk-kw">const</);
  assert.match(src, /<pre data-b="b\d+">/);
});
