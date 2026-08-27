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
| [**`redline`**](#-redline) | Review anything Claude writes inline, like a local PR review | 🚧 in development |

---

## 🖍️ redline

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

### Why it exists

Reviewing a long document in chat is imprecise and lossy. You describe a location,
Claude guesses which one you meant, and your intent arrives as prose to be
interpreted rather than applied. `redline` makes the location exact and the fix
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

`redline` runs on `127.0.0.1` by default and the document never leaves your machine.
A tiny zero-dependency server holds `review.json` on disk, so submitting is a POST,
refresh and reopen just work, there is no size ceiling, and nothing is uploaded.

A hosted mode exists for when you want to review from a phone or hand the page to
someone else — and when it is chosen, the skill says so up front rather than
afterwards.

### Install

```bash
git clone https://github.com/matthewlui/realistic-skills.git
ln -s "$PWD/realistic-skills/skills/redline" ~/.claude/skills/redline
```

### Use

```
> redline this design doc before I read it properly
> /redline docs/api-plan.md
```

Then, once you have marked it up and hit submit:

```
> collect the redline
```

### 🚧 Honest status

Design is settled and a working prototype exists — it was used to review its own
design spec, across two rounds, and the round trip held. Not installable yet:

- ✅ Selection anchoring, verdicts, suggested replacements, drafts, submit
- ✅ Hosted runtime, proven end to end
- ⬜ Local server and local transport
- ⬜ Diff / changelist renderer
- ⬜ `SKILL.md`, tests, packaging

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
