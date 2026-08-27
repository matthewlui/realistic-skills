import { escapeHtml } from './assemble.mjs';

/** djb2. Deterministic, dependency-free, and stable across processes. */
export function hashLine(s) {
  let h = 5381;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const SIDE = { del: 'old', add: 'new', context: 'ctx' };

/**
 * Row anchors key on file, side and content hash rather than line number, so a
 * hunk that shifts position keeps its ids and every comment on it survives.
 *
 * Identical content repeats constantly in real diffs - blank lines, a lone brace -
 * and a bare hash would make those rows share one anchor. Repeats therefore carry
 * an occurrence suffix. That is stable while the number of preceding identical
 * lines on the same side of the same file is unchanged, which is a weaker promise
 * than the unique-line case but far stronger than a line number.
 */
export function parseUnifiedDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  let seen = null;

  const idFor = (fileIdx, kind, body) => {
    const base = `L${fileIdx}-${SIDE[kind]}-${hashLine(body)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  for (const line of String(text).split('\n')) {
    if (line.startsWith('diff --git ')) { file = null; hunk = null; continue; }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('+++ ')) {
      file = { path: line.slice(4).replace(/^b\//, ''), hunks: [] };
      files.push(file);
      hunk = null;
      seen = new Map();
      continue;
    }
    const at = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (at && file) {
      oldNo = Number(at[1]);
      newNo = Number(at[2]);
      hunk = { oldStart: oldNo, newStart: newNo, rows: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const idx = files.length - 1;
    const body = line.slice(1);
    if (line.startsWith('-')) {
      hunk.rows.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: body, id: idFor(idx, 'del', body) });
    } else if (line.startsWith('+')) {
      hunk.rows.push({ kind: 'add', oldNo: null, newNo: newNo++, text: body, id: idFor(idx, 'add', body) });
    } else if (line.startsWith(' ')) {
      hunk.rows.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: body, id: idFor(idx, 'context', body) });
    }
  }
  return files;
}

const MARK = { context: ' ', add: '+', del: '-' };

export function renderDiff(text) {
  const out = [];
  for (const file of parseUnifiedDiff(text)) {
    out.push(`<section class="rv-file"><h2>${escapeHtml(file.path)}</h2>`);
    for (const hunk of file.hunks) {
      out.push('<div class="rv-hunk"><table><tbody>');
      for (const r of hunk.rows) {
        out.push(
          `<tr data-b="${r.id}" class="rv-row rv-${r.kind}">` +
            `<td class="rv-no">${r.oldNo ?? ''}</td>` +
            `<td class="rv-no">${r.newNo ?? ''}</td>` +
            `<td class="rv-sign">${MARK[r.kind]}</td>` +
            `<td class="rv-code">${escapeHtml(r.text)}</td>` +
          '</tr>'
        );
      }
      out.push('</tbody></table></div>');
    }
    out.push('</section>');
  }
  return out.join('\n');
}

/** Longest common subsequence over two arrays, returned as index pairs. */
function lcsPairs(a, b, eq = (x, y) => x === y) {
  const n = a.length, m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = eq(a[i], b[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Line diff between two snippets, for showing a change inside a prose document.
 * A curated change summary has to show what moved, not the end state - final-state
 * code leaves the reader unable to tell an addition from a rewrite.
 */
export function lineDiff(before, after) {
  const a = String(before).split('\n');
  const b = String(after).split('\n');
  if (before === '') return b.map((text, k) => ({ kind: 'add', text, oldNo: null, newNo: k + 1 }));
  if (after === '') return a.map((text, k) => ({ kind: 'del', text, oldNo: k + 1, newNo: null }));

  const keep = lcsPairs(a, b);
  const rows = [];
  let i = 0, j = 0;
  const flush = (untilA, untilB) => {
    while (i < untilA) rows.push({ kind: 'del', text: a[i], oldNo: ++i, newNo: null });
    while (j < untilB) rows.push({ kind: 'add', text: b[j], oldNo: null, newNo: ++j });
  };
  for (const [ai, bj] of keep) {
    flush(ai, bj);
    rows.push({ kind: 'context', text: a[ai], oldNo: ++i, newNo: ++j });
  }
  flush(a.length, b.length);
  return rows;
}

const TOKEN = /(\s+|\w+|[^\s\w])/g;

/**
 * Token-level diff between two lines, so a one-word edit reads as a one-word edit
 * rather than two nearly identical lines the reader has to compare by eye.
 */
export function tokenDiff(oldLine, newLine) {
  const a = String(oldLine).match(TOKEN) ?? [];
  const b = String(newLine).match(TOKEN) ?? [];
  const keep = lcsPairs(a, b);
  const keptA = new Set(keep.map(([x]) => x));
  const keptB = new Set(keep.map(([, y]) => y));
  return {
    before: a.map((text, k) => ({ text, changed: !keptA.has(k) })),
    after: b.map((text, k) => ({ text, changed: !keptB.has(k) })),
  };
}

function tokensToHtml(tokens, tag) {
  let html = '';
  for (const t of tokens) {
    html += t.changed && t.text.trim()
      ? `<${tag}>${escapeHtml(t.text)}</${tag}>`
      : escapeHtml(t.text);
  }
  return html;
}

/**
 * Renders a small change as an inline unified diff for embedding in prose.
 * Row anchors key on content hash under `id`, so they neither shift when the
 * surrounding excerpt grows nor collide with the document's own block ids.
 */
export function renderInlineDiff(before, after, { id, file, highlight } = {}) {
  const prefix = id ?? 'x';
  const rows = lineDiff(before, after);
  const seen = new Map();
  const anchor = (kind, text) => {
    const base = `${prefix}-${SIDE[kind]}-${hashLine(text)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  // Pair each replaced line with its replacement so words can be compared.
  const words = new Map();
  for (let k = 0; k < rows.length - 1; k++) {
    if (rows[k].kind === 'del' && rows[k + 1].kind === 'add') {
      const { before: bt, after: at } = tokenDiff(rows[k].text, rows[k + 1].text);
      words.set(k, tokensToHtml(bt, 'del'));
      words.set(k + 1, tokensToHtml(at, 'ins'));
    }
  }

  const out = [`<div class="rv-inline"${file ? ` data-file="${escapeHtml(file)}"` : ''}>`];
  if (file) out.push(`<div class="rv-inline-file">${escapeHtml(file)}</div>`);
  out.push('<table><tbody>');
  rows.forEach((r, k) => {
    const code = words.get(k) ?? (highlight ? highlight(r.text) : escapeHtml(r.text));
    out.push(
      `<tr data-b="${anchor(r.kind, r.text)}" class="rv-row rv-${r.kind}">` +
        `<td class="rv-no">${r.oldNo ?? ''}</td>` +
        `<td class="rv-no">${r.newNo ?? ''}</td>` +
        `<td class="rv-sign">${MARK[r.kind]}</td>` +
        `<td class="rv-code">${code}</td>` +
      '</tr>'
    );
  });
  out.push('</tbody></table></div>');
  return out.join('\n');
}
