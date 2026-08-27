import { assembleDocument } from './assemble.mjs';
import { assignBlockIds } from './render-prose.mjs';
import { markdownToHtml, assignBlockIdsByContent } from './render-markdown.mjs';

const TRANSPORTS = new Set(['local', 'hosted']);

// Local pages carry identity only. review.json on disk is the source of truth
// for comments, so inlining them would just be a stale copy to flash and discard.
function stubOf(state) {
  return { schema: state.schema, doc: state.doc, stub: true };
}

/**
 * Builds a review page and returns the state that must be persisted with it.
 * The advanced nextBlock is part of the return value, not a side effect, so the
 * caller cannot forget to write it back and let the counter drift.
 */
export function buildPage({ docHtml, docMarkdown, state, transport, shellCss, engineJs, transportJs, fonts = '' }) {
  if (!TRANSPORTS.has(transport)) throw new Error(`unknown transport: ${transport}`);
  if (docHtml && docMarkdown) throw new Error('pass either docHtml or docMarkdown, not both');

  const nextState = structuredClone(state);
  let html;

  if (docMarkdown != null) {
    // A .md file has nowhere to store an id, so ids come from a content registry
    // carried in review state rather than from the source.
    const assigned = assignBlockIdsByContent(
      markdownToHtml(docMarkdown), state.blockIds ?? {}, state.nextBlock ?? 1);
    html = assigned.html;
    nextState.blockIds = assigned.registry;
    nextState.nextBlock = assigned.nextBlock;
  } else {
    const assigned = assignBlockIds(docHtml, state.nextBlock ?? 1);
    html = assigned.html;
    nextState.nextBlock = assigned.nextBlock;
  }

  return {
    state: nextState,
    html: assembleDocument({
      title: nextState.doc.title,
      css: shellCss,
      docSource: html,
      engine: `${transportJs}\n${engineJs}`,
      state: transport === 'local' ? stubOf(nextState) : nextState,
      fonts,
    }),
  };
}
