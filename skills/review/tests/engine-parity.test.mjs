import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emptyState, applyDrafts } from '../lib/review-state.mjs';
import { escapeScriptText as libEscape } from '../lib/assemble.mjs';
import { findQuote as libFindQuote } from '../lib/anchors.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(here, '..', 'engine', 'review.js');

// engine/review.js cannot import ES modules from a text/template page, so it
// carries its own copy of applyDrafts. This lifts that copy out and holds it to
// the same behaviour as the tested one, so the duplication cannot silently drift.
function sliceFn(src, name, where) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in ${where}`);
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, `could not brace-match ${name}`);
  return src.slice(start, end);
}

/** Lifts one function plus any helpers it calls. Last name is the one returned. */
async function liftFromEngine(...names) {
  const src = await readFile(ENGINE, 'utf8');
  const bodies = names.map((n) => sliceFn(src, n, 'engine/review.js'));
  return new Function(`${bodies.join('\n')}; return ${names[names.length - 1]};`)();
}

const draft = (tmpId, block, quote, over = {}) => ({
  tmpId, anchor: { block, quote, before: '', after: '' },
  verdict: 'must-fix', body: 'no', suggest: '', ...over,
});

test('the engine copy of applyDrafts matches the tested one', async () => {
  const inPage = await liftFromEngine('applyDraftsInPage');
  const base = emptyState({ slug: 'd', title: 'D' });
  const drafts = [draft('d1', 'b1', 'alpha'), draft('d2', 'b2', 'beta', { verdict: 'nit' })];
  assert.deepEqual(inPage(base, drafts), applyDrafts(base, drafts));
});

test('both copies dedupe an already-published draft identically', async () => {
  const inPage = await liftFromEngine('applyDraftsInPage');
  const once = applyDrafts(emptyState({ slug: 'd', title: 'D' }), [draft('d1', 'b1', 'alpha')]);
  const again = [draft('d1', 'b1', 'alpha'), draft('d2', 'b1', 'beta')];
  assert.deepEqual(inPage(once, again), applyDrafts(once, again));
});

test('both copies carry the document rev onto new comments identically', async () => {
  const inPage = await liftFromEngine('applyDraftsInPage');
  const base = emptyState({ slug: 'd', title: 'D' });
  base.doc.rev = 7;
  assert.deepEqual(inPage(base, [draft('d1', 'b1', 'alpha')]),
    applyDrafts(base, [draft('d1', 'b1', 'alpha')]));
});

test('neither copy mutates the state it was handed', async () => {
  const inPage = await liftFromEngine('applyDraftsInPage');
  const base = emptyState({ slug: 'd', title: 'D' });
  inPage(base, [draft('d1', 'b1', 'alpha')]);
  assert.equal(base.comments.length, 0);
  assert.equal(base.nextComment, 1);
});

const HOSTED = join(here, '..', 'engine', 'transport-hosted.js');

async function liftFrom(file, ...names) {
  const src = await readFile(file, 'utf8');
  const bodies = names.map((n) => sliceFn(src, n, file));
  return new Function(`${bodies.join('\n')}; return ${names[names.length - 1]};`)();
}

test('the hosted transport escape helpers match lib/assemble', async () => {
  const esc = await liftFrom(HOSTED, 'escapeScriptText');
  const unesc = await liftFrom(HOSTED, 'unescapeScriptText');
  const cases = ['</script', '<\\/script', '<\\\\/script', '</style', '<\\/style',
    'plain text', "var x = '</script>';", 'a</SCRIPT>b'];
  for (const s of cases) {
    assert.equal(esc(s), libEscape(s), `escape mismatch for ${JSON.stringify(s)}`);
    assert.equal(unesc(esc(s)), s, `not injective for ${JSON.stringify(s)}`);
  }
});

test('unescape then escape is a fixed point, so republishing cannot creep', async () => {
  const esc = await liftFrom(HOSTED, 'escapeScriptText');
  const unesc = await liftFrom(HOSTED, 'unescapeScriptText');
  // What sits in the page after one assembly, for source using the terminator idiom.
  let inPage = libEscape("var x = '</script>';");
  for (let round = 0; round < 5; round++) {
    const next = esc(unesc(inPage));
    assert.equal(next, inPage, `escape crept on republish round ${round + 1}`);
    inPage = next;
  }
});

test('naive re-escaping would creep, which is why the fixed point matters', async () => {
  const esc = await liftFrom(HOSTED, 'escapeScriptText');
  const inPage = libEscape("var x = '</script>';");
  assert.notEqual(esc(inPage), inPage, 'if this ever passes, the guard above is vacuous');
});

test('the engine copy of findQuote matches the tested one', async () => {
  const inPage = await liftFromEngine('normQuote', 'findQuote');
  const cases = [
    ['Backoff is capped at 30s.', 'capped at 30s'],
    ['Backoff', 'BACKOFF'],
    ['Retry Policy', 'retry policy'],
    ['The Client retries failed uploads', 'CLIENT RETRIES'],
    ['ab AB', 'AB'],
    ['Backoff is\n  capped at\t30s', '  capped   at 30s  '],
    ['Backoff is capped at 30s.', 'nowhere in here'],
    ['Backoff', '   '],
    ['capped at 60s', 'capped at 30s'],
  ];
  for (const [text, sel] of cases) {
    assert.deepEqual(inPage(text, sel), libFindQuote(text, sel),
      `mismatch for ${JSON.stringify([text, sel])}`);
  }
});
