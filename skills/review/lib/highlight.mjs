import { escapeHtml } from './assemble.mjs';

/**
 * A deliberately small tokeniser. Zero dependencies is a hard constraint, so this
 * covers js/ts, json and css and falls back to escaped plain text for everything
 * else rather than guessing badly.
 *
 * It must never alter the underlying text: anchors resolve against textContent, so
 * inserting a span that changes even one character would corrupt every quote in
 * that block. plainTextOf exists so a test can hold that invariant.
 */

const KEYWORDS = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for',
  'while', 'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from',
  'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'in', 'of', 'delete', 'void', 'yield', 'switch', 'case', 'do', 'interface', 'type']);

const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this']);

const LANGS = {
  js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js',
  json: 'json', css: 'css',
};

const span = (cls, text) => `<span class="tk-${cls}">${escapeHtml(text)}</span>`;

function tokenizeJs(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);

    let m = rest.match(/^\/\*[\s\S]*?(?:\*\/|$)/);
    if (m) { out.push(span('com', m[0])); i += m[0].length; continue; }

    m = rest.match(/^\/\/[^\n]*/);
    if (m) { out.push(span('com', m[0])); i += m[0].length; continue; }

    m = rest.match(/^(['"`])(?:\\.|(?!\1)[\s\S])*\1?/);
    if (m) { out.push(span('str', m[0])); i += m[0].length; continue; }

    m = rest.match(/^\d[\w.]*/);
    if (m) { out.push(span('num', m[0])); i += m[0].length; continue; }

    m = rest.match(/^[A-Za-z_$][\w$]*/);
    if (m) {
      const w = m[0];
      out.push(KEYWORDS.has(w) ? span('kw', w) : LITERALS.has(w) ? span('lit', w) : escapeHtml(w));
      i += w.length;
      continue;
    }

    m = rest.match(/^[^\w$'"`/]+|^\//);
    const chunk = m ? m[0] : src[i];
    out.push(escapeHtml(chunk));
    i += chunk.length;
  }
  return out.join('');
}

function tokenizeJson(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);

    let m = rest.match(/^"(?:\\.|[^"])*"?(\s*:)?/);
    if (m) {
      const isKey = /:\s*$/.test(m[0]);
      if (isKey) {
        const quoted = m[0].replace(/\s*:$/, '');
        out.push(span('key', quoted) + escapeHtml(m[0].slice(quoted.length)));
      } else {
        out.push(span('str', m[0]));
      }
      i += m[0].length;
      continue;
    }

    m = rest.match(/^-?\d[\w.+-]*/);
    if (m) { out.push(span('num', m[0])); i += m[0].length; continue; }

    m = rest.match(/^(true|false|null)\b/);
    if (m) { out.push(span('lit', m[0])); i += m[0].length; continue; }

    m = rest.match(/^[^"\d\-tfn]+/);
    const chunk = m ? m[0] : src[i];
    out.push(escapeHtml(chunk));
    i += chunk.length;
  }
  return out.join('');
}

function tokenizeCss(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);

    let m = rest.match(/^\/\*[\s\S]*?(?:\*\/|$)/);
    if (m) { out.push(span('com', m[0])); i += m[0].length; continue; }

    m = rest.match(/^[-\w]+(?=\s*:)/);
    if (m) { out.push(span('prop', m[0])); i += m[0].length; continue; }

    m = rest.match(/^(['"])(?:\\.|(?!\1)[^\n])*\1?/);
    if (m) { out.push(span('str', m[0])); i += m[0].length; continue; }

    m = rest.match(/^\d[\w.%]*/);
    if (m) { out.push(span('num', m[0])); i += m[0].length; continue; }

    m = rest.match(/^[^/\-\w'"\d]+|^[/\-]/);
    const chunk = m ? m[0] : src[i];
    out.push(escapeHtml(chunk));
    i += chunk.length;
  }
  return out.join('');
}

export function highlight(code, lang) {
  const kind = LANGS[String(lang || '').toLowerCase()];
  if (!kind) return escapeHtml(code);
  if (kind === 'json') return tokenizeJson(String(code));
  if (kind === 'css') return tokenizeCss(String(code));
  return tokenizeJs(String(code));
}

/** Strips the spans back out, for asserting that highlighting is text-preserving. */
export function plainTextOf(html) {
  return String(html)
    .replace(/<span class="tk-[a-z]+">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
