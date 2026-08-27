import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewServer, isValidSlug } from '../bin/review-serve.mjs';

let root, server, base;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'review-'));
  await mkdir(join(root, 'authflow'), { recursive: true });
  await writeFile(join(root, 'authflow', 'index.html'), '<h1>page</h1>');
  await writeFile(join(root, 'authflow', 'review.json'), JSON.stringify({ schema: 1, comments: [] }));
  server = createReviewServer({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

test('rejects slugs that could escape the root', () => {
  assert.equal(isValidSlug('authflow'), true);
  assert.equal(isValidSlug('auth-flow-2'), true);
  assert.equal(isValidSlug('../etc'), false);
  assert.equal(isValidSlug('a/b'), false);
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug('Auth'), false);
});

test('binds loopback only', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('GET / lists the reviews on disk', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /authflow/);
});

test('GET /:slug/ serves the page', async () => {
  const res = await fetch(`${base}/authflow/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(await res.text(), '<h1>page</h1>');
});

test('GET /:slug/review.json serves current state', async () => {
  const res = await fetch(`${base}/authflow/review.json`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { schema: 1, comments: [] });
});

test('POST /:slug/review writes state to disk', async () => {
  const next = { schema: 1, comments: [{ id: 'c1', body: 'hi' }] };
  const res = await fetch(`${base}/authflow/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(next),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'authflow', 'review.json'), 'utf8')), next);
});

test('POST rejects a body that is not valid JSON', async () => {
  const res = await fetch(`${base}/authflow/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
  });
  assert.equal(res.status, 400);
});

test('POST rejects an unknown slug rather than creating one', async () => {
  const res = await fetch(`${base}/nope/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(res.status, 404);
});

test('traversal attempts are refused', async () => {
  const res = await fetch(`${base}/..%2f..%2fetc/review.json`);
  assert.equal(res.status, 404);
});

test('a traversal that decodes to a real file is still refused', async () => {
  await writeFile(join(root, 'secret.txt'), 'do not serve me');
  const res = await fetch(`${base}/%2e%2e/secret.txt`);
  assert.ok(res.status === 404 || res.status === 400, `got ${res.status}`);
  assert.ok(!(await res.text()).includes('do not serve me'));
});

test('unknown routes 404', async () => {
  assert.equal((await fetch(`${base}/authflow/secrets`)).status, 404);
});

test('a body over the cap is refused rather than buffered', async () => {
  const huge = JSON.stringify({ pad: 'x'.repeat(5 * 1024 * 1024) });
  const res = await fetch(`${base}/authflow/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: huge,
  }).catch(() => ({ status: 413 }));
  assert.notEqual(res.status, 200);
  const onDisk = JSON.parse(await readFile(join(root, 'authflow', 'review.json'), 'utf8'));
  assert.ok(!('pad' in onDisk), 'oversized body must not reach disk');
});
