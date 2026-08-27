import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPage } from '../lib/build-page.mjs';
import { extractBlock } from '../lib/assemble.mjs';
import { emptyState } from '../lib/review-state.mjs';

const args = (over = {}) => ({
  docHtml: '<h2>Retry</h2><p>Capped at 30s.</p>',
  state: emptyState({ slug: 'authflow', title: 'Auth flow' }),
  transport: 'local',
  shellCss: 'body{color:red}',
  engineJs: 'ENGINE',
  transportJs: 'TRANSPORT',
  ...over,
});

test('returns the page and the state to persist alongside it', () => {
  const { html, state } = buildPage(args());
  assert.match(html, /^<!doctype html>/);
  assert.equal(state.nextBlock, 3, 'caller must be able to persist the advanced counter');
});

test('assigns block ids to the document', () => {
  const src = extractBlock(buildPage(args()).html, 'rv-doc-source');
  assert.match(src, /<h2 data-b="b1">/);
  assert.match(src, /<p data-b="b2">/);
});

test('local transport emits identity only, so review.json stays the source of truth', () => {
  const { html } = buildPage(args({ transport: 'local' }));
  const inlined = JSON.parse(extractBlock(html, 'rv-state'));
  assert.equal(inlined.stub, true);
  assert.equal(inlined.doc.slug, 'authflow', 'the page must know its own slug for the drafts key');
  assert.equal(inlined.comments, undefined, 'comments must not be inlined for local');
});

test('hosted transport inlines the full state with nextBlock advanced', () => {
  const { html } = buildPage(args({ transport: 'hosted' }));
  const inlined = JSON.parse(extractBlock(html, 'rv-state'));
  assert.equal(inlined.doc.slug, 'authflow');
  assert.equal(inlined.nextBlock, 3);
});

test('does not mutate the state it was handed', () => {
  const a = args();
  buildPage(a);
  assert.equal(a.state.nextBlock, 1);
});

test('the transport module is concatenated ahead of the engine', () => {
  const engine = extractBlock(buildPage(args()).html, 'rv-engine');
  assert.ok(engine.indexOf('TRANSPORT') < engine.indexOf('ENGINE'));
});

test('an unknown transport is rejected loudly', () => {
  assert.throws(() => buildPage(args({ transport: 'ftp' })), /unknown transport/i);
});

test('rebuilding from its own output is a fixed point', () => {
  const first = buildPage(args());
  const src = extractBlock(first.html, 'rv-doc-source');
  const second = buildPage(args({ docHtml: src, state: first.state }));
  assert.equal(extractBlock(second.html, 'rv-doc-source'), src);
  assert.equal(second.state.nextBlock, first.state.nextBlock);
});

test('the built page carries the shell stylesheet', () => {
  assert.equal(extractBlock(buildPage(args()).html, 'rv-style'), 'body{color:red}');
});
