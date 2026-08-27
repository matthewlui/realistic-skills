const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Injective: adds one backslash to whatever run already precedes the terminator,
// so '</script' and '<\\/script' stay distinguishable and can be recovered exactly.
export function escapeScriptText(s) {
  return String(s ?? '').replace(
    /<(\\*)\/(script|style)/gi,
    (whole, slashes, tag) => `<${slashes}\\/${tag}`
  );
}

export function unescapeScriptText(s) {
  return String(s ?? '').replace(
    /<(\\+)\/(script|style)/gi,
    (whole, slashes, tag) => `<${slashes.slice(1)}/${tag}`
  );
}

export function assembleDocument({ title, css, docSource, engine, state, fonts = '' }) {
  const e = escapeScriptText;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    fonts,
    `<style id="rv-style">${e(css)}</style>`,
    '</head>',
    '<body>',
    '<div id="rv-app"></div>',
    `<script type="text/template" id="rv-doc-source">${e(docSource)}</script>`,
    `<script type="application/json" id="rv-state">${e(JSON.stringify(state, null, 2))}</script>`,
    `<script id="rv-engine">${e(engine)}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

export function extractBlock(html, id) {
  const re = new RegExp(`<(script|style)[^>]*id="${id}"[^>]*>([\\s\\S]*?)</\\1>`);
  const m = html.match(re);
  return m ? unescapeScriptText(m[2]) : null;
}
