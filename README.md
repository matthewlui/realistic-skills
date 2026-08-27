<div align="center">

# realistic-skills

**Agent skills built by using them — not by imagining them.**

[![License: MIT](https://img.shields.io/badge/License-MIT-B02E26?style=flat-square)](LICENSE)
[![Skills](https://img.shields.io/badge/skills-1-B02E26?style=flat-square)](#-skills)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-B02E26?style=flat-square)](https://claude.com/claude-code)

Every skill here was dogfooded on real work before it shipped, and every limit it
still has is written down in this README instead of discovered by you later.

</div>

---

## ✦ Skills

| Skill | What it gives you | Status |
|:--|:--|:--|
| [**`review`**](#-review) | Review anything Claude writes inline, like a local PR review | ✅ working |

---

## 🖍️ review

> Claude writes a document. You mark it up by selecting text — verdict, comment,
> exact replacement. Claude reads every comment back, replies to each one, and
> revises. No copying, no pasting, no "the third bullet in section two".

```
  2.3  Retry policy                          ┌─ REVIEW ─────────────────┐
                                             │                          │
  The client retries failed uploads          │  7  MUST-FIX      open   │
  with exponential backoff, capped           │  ┃ "capped at 30s"       │
  at 30s.⁷                                   │  retries forever on 401  │
          ‾‾‾‾‾‾‾‾‾‾‾‾‾‾                     │  ┌─ suggest ───────────┐ │
                                             │  │ capped at 30s and   │ │
  Uploads resume from the last               │  │ abandoned after 3   │ │
  acknowledged chunk.                        │  │ attempts            │ │
                                             │  └─────────────────────┘ │
                                             │                          │
                                             │  3  NIT       addressed  │
                                             │  ┃ "resume from the"     │
                                             │  ↳ reply: reworded       │
                                             └──────────────────────────┘
```

### Open a doc you already have

```
> /review docs/design.md
```

That's the whole flow. The Markdown renders, every heading, paragraph, list item,
table row and code fence becomes commentable, and **your `.md` is never touched** —
block ids live in a registry beside it, so the file still diffs cleanly in git.

Insert a section at the top later and every existing comment stays where it was.

### Why it exists

Reviewing a long document in chat is imprecise and lossy. You describe a location,
Claude guesses which one you meant, and your intent arrives as prose to be
interpreted rather than applied. `review` makes the location exact and the fix
literal.

### What makes it accurate

- **Quote anchors, never line numbers.** A comment binds to the text it quoted plus
  its surrounding context. Renumber the sections, move the paragraph, reorder the
  list — the comment follows.
- **Orphans are reported, never relocated.** If a revision deletes the text you
  commented on, the comment is flagged as orphaned and shown with its original
  quote. A comment that silently jumps to the wrong paragraph is worse than one
  that goes missing, because nothing tells you it happened.
- **Suggested replacements apply verbatim.** Type the exact text you want and it is
  used exactly, with no reinterpretation.
- **Every comment gets an answer.** A reply and a status on each one — `addressed`,
  or `pushed-back` with a reason. Disagreement is recorded, never quiet
  non-compliance.

### Follow-ups, when it isn't actually fixed

Claude replies to a comment and marks it addressed. If you disagree, **Not fixed —
follow up** appends to that same comment and reopens it. It keeps its id, its anchor
and its verdict, so an argument that runs three rounds stays on one thread instead of
fragmenting into unrelated comments.

```
7  MUST-FIX                      Reopened
┃ "capped at 30s"
  retries forever on a 401
  CLAUDE  capped it at 3 attempts
  FOLLOW-UP  still spins when the token is stale
```

The whole exchange stays on the record — including the parts where Claude pushed back
and turned out to be wrong.

### Change summaries show the change

Ask for a summary of some work and you get a curated document, not a dump — with the
diffs inline, and **only the changed words marked**, so a one-word edit reads as one
word instead of two near-identical lines to compare by eye:

```
templates/shell.html
 ─ 33 │ grid-template-rows:auto minmax(0,1fr)
 + 33 │ grid-template-rows:auto ▏auto▕ minmax(0,1fr)
                                 ‾‾‾‾ only the insertion is marked

lib/assemble.mjs
 ─ 10 │ .replace(/<\/(script|style)/gi, '<\/$1');
 + 10 │ .replace(
 + 11 │   /<(\\*)\/(script|style)/gi,
 + 12 │   (whole, slashes, tag) => `<${slashes}\/${tag}`
 + 13 │ );
```

Code fences and diffs are syntax highlighted. Zero dependencies — js/ts, json and css
are tokenised, anything else falls back to plain text rather than guessing badly.

### What a review page is *not*

A review page is written **for you**, not generated at you. It leads with the calls
that were made without asking and the claims that aren't proved; it leaves out what
you already agreed to. For a changelist that means only the hunks carrying a decision
or a risk, with the rest covered in a sentence and a count.

Rendering a whole diff is not a review — you already have `git diff`, and it didn't
need a skill. Thirty blocks you work through in two minutes beat four thousand rows
you abandon. That rule is in `SKILL.md`, so it survives past the session that learned
it.

### Verdicts

| | Verdict | Means |
|:--|:--|:--|
| 🔴 | `must-fix` | Broken. Changes before this ships. |
| 🔵 | `nit` | Preference. Take it or leave it. |
| 🟡 | `question` | Explain this before I can judge it. |
| 🟣 | `answer` | Answering something the document asked you. |
| 🟢 | `praise` | This works — don't refactor it away. |

### The loop

```
   ┌──────────────────────────────────────────────────────────┐
   │                                                          │
   ▼                                                          │
 claude publishes ──▶ you select + comment ──▶ submit         │
                                                  │           │
                                                  ▼           │
                                            review.json       │
                                                  │           │
                                                  ▼           │
                                 claude reads every comment,  │
                                 replies, sets status ────────┘
```

### Local first

`review` runs on `127.0.0.1` by default and the document never leaves your machine.
A tiny zero-dependency server holds `review.json` on disk, so submitting is a POST,
refresh and reopen just work, there is no size ceiling, and nothing is uploaded.

A hosted mode exists for when you want to review from a phone or hand the page to
someone else — and when it is chosen, the skill says so up front rather than
afterwards.

### Install

```bash
git clone https://github.com/matthewlui/realistic-skills.git
ln -s "$PWD/realistic-skills/skills/review" ~/.claude/skills/review
```

### Use

```
> review this design doc before I read it properly
> /review docs/api-plan.md
```

Then, once you have marked it up and hit submit:

```
> collect the review
```

If something comes back still broken, follow up on that comment rather than filing a
new one — Claude reads the whole thread before answering again.

### Status

Built by reviewing itself. The design spec was reviewed through the tool, then the
tool was reviewed through the tool, then the summary of that work was reviewed through
the tool — which is where most of what follows came from.

- ✅ Markdown, authored HTML and unified diff as input
- ✅ Selection anchoring, five verdicts, suggested replacements, drafts, submit
- ✅ Local server and local transport — no reload, nothing leaves the machine
- ✅ Hosted runtime and review extraction
- ✅ Diff renderer with content-hash line anchors; inline diffs with token marking
- ✅ Comment threads, follow-up and reopen
- ✅ Syntax highlighting, zero dependencies
- ✅ `SKILL.md` and 171 tests
- ⬜ Not yet exercised as an installed skill in a fresh session

Five bugs the test suite could not have found on its own. Two were reported by a human
looking at the page; three surfaced while building the tests around it. All five now
have tests that fail without the fix.

| Found by | Bug |
|:--|:--|
| Reviewing the page | The notice banner filled the viewport — `#rv-app` declared two grid rows for three children, which also broke the document pane's scroll containment |
| Reviewing the page | Uppercase-styled headings could not be selected at all. `Selection.toString()` returns *rendered* text, so `BACKOFF` never matched source `Backoff` |
| Writing a round-trip test | Terminator escaping wasn't injective, so any reviewed source using the `'<\/script>'` idiom came back corrupted |
| Writing a stale-counter test | A reset id counter could mint duplicate block ids, making every anchor on them ambiguous |
| Writing a republish test | Re-escaping page text deepened the escape each round, so the engine's own source would change meaning after enough republishes |

The escaping one is the instructive one: a test asserting escaping *"leaves
already-escaped text alone"* had been written first, which encoded the bug **as a
requirement**. It passed. Only a round-trip test made the two assertions contradict
each other. A green suite is evidence about the tests, not the code.

---

## Principles

1. **Dogfood before shipping.** If a skill has never been used on real work, it is
   not ready and does not get listed.
2. **No manual workaround steps.** If the design needs you to copy a file into place
   to make it work, the design is not finished.
3. **State the limits out loud.** Every skill's README says what it cannot do. You
   should never find that out by hitting it.
4. **Fix causes, not symptoms.** Anchors that survive a rewrite, not anchors that
   usually happen to line up.

## Contributing

Issues and PRs welcome. A new skill needs: a `SKILL.md`, tests for whatever is pure,
a README section written for someone who has never seen it, and evidence it was used
on something real.

## License

[MIT](LICENSE) © Matth3w Lui
