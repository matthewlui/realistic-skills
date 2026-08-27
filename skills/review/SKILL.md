---
name: review
description: Use when a document, report, plan, spec or changelist should be reviewed inline rather than discussed in chat. Publishes it as a review page where the user selects text and leaves anchored comments carrying a verdict and an optional exact replacement, then reads every comment back and answers each one. Triggers on "review this", "let me review this properly", "mark this up", "review this like a PR", "collect the review", or any request to review a generated document accurately. Also use when the user follows up on a comment saying something is still not fixed.
---

# review

Two modes. Work out which one applies before doing anything else.

## What goes in the document

Decide this before touching the runtime, because getting it wrong wastes the
reviewer's attention rather than the machine's.

**The document is something you wrote for this reader, not a dump.** It is the
proposal, the design, the summary of what changed, the decision you need made. A
mechanical rendering of everything available is not a review page: the reviewer
already has `git diff`, the file tree and the log, and none of those needed you.

Lead with what the reader has not already agreed to: the calls you made on your own,
the things you cannot prove, the question you actually need answered. Leave out what
they already approved, what no judgement hangs on, and what they would skip.

**For a changelist, include only the hunks that carry a decision or a risk.** Cover
the rest in a sentence with a count. Thirty commentable blocks a reader works through
in two minutes beats four thousand rows they abandon. If you find yourself piping a
whole diff through `renderDiff`, stop and ask what question the page is for.

A good test before publishing: for every block, can you say why a reader might comment
on *this one*? If not, it is padding, and padding is what makes a review page get
closed.

## Publish

1. **Choose the runtime and say which and why.** Never default silently.
   - **local** (default) — stays on this machine, no size ceiling, no reload
   - **hosted** — only when the user needs to review away from this machine or hand
     the page to someone else. Say out loud that it sends the document to claude.ai.
2. Put the document where it belongs for its kind:
   - **Markdown** — the common case. A design doc, spec or plan already on disk opens
     directly: pass `docMarkdown` and `kind: 'markdown'`. Ids come from a content
     registry in review state, since a `.md` file has nowhere to store one, so the
     source file stays untouched and reviewable in git.
   - **Authored HTML** — when you are writing the document yourself and want layout
     control. Write it to `.review/<slug>/doc.html` and pass `docHtml`. **Never
     renumber an existing `data-b` id** — that file is the id registry, and renumbering
     silently repoints every comment below the change.
   - **A changelist** — `renderDiff` over a unified diff, or `renderInlineDiff` for
     small excerpts embedded in prose.
3. Build it:

```js
import { buildPage } from './lib/build-page.mjs';
import { emptyState } from './lib/review-state.mjs';

// a design doc already on disk
const { html, state } = buildPage({
  docMarkdown: await readFile('docs/design.md', 'utf8'),
  state: emptyState({ slug, title, kind: 'markdown' }),
  transport: 'local', shellCss, engineJs, transportJs, fonts,
});
```

   `buildPage` returns the state to persist alongside the page. **Write both** —
   dropping the returned state loses the advanced `nextBlock`.
4. Write `index.html` and `review.json` into `.review/<slug>/`.
5. **local:** run `bin/review-serve.mjs .review` and give the user the URL.
   **hosted:** publish with `capabilities: {artifact: {}}` and use `transport: 'hosted'`.
6. Tell the user to submit one comment early, before writing twenty.

## Collect

1. Read the review.
   - **local:** `.review/<slug>/review.json`
   - **hosted:** `scripts/extract-review.mjs <page.html>`
2. **Order the work: every `must-fix` before any `nit`.**
3. **Where a reviewer turn carries `suggest`, apply it verbatim.** Use `latestSuggest`
   — a follow-up may have revised it. No reinterpretation, no improving on it.
4. Revise `doc.html`, keeping every existing `data-b` id.
5. Answer **every** comment with `replyToComment(state, id, { body, status, rev })`:
   - `addressed` — done, and say what you did
   - `pushed-back` — you disagree, and say why. Never quiet non-compliance.
6. Reconcile anchors against the revised document:

```js
import { reconcileAnchors } from './lib/review-state.mjs';
import { collectBlocks } from './lib/render-prose.mjs';

state = reconcileAnchors(state, collectBlocks(revisedDocHtml));
```

   Report orphans as orphans. Never relocate one on a hunch.
7. Bump `doc.rev`, rebuild, reissue in place.

## Follow-ups

A comment is a thread of append-only turns, not a single question and answer.

When the user says something is still broken, that is a **follow-up on the existing
comment**, never a new one: it appends a reviewer turn and flips `status` back to
`open`. The comment keeps its id, its anchor and its verdict, so an argument that
runs three rounds stays on one thread. `isReopened(comment)` distinguishes a
re-opened comment from a fresh one.

A reopened comment is unfinished work. Treat it exactly like a `must-fix`: read the
whole thread before answering, because the earlier turns are why it came back.

## Verdicts

`must-fix` · `nit` · `question` · `answer` · `praise`

`answer` is for when the document asked the reviewer something — answering is not
the same act as criticising.

## Renderers

- **markdown** — `markdownToHtml` plus `assignBlockIdsByContent`. Ids come from a
  content-hash registry in review state. Editing a block changes its id, and quote
  resolution then relocates or orphans its comments, which is the promised behaviour.
  Fenced code is syntax highlighted.
- **prose** — `assignBlockIds` over authored HTML. Ids live in the source.
- **diff** — `renderDiff` over a unified diff. Row anchors key on file, side and a
  content hash, never the line number, so a shifted hunk keeps its comments.
- **inline diff** — `renderInlineDiff(before, after, {id, file})` for a change shown
  inside prose. Replaced lines are token-diffed so a one-word edit reads as one word.
  **Use this, not a final-state code block**, whenever the point is what changed.

## Never

- Renumber or reuse a block, anchor or comment id.
- Fuzzy-match an anchor into place. Exact quote, or orphaned.
- Render the superscript anchor number as DOM text. CSS `::after` only — a text node
  pollutes `textContent` and corrupts every quote on the next pass.
- Answer a new comment while a reopened one is still open.
- Silently drop a comment, or close one without saying what happened.
- Publish a mechanical dump - a whole diff, a whole file, a whole repo - and call it a
  review. Curate it, or do not publish it.
- Show final-state code where the reader needs to see the change. Use an inline diff.
- Rewrite the user's `.md` file to inject ids into it. The registry exists so the
  source stays clean.

## Known limits

- Diff rows for repeated identical lines carry an occurrence suffix. Stable while the
  count of preceding identical lines on the same side of the same file is unchanged.
- A quote spanning several inline elements is marked segment by segment. If a span
  cannot be marked visually the comment still lives in the rail.
- The 16MB ceiling and the forced reload apply to the hosted runtime only.
