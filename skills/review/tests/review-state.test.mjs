import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, dedupeDrafts, applyDrafts, reconcileAnchors } from '../lib/review-state.mjs';

const draft = (tmpId, block, quote, over = {}) => ({
  tmpId, anchor: { block, quote, before: '', after: '' },
  verdict: 'must-fix', body: 'no', suggest: '', ...over,
});
const blocks = (o) => Object.entries(o).map(([id, text]) => ({ id, text }));

test('emptyState starts every counter at 1', () => {
  const s = emptyState({ slug: 'authflow', title: 'Auth flow', kind: 'prose' });
  assert.equal(s.doc.rev, 1);
  assert.equal(s.nextAnchor, 1);
  assert.equal(s.nextComment, 1);
  assert.equal(s.nextBlock, 1);
  assert.deepEqual(s.comments, []);
});

test('applyDrafts mints monotonic ids and advances counters', () => {
  const s = applyDrafts(emptyState({ slug: 'd', title: 'D' }),
    [draft('d1', 'b1', 'alpha'), draft('d2', 'b2', 'beta')]);
  assert.deepEqual(s.comments.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(s.comments.map((c) => c.anchor), ['a1', 'a2']);
  assert.equal(s.nextComment, 3);
  assert.equal(s.nextAnchor, 3);
});

test('applyDrafts never reuses an id after earlier rounds', () => {
  let s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  s = applyDrafts(s, [draft('d2', 'b1', 'beta')]);
  assert.deepEqual(s.comments.map((c) => c.id), ['c1', 'c2']);
});

test('applyDrafts records the originating draft id', () => {
  const s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  assert.equal(s.comments[0].fromDraft, 'd1');
});

test('applyDrafts opens comments at the current rev', () => {
  const base = emptyState({ slug: 'd', title: 'D' });
  base.doc.rev = 4;
  const s = applyDrafts(base, [draft('d1', 'b1', 'alpha')]);
  assert.equal(s.comments[0].status, 'open');
  assert.equal(s.comments[0].createdRev, 4);
  assert.deepEqual(s.comments[0].thread.map((t) => t.by), ['reviewer'],
    'a new comment starts with the reviewer turn only');
});

test('applyDrafts does not mutate the input state', () => {
  const s0 = emptyState({ slug: 'd', title: 'D' });
  applyDrafts(s0, [draft('d1', 'b1', 'alpha')]);
  assert.equal(s0.comments.length, 0);
  assert.equal(s0.nextComment, 1);
});

test('dedupeDrafts drops drafts already published', () => {
  const s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  assert.deepEqual(dedupeDrafts([draft('d1', 'b1', 'alpha'), draft('d2', 'b1', 'beta')], s)
    .map((d) => d.tmpId), ['d2']);
});

test('resubmitting an applied draft cannot duplicate the comment', () => {
  let s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  s = applyDrafts(s, [draft('d1', 'b1', 'alpha')]);
  assert.equal(s.comments.length, 1);
});

test('reconcileAnchors marks a surviving quote live', () => {
  let s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  s = reconcileAnchors(s, blocks({ b1: 'alpha beta' }));
  assert.equal(s.comments[0].anchorState, 'live');
});

test('reconcileAnchors relocates and rewrites the anchor block', () => {
  let s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  s = reconcileAnchors(s, blocks({ b1: 'rewritten', b9: 'alpha beta' }));
  assert.equal(s.comments[0].anchorState, 'relocated');
  assert.equal(s.anchors.a1.block, 'b9');
});

test('reconcileAnchors orphans a deleted quote and leaves the anchor block alone', () => {
  let s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  s = reconcileAnchors(s, blocks({ b1: 'rewritten' }));
  assert.equal(s.comments[0].anchorState, 'orphaned');
  assert.equal(s.anchors.a1.block, 'b1');
});

test('status and anchorState are independent axes', () => {
  let s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  s.comments[0].status = 'addressed';
  s.comments[0].reply = 'deleted that line';
  s = reconcileAnchors(s, blocks({ b1: 'rewritten' }));
  assert.equal(s.comments[0].status, 'addressed', 'orphaning must not reset status');
  assert.equal(s.comments[0].anchorState, 'orphaned');
  assert.equal(s.comments[0].reply, 'deleted that line');
});
