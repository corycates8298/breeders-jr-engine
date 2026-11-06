// In-memory mock of the artifact runtime (db + user) for testing.
(function(){
  var DB = JSON.parse(JSON.stringify(window.__DBDUMP__));
  var subs = {};
  function snap(c){ var m = DB[c] || {}; return { docs: Object.keys(m).map(function(id){ var v = m[id]; return { id: id, exists: true, data: function(){ return JSON.parse(JSON.stringify(v)); } }; }) }; }
  function fire(c){ (subs[c]||[]).forEach(function(fn){ setTimeout(function(){ fn(snap(c)); }, 0); }); }
  var db = { collection: function(c){ return {
      onSnapshot: function(fn, err){ (subs[c] = subs[c] || []).push(fn); setTimeout(function(){ fn(snap(c)); }, 5); return function(){}; },
      doc: function(id){ return {
        set: function(data){ JSON.stringify(data); (DB[c] = DB[c] || {})[id] = JSON.parse(JSON.stringify(data)); fire(c); return Promise.resolve(); },
        delete: function(){ if (DB[c]) delete DB[c][id]; fire(c); return Promise.resolve(); },
        get: function(){ var v = (DB[c]||{})[id]; return Promise.resolve({ id: id, exists: v != null, data: function(){ return v; } }); }
      }; }
  }; } };
  var user = { canEdit: function(){ return Promise.resolve(false); }, can: function(){ return Promise.resolve(false); } };
  window.claude = { use: function(n){ return Promise.resolve(n === 'db' ? db : user); } };
})();
