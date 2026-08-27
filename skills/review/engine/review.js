
(function(){
'use strict';

var SHELL = [
'<div class="rv-bar">',
  '<div class="rv-brand"><b id="rv-title"></b><span class="rv-rev" id="rv-revtag"></span></div>',
  '<div class="rv-counts" id="rv-counts"></div>',
  '<button class="rv-btn primary" id="rv-submit">Submit review</button>',
'</div>',
'<div class="rv-note" id="rv-note" hidden></div>',
'<div class="rv-main">',
  '<div class="rv-docwrap" id="rv-docwrap"><article id="rv-doc"></article>',
    '<div class="rv-pop" id="rv-pop" hidden></div>',
  '</div>',
  '<aside class="rv-rail" id="rv-rail"></aside>',
'</div>'
].join('');

var VERDICTS = ['must-fix','nit','question','answer','praise'];
var PLACEHOLDER = {
  'must-fix': 'What breaks, and what has to change before this ships?',
  'nit': 'Small preference. Take it or leave it, no reply needed.',
  'question': 'What do you need explained before you can judge this?',
  'answer': 'Answering a question the document put to you.',
  'praise': 'What works, so it does not quietly get refactored away.'
};
var STATUS_ORDER = ['draft','open','orphaned','pushed-back','addressed'];
var STATUS_LABEL = {draft:'Not submitted',open:'Open',addressed:'Addressed',
  'pushed-back':'Pushed back',orphaned:'Orphaned'};

var state = null, drafts = [], api = null, apiResolved = false;
var pending = null, selectedId = null, ctx = {};

var transport = window.RV_TRANSPORT || {
  load: function(){ return Promise.resolve(null); },
  save: function(){ return Promise.reject(new Error('no transport')); },
  canSave: function(){ return Promise.resolve(false); }
};

function el(id){ return document.getElementById(id); }

function dropPublishedDrafts(pending, current){
  var published = {};
  (current.comments || []).forEach(function(c){ if (c.fromDraft) published[c.fromDraft] = 1; });
  return pending.filter(function(d){ return !published[d.tmpId]; });
}
function escHtml(s){ return String(s).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function escScript(s){ return String(s).replace(/<\/(script|style)/gi, '<\\/$1'); }
function keyOf(sfx){ return 'review:' + (state && state.doc ? state.doc.slug : 'doc') + ':' + sfx; }

function lsGet(k, fb){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }catch(e){ return fb; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
function ssGet(k, fb){ try{ var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : fb; }catch(e){ return fb; } }
function ssSet(k, v){ try{ sessionStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

/* ---------- text index: normalized text with a map back to text nodes ---------- */
function textIndex(root){
  var norm = '', map = [], lastSpace = true;
  var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (w.nextNode()){
    var n = w.currentNode, d = n.data;
    for (var i = 0; i < d.length; i++){
      if (/\s/.test(d[i])){
        if (lastSpace) continue;
        norm += ' '; map.push([n, i]); lastSpace = true;
      } else {
        norm += d[i]; map.push([n, i]); lastSpace = false;
      }
    }
  }
  while (norm.length && norm[norm.length-1] === ' '){ norm = norm.slice(0,-1); map.pop(); }
  return { norm: norm, map: map };
}
function normQuote(s){ return String(s == null ? '' : s).replace(/\s+/g,' ').trim(); }

// Mirrors findQuote in lib/anchors.mjs; held there by tests/engine-parity.test.mjs.
// Selection.toString() returns rendered text, so a block with text-transform hands
// back a different case than the source. The quote is always sliced from the source.
function findQuote(text, selection){
  var source = normQuote(text), wanted = normQuote(selection);
  if (!wanted || !source) return null;
  var at = source.indexOf(wanted);
  if (at === -1) at = source.toLowerCase().indexOf(wanted.toLowerCase());
  if (at === -1) return null;
  return { at: at, quote: source.slice(at, at + wanted.length) };
}

/* Wrap normalized range [s,e) in marks. Groups by text node, applies right-to-left
   so earlier offsets stay valid. Returns array of created elements, or [] on failure. */
function wrapRange(idx, s, e, cls, n){
  if (s < 0 || e > idx.map.length || e <= s) return [];
  var groups = [], cur = null;
  for (var i = s; i < e; i++){
    var node = idx.map[i][0], off = idx.map[i][1];
    if (cur && cur.node === node && off === cur.end){ cur.end = off + 1; continue; }
    cur = { node: node, start: off, end: off + 1 };
    groups.push(cur);
  }
  var made = [];
  for (var g = groups.length - 1; g >= 0; g--){
    var grp = groups[g];
    try{
      var r = document.createRange();
      r.setStart(grp.node, grp.start);
      r.setEnd(grp.node, grp.end);
      var m = document.createElement('mark');
      m.className = cls;
      r.surroundContents(m);
      made.unshift(m);
    }catch(err){ /* segment unmarkable; card still lives in the rail */ }
  }
  if (made.length && n != null) made[0].setAttribute('data-n', n);
  return made;
}

/* ---------- render ---------- */
function renderDoc(){
  var src = el('rv-doc-source').textContent;
  el('rv-doc').innerHTML = src;
}

function allComments(){
  var out = [], maxN = 0;
  state.comments.forEach(function(c){
    var n = parseInt(String(c.id).replace(/[^0-9]/g, ''), 10) || 0;
    if (n > maxN) maxN = n;
    var copy = {}; for (var k in c) copy[k] = c[k];
    copy.n = n;
    out.push(copy);
  });
  drafts.forEach(function(d, i){
    if (d.kind === 'followup') {
      var host = null;
      for (var j = 0; j < out.length; j++) if (out[j].id === d.targetId) host = out[j];
      if (host) {
        host.thread = (host.thread || []).concat(
          [{ by: 'reviewer', body: d.body, suggest: d.suggest || '', rev: state.doc.rev, pending: true }]);
        host.status = 'draft';
        host.pendingFollowUp = d.tmpId;
      }
      return;
    }
    out.push({ id: d.tmpId, anchor: null, draftAnchor: d.anchor, verdict: d.verdict,
      status: 'draft', n: maxN + i + 1,
      thread: [{ by: 'reviewer', body: d.body, suggest: d.suggest || '', rev: state.doc.rev }] });
  });
  return out;
}

function anchorFor(c){ return c.anchor ? state.anchors[c.anchor] : c.draftAnchor; }

function applyMarks(){
  document.querySelectorAll('#rv-doc mark.rv-mark').forEach(function(m){
    var p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m); p.normalize();
  });
  ctx.marks = {}; ctx.anchorState = {};
  var list = allComments();
  for (var i = 0; i < list.length; i++){
    var c = list[i], a = anchorFor(c);
    if (!a) continue;
    ctx.anchorState[c.id] = 'orphaned';
    var block = document.querySelector('#rv-doc [data-b="' + a.block + '"]');
    if (!block) continue;
    var idx = textIndex(block);
    var q = normQuote(a.quote);
    var at = idx.norm.indexOf(q);
    if (at < 0) continue;
    ctx.anchorState[c.id] = 'live';
    var cls = 'rv-mark' + (c.status === 'draft' ? ' draft' : '');
    var made = wrapRange(idx, at, at + q.length, cls, c.n != null ? c.n : (i + 1));
    if (made.length){
      made.forEach(function(m){ m.dataset.cid = c.id; });
      ctx.marks[c.id] = made;
    }
  }
}

function counts(){
  var out = { 'must-fix':0, nit:0, question:0, praise:0, draft:0 };
  allComments().forEach(function(c){
    if (c.status === 'draft') out.draft++;
    if (out[c.verdict] != null) out[c.verdict]++;
  });
  return out;
}

function renderChrome(){
  el('rv-title').textContent = state.doc.title;
  el('rv-revtag').textContent = 'rev ' + state.doc.rev;
  var c = counts(), bits = [];
  VERDICTS.forEach(function(v){ if (c[v]) bits.push('<span class="rv-count">' + v + ' ' + c[v] + '</span>'); });
  if (c.draft) bits.push('<span class="rv-count on">' + c.draft + ' unsent</span>');
  el('rv-counts').innerHTML = bits.join('');
  var btn = el('rv-submit');
  btn.textContent = c.draft ? 'Submit ' + c.draft + (c.draft === 1 ? ' comment' : ' comments') : 'Submit review';
  btn.disabled = !c.draft || !api;

  var note = el('rv-note');
  if (!apiResolved){ note.hidden = true; return; }
  if (!api){
    note.hidden = false;
    note.innerHTML = 'This view cannot save, so comments stay in this browser only.';
  } else if (c.draft){
    note.hidden = false;
    note.innerHTML = 'Drafts are saved in this browser. Submitting writes them into the review.';
  } else { note.hidden = true; }
}

function card(c, i){
  var a = anchorFor(c);
  var n = c.n != null ? c.n : (i + 1);
  var reopened = isReopened(c);
  var statusText = reopened ? 'Reopened' : (STATUS_LABEL[c.status] || c.status);
  var h = ['<div class="rv-card' + (selectedId === c.id ? ' on' : '') + '" data-v="' +
    escHtml(c.verdict || 'nit') + '" data-cid="' + escHtml(c.id) + '">'];
  h.push('<div class="rv-cardtop"><span class="rv-n">' + n + '</span>');
  h.push('<span class="rv-vtag">' + escHtml(c.verdict || '') + '</span>');
  h.push('<span class="rv-status' + (reopened ? ' reopened' : '') + '">' + escHtml(statusText) + '</span></div>');
  if (a && a.quote) h.push('<div class="rv-cardquote">' + escHtml(a.quote) + '</div>');
  if (ctx.anchorState && ctx.anchorState[c.id] === 'orphaned')
    h.push('<div class="rv-orphan">Anchor lost &mdash; the quoted text no longer exists in the document</div>');

  var thread = c.thread || [];
  for (var t = 0; t < thread.length; t++) {
    var turn = thread[t];
    if (turn.by === 'agent') {
      h.push('<div class="rv-turn agent"><span class="rv-who">Claude</span>' +
        escHtml(turn.body) + '</div>');
    } else {
      h.push('<div class="rv-turn' + (t === 0 ? ' first' : '') + '">' +
        (t === 0 ? '' : '<span class="rv-who">Follow-up</span>') + escHtml(turn.body) + '</div>');
      if (turn.suggest) h.push('<div class="rv-cardsug">' + escHtml(turn.suggest) + '</div>');
    }
  }

  if (c.status === 'draft') {
    h.push('<div class="rv-cardacts"><button class="rv-linkish" data-act="edit" data-cid="' +
      escHtml(c.id) + '">Edit</button><button class="rv-linkish" data-act="del" data-cid="' +
      escHtml(c.id) + '">Delete</button></div>');
  } else if (thread.some(function(x){ return x.by === 'agent'; })) {
    h.push('<div class="rv-cardacts"><button class="rv-linkish" data-act="followup" data-cid="' +
      escHtml(c.id) + '">Not fixed &mdash; follow up</button></div>');
  }
  h.push('</div>');
  return h.join('');
}

function renderRail(){
  var list = allComments();
  var h = ['<div class="rv-railhead"><h3>Review</h3></div>'];
  if (!list.length){
    h.push('<p class="rv-empty">No comments yet. Select any text in the document to start one. ' +
      'Drafts are kept locally until you submit.</p>');
  } else {
    STATUS_ORDER.forEach(function(st){
      var group = list.filter(function(c){ return c.status === st; });
      if (!group.length) return;
      h.push('<div class="rv-group"><div class="rv-grouphead">' + escHtml(STATUS_LABEL[st] || st) + ' &middot; ' + group.length + '</div>');
      group.forEach(function(c){ h.push(card(c, list.indexOf(c))); });
      h.push('</div>');
    });
  }
  el('rv-rail').innerHTML = h.join('');
}

function renderAll(){ applyMarks(); renderChrome(); renderRail(); }

/* ---------- selection -> popover ---------- */
function blockOf(node){
  var n = node.nodeType === 1 ? node : node.parentNode;
  while (n && n !== el('rv-doc')){
    if (n.nodeType === 1 && n.hasAttribute('data-b')) return n;
    n = n.parentNode;
  }
  return null;
}

function capture(){
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  var r = sel.getRangeAt(0);
  var doc = el('rv-doc');
  if (!doc.contains(r.commonAncestorContainer)) return null;
  var b1 = blockOf(r.startContainer), b2 = blockOf(r.endContainer);
  if (!b1 || b1 !== b2) return null;

  var idx = textIndex(b1);
  var hit = findQuote(idx.norm, sel.toString());
  if (!hit || hit.quote.length < 2) return null;

  return {
    block: b1.getAttribute('data-b'),
    quote: hit.quote,
    before: idx.norm.slice(Math.max(0, hit.at - 32), hit.at),
    after: idx.norm.slice(hit.at + hit.quote.length, hit.at + hit.quote.length + 32),
    rect: r.getBoundingClientRect()
  };
}

function openFollowUp(comment){
  var a = anchorFor(comment) || { quote: '' };
  var block = document.querySelector('#rv-doc [data-b="' + a.block + '"]');
  var rect = block ? block.getBoundingClientRect() : { bottom: 80, left: 40 };
  openPop({ block: a.block, quote: a.quote, before: a.before, after: a.after, rect: rect },
    null, { targetId: comment.id, verdict: comment.verdict });
}

function openPop(anchor, existing, followup){
  pending = { anchor: anchor, editing: existing || null, followup: followup || null,
    verdict: followup ? followup.verdict : (existing ? existing.verdict : 'must-fix'),
    body: existing ? existing.body : '', suggest: existing ? existing.suggest : '' };
  var p = el('rv-pop');
  var vh = VERDICTS.map(function(v){
    return '<button class="rv-v" data-v="' + v + '" aria-pressed="' + (pending.verdict === v) + '">' + v + '</button>';
  }).join('');
  p.innerHTML = [
    pending.followup
      ? '<div class="rv-sublabel">Follow-up on ' + escHtml(pending.followup.targetId) +
        ' &mdash; reopens it</div>'
      : '',
    '<div class="rv-quote">' + escHtml(anchor.quote) + '</div>',
    pending.followup ? '' : '<div class="rv-verdicts">' + vh + '</div>',
    '<textarea id="rv-body" rows="3"></textarea>',
    '<div id="rv-sugwrap" hidden><div class="rv-sublabel">Suggested replacement &mdash; applied verbatim</div>',
    '<textarea id="rv-sug" class="sug" rows="2" placeholder="Exact text to use instead"></textarea></div>',
    '<div class="rv-popfoot">',
      '<button class="rv-linkish" id="rv-togsug">Suggest a replacement</button>',
      '<span class="grow"></span>',
      '<button class="rv-btn" id="rv-cancel">Cancel</button>',
      '<button class="rv-btn primary" id="rv-save">Save</button>',
    '</div>'
  ].join('');
  p.hidden = false;
  el('rv-body').value = pending.body || '';
  el('rv-body').placeholder = pending.followup
    ? 'What is still wrong? This reopens the comment.'
    : (PLACEHOLDER[pending.verdict] || '');
  el('rv-sug').value = pending.suggest || '';
  if (pending.suggest){ el('rv-sugwrap').hidden = false; el('rv-togsug').textContent = 'Remove suggestion'; }

  var wrap = el('rv-docwrap');
  var wr = wrap.getBoundingClientRect();
  var top = anchor.rect.bottom - wr.top + wrap.scrollTop + 8;
  var left = Math.min(anchor.rect.left - wr.left, wrap.clientWidth - p.offsetWidth - 16);
  p.style.top = top + 'px';
  p.style.left = Math.max(8, left) + 'px';
  el('rv-body').focus();
}

function closePop(){ el('rv-pop').hidden = true; pending = null; }

function saveDraft(){
  if (!pending) return;
  var body = el('rv-body').value.trim();
  var sug = el('rv-sugwrap').hidden ? '' : el('rv-sug').value.trim();
  if (!body && !sug) { closePop(); return; }
  if (pending.editing){
    var d = drafts.filter(function(x){ return x.tmpId === pending.editing.id; })[0];
    if (d){ d.verdict = pending.verdict; d.body = body; d.suggest = sug; }
  } else if (pending.followup) {
    drafts.push({ tmpId: 'f' + Date.now() + '-' + drafts.length, kind: 'followup',
      targetId: pending.followup.targetId, body: body, suggest: sug });
  } else {
    drafts.push({ tmpId: 'd' + Date.now() + '-' + drafts.length, kind: 'new',
      anchor: pending.anchor, verdict: pending.verdict, body: body, suggest: sug });
  }
  lsSet(keyOf('drafts'), drafts);
  closePop();
  window.getSelection().removeAllRanges();
  renderAll();
}

function saveUi(){
  ssSet(keyOf('ui'), { scroll: el('rv-docwrap').scrollTop, sel: selectedId });
}

function applyDraftsInPage(current, pending){
  var next = JSON.parse(JSON.stringify(current));
  var published = {};
  next.comments.forEach(function(c){
    if (c.fromDraft) published[c.fromDraft] = 1;
    (c.followUps || []).forEach(function(t){ published[t] = 1; });
  });
  pending.forEach(function(d){
    if (published[d.tmpId]) return;
    if (d.kind === 'followup') {
      var target = null;
      for (var i = 0; i < next.comments.length; i++) {
        if (next.comments[i].id === d.targetId) { target = next.comments[i]; break; }
      }
      if (!target) return;
      target.thread.push({ by: 'reviewer', body: d.body, suggest: d.suggest || '', rev: next.doc.rev });
      target.status = 'open';
      target.followUps = (target.followUps || []).concat(d.tmpId);
      return;
    }
    var aid = 'a' + (next.nextAnchor++);
    var cid = 'c' + (next.nextComment++);
    next.anchors[aid] = { block: d.anchor.block, quote: d.anchor.quote,
      before: d.anchor.before || '', after: d.anchor.after || '' };
    next.comments.push({ id: cid, anchor: aid, verdict: d.verdict,
      createdRev: next.doc.rev, status: 'open', anchorState: 'live',
      thread: [{ by: 'reviewer', body: d.body, suggest: d.suggest || '', rev: next.doc.rev }],
      fromDraft: d.tmpId });
  });
  return next;
}

function openingOf(c){
  var t = c.thread || [];
  for (var i = 0; i < t.length; i++) if (t[i].by === 'reviewer') return t[i];
  return null;
}

function isReopened(c){
  var t = c.thread || [];
  if (c.status !== 'open') return false;
  for (var i = 0; i < t.length; i++) if (t[i].by === 'agent') return true;
  return false;
}

async function refresh(){
  var loaded = await transport.load();
  if (loaded) {
    state = loaded;
    drafts = dropPublishedDrafts(lsGet(keyOf('drafts'), []), state);
    lsSet(keyOf('drafts'), drafts);
  }
  renderAll();
}

async function submit(){
  if (!api || !drafts.length) return;
  var btn = el('rv-submit');
  btn.disabled = true; btn.textContent = 'Saving...';
  saveUi();
  try{
    await transport.save(applyDraftsInPage(state, drafts));
    drafts = []; lsDel(keyOf('drafts'));
    await refresh();
  }catch(err){
    var code = err && (err.code || err.message) || '';
    var note = el('rv-note');
    note.hidden = false;
    note.textContent = code === 'conflict'
      ? 'A newer version was saved elsewhere. Reload to see it; your comments are still saved in this browser and can be submitted again.'
      : 'Could not save (' + (code || 'unknown') + '). Your comments are still saved in this browser.';
    renderChrome();
  }
}

/* ---------- wire up ---------- */
function boot(){
  document.getElementById('rv-app').innerHTML = SHELL;

  try{ state = JSON.parse(el('rv-state').textContent) || {}; }
  catch(e){ state = {}; }
  state = Object.assign({ schema:1, doc:{slug:'doc',title:'Review',rev:1,kind:'prose'},
    anchors:{}, comments:[], nextAnchor:1, nextComment:1, nextBlock:1 }, state);
  if (document.title !== state.doc.title) document.title = state.doc.title;

  drafts = dropPublishedDrafts(lsGet(keyOf('drafts'), []), state);
  lsSet(keyOf('drafts'), drafts);

  renderDoc();
  renderAll();

  var ui = ssGet(keyOf('ui'), null);
  if (ui){ el('rv-docwrap').scrollTop = ui.scroll || 0; selectedId = ui.sel || null; renderRail(); }

  el('rv-docwrap').addEventListener('scroll', function(){
    if (ctx.st) return;
    ctx.st = setTimeout(function(){ ctx.st = null; saveUi(); }, 250);
  });

  document.addEventListener('mouseup', function(e){
    if (el('rv-pop').contains(e.target)) return;
    setTimeout(function(){
      var a = capture();
      if (a) openPop(a); else if (!pending) closePop();
    }, 0);
  });

  el('rv-doc').addEventListener('click', function(e){
    var m = e.target.closest('mark.rv-mark');
    if (!m) return;
    selectedId = m.dataset.cid; renderRail(); saveUi();
    var c = el('rv-rail').querySelector('.rv-card.on');
    if (c) c.scrollIntoView({ block:'nearest' });
  });

  el('rv-pop').addEventListener('click', function(e){
    var v = e.target.closest('.rv-v');
    if (v){
      pending.verdict = v.dataset.v;
      el('rv-pop').querySelectorAll('.rv-v').forEach(function(b){
        b.setAttribute('aria-pressed', String(b === v)); });
      el('rv-body').placeholder = pending.followup
    ? 'What is still wrong? This reopens the comment.'
    : (PLACEHOLDER[pending.verdict] || '');
      return;
    }
    if (e.target.id === 'rv-save') return saveDraft();
    if (e.target.id === 'rv-cancel') return closePop();
    if (e.target.id === 'rv-togsug'){
      var w = el('rv-sugwrap');
      w.hidden = !w.hidden;
      e.target.textContent = w.hidden ? 'Suggest a replacement' : 'Remove suggestion';
      if (!w.hidden) el('rv-sug').focus();
    }
  });

  el('rv-rail').addEventListener('click', function(e){
    var act = e.target.closest('[data-act]');
    if (act){
      var id = act.dataset.cid;
      if (act.dataset.act === 'followup'){
        var host = null;
        for (var k = 0; k < state.comments.length; k++)
          if (state.comments[k].id === id) host = state.comments[k];
        if (host) openFollowUp(host);
        return;
      }
      if (act.dataset.act === 'del'){
        drafts = drafts.filter(function(d){ return d.tmpId !== id && d.targetId !== id; });
        lsSet(keyOf('drafts'), drafts); renderAll();
      } else {
        var d = drafts.filter(function(x){ return x.tmpId === id; })[0];
        if (d){
          var block = document.querySelector('#rv-doc [data-b="' + d.anchor.block + '"]');
          var rect = block ? block.getBoundingClientRect() : { bottom: 80, left: 40 };
          openPop({ block:d.anchor.block, quote:d.anchor.quote, before:d.anchor.before,
            after:d.anchor.after, rect:rect },
            { id:d.tmpId, verdict:d.verdict, body:d.body, suggest:d.suggest });
        }
      }
      return;
    }
    var card = e.target.closest('.rv-card');
    if (!card) return;
    selectedId = card.dataset.cid; renderRail();
    var marks = ctx.marks[selectedId];
    if (marks && marks[0]) marks[0].scrollIntoView({ block:'center' });
    saveUi();
  });

  el('rv-submit').addEventListener('click', submit);

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !el('rv-pop').hidden) closePop();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && pending) saveDraft();
  });

  transport.canSave().then(function(ok){ api = ok; apiResolved = true; renderChrome(); },
    function(){ api = false; apiResolved = true; renderChrome(); });

  if (state.stub) { refresh(); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
