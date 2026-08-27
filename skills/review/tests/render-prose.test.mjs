import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBlockIds, collectBlocks } from '../lib/render-prose.mjs';

test('assigns ids to unmarked block elements', () => {
  const { html, nextBlock } = assignBlockIds('<h2>Retry</h2><p>Backoff.</p>');
  assert.equal(html, '<h2 data-b="b1">Retry</h2><p data-b="b2">Backoff.</p>');
  assert.equal(nextBlock, 3);
});

test('preserves ids that are already present', () => {
  const src = '<p data-b="b7">Kept.</p>';
  assert.equal(assignBlockIds(src, 9).html, src);
});

test('is idempotent', () => {
  const once = assignBlockIds('<p>A</p><p>B</p>');
  const twice = assignBlockIds(once.html, once.nextBlock);
  assert.equal(twice.html, once.html);
  assert.equal(twice.nextBlock, once.nextBlock);
});

test('inserting a block at the top does not renumber existing ids', () => {
  const first = assignBlockIds('<p>Original one.</p><p>Original two.</p>');
  const grown = `<p>Brand new.</p>${first.html}`;
  const second = assignBlockIds(grown, first.nextBlock);
  assert.match(second.html, /<p data-b="b3">Brand new\.<\/p>/);
  assert.match(second.html, /<p data-b="b1">Original one\.<\/p>/);
  assert.match(second.html, /<p data-b="b2">Original two\.<\/p>/);
});

test('marks list items and table rows, not their containers', () => {
  const { html } = assignBlockIds('<ul><li>One</li><li>Two</li></ul>');
  assert.equal(html, '<ul><li data-b="b1">One</li><li data-b="b2">Two</li></ul>');
});

test('keeps existing attributes when adding an id', () => {
  const { html } = assignBlockIds('<p class="lede">Hi</p>');
  assert.equal(html, '<p class="lede" data-b="b1">Hi</p>');
});

test('collectBlocks returns id and plain text per block, in order', () => {
  const { html } = assignBlockIds('<h2>Retry</h2><p>Capped at <code>30s</code>.</p>');
  assert.deepEqual(collectBlocks(html), [
    { id: 'b1', text: 'Retry' },
    { id: 'b2', text: 'Capped at 30s.' },
  ]);
});

test('collectBlocks decodes entities so quotes match what a reader selected', () => {
  const { html } = assignBlockIds('<p>Tom &amp; Jerry &lt;3</p>');
  assert.deepEqual(collectBlocks(html), [{ id: 'b1', text: 'Tom & Jerry <3' }]);
});

test('never mints an id that already exists in the source, even if startAt is stale', () => {
  // A lost or reset nextBlock counter must not produce two blocks sharing an id,
  // which would make every anchor on them ambiguous.
  const { html } = assignBlockIds('<p data-b="b1">Existing.</p><p>Fresh.</p>', 1);
  const ids = collectBlocks(html).map((b) => b.id);
  assert.deepEqual(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(',')}`);
  assert.deepEqual(ids, ['b1', 'b2']);
});

test('skips over a whole run of taken ids', () => {
  const { html, nextBlock } = assignBlockIds(
    '<p data-b="b1">A</p><p data-b="b2">B</p><p data-b="b3">C</p><p>New.</p>', 1);
  assert.match(html, /<p data-b="b4">New\.<\/p>/);
  assert.equal(nextBlock, 5);
});
