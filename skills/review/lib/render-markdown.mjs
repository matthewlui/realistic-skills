import { escapeHtml } from './assemble.mjs';
import { highlight } from './highlight.mjs';
import { hashLine } from './render-diff.mjs';

/**
 * A small block-level Markdown renderer. Zero dependencies is a hard constraint,
 * so this covers what design docs actually use - headings, paragraphs, lists,
 * fenced code, blockquotes, tables, rules - and escapes anything it does not
 * understand rather than passing raw HTML through.
 */

const SAFE_HREF = /^(https?:|mailto:|#|\/|\.)/i;

function inline(text) {
  const code = [];
  // Pull inline code out first so its contents are never parsed for emphasis.
  // The sentinel is deliberately unlikely in prose; a bare number would collide.
  let s = String(text).replace(/`([^`]+)`/g, (whole, body) => {
    code.push(body);
    return `@@RVCODE${code.length - 1}@@`;
  });

  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) =>
    SAFE_HREF.test(href) ? `<a href="${escapeHtml(href)}">${label}</a>` : label);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/@@RVCODE(\d+)@@/g, (whole, n) => `<code>${escapeHtml(code[Number(n)])}</code>`);
  return s;
}

function tableRows(lines) {
  const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(lines[0]);
  const body = lines.slice(2).map(cells);
  const out = ['<div class="tablewrap"><table><thead><tr>'];
  out.push(head.map((c) => `<th>${inline(c)}</th>`).join(''));
  out.push('</tr></thead><tbody>');
  for (const row of body) {
    out.push('<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
  }
  out.push('</tbody></table></div>');
  return out.join('\n');
}

const BREAKS = /^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|(-{3,}|\*{3,}|_{3,})\s*$)/;

export function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const code = body.join('\n');
      const rendered = lang ? highlight(code, lang) : escapeHtml(code);
      out.push(`<div class="codewrap"><pre><code>${rendered}</code></pre></div>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr />'); i++; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const block = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) block.push(lines[i++]);
      out.push(tableRows(block));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const block = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        block.push(lines[i++].replace(/^\s*>\s?/, ''));
      }
      out.push(`<blockquote><p>${inline(block.join(' '))}</p></blockquote>`);
      continue;
    }

    const bullet = /^\s*([-*+])\s+(.*)$/;
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(lines[i].match(re)[2]);
        i++;
        // fold continuation lines into the item they belong to
        while (i < lines.length && lines[i].trim() && !re.test(lines[i]) && !BREAKS.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>\n` + items.map((t) => `<li>${inline(t)}</li>`).join('\n') + `\n</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !BREAKS.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    else i++;
  }

  return out.join('\n\n');
}

const BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'tr', 'pre', 'blockquote'];
const OPEN_TAG = new RegExp(`<(${BLOCK_TAGS.join('|')})((?:\\s[^>]*)?)>`, 'gi');

/**
 * Assigns block ids by content hash, recording them in a registry carried in
 * review state.
 *
 * A .md file has nowhere to store a data-b id, so the source cannot be the
 * registry the way it is for authored HTML. Hashing the block's own text keeps
 * ids stable across re-renders and unaffected by insertions elsewhere.
 *
 * Editing a block's text does change its id. That is deliberate rather than
 * papered over: quote resolution then relocates the comment if the quoted phrase
 * survived, or orphans it if it did not - exactly what the anchor rules promise.
 */
export function assignBlockIdsByContent(html, registry = {}, startAt = 1) {
  const src = String(html);
  const next = { ...registry };
  const used = new Set(Object.values(next));
  const seen = new Map();
  let n = startAt;

  const out = src.replace(OPEN_TAG, (whole, tag, attrs, offset) => {
    if (/\sdata-b\s*=/i.test(attrs)) return whole;

    const after = src.slice(offset);
    const close = after.indexOf(`</${tag}>`);
    const inner = close === -1 ? '' : after.slice(after.indexOf('>') + 1, close);
    const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    const base = `${tag}:${hashLine(text)}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const key = occurrence === 1 ? base : `${base}#${occurrence}`;

    let id = next[key];
    if (!id) {
      while (used.has(`b${n}`)) n++;
      id = `b${n++}`;
      next[key] = id;
      used.add(id);
    }
    return `<${tag}${attrs} data-b="${id}">`;
  });

  while (used.has(`b${n}`)) n++;
  return { html: out, registry: next, nextBlock: n };
}
