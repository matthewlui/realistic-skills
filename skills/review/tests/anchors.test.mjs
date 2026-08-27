import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuote, resolveAnchor, findQuote } from '../lib/anchors.mjs';

const blocks = (o) => Object.entries(o).map(([id, text]) => ({ id, text }));

test('normalizeQuote collapses whitespace and trims', () => {
  assert.equal(normalizeQuote('  capped   at\n30s  '), 'capped at 30s');
});

test('live when the quote is still in its home block', () => {
  const b = blocks({ b1: 'Backoff is capped at 30s.', b2: 'Unrelated.' });
  const r = resolveAnchor({ block: 'b1', quote: 'capped at 30s' }, b);
  assert.equal(r.state, 'live');
  assert.equal(r.block, 'b1');
  assert.equal(r.at, 11);
});

test('matching ignores whitespace differences', () => {
  const b = blocks({ b1: 'Backoff is\n  capped at\t30s.' });
  assert.equal(resolveAnchor({ block: 'b1', quote: 'capped at 30s' }, b).state, 'live');
});

test('relocated when the quote moved to another block', () => {
  const b = blocks({ b1: 'Rewritten entirely.', b7: 'Backoff is capped at 30s.' });
  const r = resolveAnchor({ block: 'b1', quote: 'capped at 30s' }, b);
  assert.equal(r.state, 'relocated');
  assert.equal(r.block, 'b7');
});

test('home block wins even when the quote also exists elsewhere', () => {
  const b = blocks({ b1: 'capped at 30s here', b2: 'capped at 30s there' });
  const r = resolveAnchor({ block: 'b1', quote: 'capped at 30s' }, b);
  assert.equal(r.state, 'live');
  assert.equal(r.block, 'b1');
});

test('orphaned when the quote is gone from the document', () => {
  const b = blocks({ b1: 'Rewritten entirely.' });
  const r = resolveAnchor({ block: 'b1', quote: 'capped at 30s' }, b);
  assert.deepEqual(r, { block: null, state: 'orphaned', at: null });
});

test('orphaned when the home block was deleted and quote is gone', () => {
  const b = blocks({ b2: 'Something else.' });
  assert.equal(resolveAnchor({ block: 'b1', quote: 'capped at 30s' }, b).state, 'orphaned');
});

test('an empty quote is orphaned, never matched against everything', () => {
  const b = blocks({ b1: 'Anything at all.' });
  assert.equal(resolveAnchor({ block: 'b1', quote: '   ' }, b).state, 'orphaned');
});

test('never fuzzy matches a near miss', () => {
  const b = blocks({ b1: 'Backoff is capped at 60s.' });
  assert.equal(resolveAnchor({ block: 'b1', quote: 'capped at 30s' }, b).state, 'orphaned');
});

// --- findQuote: reconciles what the reader selected with what the source says ---
// Selection.toString() returns *rendered* text, so text-transform:uppercase makes
// the browser hand back "BACKOFF" for source that reads "Backoff". Matching that
// literally fails and the comment popover silently never opens.

test('findQuote matches an exact selection and returns the source text', () => {
  const r = findQuote('Backoff is capped at 30s.', 'capped at 30s');
  assert.deepEqual(r, { at: 11, quote: 'capped at 30s' });
});

test('findQuote survives text-transform:uppercase and stores the true source case', () => {
  const r = findQuote('Backoff', 'BACKOFF');
  assert.deepEqual(r, { at: 0, quote: 'Backoff' },
    'the stored quote must be the source text, not the rendered text');
});

test('findQuote survives text-transform:lowercase and capitalize', () => {
  assert.equal(findQuote('Retry Policy', 'retry policy').quote, 'Retry Policy');
  assert.equal(findQuote('retry policy', 'Retry Policy').quote, 'retry policy');
});

test('findQuote handles a transformed selection inside a longer block', () => {
  const r = findQuote('The Client retries failed uploads', 'CLIENT RETRIES');
  assert.deepEqual(r, { at: 4, quote: 'Client retries' });
});

test('findQuote normalises whitespace on both sides', () => {
  assert.equal(findQuote('Backoff is\n  capped at\t30s', '  capped   at 30s  ').quote, 'capped at 30s');
});

test('findQuote prefers an exact match over a case-insensitive one', () => {
  // 'ab' appears lowercase at 0 and uppercase at 3; an exact selection must win.
  const r = findQuote('ab AB', 'AB');
  assert.deepEqual(r, { at: 3, quote: 'AB' });
});

test('findQuote returns null when the text is genuinely absent', () => {
  assert.equal(findQuote('Backoff is capped at 30s.', 'nowhere in here'), null);
});

test('findQuote returns null for an empty selection', () => {
  assert.equal(findQuote('Backoff', '   '), null);
});

test('findQuote is not fuzzy: a near miss still fails', () => {
  assert.equal(findQuote('capped at 60s', 'capped at 30s'), null);
});
