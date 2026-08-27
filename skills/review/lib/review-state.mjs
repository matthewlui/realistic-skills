import { resolveAnchor } from './anchors.mjs';

export function emptyState({ slug, title, kind = 'prose' }) {
  return {
    schema: 1,
    doc: { slug, title, rev: 1, kind },
    anchors: {},
    comments: [],
    nextAnchor: 1,
    nextComment: 1,
    nextBlock: 1,
    blockIds: {},
  };
}

export function dedupeDrafts(drafts, state) {
  const published = new Set();
  for (const c of state.comments) {
    if (c.fromDraft) published.add(c.fromDraft);
    for (const t of c.followUps ?? []) published.add(t);
  }
  return drafts.filter((d) => !published.has(d.tmpId));
}

/**
 * Applies a batch of drafts. A draft is either a new comment or a follow-up on an
 * existing one; a follow-up appends to that comment's thread and reopens it, so a
 * disagreement about whether something is fixed stays on one thread across rounds
 * instead of fragmenting into unrelated comments.
 */
export function applyDrafts(state, drafts) {
  const next = structuredClone(state);
  for (const d of dedupeDrafts(drafts, next)) {
    if (d.kind === 'followup') {
      const target = next.comments.find((c) => c.id === d.targetId);
      if (!target) continue; // aimed at a comment that no longer exists
      target.thread.push({ by: 'reviewer', body: d.body, suggest: d.suggest ?? '', rev: next.doc.rev });
      target.status = 'open';
      target.followUps = (target.followUps ?? []).concat(d.tmpId);
      continue;
    }
    const aid = `a${next.nextAnchor++}`;
    const cid = `c${next.nextComment++}`;
    next.anchors[aid] = {
      block: d.anchor.block,
      quote: d.anchor.quote,
      before: d.anchor.before ?? '',
      after: d.anchor.after ?? '',
    };
    next.comments.push({
      id: cid,
      anchor: aid,
      verdict: d.verdict,
      createdRev: next.doc.rev,
      status: 'open',
      anchorState: 'live',
      thread: [{ by: 'reviewer', body: d.body, suggest: d.suggest ?? '', rev: next.doc.rev }],
      fromDraft: d.tmpId,
    });
  }
  return next;
}

/** Appends an agent turn and sets the status. Threads are append-only. */
export function replyToComment(state, id, { body, status, rev }) {
  const next = structuredClone(state);
  const target = next.comments.find((c) => c.id === id);
  if (!target) return next;
  target.thread.push({ by: 'agent', body, rev });
  target.status = status;
  return next;
}

export function openingOf(comment) {
  return (comment.thread ?? []).find((t) => t.by === 'reviewer') ?? null;
}

/** The newest reviewer suggestion wins, so a follow-up can revise the fix. */
export function latestSuggest(comment) {
  const turns = (comment.thread ?? []).filter((t) => t.by === 'reviewer' && t.suggest);
  return turns.length ? turns[turns.length - 1].suggest : '';
}

/** Derived, not stored: open again after the agent has already answered once. */
export function isReopened(comment) {
  const thread = comment.thread ?? [];
  return comment.status === 'open' && thread.some((t) => t.by === 'agent');
}

/** Lifts a legacy single body/reply pair into a thread. Idempotent. */
export function migrateComment(comment) {
  if (Array.isArray(comment.thread)) return comment;
  const { body, reply, repliedRev, suggest, ...rest } = comment;
  const thread = [{ by: 'reviewer', body: body ?? '', suggest: suggest ?? '', rev: comment.createdRev ?? 1 }];
  if (reply) thread.push({ by: 'agent', body: reply, rev: repliedRev ?? comment.createdRev ?? 1 });
  return { ...rest, thread };
}

export function migrateState(state) {
  return { ...state, comments: (state.comments ?? []).map(migrateComment) };
}

export function reconcileAnchors(state, blocks) {
  const next = structuredClone(state);
  for (const c of next.comments) {
    const a = next.anchors[c.anchor];
    if (!a) {
      c.anchorState = 'orphaned';
      continue;
    }
    const r = resolveAnchor(a, blocks);
    c.anchorState = r.state;
    if (r.state === 'relocated') a.block = r.block;
  }
  return next;
}
