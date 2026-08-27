#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { extractBlock } from '../lib/assemble.mjs';

/**
 * Pulls review state out of a hosted page. A local page carries an identity-only
 * stub, which is not review state - review.json on disk is. Returning the stub
 * would look like a review with zero comments, so it is refused instead.
 */
export function extractReview(html) {
  const raw = extractBlock(html, 'rv-state');
  if (raw === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.stub === true || !Array.isArray(parsed.comments)) return null;
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: extract-review.mjs <page.html>');
    process.exit(2);
  }
  const state = extractReview(await readFile(path, 'utf8'));
  if (!state) {
    console.error(`no review state in ${path} (a local page keeps its state in review.json)`);
    process.exit(1);
  }
  console.log(JSON.stringify(state, null, 2));
}
