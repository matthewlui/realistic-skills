import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, applyDrafts, replyToComment, openingOf, latestSuggest,
  isReopened, migrateComment,
} from '../lib/review-state.mjs';

const newDraft = (tmpId, block, quote, over = {}) => ({
  tmpId, kind: 'new', anchor: { block, quote, before: '', after: '' },
  verdict: 'must-fix', body: 'this retries forever', suggest: '', ...over,
});
const followUp = (tmpId, targetId, body, over = {}) => ({
  tmpId, kind: 'followup', targetId, body, suggest: '', ...over,
});

const opened = () => applyDrafts(emptyState({ slug: 'd', title: 'D' }), [newDraft('d1', 'b1', 'alpha')]);

test('a new comment opens a thread with the reviewer speaking first', () => {
  const c = opened().comments[0];
  assert.equal(c.thread.length, 1);
  assert.deepEqual(c.thread[0], { by: 'reviewer', body: 'this retries forever', suggest: '', rev: 1 });
  assert.equal(c.status, 'open');
});

test('a draft with no kind is still treated as a new comment', () => {
  const s = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [
    { tmpId: 'd9', anchor: { block: 'b1', quote: 'a', before: '', after: '' },
      verdict: 'nit', body: 'small', suggest: '' },
  ]);
  assert.equal(s.comments[0].thread[0].by, 'reviewer');
});

test('replying appends an agent turn and sets the status', () => {
  const s = replyToComment(opened(), 'c1', { body: 'capped it at 3', status: 'addressed', rev: 2 });
  const c = s.comments[0];
  assert.equal(c.status, 'addressed');
  assert.equal(c.thread.length, 2);
  assert.deepEqual(c.thread[1], { by: 'agent', body: 'capped it at 3', rev: 2 });
});

test('a follow-up appends to the same comment and reopens it', () => {
  let s = replyToComment(opened(), 'c1', { body: 'fixed', status: 'addressed', rev: 2 });
  s = applyDrafts(s, [followUp('d2', 'c1', 'still broken on 401')]);
  const c = s.comments[0];
  assert.equal(c.status, 'open', 'a follow-up must reopen the comment');
  assert.equal(c.thread.length, 3);
  assert.deepEqual(c.thread[2], { by: 'reviewer', body: 'still broken on 401', suggest: '', rev: 1 });
});

test('a follow-up mints no new comment and no new anchor', () => {
  let s = replyToComment(opened(), 'c1', { body: 'fixed', status: 'addressed', rev: 2 });
  const before = { comments: s.comments.length, anchors: Object.keys(s.anchors).length,
    nextComment: s.nextComment, nextAnchor: s.nextAnchor };
  s = applyDrafts(s, [followUp('d2', 'c1', 'still broken')]);
  assert.equal(s.comments.length, before.comments);
  assert.equal(Object.keys(s.anchors).length, before.anchors);
  assert.equal(s.nextComment, before.nextComment);
  assert.equal(s.nextAnchor, before.nextAnchor);
  assert.equal(s.comments[0].id, 'c1', 'the thread keeps its identity across rounds');
});

test('a follow-up keeps the original verdict and anchor', () => {
  let s = replyToComment(opened(), 'c1', { body: 'fixed', status: 'addressed', rev: 2 });
  s = applyDrafts(s, [followUp('d2', 'c1', 'nope')]);
  assert.equal(s.comments[0].verdict, 'must-fix');
  assert.equal(s.comments[0].anchor, 'a1');
});

test('a follow-up can carry a fresh suggested replacement', () => {
  let s = replyToComment(opened(), 'c1', { body: 'reworded', status: 'addressed', rev: 2 });
  s = applyDrafts(s, [followUp('d2', 'c1', 'use this instead', { suggest: 'maxRetries: 3' })]);
  assert.equal(latestSuggest(s.comments[0]), 'maxRetries: 3');
});

test('latestSuggest falls back to the opening suggestion', () => {
  const s = applyDrafts(emptyState({ slug: 'd', title: 'D' }),
    [newDraft('d1', 'b1', 'alpha', { suggest: 'first idea' })]);
  assert.equal(latestSuggest(s.comments[0]), 'first idea');
});

test('a resubmitted follow-up cannot double-append', () => {
  let s = replyToComment(opened(), 'c1', { body: 'fixed', status: 'addressed', rev: 2 });
  s = applyDrafts(s, [followUp('d2', 'c1', 'still broken')]);
  s = applyDrafts(s, [followUp('d2', 'c1', 'still broken')]);
  assert.equal(s.comments[0].thread.length, 3);
});

test('a follow-up aimed at an unknown comment is dropped, not crashed on', () => {
  const s = applyDrafts(opened(), [followUp('d2', 'c99', 'orphan follow-up')]);
  assert.equal(s.comments.length, 1);
  assert.equal(s.comments[0].thread.length, 1);
});

test('several rounds accumulate in order', () => {
  let s = opened();
  s = replyToComment(s, 'c1', { body: 'r1', status: 'addressed', rev: 2 });
  s = applyDrafts(s, [followUp('f1', 'c1', 'still no')]);
  s = replyToComment(s, 'c1', { body: 'r2', status: 'addressed', rev: 3 });
  s = applyDrafts(s, [followUp('f2', 'c1', 'better')]);
  assert.deepEqual(s.comments[0].thread.map((t) => t.by),
    ['reviewer', 'agent', 'reviewer', 'agent', 'reviewer']);
  assert.deepEqual(s.comments[0].thread.map((t) => t.body),
    ['this retries forever', 'r1', 'still no', 'r2', 'better']);
});

test('isReopened distinguishes a fresh comment from a re-opened one', () => {
  const fresh = opened();
  assert.equal(isReopened(fresh.comments[0]), false);
  let s = replyToComment(fresh, 'c1', { body: 'fixed', status: 'addressed', rev: 2 });
  assert.equal(isReopened(s.comments[0]), false, 'addressed is not reopened');
  s = applyDrafts(s, [followUp('d2', 'c1', 'still broken')]);
  assert.equal(isReopened(s.comments[0]), true);
});

test('openingOf returns the reviewer first turn', () => {
  assert.equal(openingOf(opened().comments[0]).body, 'this retries forever');
});

test('replying to an unknown comment leaves state untouched', () => {
  const s = opened();
  assert.deepEqual(replyToComment(s, 'c99', { body: 'x', status: 'addressed', rev: 2 }), s);
});

test('pushed-back is a valid reply status and survives a follow-up reopening it', () => {
  let s = replyToComment(opened(), 'c1', { body: 'breaks iOS 15', status: 'pushed-back', rev: 2 });
  assert.equal(s.comments[0].status, 'pushed-back');
  s = applyDrafts(s, [followUp('d2', 'c1', 'we dropped iOS 15')]);
  assert.equal(s.comments[0].status, 'open');
  assert.equal(s.comments[0].thread[1].body, 'breaks iOS 15', 'the disagreement stays on the record');
});

test('migrateComment lifts a legacy body/reply pair into a thread', () => {
  const legacy = { id: 'c1', anchor: 'a1', verdict: 'must-fix', body: 'orig', suggest: 'sug',
    createdRev: 1, status: 'addressed', anchorState: 'live', reply: 'done', repliedRev: 2 };
  const c = migrateComment(legacy);
  assert.deepEqual(c.thread, [
    { by: 'reviewer', body: 'orig', suggest: 'sug', rev: 1 },
    { by: 'agent', body: 'done', rev: 2 },
  ]);
  assert.equal(c.body, undefined);
  assert.equal(c.reply, undefined);
  assert.equal(c.status, 'addressed');
});

test('migrateComment leaves an already-threaded comment alone', () => {
  const c = opened().comments[0];
  assert.deepEqual(migrateComment(c), c);
});

test('migrateComment handles a legacy comment with no reply yet', () => {
  const c = migrateComment({ id: 'c1', anchor: 'a1', verdict: 'nit', body: 'orig', suggest: '',
    createdRev: 1, status: 'open', anchorState: 'live', reply: '', repliedRev: null });
  assert.equal(c.thread.length, 1);
  assert.equal(c.thread[0].by, 'reviewer');
});
