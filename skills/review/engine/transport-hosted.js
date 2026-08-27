// Hosted transport: the page carries its own source as data and republishes
// itself. It reads only the inert text of its style/template/script blocks and
// never the rendered tree, so nothing a viewer did to the DOM can leak into a
// published version.
window.RV_TRANSPORT = (function(){
  var api = null, ready = null;

  var HTML_ESCAPES = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return HTML_ESCAPES[c]; });
  }

  // Must match lib/assemble.mjs exactly; held there by tests/engine-parity.test.mjs.
  function escapeScriptText(s){
    return String(s == null ? '' : s).replace(/<(\\*)\/(script|style)/gi,
      function(whole, slashes, tag){ return '<' + slashes + '\\/' + tag; });
  }
  function unescapeScriptText(s){
    return String(s == null ? '' : s).replace(/<(\\+)\/(script|style)/gi,
      function(whole, slashes, tag){ return '<' + slashes.slice(1) + '/' + tag; });
  }

  // Text read back out of the page is already in escaped form. Unescaping before
  // re-escaping keeps it byte-stable; re-escaping directly deepens the escape on
  // every republish and silently changes what the engine's own source means.
  function inertText(id){
    var node = document.getElementById(id);
    return node ? unescapeScriptText(node.textContent) : '';
  }

  function headLinks(){
    var out = [];
    var links = document.head ? document.head.querySelectorAll('link[rel="preconnect"],link[rel="stylesheet"]') : [];
    for (var i = 0; i < links.length; i++) out.push(links[i].outerHTML);
    return out.join('');
  }

  function assemble(state){
    var e = escapeScriptText;
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escapeHtml(state.doc.title) + '</title>',
      headLinks(),
      '<style id="rv-style">' + e(inertText('rv-style')) + '<\/style>',
      '</head>',
      '<body>',
      '<div id="rv-app"></div>',
      '<script type="text/template" id="rv-doc-source">' + e(inertText('rv-doc-source')) + '<\/script>',
      '<script type="application/json" id="rv-state">' + e(JSON.stringify(state, null, 2)) + '<\/script>',
      '<script id="rv-engine">' + e(inertText('rv-engine')) + '<\/script>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  function resolve(){
    if (ready) return ready;
    ready = (window.claude && typeof window.claude.use === 'function')
      ? window.claude.use('artifact').then(function(a){ api = a; return a; }, function(){ return null; })
      : Promise.resolve(null);
    return ready;
  }

  return {
    canSave: function(){ return resolve().then(function(a){ return !!a; }); },

    load: function(){
      try {
        return Promise.resolve(JSON.parse(document.getElementById('rv-state').textContent));
      } catch (e) {
        return Promise.resolve(null);
      }
    },

    save: function(state){
      return resolve().then(function(a){
        if (!a) throw new Error('not_granted');
        return a.publish(assemble(state));
      });
    }
  };
})();
