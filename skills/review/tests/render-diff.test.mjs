import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashLine, parseUnifiedDiff, renderDiff } from '../lib/render-diff.mjs';

const DIFF = [
  'diff --git a/src/upload.ts b/src/upload.ts',
  '--- a/src/upload.ts',
  '+++ b/src/upload.ts',
  '@@ -40,4 +40,5 @@',
  '   const backoff = base * 2 ** n',
  '-  while (true) {',
  '+  for (let n = 0; n < max; n++) {',
  '     await sleep(backoff)',
  '   }',
].join('\n');

test('hashLine is deterministic and eight hex characters', () => {
  assert.equal(hashLine('abc'), hashLine('abc'));
  assert.match(hashLine('abc'), /^[0-9a-f]{8}$/);
  assert.notEqual(hashLine('abc'), hashLine('abd'));
});

test('parses the file path', () => {
  assert.equal(parseUnifiedDiff(DIFF)[0].path, 'src/upload.ts');
});

test('classifies rows and numbers each side independently', () => {
  const rows = parseUnifiedDiff(DIFF)[0].hunks[0].rows;
  assert.deepEqual(rows.map((r) => r.kind), ['context', 'del', 'add', 'context', 'context']);
  assert.deepEqual(rows.map((r) => r.oldNo), [40, 41, null, 42, 43]);
  assert.deepEqual(rows.map((r) => r.newNo), [40, null, 41, 42, 43]);
});

test('row ids encode file, side and content hash, never the line number', () => {
  const rows = parseUnifiedDiff(DIFF)[0].hunks[0].rows;
  const del = rows.find((r) => r.kind === 'del');
  assert.equal(del.id, `L0-old-${hashLine('  while (true) {')}`);
  assert.ok(!del.id.includes('41'));
});

test('identical content on opposite sides gets distinct ids', () => {
  const d = ['--- a/f', '+++ b/f', '@@ -1,1 +1,1 @@', '-same', '+same'].join('\n');
  const rows = parseUnifiedDiff(d)[0].hunks[0].rows;
  assert.notEqual(rows[0].id, rows[1].id);
});

test('ids are stable when a hunk shifts to different line numbers', () => {
  const shifted = DIFF.replace('@@ -40,4 +40,5 @@', '@@ -90,4 +90,5 @@');
  const a = parseUnifiedDiff(DIFF)[0].hunks[0].rows.map((r) => r.id);
  const b = parseUnifiedDiff(shifted)[0].hunks[0].rows.map((r) => r.id);
  assert.deepEqual(a, b);
});

test('handles multiple files with distinct file indices', () => {
  const two = `${DIFF}\ndiff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,1 +1,1 @@\n-x\n+y`;
  const files = parseUnifiedDiff(two);
  assert.equal(files.length, 2);
  assert.match(files[1].hunks[0].rows[0].id, /^L1-old-/);
});

test('the same line content in two different files gets different ids', () => {
  const two = ['--- a/one.ts', '+++ b/one.ts', '@@ -1,1 +1,1 @@', '-dup',
    'diff --git a/two.ts b/two.ts', '--- a/two.ts', '+++ b/two.ts', '@@ -1,1 +1,1 @@', '-dup'].join('\n');
  const files = parseUnifiedDiff(two);
  assert.notEqual(files[0].hunks[0].rows[0].id, files[1].hunks[0].rows[0].id);
});

test('renderDiff marks every row with a data-b anchor', () => {
  const html = renderDiff(DIFF);
  for (const r of parseUnifiedDiff(DIFF)[0].hunks[0].rows) {
    assert.ok(html.includes(`data-b="${r.id}"`), `missing ${r.id}`);
  }
});

test('renderDiff escapes source code so it cannot inject markup', () => {
  const d = ['--- a/f', '+++ b/f', '@@ -1,1 +1,1 @@', '-<script>evil()</script>'].join('\n');
  const html = renderDiff(d);
  assert.ok(!html.includes('<script>evil()'));
  assert.ok(html.includes('&lt;script&gt;evil()'));
});

test('renderDiff output survives assembly into a page', async () => {
  const { assembleDocument, extractBlock } = await import('../lib/assemble.mjs');
  const d = ['--- a/f', '+++ b/f', '@@ -1,1 +1,1 @@', "-var x = '</script>';"].join('\n');
  const html = renderDiff(d);
  const page = assembleDocument({ title: 'T', css: 'a{}', docSource: html, engine: 'E', state: {} });
  assert.equal(extractBlock(page, 'rv-doc-source'), html);
});

test('duplicate row ids within a file are disambiguated', () => {
  const d = ['--- a/f', '+++ b/f', '@@ -1,3 +1,3 @@', ' dup', ' dup', ' dup'].join('\n');
  const ids = parseUnifiedDiff(d)[0].hunks[0].rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `repeated identical lines collided: ${ids.join(',')}`);
});
