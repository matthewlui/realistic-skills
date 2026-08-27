export function normalizeQuote(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function resolveAnchor(anchor, blocks) {
  const miss = { block: null, state: 'orphaned', at: null };
  const quote = normalizeQuote(anchor?.quote);
  if (!quote) return miss;

  const home = blocks.find((b) => b.id === anchor.block);
  if (home) {
    const at = normalizeQuote(home.text).indexOf(quote);
    if (at !== -1) return { block: home.id, state: 'live', at };
  }

  for (const b of blocks) {
    if (b.id === anchor.block) continue;
    const at = normalizeQuote(b.text).indexOf(quote);
    if (at !== -1) return { block: b.id, state: 'relocated', at };
  }

  return miss;
}

/**
 * Locates what the reader selected inside a block's source text.
 *
 * Selection.toString() returns text as *rendered*, so a block styled with
 * text-transform hands back a different case than the source holds. Matching
 * literally fails there, and the comment popover just never opens - which is
 * indistinguishable from the page being broken.
 *
 * The returned quote is always sliced from the source text, never the selection,
 * so what gets stored is what the document actually says. This is a capture-time
 * correction for a rendering transform, not fuzzy anchor matching: resolveAnchor
 * stays exact, because by then the quote is already true source text.
 */
export function findQuote(text, selection) {
  const source = normalizeQuote(text);
  const wanted = normalizeQuote(selection);
  if (!wanted || !source) return null;

  let at = source.indexOf(wanted);
  if (at === -1) at = source.toLowerCase().indexOf(wanted.toLowerCase());
  if (at === -1) return null;

  return { at, quote: source.slice(at, at + wanted.length) };
}
