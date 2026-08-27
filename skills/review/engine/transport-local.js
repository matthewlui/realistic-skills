// Local transport: review.json on disk is the source of truth. Submitting is a
// POST, so nothing reloads and refresh or reopen simply re-reads the file.
window.RV_TRANSPORT = (function(){
  var base = location.pathname.replace(/\/(index\.html)?$/, '');

  return {
    canSave: function(){ return Promise.resolve(true); },

    load: function(){
      return fetch(base + '/review.json', { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .catch(function(){ return null; });
    },

    save: function(state){
      return fetch(base + '/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state)
      }).then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status);
      });
    }
  };
})();
