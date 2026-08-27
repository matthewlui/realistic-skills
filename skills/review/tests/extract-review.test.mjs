import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReview } from '../scripts/extract-review.mjs';
import { assembleDocument } from '../lib/assemble.mjs';
import { emptyState, applyDrafts } from '../lib/review-state.mjs';

const page = (state, over = {}) => assembleDocument({
  title: 'T', css: 'a{}', docSource: '<p data-b="b1">x</p>', engine: 'E', state, ...over,
});

test('extracts state from a hosted page', () => {
  const state = applyDrafts(emptyState({ slug: 'a', title: 'T' }), [{
    tmpId: 'd1', anchor: { block: 'b1', quote: 'x', before: '', after: '' },
    verdict: 'must-fix', body: 'no', suggest: '',
  }]);
  const got = extractReview(page(state));
  assert.equal(got.comments.length, 1);
  assert.equal(got.comments[0].verdict, 'must-fix');
});

test('survives a document source containing a script terminator', () => {
  const state = emptyState({ slug: 'a', title: 'T' });
  assert.deepEqual(extractReview(page(state, { docSource: '<pre data-b="b1"></script></pre>' })), state);
});

test('returns null when there is no state block', () => {
  assert.equal(extractReview('<html><body>nothing</body></html>'), null);
});

test('returns null when the state block is not valid JSON', () => {
  assert.equal(extractReview('<script type="application/json" id="rv-state">{oops</script>'), null);
});

test('returns null for a local page stub rather than pretending it is state', () => {
  const stub = { schema: 1, doc: { slug: 'a', title: 'T', rev: 1, kind: 'prose' }, stub: true };
  assert.equal(extractReview(page(stub)), null);
});
