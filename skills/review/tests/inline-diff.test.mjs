import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff, tokenDiff, renderInlineDiff } from '../lib/render-diff.mjs';

test('lineDiff marks unchanged lines as context', () => {
  const rows = lineDiff('a\nb', 'a\nb');
  assert.deepEqual(rows.map((r) => r.kind), ['context', 'context']);
});

test('lineDiff finds a pure insertion', () => {
  const rows = lineDiff('a\nc', 'a\nb\nc');
  assert.deepEqual(rows.map((r) => [r.kind, r.text]),
    [['context', 'a'], ['add', 'b'], ['context', 'c']]);
});

test('lineDiff finds a pure deletion', () => {
  const rows = lineDiff('a\nb\nc', 'a\nc');
  assert.deepEqual(rows.map((r) => [r.kind, r.text]),
    [['context', 'a'], ['del', 'b'], ['context', 'c']]);
});

test('lineDiff pairs a replacement as delete then add', () => {
  const rows = lineDiff('a\nold\nc', 'a\nnew\nc');
  assert.deepEqual(rows.map((r) => r.kind), ['context', 'del', 'add', 'context']);
});

test('lineDiff numbers each side independently', () => {
  const rows = lineDiff('a\nb\nc', 'a\nc');
  assert.deepEqual(rows.map((r) => [r.oldNo, r.newNo]), [[1, 1], [2, null], [3, 2]]);
});

test('lineDiff handles an empty before', () => {
  assert.deepEqual(lineDiff('', 'x').map((r) => r.kind), ['add']);
});

test('tokenDiff marks only the inserted word', () => {
  const { before, after } = tokenDiff(
    'grid-template-rows:auto minmax(0,1fr)',
    'grid-template-rows:auto auto minmax(0,1fr)');
  assert.equal(before.filter((t) => t.changed).length, 0, 'nothing was removed');
  assert.deepEqual(after.filter((t) => t.changed).map((t) => t.text), ['auto', ' ']);
});

test('tokenDiff marks a substitution on both sides', () => {
  const { before, after } = tokenDiff('capped at 30s', 'capped at 60s');
  assert.deepEqual(before.filter((t) => t.changed).map((t) => t.text), ['30s']);
  assert.deepEqual(after.filter((t) => t.changed).map((t) => t.text), ['60s']);
});

test('tokenDiff reassembles to the original text', () => {
  const { before, after } = tokenDiff('const a = 1;', 'const b = 22;');
  assert.equal(before.map((t) => t.text).join(''), 'const a = 1;');
  assert.equal(after.map((t) => t.text).join(''), 'const b = 22;');
});

test('tokenDiff marks nothing when the lines match', () => {
  const { before, after } = tokenDiff('same line', 'same line');
  assert.equal(before.some((t) => t.changed), false);
  assert.equal(after.some((t) => t.changed), false);
});

test('renderInlineDiff anchors rows by content hash under the given id', () => {
  const html = renderInlineDiff('old line', 'new line', { id: 'grid' });
  assert.match(html, /data-b="grid-old-[0-9a-f]{8}"/);
  assert.match(html, /data-b="grid-new-[0-9a-f]{8}"/);
});

test('renderInlineDiff ids do not shift when surrounding context grows', () => {
  const a = renderInlineDiff('x\nold', 'x\nnew', { id: 'g' });
  const b = renderInlineDiff('lead\nx\nold', 'lead\nx\nnew', { id: 'g' });
  const idOf = (h, side) => h.match(new RegExp(`data-b="g-${side}-[0-9a-f]{8}"`))[0];
  assert.equal(idOf(a, 'old'), idOf(b, 'old'));
  assert.equal(idOf(a, 'new'), idOf(b, 'new'));
});

test('renderInlineDiff marks changed words inside changed lines', () => {
  const html = renderInlineDiff('capped at 30s', 'capped at 60s', { id: 'c' });
  assert.match(html, /<del>30s<\/del>/);
  assert.match(html, /<ins>60s<\/ins>/);
});

test('renderInlineDiff escapes code so it cannot inject markup', () => {
  const html = renderInlineDiff('<script>a()</script>', '<script>b()</script>', { id: 'x' });
  assert.ok(!html.includes('<script>a()'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderInlineDiff labels the file when given one', () => {
  assert.match(renderInlineDiff('a', 'b', { id: 'x', file: 'templates/shell.html' }),
    /templates\/shell\.html/);
});

test('renderInlineDiff output survives assembly into a page', async () => {
  const { assembleDocument, extractBlock } = await import('../lib/assemble.mjs');
  const html = renderInlineDiff("var x = '</script>';", "var y = '</script>';", { id: 'q' });
  const page = assembleDocument({ title: 'T', css: 'a{}', docSource: html, engine: 'E', state: {} });
  assert.equal(extractBlock(page, 'rv-doc-source'), html);
});
