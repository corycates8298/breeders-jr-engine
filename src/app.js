(function () {
'use strict';
var E = window.RaceEngine;
var $ = function (s) { return document.querySelector(s); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pct(p, d) { if (p == null || isNaN(p)) return '—'; return (p * 100).toFixed(d == null ? 1 : d) + '%'; }
function signed(x, d) { if (x == null || isNaN(x)) return '—'; var s = (+x).toFixed(d == null ? 1 : d); return (x > 0 ? '+' : '') + s.replace(/\.0$/, d ? '.0' : ''); }
function byNum(a, b) { return parseInt(a, 10) - parseInt(b, 10); }

var S = {
  races: [], status: {}, jrpicks: {}, results: {}, live: {}, model: null, hist: [], reviews: [], jrsheets: {}, meta: null, conds: {},
  db: null, user: null, canEdit: false, canWrite: null, ready: false, errors: [], X: null, book: {},
  ui: { view: 'home', playRace: null, labOpen: false, raceId: null, pgm: null, factor: null, raceTab: 'overview', sort: { key: 'claude', dir: -1 }, day: 'all', q: '', minP: 0, matrixAll: true, what: null, factorRace: 'all', tuneOut: null,
    scn: null, fday: null, sitTab: 'explorer', sitDim: 'going', sitVal: null, sitDay: 'all', keyAll: false, connKind: 'J', connSel: null, cardPreview: null, cardMsg: null }
};
// ---------- what-if scenario (kept in this browser only) ----------
var SCN_KEY = 'bje-scenario-v1';
function emptyScn() { return { going: {}, bias: {}, pace: {}, hypo: {} }; }
function loadScn() { try { var v = JSON.parse(localStorage.getItem(SCN_KEY) || 'null'); if (v && typeof v === 'object') { var e = emptyScn(); Object.keys(e).forEach(function (k) { if (v[k] && typeof v[k] === 'object') e[k] = v[k]; }); return e; } } catch (e) { } return emptyScn(); }
function saveScn() { try { localStorage.setItem(SCN_KEY, JSON.stringify(S.ui.scn)); } catch (e) { } }
S.ui.scn = loadScn();
var SURF_NAME = { D: 'Dirt', T: 'Turf', S: 'Synthetic' };
function scnParts() { var c = S.ui.scn, out = [];
  Object.keys(c.going).forEach(function (d) { var g = c.going[d]; Object.keys(g).forEach(function (sk) { out.push(dateShort(d) + ' ' + SURF_NAME[sk].toLowerCase() + ' ' + goingLabel(sk, g[sk])); }); });
  Object.keys(c.bias).forEach(function (sk) { out.push(SURF_NAME[sk].toLowerCase() + ' bias set by hand'); });
  var np = Object.keys(c.pace).length; if (np) out.push(np + ' pace override' + (np > 1 ? 's' : ''));
  var nh = Object.keys(c.hypo).length; if (nh) out.push(nh + ' hypothetical result' + (nh > 1 ? 's' : ''));
  return out; }
function goingLabel(sk, g) { if (!g) return 'default (fast/firm)'; return sk === 'T' ? ({ fast: 'firm', good: 'good', off: 'yielding/soft' })[g] : ({ fast: 'fast', good: 'good', off: 'sloppy/muddy' })[g]; }
function goingOf(r) { var sk = E.raceSurface(r); var c = S.ui.scn.going[r.date]; if (c && c[sk]) return { v: c[sk], src: 'what-if' };
  var o = S.conds[E.cardOf(r) + '-' + r.date]; if (o && o[sk]) return { v: o[sk], src: 'official' }; return { v: null, src: 'default' }; }
function parseList(v) { return String(v || '').trim().split(/[\s,\-]+/).filter(Boolean).map(function (p) { return p.toUpperCase(); }); }
// Checks program numbers typed for a race: each must be a horse in this race, listed once; activeOnly also requires starter/doubtful status.
function checkPgms(rid, list, activeOnly) {
  var r = S.races.find(function (q) { return q.id === rid; }); if (!r) return 'race not found';
  var st = (S.status[rid] && S.status[rid].map) || {}; var seen = {}, errs = [];
  list.forEach(function (p) { var h = r.horses.find(function (x) { return String(x.pgm).toUpperCase() === p; });
    if (seen[p]) errs.push('#' + p + ' is listed twice'); seen[p] = 1;
    if (!h) errs.push('no horse #' + p + ' in this race');
    else if (activeOnly) { var s0 = st[h.pgm] || h.status; if (s0 !== 'starter' && s0 !== 'doubtful') errs.push('#' + p + ' ' + h.name + ' is marked ' + s0 + ' (change its status first)'); } });
  return errs.length ? errs.join('; ') : null; }
function canonPgm(rid, p) { var r = S.races.find(function (q) { return q.id === rid; }); var h = r && r.horses.find(function (x) { return String(x.pgm).toUpperCase() === p; }); return h ? String(h.pgm) : p; }
function fmtWhen(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return String(iso); try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) + ' ET'; } catch (e) { return String(iso); } }
function lastUpdate() { var best = null; [S.status, S.results, S.live, S.jrpicks, S.conds].forEach(function (m) { Object.keys(m || {}).forEach(function (k) { var t = m[k] && m[k].savedAt; var d = t ? new Date(t) : null; if (d && !isNaN(d) && (!best || d > best)) best = d; }); }); return best ? best.toISOString() : null; }
function nowMinET() { try { var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()); var hh = 0, mm = 0; parts.forEach(function (x) { if (x.type === 'hour') hh = +x.value % 24; if (x.type === 'minute') mm = +x.value; }); return hh * 60 + mm; } catch (e) { return null; } }
function postMin(post) { var m = String(post || '').match(/(\d{1,2}):(\d{2})\s*([AP])M/i); if (!m) return null; var h = +m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0); return h * 60 + (+m[2]); }
function nextRace() { var t = todayET(), now = nowMinET(); if (now == null) return null; var day = S.races.filter(function (r) { return r.date === t && !hasRes(r.id); }).sort(raceSort);
  for (var i = 0; i < day.length; i++) { var pm = postMin(day[i].post); if (pm != null && pm >= now - 20) return day[i]; } return null; }
// ---------- readiness check (kept in this browser only) ----------
var RD_KEY = 'bje-ready-v1';
function loadReady() { var d = { loc: '', app: '', verified: false, funded: false, bankroll: 0, minBet: 2, margin: 0.15 }; try { var v = JSON.parse(localStorage.getItem(RD_KEY) || 'null'); if (v && typeof v === 'object') Object.keys(d).forEach(function (k) { if (v[k] != null) d[k] = v[k]; }); } catch (e) { } d.bankroll = Math.max(0, +d.bankroll || 0); d.minBet = +d.minBet === 1 ? 1 : 2; d.margin = MARGINS.indexOf(+d.margin) >= 0 ? +d.margin : 0.15; return d; }
var MARGINS = [0.03, 0.1, 0.15, 0.25];
function saveReady(d) { try { localStorage.setItem(RD_KEY, JSON.stringify(d)); } catch (e) { } }
function readyDone(d) { return !!(String(d.loc).trim() && String(d.app).trim() && d.verified && d.funded); }
// ---------- post times in the viewer's own time zone ----------
function viewerTZ() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
function etDate(iso, post) { var pm = postMin(post), pp = dParts(iso); if (pm == null || !pp) return null;
  for (var off = 4; off <= 5; off++) { var t = new Date(Date.UTC(pp.y, pp.mon, pp.day, 0, pm + off * 60)); try { var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t); var hh = 0, mm = 0; parts.forEach(function (x) { if (x.type === 'hour') hh = +x.value % 24; if (x.type === 'minute') mm = +x.value; }); if (hh * 60 + mm === pm) return t; } catch (e) { return null; } }
  return null; }
function localPost(r) { var tz = viewerTZ(); if (!tz || tz === 'America/New_York') return ''; var d = etDate(r.date, r.post); if (!d) return ''; try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d); } catch (e) { return ''; } }
// ---------- freshness: a race inside the hour needs scratches and odds updated in the last 30 minutes ----------
function raceStale(r) { if (r.date !== todayET() || hasRes(r.id)) return null; var now = nowMinET(), pm = postMin(r.post); if (now == null || pm == null) return null; var mtp = pm - now; if (mtp > 60 || mtp < -15) return null;
  var last = null; [S.status[r.id], S.live[r.id]].forEach(function (x) { var d = x && x.savedAt ? new Date(x.savedAt) : null; if (d && !isNaN(d) && (!last || d > last)) last = d; });
  var age = last ? Math.round((Date.now() - last.getTime()) / 60000) : null; return (age == null || age > 30) ? { mtp: mtp, age: age } : null; }
function staleTag(r) { var st = raceStale(r); return st ? ' <span class="tag bad" title="Post in ' + st.mtp + ' min; ' + (st.age == null ? 'no scratches or live odds saved yet' : 'last update ' + st.age + ' min ago') + '">stale: update scratches and odds</span>' : ''; }
function payOf(rid) { var x = S.results[rid]; var v = x && x.winPay ? parseFloat(String(x.winPay).replace(/[^0-9.]/g, '')) : NaN; return isFinite(v) && v > 0 ? v : null; }
function hasRes(rid) { var x = S.results[rid]; return !!(x && x.order && x.order.length); }
// ---------- dates ----------
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MONL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dParts(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return null; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return { dow: d.getUTCDay(), mon: +m[2] - 1, day: +m[3], y: +m[1] }; }
function dayShort(r) { var p = dParts(r.date); return p ? DOW[p.dow] : (r.day || ''); }
function dateLong(iso) { var p = dParts(iso); return p ? DOWL[p.dow] + ', ' + MONL[p.mon] + ' ' + p.day : (iso || ''); }
function dateShort(iso) { var p = dParts(iso); return p ? DOW[p.dow] + ' ' + MONL[p.mon] + ' ' + p.day : (iso || ''); }
function todayET() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function addDay(iso, n) { var p = String(iso).split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.toISOString().slice(0, 10); }
function relDay(iso) { var t = todayET(); if (iso === t) return 'today'; if (iso === addDay(t, 1)) return 'tomorrow'; if (iso === addDay(t, -1)) return 'yesterday'; return iso < t ? 'past' : 'ahead'; }
function raceDates() { var d = {}; S.races.forEach(function (r) { d[r.date] = 1; }); return Object.keys(d).sort(); }
var A = {};

// Standard US saddle-cloth colors (program numbers), as printed in the official program.
var CLOTH = { 1: ['#d8262e', '#fff'], 2: ['#ffffff', '#111'], 3: ['#1f4fbf', '#fff'], 4: ['#f2d21b', '#111'], 5: ['#1a7f36', '#fff'], 6: ['#111111', '#f2d21b'], 7: ['#f08a24', '#111'], 8: ['#f5a3c0', '#111'], 9: ['#2ec4c4', '#111'], 10: ['#6b3fa0', '#fff'], 11: ['#b9b9b9', '#8f0b21'], 12: ['#a4d65e', '#111'], 13: ['#6b4226', '#fff'], 14: ['#7a1f2b', '#f2d21b'], 15: ['#c3b091', '#111'], 16: ['#9bb8e3', '#8a0a1f'], 17: ['#1b2a4a', '#fff'], 18: ['#1f4d2b', '#f2d21b'], 19: ['#9fd3ee', '#a00d25'], 20: ['#a01f6a', '#f2d21b'] };
function cloth(p) { return CLOTH[parseInt(p, 10)] || ['#777', '#fff']; }
function chip(p) { var c = cloth(p); return '<span class="chip" style="background:' + c[0] + ';color:' + c[1] + '" title="Program number ' + esc(p) + '">' + esc(p) + '</span>'; }
function svgChip(p, x, y) { var c = cloth(p); return '<rect x="' + x + '" y="' + (y - 9) + '" width="22" height="18" rx="3" fill="' + c[0] + '" stroke="rgba(0,0,0,.3)"/><text x="' + (x + 11) + '" y="' + (y + 4) + '" text-anchor="middle" style="font:700 12px Barlow Condensed,Arial Narrow,sans-serif;fill:' + c[1] + '">' + esc(p) + '</text>'; }

// ---------- data ----------
function raceSort(a, b) { return (a.date || '').localeCompare(b.date || '') || (a.cardRace - b.cardRace); }
function docsToMap(snap) { var m = {}; snap.docs.forEach(function (d) { if (d.exists !== false) m[d.id] = d.data(); }); return m; }
function weightsNow() { return S.ui.what || (S.model && S.model.weights) || E.DEFAULT_WEIGHTS; }
function raceO(r) {
  var o = JSON.parse(JSON.stringify(r));
  var st = S.status[r.id] && S.status[r.id].map;
  if (st) o.horses.forEach(function (h) { if (st[h.pgm]) h.status = st[h.pgm]; });
  var jp = S.jrpicks[r.id];
  if (jp && jp.picks && jp.picks.length) o.jr = { picks: jp.picks.map(String), source: jp.source || 'Entered on this page' };
  return o;
}
var pending = false;
function recompute() {
  A = {};
  var goings = {}, lives = {}, res = {}, hyp = S.ui.scn.hypo || {};
  S.races.forEach(function (r) { var g = goingOf(r).v; if (g) goings[r.id] = g; if (S.live[r.id]) lives[r.id] = S.live[r.id].odds;
    if (hasRes(r.id)) res[r.id] = S.results[r.id]; else if (hyp[r.id] && hyp[r.id].length) res[r.id] = { order: hyp[r.id].map(String), hypo: true }; });
  var objs = S.races.map(raceO);
  try { S.X = E.crossRace(objs, res, { lives: lives, goings: goings, manualBias: S.ui.scn.bias, pace: S.ui.scn.pace, tOffset: S.model && S.model.tOffset }); } catch (e) { console.error('crossRace', e); S.X = null; S.errors.push('cross-race: ' + e.message); }
  try { S.book = E.horseBook(objs, S.results, goings, lives); } catch (e) { console.error('book', e); S.book = {}; }
  S.goings = goings; S.resAll = res;
  objs.forEach(function (o) {
    var live = lives[o.id];
    try { A[o.id] = E.analyze(o, { weights: weightsNow(), live: live, result: S.results[o.id], tOffset: S.model && S.model.tOffset, ctx: S.X && S.X.ctxs[o.id] }); A[o.id].race = o; A[o.id].hypo = (!hasRes(o.id) && res[o.id]) ? res[o.id].order : null; }
    catch (e) { console.error('analyze', o.id, e); }
  });
  if (!pending) { pending = true; requestAnimationFrame(function () { pending = false; render(); }); }
}
function horse(rid, pgm) { var a = A[rid]; return a && a.race.horses.find(function (h) { return h.pgm === pgm; }); }
function raceTitle(r) { return dayShort(r) + ' R' + r.cardRace + ' · ' + r.name; }
function raceShort(r) { return dayShort(r) + ' R' + r.cardRace; }
function activeH(a) { return a.race.horses.filter(E.isActive); }

async function boot() {
  var cl = window.claude;
  if (!cl || !cl.use) { noDb(); return; }
  var res = await Promise.all([cl.use('db'), cl.use('user')]);
  var db = res[0], user = res[1];
  if (!db) { noDb(); return; }
  S.db = db; S.user = user;
  if (user) {
    try { S.canEdit = !!(await user.canEdit()); } catch (e) { S.canEdit = false; }
    try { S.canWrite = await user.can('data.write'); } catch (e) { S.canWrite = null; }
  }
  function sub(coll, fn) { db.collection(coll).onSnapshot(function (snap) { try { fn(snap); } catch (e) { S.errors.push(coll + ': ' + e.message); } if (coll === 'races') S.ready = true; recompute(); }, function (e) { S.errors.push(coll + ': ' + (e.code || e.message)); S.ready = true; render(); }); }
  sub('races', function (s) { S.races = s.docs.filter(function (d) { return d.exists !== false; }).map(function (d) { var x = Object.assign({}, d.data()); x.id = d.id; return x; }).sort(raceSort); });
  sub('status', function (s) { S.status = docsToMap(s); });
  sub('jrpicks', function (s) { S.jrpicks = docsToMap(s); });
  sub('results', function (s) { S.results = docsToMap(s); });
  sub('live', function (s) { S.live = docsToMap(s); });
  sub('jrsheets', function (s) { S.jrsheets = docsToMap(s); });
  sub('model', function (s) { var m = docsToMap(s); S.model = m.current || null; });
  sub('modelhist', function (s) { S.hist = s.docs.map(function (d) { var x = Object.assign({}, d.data()); x.id = d.id; return x; }).sort(function (a, b) { return String(b.savedAt || '').localeCompare(String(a.savedAt || '')); }); });
  sub('reviews', function (s) { S.reviews = s.docs.map(function (d) { var x = Object.assign({}, d.data()); x.id = d.id; return x; }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }); });
  sub('meta', function (s) { var m = docsToMap(s); S.meta = m.card || null; });
  sub('conditions', function (s) { S.conds = docsToMap(s); });
}
function noDb() {
  $('#app').innerHTML = '<div class="empty"><h2>Sign in to see the card</h2><p style="margin:8px auto">The races, Jr\'s sheets and the model live in this page\'s shared database, which loads only for signed-in viewers it is shared with. Sign in to claude.ai and reload.</p></div>';
}
// Every shared path is editor-only (db rules write: admin), so only editors see working save buttons.
function canSave() { return !!(S.db && S.canEdit); }
async function save(coll, id, data, msg) {
  if (!S.db) return false;
  try { await S.db.collection(coll).doc(id).set(data); toast(msg || 'Saved'); return true; }
  catch (e) { toast('Not saved: ' + (e.code === 'invalid_argument' ? 'this account can only view' : (e.message || e.code))); return false; }
}
function toast(t) { var el = $('#toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(function () { el.style.display = 'none'; }, Math.max(2600, Math.min(9000, String(t).length * 55))); }

/*@@plus.js@@*/
// ---------- routing ----------
var LAB_VIEWS = ['forecast', 'races', 'horses', 'horse', 'situations', 'connections', 'factors', 'factor', 'jr', 'model', 'cards', 'data'];
function route() {
  var h = (location.hash || '#home').slice(1);
  var u = S.ui; var m; var anchor = null;
  if ((m = h.match(/^play-([a-z0-9][a-z0-9-]*)$/))) { u.view = 'play'; u.playRace = m[1]; }
  else if (h === 'play') { u.view = 'play'; u.playRace = null; }
  else if (/^how(-[a-z]+)?$/.test(h)) { u.view = 'how'; anchor = h === 'how' ? null : h; }
  else if ((m = h.match(/^horse-([a-z0-9][a-z0-9-]*)-([0-9A-Za-z]+)$/))) { u.view = 'horse'; u.raceId = m[1]; u.pgm = m[2]; }
  else if ((m = h.match(/^race-([a-z0-9][a-z0-9-]*)$/))) { u.view = 'race'; u.raceId = m[1]; }
  else if ((m = h.match(/^factor-(\w+)$/))) { u.view = 'factor'; u.factor = m[1]; }
  else if (['home', 'dashboard', 'forecast', 'races', 'horses', 'situations', 'connections', 'factors', 'jr', 'model', 'results', 'cards', 'data'].indexOf(h) >= 0) u.view = h;
  else u.view = 'home';
  if (LAB_VIEWS.indexOf(u.view) >= 0) u.labOpen = true;
  render();
  var el = anchor && document.getElementById(anchor); if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- formatting ----------
function fmtLen(v) { if (v == null) return '—'; if (v === 0) return 'won'; if (v <= 0.06) return 'nose'; if (v <= 0.11) return 'head'; if (v <= 0.26) return 'neck'; if (v >= 90) return 'far back'; var w = Math.floor(v), f = v - w, fr = f >= 0.7 ? '¾' : f >= 0.45 ? '½' : f >= 0.2 ? '¼' : ''; return (w ? w : '') + fr + (w || fr ? '' : '0'); }
function fmtF(c, v) {
  if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) return '—';
  switch (c.fmt) {
    case '1': return (+v).toFixed(1);
    case 's1': return signed(v, 1);
    case 's0': return v === 0 ? '0' : signed(v, 0);
    case 's1f': return (v > 0 ? '+' : '') + (+v).toFixed(1).replace(/\.0$/, '') + 'f';
    case 'len': return fmtLen(v);
    case 'pct': return Math.round(v * 100) + '%';
    case 'grade': return v ? 'G' + (4 - v) : '—';
    case 'pos': return ordinal(v);
    case 'days': return v + 'd';
    case 'pp': return signed(v, 1) + ' pp';
    case 'odds': return (+v).toFixed(2).replace(/\.00$/, '') + '-1';
    case 'flag': return v ? 'yes' : 'no';
    case 'lvl': return ['other', 'stakes', 'G3', 'G2', 'G1'][v] || String(v);
    case 's2': return (v > 0 ? '+' : '') + (+v).toFixed(2);
    default: return Number.isInteger(+v) ? String(v) : (+v).toFixed(1);
  }
}
function ordinal(n) { n = +n; var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function factor(key) { return E.FACTORS.find(function (f) { return f.key === key; }); }

// ---------- tooltip ----------
var tip = $('#tip');
document.addEventListener('pointermove', function (e) {
  var t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { tip.style.display = 'none'; return; }
  tip.innerHTML = t.getAttribute('data-tip'); tip.style.display = 'block';
  var x = e.clientX + 14, y = e.clientY + 14; var w = tip.offsetWidth, h = tip.offsetHeight;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
});
document.addEventListener('pointerleave', function () { tip.style.display = 'none'; });

// ---------- charts ----------
function probChart(a) {
  var hs = activeH(a).slice().sort(function (x, y) { return a.M.p[y.pgm] - a.M.p[x.pgm]; });
  var rowH = 26, top = 26, left = 196, right = 92, W = 760;
  var maxP = Math.max.apply(null, hs.map(function (h) { return Math.max(a.M.p[h.pgm], a.C.q[h.pgm]); }));
  var xmax = Math.min(1, Math.ceil(maxP * 10 + 0.0001) / 10);
  var H = top + hs.length * rowH + 22; var pw = W - left - right;
  var X = function (p) { return left + pw * p / xmax; };
  var jr = a.race.jr && a.race.jr.picks || [];
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:900px" role="img" aria-label="Win chances, Claude versus market">';
  for (var g = 0; g <= xmax + 1e-9; g += 0.1) { var gx = X(g); s += '<line class="ax" x1="' + gx + '" x2="' + gx + '" y1="' + (top - 6) + '" y2="' + (H - 18) + '" stroke-dasharray="' + (g ? '2 3' : '') + '"/><text class="axt" x="' + gx + '" y="' + (H - 4) + '" text-anchor="middle">' + Math.round(g * 100) + '%</text>'; }
  hs.forEach(function (h, i) {
    var y = top + i * rowH + rowH / 2; var p = a.M.p[h.pgm], q = a.C.q[h.pgm];
    var ji = jr.indexOf(h.pgm);
    var tipTxt = '<b>' + esc(h.name) + '</b><br>Claude ' + pct(p) + ' · market ' + pct(q) + '<br>Edge ' + signed((p - q) * 100) + ' pp · fair odds ' + E.fmtOdds(p) + (ji >= 0 ? '<br>Jr\'s pick #' + (ji + 1) : '');
    s += '<g data-tip="' + esc(tipTxt) + '"><rect x="0" y="' + (y - rowH / 2) + '" width="' + W + '" height="' + rowH + '" fill="transparent"/>';
    s += svgChip(h.pgm, 4, y) + '<text class="lbl" x="32" y="' + (y + 4) + '">' + esc(h.name.length > 22 ? h.name.slice(0, 21) + '…' : h.name) + '</text>';
    s += '<rect x="' + left + '" y="' + (y - 7) + '" width="' + Math.max(2, X(p) - left) + '" height="14" rx="3" fill="var(--s-claude)"/>';
    s += '<rect x="' + (X(q) - 1) + '" y="' + (y - 10) + '" width="2.5" height="20" fill="var(--s-mkt)"/>';
    s += '<text class="lbl" x="' + (Math.max(X(p), X(q)) + 6) + '" y="' + (y + 4) + '" style="font-weight:600">' + pct(p, 0) + '</text>';
    if (ji >= 0) s += '<text x="' + (Math.max(X(p), X(q)) + 44) + '" y="' + (y + 4) + '" style="font:600 11px IBM Plex Sans,sans-serif;fill:var(--s-jr)">Jr ' + (ji + 1) + '</text>';
    s += '</g>';
  });
  s += '<text class="axt" x="' + left + '" y="14">Claude win chance (bar) · market line (blue tick)</text></svg>';
  return s;
}
function legendProb() { return '<div class="legend"><span><i class="sw" style="background:var(--s-claude)"></i>Claude model</span><span><i class="sw tick" style="background:var(--s-mkt)"></i>Market (morning line, or live odds once entered)</span><span style="color:var(--s-jr);font-weight:600">Jr n</span><span>= Jr\'s pick order</span></div>'; }

function divergeChart(rows, title) {
  // rows: {label, pgm, d, sub}
  if (!rows.length) return '<p class="muted">No picks to compare yet.</p>';
  var rowH = 24, top = 24, left = 230, W = 760, right = 40; var H = top + rows.length * rowH + 24;
  var md = Math.max(2, Math.ceil(Math.max.apply(null, rows.map(function (r) { return Math.abs(r.d || 0); })))); var pw = W - left - right;
  var X = function (d) { return left + pw / 2 + (pw / 2) * d / md; };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:900px" role="img" aria-label="' + esc(title) + '">';
  for (var g = -md; g <= md; g++) { var gx = X(g); s += '<line class="ax" x1="' + gx + '" x2="' + gx + '" y1="' + (top - 6) + '" y2="' + (H - 18) + '"' + (g ? ' stroke-dasharray="2 3"' : ' style="stroke:var(--ink2)"') + '/>' + (g % 1 === 0 && (md <= 6 || g % 2 === 0) ? '<text class="axt" x="' + gx + '" y="' + (H - 4) + '" text-anchor="middle">' + (g > 0 ? '+' + g : g) + '</text>' : ''); }
  rows.forEach(function (r, i) {
    var y = top + i * rowH + rowH / 2;
    s += '<g data-tip="' + esc(r.tip || '') + '">' + '<rect x="0" y="' + (y - rowH / 2) + '" width="' + W + '" height="' + rowH + '" fill="transparent"/>';
    s += '<text class="lbl2" x="4" y="' + (y + 4) + '">' + esc(r.sub) + '</text>' + svgChip(r.pgm, 92, y) + '<text class="lbl" x="120" y="' + (y + 4) + '">' + esc(r.label.length > 15 ? r.label.slice(0, 14) + '…' : r.label) + '</text>';
    if (r.d == null) s += '<text class="lbl2" x="' + X(0) + '" y="' + (y + 4) + '" text-anchor="middle">scratched</text>';
    else if (r.d === 0) s += '<circle cx="' + X(0) + '" cy="' + y + '" r="4.5" fill="var(--neutral)" stroke="var(--paper)" stroke-width="2"/>';
    else { var x0 = X(0), x1 = X(r.d); s += '<rect x="' + Math.min(x0, x1) + '" y="' + (y - 7) + '" width="' + Math.abs(x1 - x0) + '" height="14" rx="3" fill="' + (r.d > 0 ? 'var(--s-jr)' : 'var(--s-mkt)') + '"/>'; }
    s += '</g>';
  });
  s += '<text class="axt" x="' + X(-md) + '" y="14">← Jr rates lower than consensus</text><text class="axt" x="' + X(md) + '" y="14" text-anchor="end">Jr rates higher →</text></svg>';
  return s;
}

function waterfall(a, pgm) {
  var hs = activeH(a); var Wn = a.M.weights || {}; var order = ['market', 'experts', 'speed', 'trend', 'g1', 'jrMethod', 'factors', 'situation', 'pace', 'bias', 'keyRace', 'conn', 'jrPicks'].filter(function (k) { return k === 'market' || Wn[k]; });
  var names = { market: 'Market', experts: 'Experts vs market', speed: 'Speed average', trend: 'Speed up/down', g1: 'G1 proximity', jrMethod: 'Jr-method greens', factors: '35-factor greens', situation: 'Situation fit', pace: 'Pace shape', bias: 'Track bias', keyRace: 'Key races', conn: 'Jockey/trainer form', jrPicks: 'Jr\'s picks' };
  var steps = []; var prev = null;
  for (var k = 0; k < order.length; k++) {
    var sum = {}, mx = -1e9; hs.forEach(function (h) { var t = 0; for (var j = 0; j <= k; j++) t += a.M.parts[h.pgm][order[j]] || 0; sum[h.pgm] = t; if (t > mx) mx = t; });
    var tot = 0; hs.forEach(function (h) { tot += Math.exp(sum[h.pgm] - mx); }); var p = Math.exp(sum[pgm] - mx) / tot;
    steps.push({ key: order[k], label: names[order[k]], p: p, d: prev == null ? p : p - prev }); prev = p;
  }
  var rowH = 26, top = 10, left = 150, right = 70, W = 640; var H = top + (steps.length + 1) * rowH + 22; var pw = W - left - right;
  var xmax = Math.min(1, Math.ceil(Math.max.apply(null, steps.map(function (s) { return s.p; })) * 10 + 0.0001) / 10) || 0.1;
  var X = function (p) { return left + pw * p / xmax; };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="How each factor moved this horse\'s win chance">';
  for (var g = 0; g <= xmax + 1e-9; g += 0.05) { var gx = X(g); if (Math.round(g * 100) % 10 === 0 || xmax <= 0.3) s += '<line class="ax" x1="' + gx + '" x2="' + gx + '" y1="' + top + '" y2="' + (H - 18) + '" stroke-dasharray="2 3"/><text class="axt" x="' + gx + '" y="' + (H - 4) + '" text-anchor="middle">' + Math.round(g * 100) + '%</text>'; }
  steps.forEach(function (st, i) {
    var y = top + i * rowH + rowH / 2; var from = i === 0 ? 0 : steps[i - 1].p, to = st.p;
    var col = i === 0 ? 'var(--s-mkt)' : (to >= from ? 'var(--s-claude)' : 'var(--s-jr)');
    var t = '<b>' + st.label + '</b><br>' + (i === 0 ? 'Starting point: ' + pct(to) : signed((to - from) * 100, 1) + ' pp → ' + pct(to));
    s += '<g data-tip="' + esc(t) + '"><rect x="0" y="' + (y - rowH / 2) + '" width="' + W + '" height="' + rowH + '" fill="transparent"/><text class="lbl" x="4" y="' + (y + 4) + '">' + esc(st.label) + '</text>';
    s += '<rect x="' + X(Math.min(from, to)) + '" y="' + (y - 7) + '" width="' + Math.max(1.5, Math.abs(X(to) - X(from))) + '" height="14" rx="2" fill="' + col + '"/>';
    s += '<text class="lbl2" x="' + (X(Math.max(from, to)) + 6) + '" y="' + (y + 4) + '">' + (i === 0 ? pct(to) : signed((to - from) * 100, 1)) + '</text></g>';
    if (i < steps.length - 1) s += '<line x1="' + X(to) + '" x2="' + X(to) + '" y1="' + (y + 7) + '" y2="' + (y + rowH - 7) + '" style="stroke:var(--muted)" stroke-dasharray="2 2"/>';
  });
  var yE = top + steps.length * rowH + rowH / 2; var fin = steps[steps.length - 1].p;
  s += '<text class="lbl" x="4" y="' + (yE + 4) + '" style="font-weight:600">Claude</text><rect x="' + left + '" y="' + (yE - 7) + '" width="' + Math.max(2, X(fin) - left) + '" height="14" rx="3" fill="var(--s-claude)"/><text class="lbl" x="' + (X(fin) + 6) + '" y="' + (yE + 4) + '" style="font-weight:600">' + pct(fin) + '</text></svg>';
  return s;
}

function speedChart(h, f) {
  var rs = (h.races || []).slice(0, 6).filter(function (r) { return r.fig != null; }).reverse();
  if (!rs.length) return '<p class="muted">No speed figures in the free past performances (common for races in France and Japan).</p>';
  var off = (/juvenile/i.test(A[S.ui.raceId].race.name) ? E.T_OFFSET.juvenile : E.T_OFFSET.older);
  var pts = rs.map(function (r) { return { r: r, v: r.ft === 'T' ? r.fig + off : r.fig }; });
  var W = 500, H = 220, l = 34, rgt = 16, t = 18, b = 40; var vs = pts.map(function (p) { return p.v; });
  var lo = Math.floor((Math.min.apply(null, vs) - 4) / 5) * 5, hi = Math.ceil((Math.max.apply(null, vs) + 4) / 5) * 5;
  var X = function (i) { return pts.length === 1 ? (l + (W - l - rgt) / 2) : l + (W - l - rgt) * i / (pts.length - 1); };
  var Y = function (v) { return t + (H - t - b) * (1 - (v - lo) / (hi - lo)); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Speed figures, oldest to latest">';
  for (var g = lo; g <= hi; g += 5) s += '<line class="ax" x1="' + l + '" x2="' + (W - rgt) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" stroke-dasharray="2 3"/><text class="axt" x="' + (l - 6) + '" y="' + (Y(g) + 4) + '" text-anchor="end">' + g + '</text>';
  if (f.avg3 != null) { var n3 = Math.min(3, pts.length); var xa = X(pts.length - n3), xb = X(pts.length - 1); s += '<line x1="' + xa + '" x2="' + xb + '" y1="' + Y(f.avg3) + '" y2="' + Y(f.avg3) + '" style="stroke:var(--s-jr);stroke-width:2" stroke-dasharray="5 4"/><text x="' + (xb + 4) + '" y="' + (Y(f.avg3) - 6) + '" text-anchor="end" style="font:600 11px IBM Plex Sans,sans-serif;fill:var(--s-jr)">3-race avg ' + f.avg3.toFixed(1) + '</text>'; }
  s += '<polyline fill="none" style="stroke:var(--s-claude);stroke-width:2" points="' + pts.map(function (p, i) { return X(i) + ',' + Y(p.v); }).join(' ') + '"/>';
  pts.forEach(function (p, i) {
    var r = p.r; var tt = '<b>' + esc(r.d) + ' ' + esc(r.trk) + '</b><br>' + (r.ft === 'T' ? 'Overseas rating T-' + r.fig + ' → ' + p.v + ' on the US scale' : 'Equibase speed ' + r.fig) + (r.fin ? '<br>Finished ' + ordinal(r.fin) + (r.fin > 1 && r.mg != null ? ', ' + fmtLen(r.mg) + ' back' : '') : '') + (r.gr && /^[123]$/.test(r.gr) ? '<br>Grade ' + r.gr : '');
    s += '<g data-tip="' + esc(tt) + '"><circle cx="' + X(i) + '" cy="' + Y(p.v) + '" r="10" fill="transparent"/><circle cx="' + X(i) + '" cy="' + Y(p.v) + '" r="' + (i === pts.length - 1 ? 5.5 : 4) + '" fill="var(--s-claude)" stroke="var(--paper)" stroke-width="2"/></g>';
    s += '<text class="axt" x="' + X(i) + '" y="' + (H - 22) + '" text-anchor="middle">' + esc(r.d.slice(0, 5)) + '</text><text class="axt" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + (r.ft === 'T' ? 'T' + r.fig : p.v) + '</text>';
  });
  return s + '</svg>';
}

function factorBars(a, key) {
  var c = factor(key); var bf = a.V.byFactor[key]; var hs = a.race.horses.filter(E.isEntered).filter(function (h) { return bf.values[h.pgm] != null; });
  if (!hs.length) return '<p class="muted">No horse in this race has a value for this factor.</p>';
  hs.sort(function (x, y) { return (bf.rank[x.pgm] || 99) - (bf.rank[y.pgm] || 99); });
  var vals = hs.map(function (h) { return +bf.values[h.pgm]; }); var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals)); if (hi === lo) hi = lo + 1;
  var rowH = 24, top = 8, left = 196, right = 70, W = 700; var H = top + hs.length * rowH + 22; var pw = W - left - right;
  var X = function (v) { return left + pw * (v - lo) / (hi - lo); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(c.label) + ' across the field">';
  s += '<line class="ax" x1="' + X(0) + '" x2="' + X(0) + '" y1="' + top + '" y2="' + (H - 18) + '" style="stroke:var(--ink2)"/>';
  hs.forEach(function (h, i) {
    var y = top + i * rowH + rowH / 2; var v = +bf.values[h.pgm]; var g = bf.greens.indexOf(h.pgm) >= 0;
    var t = '<b>' + esc(h.name) + '</b><br>' + esc(c.label) + ': ' + fmtF(c, v) + '<br>Rank ' + (bf.rank[h.pgm] || '—') + ' of ' + bf.n + (g ? ' · green (top third)' : '') + (h.status !== 'starter' ? '<br>' + esc(h.status) : '');
    s += '<g data-tip="' + esc(t) + '"><rect x="0" y="' + (y - rowH / 2) + '" width="' + W + '" height="' + rowH + '" fill="transparent"/>' + svgChip(h.pgm, 4, y) + '<text class="lbl" x="32" y="' + (y + 4) + '">' + esc(h.name.length > 22 ? h.name.slice(0, 21) + '…' : h.name) + (h.status === 'AE' ? ' (AE)' : '') + '</text>';
    s += '<rect x="' + Math.min(X(0), X(v)) + '" y="' + (y - 7) + '" width="' + Math.max(1.5, Math.abs(X(v) - X(0))) + '" height="14" rx="3" fill="' + (g ? 'var(--s-claude)' : 'var(--neutral)') + '"/>';
    s += '<text class="lbl2" x="' + (Math.max(X(0), X(v)) + 6) + '" y="' + (y + 4) + '">' + esc(fmtF(c, v)) + '</text></g>';
  });
  return s + '</svg>';
}

// ---------- shared pieces ----------
function confTag(a) {
  var o = a.M.order; if (o.length < 2) return '';
  var gap = a.M.p[o[0]] - a.M.p[o[1]];
  if (gap >= 0.15) return '<span class="tag good" title="Top choice leads the next by ' + (gap * 100).toFixed(0) + ' points">clear</span>';
  if (gap >= 0.07) return '<span class="tag acc" title="Lead of ' + (gap * 100).toFixed(0) + ' points">lean</span>';
  return '<span class="tag warn" title="Top two within ' + (gap * 100).toFixed(0) + ' points">toss-up</span>';
}
function hLink(rid, pgm, name) { return '<a href="#horse-' + rid + '-' + esc(pgm) + '" class="hname">' + esc(name) + '</a>'; }
function statusTag(h) { if (h.status === 'scratched') return ' <span class="tag bad">scratched</span>'; if (h.status === 'doubtful') return ' <span class="tag warn" title="' + esc(h.note || '') + '">scratch risk</span>'; if (h.status === 'AE') return ' <span class="tag">also-eligible</span>'; return ''; }

// ---------- views ----------
function render() {
  document.querySelectorAll('#tabs a, #lab a, #bnav a').forEach(function (a) { var v = S.ui.view; var map = { race: 'dashboard', horse: 'horses', factor: 'factors' }; var on = a.getAttribute('data-v') === (map[v] || v); a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  var lb = $('#labbtn'), lab = $('#lab'); if (lb && lab) { var inLab = LAB_VIEWS.indexOf(S.ui.view) >= 0; lab.hidden = !(S.ui.labOpen || inLab); lb.setAttribute('aria-expanded', String(!lab.hidden)); lb.classList.toggle('on', inLab); }
  document.querySelectorAll('[data-editor]').forEach(function (el) { el.hidden = !canSave(); });
  var m = $('#hdrmeta');
  if (S.races.length) {
    var nAct = 0, nScr = 0; S.races.forEach(function (r) { var a = A[r.id]; if (!a) return; a.race.horses.forEach(function (h) { if (E.isActive(h)) nAct++; if (h.status === 'scratched') nScr++; }); });
    m.innerHTML = '<span><b>' + S.races.length + '</b> races</span><span><b>' + nAct + '</b> starters · ' + nScr + ' scratched</span><span>Model <b>' + esc((weightsNow().version) || 'v1.0') + (S.ui.what ? ' (what-if)' : '') + '</b></span><span>PPs as of ' + esc((S.meta && S.meta.asOf) || '—') + '</span>' + (lastUpdate() ? '<span>Race-day update <b>' + esc(fmtWhen(lastUpdate())) + '</b></span>' : '');
  }
  var cards = {}; S.races.forEach(function (r) { cards[E.cardOf(r)] = 1; }); var eb = $('#eyebrow'); if (eb && S.races.length) { var ds = raceDates(); eb.textContent = (cards.bc26 ? 'Breeders\' Cup 2026 · Keeneland' : Object.keys(cards).join(' + ')) + (Object.keys(cards).length > 1 && cards.bc26 ? ' + ' + (Object.keys(cards).length - 1) + ' more card' + (Object.keys(cards).length > 2 ? 's' : '') : '') + ' · ' + dateShort(ds[0]).slice(4) + (ds.length > 1 ? ' – ' + dateShort(ds[ds.length - 1]).slice(4) : ''); }
  if (!S.ready) return;
  if (!S.races.length) { $('#app').innerHTML = (S.errors.length ? '<p class="note">Could not load: ' + esc(S.errors.join('; ')) + '</p>' : '') + '<div class="empty"><h2>No races loaded yet</h2><p style="margin:8px auto">The database is empty. Ask Claude to load a race card; it writes one document per race.</p></div>'; return; }
  var v = S.ui.view, html = '';
  try {
    if (v === 'home') html = vHome();
    else if (v === 'play') html = vPlay();
    else if (v === 'how') html = vHow();
    else if (v === 'dashboard') html = vDashboard();
    else if (v === 'races') html = vRaces();
    else if (v === 'race') html = vRace(S.ui.raceId);
    else if (v === 'horse') html = vHorse(S.ui.raceId, S.ui.pgm);
    else if (v === 'horses') html = vHorses();
    else if (v === 'factors') html = vFactors();
    else if (v === 'factor') html = vFactor(S.ui.factor);
    else if (v === 'jr') html = vJr();
    else if (v === 'model') html = vModel();
    else if (v === 'results') html = vResults();
    else if (v === 'data') html = vData();
    else if (v === 'forecast') html = vForecast();
    else if (v === 'situations') html = vSituations();
    else if (v === 'connections') html = vConnections();
    else if (v === 'cards') html = vCards();
  } catch (e) { console.error(e); html = '<div class="empty"><h2>Something broke drawing this view</h2><p class="mono">' + esc(e.message) + '</p></div>'; }
  var sp = scnParts(); if (sp.length) html = '<div class="note scn" style="margin-top:10px">What-if on this screen only: ' + esc(sp.join(' · ')) + ' <button class="btn" data-act="scn-reset">Clear</button> <a href="#forecast">Edit</a></div>' + html;
  if (S.errors.length) html = '<p class="note">Some data could not load: ' + esc(S.errors.join('; ')) + '</p>' + html;
  $('#app').innerHTML = html;
  document.querySelectorAll('#app [data-go]').forEach(function (el) { el.tabIndex = 0; el.setAttribute('role', 'link'); });
}

function vDashboard() {
  var dates = raceDates(); var jrRaces = S.races.filter(function (r) { return A[r.id] && A[r.id].D; });
  var agree = jrRaces.filter(function (r) { return A[r.id].D.topAgree; }).length;
  var graded = S.races.filter(function (r) { return A[r.id] && A[r.id].G; });
  var claudeHits = graded.filter(function (r) { return A[r.id].G.claude.top1; }).length, consHits = graded.filter(function (r) { return A[r.id].G.consensus.top1; }).length;
  var h = '<h2>The card at a glance</h2><p class="ink2">Claude\'s model starts from the market and moves it with expert picks, speed figures, G1 form, Jr\'s method and 40 factors per horse. Click any race or horse to drill in.</p>';
  h += '<div class="grid g4" style="margin:12px 0">' +
    kpi(S.races.length, 'races', dates.map(function (d) { return S.races.filter(function (r) { return r.date === d; }).length + ' ' + dateShort(d).split(' ')[0]; }).join(', ')) +
    kpi(jrRaces.length, 'races Jr has picked', 'his top pick matches the market favorite in ' + agree) +
    kpi(E.FACTORS.length, 'factors per horse', 'all required · the top third of each field goes green') +
    (function () { var pr = preRecord(); return pr.n ? kpi(pr.w + '/' + pr.n, 'races won by Claude\'s pre-race pick', 'the race-day engine\'s picks (v1.1) · refit model in hindsight ' + claudeHits + '/' + graded.length + ' · market favorite ' + consHits + '/' + graded.length) : kpi(graded.length ? (claudeHits + '/' + graded.length) : '—', 'races won by Claude\'s top pick', graded.length ? 'market favorite: ' + consHits + '/' + graded.length : 'results arrive after each race day'); })() + '</div>';
  var fd = defaultFday(); if (fd) { var fr = S.races.filter(function (r) { return r.date === fd; }); var fdone = S.races.filter(function (r) { return r.date <= fd && hasRes(r.id); }).length; var rl = relDay(fd);
    h += '<a class="panel" href="#forecast" style="display:block;text-decoration:none;color:inherit;margin-bottom:12px;border-left:4px solid var(--s-claude)"><div class="eyebrow">Forecast</div><b style="font:600 18px var(--f-display)">' + esc(dateLong(fd)) + (rl === 'today' || rl === 'tomorrow' ? ' (' + rl + ')' : '') + ': ' + fr.length + ' races</b><div class="small ink2">Projected from the full model plus what earlier races show (bias by surface, key races, going, pace). Fed by ' + fdone + ' result' + (fdone === 1 ? '' : 's') + ' so far; it updates as each one is entered. Open the forecast →</div></a>'; }
  var nx = nextRace(); if (nx && A[nx.id] && A[nx.id].M.order.length) { var an = A[nx.id], pn = an.M.order[0], fn = an.C.order[0], hn = horse(nx.id, pn), hfn = horse(nx.id, fn);
    h += '<a class="panel" href="#race-' + nx.id + '" style="display:block;text-decoration:none;color:inherit;margin-bottom:12px;border-left:4px solid var(--s-mkt)"><div class="eyebrow">Next post</div><b style="font:600 18px var(--f-display)">' + esc(raceTitle(nx)) + ' · ' + esc(nx.post) + ' ET' + (localPost(nx) ? ' (' + esc(localPost(nx)) + ' your time)' : '') + '</b>' + staleTag(nx) + '<div class="small ink2">Claude\'s top pick ' + chip(pn) + ' ' + esc(hn ? hn.name : pn) + ' (' + pct(an.M.p[pn], 0) + ') · market favorite ' + chip(fn) + ' ' + esc(hfn ? hfn.name : fn) + ' (' + pct(an.C.q[fn], 0) + ')' + (an.D ? ' · Jr has picked it' : '') + (E.expertTop(an.C) ? ' · experts\' pick ' + chip(E.expertTop(an.C)) : '') + '. Mark late scratches and live odds under Race-day updates, then open Bet check →' + (readyDone(loadReady()) ? '' : '<br><b>Before betting:</b> finish the readiness check in the race\'s Bet check tab (location, licensed app, verified, funded).') + '</div></a>'; }
  h += '<div class="tw"><table><thead><tr><th>Race</th><th>Post (ET)</th><th title="On finished races: the pick the race-day engine (v1.1) made before the result">Claude\'s pick</th><th style="min-width:150px" class="hide-sm">Win chance</th><th>Market favorite</th><th title="Most published expert win picks" class="hide-sm">Experts</th><th class="hide-sm">Jr\'s top</th><th class="r hide-sm" title="Average rank gap between Jr\'s picks and the consensus">Jr gap</th><th class="hide-sm">Read</th><th>Result</th></tr></thead><tbody>';
  S.races.forEach(function (r) {
    var a = A[r.id]; if (!a) return; var o = a.M.order; var p = o[0]; var hp = horse(r.id, p); var fav = a.C.order[0]; var hf = horse(r.id, fav);
    if (!hp || !hf) { h += '<tr class="click" data-go="race-' + r.id + '"><td><b>' + esc(raceShort(r)) + '</b> ' + esc(r.name) + '</td><td class="num">' + esc(r.post) + '</td><td colspan="8" class="muted small">No starters left (every horse is marked scratched or AE)</td></tr>'; return; }
    var jt = a.race.jr && a.race.jr.picks && a.race.jr.picks[0]; var et = E.expertTop(a.C); var lp = localPost(r);
    var pre0 = S.results[r.id] && S.results[r.id].pre; var lk = pre0 && pre0.top && horse(r.id, String(pre0.top)) ? String(pre0.top) : null;
    var sp = lk || p, hs = horse(r.id, sp), spP = lk ? (pre0.p != null ? +pre0.p : null) : a.M.p[p];
    h += '<tr class="click" data-go="race-' + r.id + '"><td><b>' + esc(raceShort(r)) + '</b> ' + esc(r.name) + staleTag(r) + '</td><td class="num">' + esc(r.post) + (lp ? '<br><span class="small muted">' + esc(lp) + '</span>' : '') + '</td><td>' + chip(sp) + ' ' + esc(hs.name) + (lk ? '<br><span class="small muted">locked ' + esc(pre0.version || '') + (lk !== p ? ' · refit now: #' + esc(p) : '') + '</span>' : '') + '</td>' +
      '<td class="hide-sm">' + (spP != null ? '<div class="bar" data-tip="' + esc('Claude ' + (lk ? '(locked) ' : '') + pct(spP) + ' · market ' + pct(a.C.q[sp])) + '"><i style="width:' + (spP * 100).toFixed(1) + '%"></i><u style="left:' + (a.C.q[sp] * 100).toFixed(1) + '%"></u></div><span class="small num">' + pct(spP, 0) + ' <span class="muted">vs ' + pct(a.C.q[sp], 0) + '</span></span>' : '<span class="muted small">—</span>') + '</td>' +
      '<td>' + chip(fav) + ' <span class="small">' + esc(hf.ml) + '</span>' + (fav !== sp ? ' <span class="tag warn" title="Claude\'s pick differs from the market favorite">differs</span>' : '') + '</td>' +
      '<td class="hide-sm">' + (et ? chip(et) : '<span class="muted small">—</span>') + '</td>' +
      '<td class="hide-sm">' + (jt ? chip(jt) : '<span class="muted small">—</span>') + '</td><td class="r num hide-sm">' + (a.D && a.D.index != null ? a.D.index.toFixed(1) : '—') + '</td><td class="hide-sm">' + confTag(a) + '</td><td>' + resultCell(r, sp, nx) + '</td></tr>';
  });
  h += '</tbody></table></div>' + '<p class="small muted" style="margin-top:6px">On finished races Claude\'s pick and chance are the ones locked on race day (v1.1); "refit now" shows where today\'s refit model, tuned on these same results, would land. Bar = Claude\'s win chance; blue tick = market. "Jr gap" = average number of places between Jr\'s ranking and the consensus, over his picks.</p>';
  // displacement chart
  var rows = [];
  jrRaces.forEach(function (r) { var a = A[r.id]; a.D.rows.forEach(function (x) { var hh = horse(r.id, x.pgm); rows.push({ sub: raceShort(r) + ' #' + x.jr, pgm: x.pgm, label: hh ? hh.name : x.pgm, d: x.d, tip: '<b>' + esc(hh ? hh.name : x.pgm) + '</b><br>Jr ranks ' + ordinal(x.jr) + ', consensus ' + (x.cons != null ? ordinal(Math.round(x.cons)) : 'n/a (scratched)') + (x.d != null ? '<br>Gap ' + signed(x.d, 1) + ' places' : '') }); }); });
  h += '<h2>The displacement: Jr versus the consensus</h2><p class="ink2">Each bar is one of Jr\'s picks: his rank against the consensus rank (morning-line order, with expert picks breaking ties). Orange means Jr rates the horse higher than the consensus; blue means lower; a dot means they agree.</p><div class="panel">' + divergeChart(rows, 'Jr versus consensus, by pick') + '</div>';
  // biggest edges
  var edges = [];
  S.races.forEach(function (r) { var a = A[r.id]; if (!a) return; activeH(a).forEach(function (hh) { var p = a.M.p[hh.pgm], q = a.C.q[hh.pgm]; if (p >= 0.05) edges.push({ r: r, h: hh, p: p, q: q, e: p - q }); }); });
  edges.sort(function (x, y) { return y.e - x.e; });
  h += '<h2>Where the model moves most from the market</h2><div class="grid g2"><div class="tw"><table><thead><tr><th>Above the market</th><th class="r">Claude</th><th class="r">Market</th><th class="r">Edge</th></tr></thead><tbody>' + edges.slice(0, 8).map(edgeRow).join('') + '</tbody></table></div>' +
    '<div class="tw"><table><thead><tr><th>Below the market</th><th class="r">Claude</th><th class="r">Market</th><th class="r">Edge</th></tr></thead><tbody>' + edges.slice(-8).reverse().map(edgeRow).join('') + '</tbody></table></div></div>';
  h += '<p class="note" style="margin-top:14px">Decision support, not betting advice. Every win chance here is an estimate built on public data and the morning line; live odds will differ, and a 30% horse loses 7 times in 10.</p>';
  return h;
}
function preRecord() { var n = 0, w = 0; S.races.forEach(function (r) { var x = S.results[r.id]; if (!hasRes(r.id) || !x.pre || !x.pre.top) return; var win = canonWinner(r.id); if (!win) return; n++; if (String(x.pre.top) === win) w++; }); return { n: n, w: w }; }
function resultCell(r, p, nx) { if (hasRes(r.id)) { var w = canonWinner(r.id); var pre = S.results[r.id].pre; var cmp = pre && pre.top ? String(pre.top) : p; return w ? chip(w) + (w === cmp ? ' <span class="tag good">' + (pre && pre.top ? 'race-day pick won' : 'top pick won') + '</span>' : '') : '<span class="tag warn">check result</span>'; } return nx && nx.id === r.id ? '<span class="tag acc">next</span>' : '<span class="muted small">—</span>'; }
function canonWinner(rid) { var a = A[rid]; var o = S.results[rid] && S.results[rid].order; if (!a || !o || !o.length) return null; var w = String(o[0]).trim(); return activeH(a).some(function (hh) { return String(hh.pgm) === w; }) ? w : null; }
function kpi(v, l, s) { return '<div class="panel kpi"><b class="num">' + esc(v) + '</b><span><b style="font:600 13px var(--f-body);color:var(--ink)">' + esc(l) + '</b><br>' + esc(s) + '</span></div>'; }
function edgeRow(x) { return '<tr class="click" data-go="horse-' + x.r.id + '-' + x.h.pgm + '"><td>' + chip(x.h.pgm) + ' ' + esc(x.h.name) + ' <span class="muted small">' + esc(raceShort(x.r)) + '</span></td><td class="r num">' + pct(x.p) + '</td><td class="r num">' + pct(x.q) + '</td><td class="r num" style="color:' + (x.e >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + signed(x.e * 100, 1) + '</td></tr>'; }

function vRaces() {
  var h = '<h2>Races</h2><div class="grid g2">';
  S.races.forEach(function (r) {
    var a = A[r.id]; if (!a) return; var o = a.M.order.slice(0, 3);
    h += '<a class="panel" style="text-decoration:none;color:inherit;display:block" href="#race-' + r.id + '"><div class="eyebrow">' + esc(dateLong(r.date)) + ' · Race ' + r.cardRace + ' · ' + esc(r.post) + ' ET</div><h3 style="margin:4px 0 6px">' + esc(r.name) + '</h3><div class="small ink2">' + esc(r.distance) + ' ' + esc(r.surface) + ' · ' + activeH(a).length + ' starters ' + confTag(a) + '</div><div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">' +
      o.map(function (p, i) { var hh = horse(r.id, p); return '<div>' + chip(p) + ' ' + esc(hh.name) + ' <span class="num small muted">' + pct(a.M.p[p], 0) + '</span></div>'; }).join('') + '</div></a>';
  });
  return h + '</div>';
}

function raceNav(rid) {
  var i = S.races.findIndex(function (r) { return r.id === rid; }); var p = S.races[i - 1], n = S.races[i + 1];
  return '<div class="filters"><select aria-label="Choose race" onchange="location.hash=\'race-\'+this.value">' + S.races.map(function (r) { return '<option value="' + r.id + '"' + (r.id === rid ? ' selected' : '') + '>' + esc(raceTitle(r)) + '</option>'; }).join('') + '</select>' +
    (p ? '<a class="btn" href="#race-' + p.id + '">← ' + esc(p.day + ' R' + p.cardRace) + '</a>' : '') + (n ? '<a class="btn" href="#race-' + n.id + '">' + esc(n.day + ' R' + n.cardRace) + ' →</a>' : '') + '</div>';
}
function vRace(rid) {
  var a = A[rid]; if (!a) return '<div class="empty">Race not found.</div>'; var r = a.race;
  if (S.ui.raceTab === 'edit' && !canSave()) S.ui.raceTab = 'overview';
  var t = S.ui.raceTab;
  var h = raceNav(rid) + '<div class="racehead"><span class="rn">R' + r.cardRace + '</span><div><h2 style="margin:0">' + esc(r.name) + '</h2><div class="ink2 small">' + esc(dateLong(r.date)) + ' · ' + esc(r.post) + ' ET' + (localPost(r) ? ' (' + esc(localPost(r)) + ' your time)' : '') + ' · ' + esc(r.distance) + ' ' + esc(r.surface) + ' · ' + esc(r.grade || '') + ' ' + esc(r.purse || '') + ' · ' + activeH(a).length + ' starters ' + confTag(a) + (a.M.mixedScale ? ' <span class="tag warn" title="This field mixes US speed figures with overseas ratings; the speed weight is halved">mixed figure scales</span>' : '') + (a.C.source === 'Live odds' ? ' <span class="tag acc">live odds</span>' : '') + staleTag(r) + '</div></div></div>';
  var tabs = [['overview', 'Overview'], ['situation', 'Situation & pace'], ['horses', 'Horse by horse'], ['matrix', 'Factor matrix'], ['jr', 'Jr vs consensus'], ['exotics', 'Exactas & trifectas'], ['bets', 'Bet check']].concat(canSave() ? [['edit', 'Race-day updates']] : []);
  h += raceCalls(r);
  h += '<div class="subtabs">' + tabs.map(function (x) { return '<button class="' + (t === x[0] ? 'on' : '') + '" data-rt="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
  if (t === 'overview') h += raceOverview(a);
  else if (t === 'horses') h += raceHorses(a);
  else if (t === 'matrix') h += raceMatrix(a);
  else if (t === 'jr') h += raceJr(a);
  else if (t === 'exotics') h += raceExotics(a);
  else if (t === 'edit') h += raceEdit(a);
  else if (t === 'bets') h += raceBets(a);
  else if (t === 'situation') h += raceSituation(a);
  return h;
}
function raceOverview(a) {
  var r = a.race; var hs = activeH(a).slice().sort(function (x, y) { return a.M.p[y.pgm] - a.M.p[x.pgm]; });
  var top = hs[0];
  var fin = hasRes(r.id);
  var h = (fin ? '<p class="small muted">This race is official. The numbers below come from today\'s refit model (' + esc(weightsNow().version || '') + '), which was tuned on these results: read them as hindsight. The race-day call is in the strip above.</p>' : '') + '<p><b>' + esc(top.name) + (fin ? ' tops the refit model at ' : ' is Claude\'s top choice at ') + pct(a.M.p[top.pgm], 0) + '</b> (market ' + pct(a.C.q[top.pgm], 0) + ', fair odds ' + E.fmtOdds(a.M.p[top.pgm]) + '). Market favorite: ' + esc(horse(r.id, a.C.order[0]).name) + '.' + (r.jr ? ' Jr\'s picks: ' + r.jr.picks.map(function (p) { var hh = horse(r.id, p); return esc(p) + ' ' + esc(hh ? hh.name : '?') + (hh && hh.status === 'scratched' ? ' (scratched)' : ''); }).join(', ') + '.' : (fin ? ' Jr didn\'t play this race.' : ' Jr has not picked this race yet.')) + '</p>';
  if (a.race.jr && a.M0 && a.M0.order[0] !== a.M.order[0]) h += '<p class="note">Jr\'s picks are one small input to the model, and here they decide the top spot: with them switched off, the top choice would be ' + esc(horse(r.id, a.M0.order[0]).name) + ' (' + pct(a.M0.p[a.M0.order[0]], 0) + ' vs ' + pct(a.M0.p[a.M.order[0]], 0) + ').</p>';
  r.horses.filter(function (x) { return x.status === 'doubtful'; }).forEach(function (d) {
    var alt = JSON.parse(JSON.stringify(r)); alt.horses.forEach(function (x) { if (x.pgm === d.pgm) x.status = 'scratched'; });
    var b = E.analyze(alt, { weights: weightsNow(), live: S.live[r.id] && S.live[r.id].odds, tOffset: S.model && S.model.tOffset });
    h += '<p class="note">' + esc(d.name) + ' (#' + esc(d.pgm) + ') is a scratch risk' + (d.note ? ': ' + esc(d.note) : '.') + ' If he scratches: ' + b.M.order.slice(0, 3).map(function (p) { return esc(horse(r.id, p).name) + ' ' + pct(b.M.p[p], 0); }).join(', ') + '.</p>';
  });
  var g0 = goingOf(r); var nRefs = activeH(a).filter(function (x) { return a.ctx && a.ctx.keyRefs && a.ctx.keyRefs[x.pgm] && a.ctx.keyRefs[x.pgm].length; }).length;
  h += '<p class="small">Situation: ' + esc(SURF_NAME[E.raceSurface(r)] + ' ' + goingLabel(E.raceSurface(r), g0.v || 'fast')) + (g0.src === 'what-if' ? ' (what-if)' : (g0.src === 'official' ? ' (official)' : '')) + ' · ' + shapeTag(a.P) + ' · ' + (a.ctx && a.ctx.bias && a.ctx.bias.n ? 'bias from ' + a.ctx.bias.n + ' earlier race(s) on this surface' : 'no bias readings yet') + ' · ' + nRefs + ' horse(s) with key-race links' + (a.hypo ? ' · <span class="tag warn">hypothetical result entered</span>' : '') + ' · <a href="#" data-rt="situation">Situation &amp; pace →</a></p>';
  h += '<div class="panel">' + legendProb() + probChart(a) + '</div>';
  h += '<h3>The field</h3><div class="tw"><table><thead><tr><th>#</th><th>Horse</th><th>ML</th><th class="r">Market</th><th class="r">Claude</th><th class="r">Fair odds</th><th class="r">Edge</th><th class="r" title="Greens on the Jr-method categories (Equibase data)">Jr-method</th><th class="r" title="Factor greens out of 40 (all required)">40-factor</th><th class="r">3-race avg</th><th class="r">Up/down</th><th class="r">Experts</th><th>Jr</th><th>Trainer / jockey</th></tr></thead><tbody>';
  r.horses.slice().sort(function (x, y) { return byNum(x.pgm, y.pgm); }).forEach(function (hh) {
    var act = E.isActive(hh); var f = a.F[hh.pgm]; var p = a.M.p[hh.pgm], q = a.C.q[hh.pgm]; var ji = r.jr ? r.jr.picks.indexOf(hh.pgm) : -1;
    h += '<tr class="click' + (act ? '' : ' dim') + '" data-go="horse-' + r.id + '-' + hh.pgm + '"><td>' + chip(hh.pgm) + '</td><td>' + esc(hh.name) + statusTag(hh) + '</td><td class="num">' + esc(hh.ml) + '</td><td class="r num">' + (act ? pct(q) : '—') + '</td><td class="r num"><b>' + (act ? pct(p) : '—') + '</b></td><td class="r num">' + (act ? E.fmtOdds(p) : '—') + '</td><td class="r num" style="color:' + (act && p >= q ? 'var(--good)' : 'var(--bad)') + '">' + (act ? signed((p - q) * 100, 1) : '') + '</td>' +
      '<td class="r num">' + (a.J.counts[hh.pgm] != null ? a.J.counts[hh.pgm] : '—') + '</td><td class="r num">' + (E.isActive(hh) && a.V.all[hh.pgm] != null ? a.V.all[hh.pgm] + ' / 40' : '—') + '</td><td class="r num">' + (f.avg3 != null ? f.avg3.toFixed(1) : '—') + '</td><td class="r num">' + (f.trend != null ? signed(f.trend, 1) : '—') + '</td><td class="r num">' + (f.exW || '') + (f.exV ? ' <span class="muted">+' + f.exV + 'v</span>' : '') + '</td><td>' + (ji >= 0 ? '<span class="hly" style="padding:0 5px;font-weight:700">' + (ji + 1) + '</span>' : '') + '</td><td class="small ink2">' + esc(titleCase(hh.trainer)) + ' / ' + esc(titleCase(hh.jockey)) + '</td></tr>';
  });
  h += '</tbody></table></div><p class="small muted">Edge = Claude minus market, in percentage points. Market = morning line with the track\'s cut removed (overround ' + a.C.overround.toFixed(2) + ').</p>';
  return h;
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); }).replace(/\b(Ii|Iii|Iv)\b/g, function (m) { return m.toUpperCase(); }).replace(/\bMc([a-z])/g, function (m, c) { return 'Mc' + c.toUpperCase(); }).replace(/\bO'([a-z])/g, function (m, c) { return "O'" + c.toUpperCase(); }); }
function raceHorses(a) {
  var r = a.race; var hs = r.horses.filter(E.isEntered).slice().sort(function (x, y) { return (a.M.p[y.pgm] || -1) - (a.M.p[x.pgm] || -1); });
  return '<div class="grid g2">' + hs.map(function (hh) {
    var f = a.F[hh.pgm]; var greens = E.FACTORS.filter(function (c) { return a.V.byFactor[c.key].greens.indexOf(hh.pgm) >= 0; });
    return '<a class="panel" style="text-decoration:none;color:inherit;display:block" href="#horse-' + r.id + '-' + hh.pgm + '"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div>' + chip(hh.pgm) + ' <b>' + esc(hh.name) + '</b>' + statusTag(hh) + '</div><div class="num"><b>' + (E.isActive(hh) ? pct(a.M.p[hh.pgm], 0) : '—') + '</b> <span class="muted small">ML ' + esc(hh.ml) + '</span></div></div>' +
      '<div class="small ink2" style="margin-top:6px">Last 3 speed: ' + (f.last3raw.length ? esc(f.last3raw.join(' · ')) : '—') + ' · avg ' + (f.avg3 != null ? f.avg3.toFixed(1) : '—') + ' (' + signed(f.trend, 1) + ')</div>' +
      '<div class="small" style="margin-top:6px">Top four in ' + greens.length + ' of 35: ' + greens.slice(0, 8).map(function (c) { return '<span class="hl" style="padding:0 4px">' + esc(c.label) + '</span>'; }).join(' ') + (greens.length > 8 ? ' …' : '') + '</div></a>';
  }).join('') + '</div>';
}
function raceMatrix(a) {
  var r = a.race; var hs = r.horses.filter(E.isEntered).slice().sort(function (x, y) { return byNum(x.pgm, y.pgm); });
  var h = '<div class="filters"><span class="small muted">All 40 factors are required. Green = the top third of the starters on that factor (at most ' + a.V.k + ' here); a tie that would add more than one extra horse stays white, so green always means the horse stands out. Missing data ranks last and is never green; zero counts are never green. Also-eligibles are shown but not ranked. Click a factor for the field chart.</span></div>';
  h += '<div class="tw"><table class="matrix"><thead><tr><th class="f">Factor</th>' + hs.map(function (hh) { return '<th class="c"><a href="#horse-' + r.id + '-' + hh.pgm + '" title="' + esc(hh.name) + '">' + chip(hh.pgm) + '</a></th>'; }).join('') + '</tr></thead><tbody>';
  var grp = null;
  E.FACTORS.forEach(function (c) {
    if (c.group !== grp) { grp = c.group; h += '<tr class="grp"><td colspan="' + (hs.length + 1) + '">' + esc(grp) + '</td></tr>'; }
    var bf = a.V.byFactor[c.key];
    h += '<tr><td class="f"><a class="flink" href="#factor-' + c.key + '" data-tip="' + esc(c.desc) + '">' + esc(c.label) + '</a></td>' + hs.map(function (hh) { var v = bf.values[hh.pgm]; var g = bf.greens.indexOf(hh.pgm) >= 0; return '<td' + (g ? ' class="hl"' : '') + ' data-tip="' + esc('<b>' + hh.name + '</b><br>' + c.label + ': ' + fmtF(c, v) + (bf.rank[hh.pgm] ? '<br>Rank ' + bf.rank[hh.pgm] + ' of ' + bf.n : '')) + '">' + esc(fmtF(c, v)) + '</td>'; }).join('') + '</tr>';
  });
  h += '<tr class="grp"><td colspan="' + (hs.length + 1) + '">Totals</td></tr>';
  h += '<tr><td class="f">Jr-method greens (10)</td>' + hs.map(function (hh) { return '<td><b>' + (a.J.counts[hh.pgm] || 0) + '</b></td>'; }).join('') + '</tr>';
  h += '<tr><td class="f">Greens, all 40</td>' + hs.map(function (hh) { return '<td class="hly"><b>' + a.V.all[hh.pgm] + '</b></td>'; }).join('') + '</tr>';
  h += '<tr><td class="f">Greens, 35 non-market (model)</td>' + hs.map(function (hh) { return '<td><b>' + a.V.form[hh.pgm] + '</b></td>'; }).join('') + '</tr>';
  h += '<tr><td class="f">Claude win chance</td>' + hs.map(function (hh) { return '<td>' + (E.isActive(hh) ? pct(a.M.p[hh.pgm], 0) : (hh.status === 'AE' ? 'AE' : '—')) + '</td>'; }).join('') + '</tr>';
  return h + '</tbody></table></div>';
}
function raceJr(a) {
  var r = a.race; var h = '';
  if (r.jr && a.D) {
    h += '<p>Jr picked <b>' + r.jr.picks.join(' – ') + '</b>. ' + (a.D.topAgree ? 'His top pick is also the consensus favorite.' : 'His top pick is not the consensus favorite (' + esc(horse(r.id, a.C.order[0]).name) + ').') + ' ' + a.D.overlap + ' of his ' + a.D.k + ' picks are in the consensus top ' + a.D.k + '. Average gap: ' + (a.D.index != null ? a.D.index.toFixed(1) : '—') + ' places.</p>';
    h += '<div class="tw"><table><thead><tr><th>Jr\'s order</th><th>Horse</th><th class="r">Consensus rank</th><th class="r">Gap</th><th class="r">Market</th><th class="r">Claude</th><th class="r">Jr-method greens</th></tr></thead><tbody>' + a.D.rows.map(function (x) { var hh = horse(r.id, x.pgm); return '<tr><td><b>' + x.jr + '</b></td><td>' + chip(x.pgm) + ' ' + esc(hh ? hh.name : x.pgm) + (hh ? statusTag(hh) : '') + '</td><td class="r num">' + (x.cons != null ? (x.cons % 1 ? x.cons.toFixed(1) : x.cons) : '—') + '</td><td class="r num">' + (x.d != null ? signed(x.d, 1) : '—') + '</td><td class="r num">' + pct(a.C.q[x.pgm]) + '</td><td class="r num">' + pct(a.M.p[x.pgm]) + '</td><td class="r num">' + (a.J.counts[x.pgm] != null ? a.J.counts[x.pgm] : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  } else h += '<p class="muted">Jr has not picked this race. Add his picks under Race-day updates and the comparison fills in.</p>';
  h += '<h3>Jr\'s method on the free Equibase data</h3><p class="ink2">The same rules as his sheet (best four values green, count the greens, leave out also-eligibles) applied to ten categories the official PPs carry. Ranking: <b>' + a.J.order.slice(0, 4).map(function (p) { return esc(p); }).join(' – ') + '</b>.</p>';
  h += '<div class="tw"><table class="matrix"><thead><tr><th class="f">Category</th>' + a.race.horses.filter(E.isEntered).sort(function (x, y) { return byNum(x.pgm, y.pgm); }).map(function (hh) { return '<th class="c">' + chip(hh.pgm) + '</th>'; }).join('') + '</tr></thead><tbody>';
  var hs = a.race.horses.filter(E.isEntered).sort(function (x, y) { return byNum(x.pgm, y.pgm); });
  a.J.cats.forEach(function (c) { var fc = factor(c.key === 'form' ? 'formW3' : c.key === 'surf' ? 'surfWins' : c.key === 'dist' ? 'distWins' : c.key) || { fmt: 'num' }; h += '<tr><td class="f" data-tip="' + esc(c.desc) + '">' + esc(c.label) + '</td>' + hs.map(function (hh) { var v = c.values[hh.pgm]; return '<td' + (c.greens.indexOf(hh.pgm) >= 0 ? ' class="hl"' : '') + '>' + esc(fmtF(c.key === 'works' ? { fmt: 'pct' } : fc, v)) + '</td>'; }).join('') + '</tr>'; });
  h += '<tr><td class="f"><b>Greens</b></td>' + hs.map(function (hh) { return '<td class="hly"><b>' + (a.J.counts[hh.pgm] || 0) + '</b></td>'; }).join('') + '</tr></tbody></table></div>';
  var sheet = S.jrsheets[r.id]; if (sheet) h += '<h3>Jr\'s own sheet for this race</h3>' + jrSheetTable(sheet, r.id) + '<p class="small"><a href="#jr">Full decode of every row →</a></p>';
  return h;
}
function raceExotics(a) {
  var r = a.race;
  function rowsOf(list) { return list.map(function (x) { return '<tr><td>' + x.c.map(function (p) { return chip(p); }).join(' ') + '</td><td class="small">' + x.c.map(function (p) { return esc(horse(r.id, p).name); }).join(' / ') + '</td><td class="r num">' + pct(x.p) + '</td><td class="r num">$' + (2 / x.p).toFixed(2) + '</td></tr>'; }).join(''); }
  return '<p class="ink2">Chances for the likeliest finishing orders, from Claude\'s win chances by the Harville method (it tends to overrate favorites for second and third). "Fair $2 payoff" is the payout at which a $2 ticket breaks even over time.</p><div class="grid g2"><div class="tw"><table><thead><tr><th colspan="2">Exacta (1st–2nd)</th><th class="r">Chance</th><th class="r">Fair $2</th></tr></thead><tbody>' + rowsOf(a.X.exacta) + '</tbody></table></div><div class="tw"><table><thead><tr><th colspan="2">Trifecta (1st–2nd–3rd)</th><th class="r">Chance</th><th class="r">Fair $2</th></tr></thead><tbody>' + rowsOf(a.X.trifecta) + '</tbody></table></div></div>';
}
function readyBlock() { var d = loadReady(); var done = readyDone(d);
  return '<div class="panel" style="margin:10px 0"><h3 style="margin-top:0">Before you bet ' + (done ? '<span class="tag good">ready</span>' : '<span class="tag warn">not finished</span>') + '</h3><p class="small ink2">Kept in this browser only. Use a racing app licensed where you are, verified and funded before the first post. (When this card ran, prediction markets such as Kalshi did not list U.S. horse racing.)</p>' +
    '<div class="filters"><input type="text" data-rd="loc" placeholder="Your state or country" value="' + esc(d.loc) + '" size="16" aria-label="Your state or country"><input type="text" data-rd="app" placeholder="Licensed racing app" value="' + esc(d.app) + '" size="18" aria-label="Licensed racing app">' +
    '<label class="small"><input type="checkbox" data-rd="verified"' + (d.verified ? ' checked' : '') + '> account verified</label><label class="small"><input type="checkbox" data-rd="funded"' + (d.funded ? ' checked' : '') + '> funded</label></div>' +
    '<div class="filters"><label class="small">Bankroll $ <input type="text" inputmode="decimal" data-rd="bankroll" value="' + (d.bankroll || '') + '" size="8" aria-label="Bankroll in dollars"></label><label class="small">Minimum bet <select data-rd="minBet" aria-label="Minimum bet"><option value="2"' + (d.minBet === 2 ? ' selected' : '') + '>$2</option><option value="1"' + (d.minBet === 1 ? ' selected' : '') + '>$1</option></select></label><label class="small">Safety margin <select data-rd="margin" aria-label="Safety margin on expected value">' + MARGINS.map(function (m) { return '<option value="' + m + '"' + (d.margin === m ? ' selected' : '') + '>+' + Math.round(m * 100) + '% EV' + (m === 0.15 ? ' (recommended)' : m === 0.03 ? ' (master minimum)' : '') + '</option>'; }).join('') + '</select></label>' + (d.bankroll ? '<span class="small muted">Caps: $' + Math.floor(d.bankroll * 0.02) + ' a race, $' + Math.floor(d.bankroll * 0.1) + ' a day.</span>' : '<span class="small muted">No bankroll: stakes show as the minimum bet.</span>') + '</div></div>'; }
function raceBets(a) {
  var r = a.race, d = loadReady(), live = S.live[r.id] && S.live[r.id].odds;
  var B = E.betCheck(r, a.M, a.C, live, { bankroll: d.bankroll, minBet: d.minBet, minEV: d.margin });
  var h = '<p class="ink2">The master prompt\'s betting rules, run on this race. A win bet needs the <b>live</b> price: expected value = Claude\'s chance × (odds + 1) − 1, and it must clear your safety margin (now +' + Math.round(d.margin * 100) + '%; 15% is recommended while the model has few graded races, 3% is the master method\'s minimum) with a chance of at least 5%. Stakes are a quarter of the Kelly amount, capped at 2% of bankroll a race. Expect PASS most of the time: the track keeps 15–25% of every pool, so the model has to see more than that.</p>';
  if (hasRes(r.id)) h += '<p class="note">This race is official. The table replays the check with today\'s numbers.</p>';
  if (B.basis === 'ML') h += '<p class="note">No complete live odds yet, so nothing below is a bet. The morning line is shown only to tell you the minimum odds you would need. Enter every starter\'s odds under Race-day updates 2–5 minutes before post.</p>';
  h += readyBlock();
  h += '<div class="tw"><table><thead><tr><th>#</th><th>Horse</th><th class="r">Odds (' + B.basis + ')</th><th class="r">Claude</th><th class="r">Market</th><th class="r">Fair odds</th><th class="r">Bet only at</th><th class="r">EV</th><th class="r">Stake</th><th>Verdict</th><th>Flags</th></tr></thead><tbody>' + B.rows.map(function (x) {
    var vt = x.verdict === 'BET' ? '<span class="tag good">BET</span>' : (x.verdict === 'ML' ? '<span class="tag">needs live odds</span>' : '<span class="tag">PASS</span>');
    var fl = (x.overbetFav ? '<span class="tag bad" title="The favorite\'s model chance is 4+ points below the market">overbet favorite</span> ' : '') + (x.contender ? '<span class="tag acc" title="Model chance 2+ points above the market">contender value</span>' : '') + (B.expertTop === x.pgm ? ' <span class="tag" title="Most published expert win picks">experts\' pick</span>' : '');
    return '<tr><td>' + chip(x.pgm) + '</td><td>' + esc(x.name) + '</td><td class="r num">' + esc(x.odds == null ? '—' : x.odds) + '</td><td class="r num">' + pct(x.p) + '</td><td class="r num">' + pct(x.q) + '</td><td class="r num">' + esc(E.fmtOdds(x.p)) + '</td><td class="r num">' + (x.minOdds != null ? x.minOdds.toFixed(1) + '-1' : '—') + '</td><td class="r num" style="color:' + (x.ev == null ? 'inherit' : x.ev >= B.minEV - 1e-12 ? 'var(--good)' : 'var(--bad)') + '">' + (x.ev == null ? '—' : signed(x.ev * 100, 1) + '%') + '</td><td class="r num">' + (x.verdict === 'BET' ? (d.bankroll ? '$' + x.stake : '$' + d.minBet) : '—') + '</td><td>' + vt + '</td><td>' + fl + '</td></tr>'; }).join('') + '</tbody></table></div>';
  h += B.bets.length ? '<p><b>Bets that pass:</b> ' + B.bets.map(function (x) { return chip(x.pgm) + ' ' + esc(x.name) + ' at ' + esc(x.odds) + (d.bankroll ? ' · $' + x.stake : ''); }).join('; ') + '. If the odds drop below "Bet only at" before the gates open, PASS.</p>' : '<p><b>' + (B.basis === 'ML' ? 'No bet until live odds are in.' : 'PASS on this race:') + '</b> ' + (B.basis === 'ML' ? '' : 'no horse clears +' + Math.round(B.minEV * 100) + '% expected value at these prices.') + ' Picks still stand: top pick ' + chip(a.M.order[0]) + ' ' + esc((horse(r.id, a.M.order[0]) || {}).name || '') + '.</p>';
  h += '<p class="small muted">If money is tight, or you are in a financial proceeding, PASS. Decision support, not licensed betting or financial advice.</p>';
  return h;
}
function raceEdit(a) {
  var r = a.race; var ok = canSave();
  var live = (S.live[r.id] && S.live[r.id].odds) || {}; var res = S.results[r.id]; var jp = S.jrpicks[r.id];
  var h = '<p class="ink2">Use this on race day: mark scratches, type the live odds from the tote board, record Jr\'s picks and the official finish. Every change re-runs the model at once and is saved for everyone who opens this page.</p>' + (ok ? '' : '<p class="note">Only editors of this page can save race-day updates. Everything here still re-runs live as an editor enters them.</p>');
  h += '<div class="tw"><table><thead><tr><th>#</th><th>Horse</th><th>Status</th><th>Live odds (to 1)</th></tr></thead><tbody>' + r.horses.slice().sort(function (x, y) { return byNum(x.pgm, y.pgm); }).map(function (hh) {
    return '<tr><td>' + chip(hh.pgm) + '</td><td>' + esc(hh.name) + '</td><td><select id="st-' + r.id + '-' + hh.pgm + '" data-st="' + hh.pgm + '"' + (ok ? '' : ' disabled') + '>' + ['starter', 'doubtful', 'AE', 'scratched'].map(function (s) { return '<option' + (hh.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td><td><input type="text" inputmode="decimal" size="6" id="lo-' + r.id + '-' + hh.pgm + '" data-lo="' + hh.pgm + '" value="' + esc(live[hh.pgm] != null ? live[hh.pgm] : '') + '" placeholder="' + esc(hh.ml) + '"' + (ok ? '' : ' disabled') + '></td></tr>';
  }).join('') + '</tbody></table></div>';
  h += '<div class="filters" style="margin-top:10px"><button class="btn primary" data-act="save-status"' + (ok ? '' : ' disabled') + '>Save statuses</button><button class="btn" data-act="save-live"' + (ok ? '' : ' disabled') + '>Save live odds</button><button class="btn" data-act="clear-live"' + (ok ? '' : ' disabled') + '>Clear live odds</button><span class="small muted">Live odds replace the morning line only when every starter has one.</span></div>';
  h += '<h3>Jr\'s picks</h3><div class="filters"><input type="text" id="jrp-' + r.id + '" value="' + esc(jp && jp.picks ? jp.picks.join(' ') : (r.jr ? r.jr.picks.join(' ') : '')) + '" placeholder="e.g. 3 4 10 8"' + (ok ? '' : ' disabled') + '><button class="btn" data-act="save-jr"' + (ok ? '' : ' disabled') + '>Save Jr\'s picks</button><span class="small muted">Program numbers in his order, separated by spaces.</span></div>';
  h += '<h3>Official result</h3><div class="filters"><input type="text" id="res-' + r.id + '" value="' + esc(res && res.order ? res.order.join(' ') : '') + '" placeholder="Finish order, e.g. 3 9 4 1"' + (ok ? '' : ' disabled') + '><input type="text" id="pay-' + r.id + '" value="' + esc(res && res.winPay ? res.winPay : '') + '" placeholder="$2 win payoff" size="10"' + (ok ? '' : ' disabled') + '><button class="btn primary" data-act="save-res"' + (ok ? '' : ' disabled') + '>Save result</button></div>' + (res ? '<p class="small muted">Saved ' + esc(fmtWhen(res.savedAt)) + (res.source ? ' · ' + esc(res.source) : '') + '</p>' : '');
  return h;
}

function vHorse(rid, pgm) {
  var a = A[rid]; if (!a) return '<div class="empty">Race not found.</div>'; var r = a.race; var hh = horse(rid, pgm); if (!hh) return '<div class="empty">Horse not found.</div>';
  var f = a.F[pgm]; var act = E.isActive(hh);
  var list = r.horses.slice().sort(function (x, y) { return byNum(x.pgm, y.pgm); }); var i = list.findIndex(function (x) { return x.pgm === pgm; }); var prev = list[i - 1], next = list[i + 1];
  var h = '<div class="filters"><a class="btn" href="#race-' + rid + '">← ' + esc(raceTitle(r)) + '</a>' + (prev ? '<a class="btn" href="#horse-' + rid + '-' + prev.pgm + '">' + chip(prev.pgm) + ' prev</a>' : '') + (next ? '<a class="btn" href="#horse-' + rid + '-' + next.pgm + '">next ' + chip(next.pgm) + '</a>' : '') + '</div>';
  var bc = cloth(pgm); h += '<div class="racehead"><span class="chip" style="background:' + bc[0] + ';color:' + bc[1] + ';height:40px;min-width:40px;font-size:24px">' + esc(pgm) + '</span><div><h2 style="margin:0">' + esc(hh.name) + statusTag(hh) + '</h2><div class="ink2 small">' + esc(raceTitle(r)) + ' · ML ' + esc(hh.ml) + ' · ' + esc(titleCase(hh.trainer)) + ' / ' + esc(titleCase(hh.jockey)) + (hh.wt ? ' · ' + hh.wt + ' lb' : '') + '</div>' + (hh.note ? '<div class="small" style="color:var(--warn)">' + esc(hh.note) + '</div>' : '') + '</div></div>';
  var ji = r.jr ? r.jr.picks.indexOf(pgm) : -1;
  if (hasRes(rid)) h += '<p class="small muted" style="margin-top:8px">Official race: win chances here are from the refit model, tuned on these results (hindsight). ' + (S.results[rid].pre && S.results[rid].pre.top ? 'Claude\'s race-day pick was #' + esc(S.results[rid].pre.top) + ' ' + esc((horse(rid, String(S.results[rid].pre.top)) || {}).name || '') + '.' : '') + '</p>';
  h += '<div class="grid g4" style="margin:12px 0">' + kpi(act ? pct(a.M.p[pgm]) : '—', hasRes(rid) ? 'Claude win chance (refit)' : 'Claude win chance', act ? 'fair odds ' + E.fmtOdds(a.M.p[pgm]) + ' · rank ' + (a.M.order.indexOf(pgm) + 1) + ' of ' + a.M.order.length : 'not a starter') +
    kpi(act ? pct(a.C.q[pgm]) : '—', 'market chance', 'morning line ' + hh.ml) + kpi(act && a.V.all[pgm] != null ? a.V.all[pgm] + ' / 40' : '—', 'factor greens', act && a.V.all[pgm] != null ? 'non-market 35: ' + a.V.form[pgm] + ' · Jr-method ' + (a.J.counts[pgm] || 0) : 'not a starter: not ranked') + kpi(ji >= 0 ? '#' + (ji + 1) : '—', 'Jr\'s pick', r.jr ? 'his order: ' + r.jr.picks.join('-') : 'no picks for this race') + '</div>';
  h += '<div class="cols2"><div class="panel"><h3 style="margin-top:0">What moved the win chance</h3><p class="small ink2">Start from the market, then add each part of the model in turn.</p>' + (act ? waterfall(a, pgm) : '<p class="muted">Not a starter.</p>') + '</div><div class="panel"><h3 style="margin-top:0">Speed, oldest to latest</h3><p class="small ink2">Dashed line = the 3-race average Jr uses. Overseas ratings are shown as printed (T) and placed on the US scale.</p>' + speedChart(hh, f) + '</div></div>';
  // factor table
  h += '<h3>All 40 factors</h3><p class="small ink2">Rank is within this field; green = the top third of the starters (at most four). Missing data ranks last and is never green. Click a factor to see the whole field on it.</p><div class="tw"><table><thead><tr><th>Group</th><th>Factor</th><th class="r">Value</th><th class="r">Rank</th><th class="r">Field best</th><th style="min-width:120px">Standing</th></tr></thead><tbody>';
  E.FACTORS.forEach(function (c) {
    var bf = a.V.byFactor[c.key]; var v = bf.values[pgm]; var g = bf.greens.indexOf(pgm) >= 0; var rk = bf.rank[pgm];
    var bestP = Object.keys(bf.rank).find(function (p) { return bf.rank[p] === 1; }); var bestV = bestP != null ? bf.values[bestP] : null;
    var stand = rk ? (bf.n > 1 ? 1 - (rk - 1) / (bf.n - 1) : 1) : null;
    h += '<tr><td class="small ink2">' + esc(c.group) + '</td><td><a class="flink" href="#factor-' + c.key + '" data-tip="' + esc(c.desc) + '">' + esc(c.label) + '</a></td><td class="r num' + (g ? ' hl' : '') + '">' + esc(fmtF(c, v)) + '</td><td class="r num">' + (rk ? rk + ' / ' + bf.n : '—') + '</td><td class="r num small ink2">' + esc(fmtF(c, bestV)) + '</td><td>' + (stand != null ? '<div class="bar" style="min-width:100px"><i style="width:' + (stand * 100).toFixed(0) + '%;background:' + (g ? 'var(--s-claude)' : 'var(--neutral)') + '"></i></div>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div><p class="small muted">Standing: full bar = best in the field. "—" = no evidence in the past performances (ranked last).</p>';
  h += horseSituation(a, hh);
  // past performances
  h += '<h3>Recent races (from the official free past performances)</h3><div class="tw"><table class="pp"><thead><tr><th>Date</th><th>Track</th><th>Cond.</th><th>Surface</th><th>Going</th><th>Dist.</th><th>Grade</th><th class="r">Speed</th><th class="r">Pace</th><th class="r">Finish</th><th class="r">Margin</th><th class="r">Odds</th><th class="r">Field</th></tr></thead><tbody>' + (hh.races || []).map(function (x) {
    return '<tr><td>' + esc(x.d) + '</td><td>' + esc(x.trk) + (x.fo ? ' <span class="muted">abroad</span>' : '') + '</td><td>' + esc(x.sc || '') + '</td><td>' + esc(SURF_NAME[E.lineSurface(x)]) + '</td><td>' + esc(({ fast: 'fast/firm', good: 'good', off: 'wet/soft', aw: 'synthetic' })[E.lineGoing(x)]) + '</td><td>' + esc(x.fl != null ? x.fl + 'f' : (x.dist || '')) + '</td><td>' + esc(/^[123]$/.test(x.gr || '') ? 'G' + x.gr : (x.gr || '')) + '</td><td class="r">' + (x.fig != null ? (x.ft === 'T' ? 'T' + x.fig : x.fig) : '—') + '</td><td class="r">' + (x.pace != null ? x.pace : '') + '</td><td class="r">' + (x.fin ? ordinal(x.fin) : '—') + '</td><td class="r">' + (x.fin === 1 ? 'won by ' + fmtLen(x.mg) : (x.mg != null ? fmtLen(x.mg) : '')) + '</td><td class="r">' + (x.odds != null ? (x.fav ? '*' : '') + x.odds.toFixed(2) : '') + '</td><td class="r">' + (x.fs || '') + '</td></tr>';
  }).join('') + '</tbody></table></div><p class="small muted">Speed: Equibase figure for US races; "T" = overseas rating as printed. * = favorite. Margin for a winner is the winning margin.</p>';
  // records + experts
  var rec = hh.rec || {}; var labs = [['Life', 'Lifetime'], ['2026', '2026'], ['Dirt', 'Dirt'], ['WetDirt', 'Wet dirt'], ['Turf', 'Turf'], ['WetTurf', 'Soft/wet turf'], ['Synthetic', 'Synthetic'], ['Distance', 'This distance'], ['BCTurf', 'Keeneland turf'], ['BCDirt', 'Keeneland dirt']];
  h += '<div class="grid g2" style="margin-top:14px"><div class="tw"><table><thead><tr><th>Record</th><th class="r">Starts</th><th class="r">Wins</th></tr></thead><tbody>' + labs.filter(function (l) { return rec[l[0]]; }).map(function (l) { return '<tr><td>' + l[1] + '</td><td class="r num">' + rec[l[0]][0] + '</td><td class="r num">' + rec[l[0]][1] + '</td></tr>'; }).join('') + '</tbody></table></div>';
  var ex = hh.experts || [];
  h += '<div class="tw"><table><thead><tr><th>Expert</th><th>Outlet</th><th>Pick</th></tr></thead><tbody>' + (ex.length ? ex.map(function (e) { return '<tr><td>' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.n) + '</a>' : esc(e.n)) + '</td><td class="small">' + esc(e.o) + '</td><td>' + (e.t === 'win' ? '<span class="tag good">win</span>' : '<span class="tag">value</span>') + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="muted">No published expert named this horse.</td></tr>') + '</tbody></table></div></div>';
  return h;
}

function vHorses() {
  var u = S.ui; var rows = [];
  S.races.forEach(function (r) { var a = A[r.id]; if (!a) return; if (u.day !== 'all' && r.date !== u.day) return;
    activeH(a).forEach(function (hh) { var f = a.F[hh.pgm]; var ji = a.race.jr ? a.race.jr.picks.indexOf(hh.pgm) : -1; rows.push({ r: r, h: hh, claude: a.M.p[hh.pgm], mkt: a.C.q[hh.pgm], edge: a.M.p[hh.pgm] - a.C.q[hh.pgm], jrm: a.J.counts[hh.pgm] || 0, core: a.V.core[hh.pgm], all: a.V.all[hh.pgm], avg3: f.avg3, trend: f.trend, ex: f.exW, jr: ji >= 0 ? ji + 1 : null, rank: a.M.order.indexOf(hh.pgm) + 1 }); }); });
  if (u.q) { var q = u.q.toLowerCase(); rows = rows.filter(function (x) { return x.h.name.toLowerCase().indexOf(q) >= 0 || (x.h.trainer || '').toLowerCase().indexOf(q) >= 0 || (x.h.jockey || '').toLowerCase().indexOf(q) >= 0; }); }
  if (u.minP) rows = rows.filter(function (x) { return x.claude >= u.minP; });
  var k = u.sort.key, d = u.sort.dir;
  rows.sort(function (x, y) { var a = x[k], b = y[k]; if (k === 'race') { a = x.r.date + String(x.r.cardRace).padStart(2, '0') + String(x.rank).padStart(2, '0'); b = y.r.date + String(y.r.cardRace).padStart(2, '0') + String(y.rank).padStart(2, '0'); } if (k === 'name') { a = x.h.name; b = y.h.name; } if (a == null) return 1; if (b == null) return -1; return (a < b ? -1 : a > b ? 1 : 0) * d; });
  function th(key, label, cls) { return '<th class="sort ' + (cls || '') + '" data-sort="' + key + '">' + label + (k === key ? (d > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }
  var h = '<h2>All horses, all races</h2><p class="ink2">Every starter on the card. Sort by any column; click a horse for its full drill-down.</p>';
  h += '<div class="filters"><select id="fday" aria-label="Day"><option value="all"' + (u.day === 'all' ? ' selected' : '') + '>Every day</option>' + raceDates().map(function (d) { return '<option value="' + d + '"' + (u.day === d ? ' selected' : '') + '>' + esc(dateLong(d)) + '</option>'; }).join('') + '</select>' + '<input type="search" id="fq" placeholder="Horse, trainer or jockey" value="' + esc(u.q) + '"><select id="fmin" aria-label="Minimum win chance"><option value="0">Any win chance</option><option value="0.05"' + (u.minP === 0.05 ? ' selected' : '') + '>5% or more</option><option value="0.1"' + (u.minP === 0.1 ? ' selected' : '') + '>10% or more</option><option value="0.2"' + (u.minP === 0.2 ? ' selected' : '') + '>20% or more</option></select><span class="small muted">' + rows.length + ' horses</span></div>';
  h += '<div class="tw" style="max-height:70vh"><table><thead><tr>' + th('race', 'Race') + th('name', 'Horse') + th('claude', 'Claude', 'r') + th('mkt', 'Market', 'r') + th('edge', 'Edge', 'r') + th('rank', 'Rank', 'r') + th('jrm', 'Jr-method', 'r') + th('core', 'Greens / 40', 'r') + th('all', 'All 35', 'r') + th('avg3', '3-race avg', 'r') + th('trend', 'Up/down', 'r') + th('ex', 'Experts', 'r') + th('jr', 'Jr pick', 'r') + '</tr></thead><tbody>';
  rows.forEach(function (x) { h += '<tr class="click" data-go="horse-' + x.r.id + '-' + x.h.pgm + '"><td class="small">' + esc(raceShort(x.r) + ' ' + x.r.name) + '</td><td>' + chip(x.h.pgm) + ' ' + esc(x.h.name) + statusTag(x.h) + '</td><td class="r num"><b>' + pct(x.claude) + '</b></td><td class="r num">' + pct(x.mkt) + '</td><td class="r num" style="color:' + (x.edge >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + signed(x.edge * 100, 1) + '</td><td class="r num">' + x.rank + '</td><td class="r num">' + x.jrm + '</td><td class="r num">' + x.core + '</td><td class="r num">' + x.all + '</td><td class="r num">' + (x.avg3 != null ? x.avg3.toFixed(1) : '—') + '</td><td class="r num">' + (x.trend != null ? signed(x.trend, 1) : '—') + '</td><td class="r num">' + (x.ex || '') + '</td><td class="r num">' + (x.jr ? '<span class="hly" style="padding:0 5px;font-weight:700">' + x.jr + '</span>' : '') + '</td></tr>'; });
  return h + '</tbody></table></div>';
}

function factorQ() {
  var list = S.races.filter(function (r) { return A[r.id] && A[r.id].race; }).map(function (r) { return { a: A[r.id], winner: hasRes(r.id) ? canonWinner(r.id) : null }; });
  var m = {}; E.factorQuality(list).forEach(function (q) { m[q.key] = q; }); return m;
}
function qLine(q) { return q ? Math.round(q.coverage * 100) + '% data coverage · decisive in ' + q.decisive + ' of ' + q.races + ' races · ' + q.avgGreens.toFixed(1) + ' greens a race · winner green in ' + q.winnersGreen + ' of ' + q.graded + ' graded races' + (q.lift != null ? ' (' + q.lift.toFixed(1) + '× chance)' : '') : ''; }
function vFactors() {
  var jrKeys = { g1: 1, spdLast: 1, avg3: 1, trend: 1, cls: 1, surfWins: 1, distWins: 1, course: 1, formW3: 1, works: 1 };
  var modelKeys = { mlProb: 'market (not in the count)', exW: 'experts vs market (not in the count)', exV: 'not in the count', smartGap: 'not in the count', lastOdds: 'not in the count', avg3: 'speed + count', trend: 'trend + count', g1: 'G1 term + count', paceFit: 'pace term + count', sitFig: 'situation term + count' };
  var Q = factorQ(); var gN = S.races.filter(function (r) { return hasRes(r.id); }).length;
  var h = '<h2>The 40 factors</h2><p class="ink2">Every factor is required and computed for every starter from the official past performances, the morning line and published picks. Each one is a filter: the top third of the field on it (at most four horses) turns green, and a tie that would add more than one extra horse stays white, so a green always means the horse stands out. Missing data counts as no evidence: ranked last, never green.</p>';
  h += '<p class="small ink2">Filter quality is measured on the ' + gN + ' races with official results. "Lift" is how often the winner was green against what chance would give (1.0× = no better than chance). With this few races it is a check, not proof.</p>';
  h += '<div class="tw"><table><thead><tr><th>Group</th><th>Factor</th><th>Better when</th><th class="r">Coverage</th><th class="r">Decisive</th><th class="r">Greens / race</th><th class="r">Winner green</th><th class="r">Lift</th><th class="c">Jr</th><th>Model use</th></tr></thead><tbody>';
  E.FACTORS.forEach(function (c) { var q = Q[c.key] || {}; h += '<tr class="click" data-go="factor-' + c.key + '"><td class="small ink2">' + esc(c.group) + '</td><td data-tip="' + esc(c.desc) + '"><b>' + esc(c.label) + '</b></td><td class="small">' + ({ high: 'higher', low: 'lower', nearZero: 'same trip', target: 'near ' + c.target + ' days' })[c.better] + '</td><td class="r num">' + Math.round((q.coverage || 0) * 100) + '%</td><td class="r num">' + (q.decisive || 0) + '/' + (q.races || 0) + '</td><td class="r num">' + (q.avgGreens || 0).toFixed(1) + '</td><td class="r num">' + (q.winnersGreen || 0) + '/' + (q.graded || 0) + '</td><td class="r num" style="color:' + (q.lift == null ? 'inherit' : q.lift >= 1.5 ? 'var(--good)' : q.lift < 1 ? 'var(--bad)' : 'inherit') + '">' + (q.lift != null ? q.lift.toFixed(1) + '×' : '—') + '</td><td class="c">' + (jrKeys[c.key] ? '✓' : '') + '</td><td class="small">' + (modelKeys[c.key] || 'via the 35-factor count') + '</td></tr>'; });
  h += '</tbody></table></div><p class="small muted">The 35 factors that do not come from the odds or the experts feed the model\'s factor-count term; the five market factors (morning line, expert win and value picks, experts vs market, last-race odds) are shown but left out of that count so the market is not counted twice. Pace-shape fit is decisive only when the projected pace is lone-speed or contested; in an honest pace it is neutral by design. Jr\'s DRF-only rows (jockey %, trainer %, jockey–trainer combo, pedigree rating) are on his sheet in Jr\'s method; they are not in the free Equibase PPs.</p>';
  return h;
}
function vFactor(key) {
  var c = factor(key); if (!c) return '<div class="empty">Unknown factor.</div>';
  var fr = S.ui.factorRace;
  var h = '<div class="filters"><a class="btn" href="#factors">← All 40 factors</a><select aria-label="Factor" onchange="location.hash=\'factor-\'+this.value">' + E.FACTORS.map(function (x) { return '<option value="' + x.key + '"' + (x.key === key ? ' selected' : '') + '>' + esc(x.group + ' · ' + x.label) + '</option>'; }).join('') + '</select></div>';
  h += '<h2>' + esc(c.label) + '</h2><p class="ink2">' + esc(c.desc) + ' <span class="tag acc">required</span></p><p class="small ink2">' + esc(qLine(factorQ()[key])) + '</p>';
  h += '<div class="filters"><select id="frace" aria-label="Race">' + '<option value="all">Leaders in every race</option>' + S.races.map(function (r) { return '<option value="' + r.id + '"' + (fr === r.id ? ' selected' : '') + '>' + esc(raceTitle(r)) + '</option>'; }).join('') + '</select></div>';
  if (fr !== 'all' && A[fr]) { h += '<div class="panel">' + factorBars(A[fr], key) + '</div><p class="small muted">Green bars = the top third of the starters (at most four). Also-eligibles are shown, not ranked.</p>'; return h; }
  h += '<div class="tw"><table><thead><tr><th>Race</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th><th class="r">Leader\'s Claude chance</th></tr></thead><tbody>';
  S.races.forEach(function (r) { var a = A[r.id]; if (!a) return; var bf = a.V.byFactor[key]; var ps = Object.keys(bf.rank).filter(function (p) { var hh = horse(r.id, p); return hh && E.isActive(hh); }).sort(function (x, y) { return bf.rank[x] - bf.rank[y]; }).slice(0, 4);
    h += '<tr><td class="small"><a href="#race-' + r.id + '">' + esc(raceTitle(r)) + '</a></td>' + [0, 1, 2, 3].map(function (i) { var p = ps[i]; if (!p) return '<td class="muted">—</td>'; var hh = horse(r.id, p); return '<td><a href="#horse-' + r.id + '-' + p + '" style="color:inherit;text-decoration:none">' + chip(p) + ' <span class="small">' + esc(hh.name.length > 16 ? hh.name.slice(0, 15) + '…' : hh.name) + '</span> <b class="num small">' + esc(fmtF(c, bf.values[p])) + '</b></a></td>'; }).join('') + '<td class="r num">' + (ps[0] ? pct(a.M.p[ps[0]]) : '—') + '</td></tr>'; });
  return h + '</tbody></table></div>';
}

// ---------- Jr ----------
function jrSheetTable(sh, rid) {
  var ps = Object.keys(sh.count.values).sort(byNum);
  var h = '<div class="tw"><table class="jrgrid"><thead><tr><th>Row</th><th>Meaning</th>' + ps.map(function (p) { return '<th class="c">' + chip(p) + '</th>'; }).join('') + '</tr></thead><tbody>';
  sh.rows.forEach(function (row) {
    h += '<tr><td class="rl"><b>' + esc(row.key) + '</b></td><td class="rl" data-tip="' + esc('<b>' + row.label + '</b> (' + row.status + ')<br>' + row.decode + '<br><br>' + row.evidence) + '"><span class="status-' + row.status + '">●</span> ' + esc(row.label) + '</td>' + ps.map(function (p) { var v = row.values[p]; var g = row.greens.indexOf(p) >= 0; return '<td class="red' + (g ? ' hl' : '') + '">' + esc(v) + '</td>'; }).join('') + '</tr>';
  });
  h += '<tr><td class="rl"><b>Σ</b></td><td class="rl"><span class="status-verified">●</span> Green count</td>' + ps.map(function (p) { var v = sh.count.values[p]; return '<td' + (v >= 4 ? ' class="hly"' : '') + '><b>' + v + '</b></td>'; }).join('') + '</tr></tbody></table></div>';
  h += '<div class="legend"><span><span class="status-verified">●</span> verified</span><span><span class="status-likely">●</span> likely</span><span><span class="status-unknown">●</span> unknown, ask Jr</span><span><span class="hl" style="padding:0 6px">green</span> his highlighter</span><span><span class="hly" style="padding:0 6px">yellow</span> his count highlight</span></div>';
  return h;
}
function vJr() {
  var sh = S.jrsheets['bc26-fri-r6'];
  var h = '<h2>Jr\'s method, decoded</h2>';
  h += '<p><b>Jr scores each horse on about nine categories from DRF past performances, highlights the best four values in each row in green, counts the greens, and picks the top three starters by count.</b> On race 6 his top three by count (3, 4, 10) are exactly his first three picks; his fourth, 8 Force Noir, is a judgment call (a neck behind in a Group 1).</p>';
  if (sh) {
    h += '<h3>His race 6 sheet, cell by cell</h3><p class="small ink2">' + esc(sh.source) + '. Header: ' + esc(sh.header.left.join(' · ')) + '. Margin notes: ' + esc(sh.header.margin) + '. Hover any row for the decode and the evidence.</p>' + jrSheetTable(sh);
    h += '<div class="tw" style="margin-top:12px"><table><thead><tr><th>Row</th><th>What it is</th><th>Status</th><th style="min-width:340px">Evidence</th></tr></thead><tbody>' + sh.rows.map(function (r) { return '<tr><td><b>' + esc(r.key) + '</b></td><td style="white-space:normal;min-width:200px"><b>' + esc(r.label) + '</b><br><span class="small ink2">' + esc(r.decode) + '</span></td><td class="status-' + r.status + '"><b>' + esc(r.status) + '</b></td><td class="small" style="white-space:normal">' + esc(r.evidence) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    h += '<p class="note" style="margin-top:10px">' + esc(sh.method) + '</p>';
    // agreement with engine
    var a = A['bc26-fri-r6'];
    if (a) {
      var g1 = a.V.byFactor.g1.greens.slice().sort(byNum).join(', '); var jrA = sh.rows[0].greens.slice().sort(byNum).join(', ');
      h += '<h3>Does the engine reproduce him?</h3><div class="tw"><table><thead><tr><th>Check</th><th>Jr\'s sheet</th><th>Engine on free data</th><th>Match</th></tr></thead><tbody>' +
        '<tr><td>G1-proximity greens</td><td>' + jrA + '</td><td>' + g1 + '</td><td>' + (g1 === jrA ? '<span class="tag good">exact</span>' : '<span class="tag warn">differs</span>') + '</td></tr>' +
        '<tr><td>Top three starters by green count</td><td>3, 4, 10</td><td>' + a.J.order.slice(0, 3).join(', ') + ' (Equibase categories)</td><td>' + (a.J.order.slice(0, 3).join(',') === '3,4,10' ? '<span class="tag good">exact</span>' : '<span class="tag warn">differs: his speed rows use Beyer figures</span>') + '</td></tr>' +
        '<tr><td>Final picks</td><td>3, 4, 10, 8</td><td>Claude model without Jr\'s picks as an input: <b>' + a.M0.order.slice(0, 4).join(', ') + '</b><br><span class="small muted">with them: ' + a.M.order.slice(0, 4).join(', ') + '</span></td><td><span class="tag acc">' + a.M0.order.slice(0, 4).filter(function (p) { return ['3','4','10','8'].indexOf(p) >= 0; }).length + ' of 4 independently</span></td></tr></tbody></table></div>';
    }
  }
  // Friday picks
  var jrRaces = S.races.filter(function (r) { return A[r.id] && A[r.id].D; });
  h += '<h3>His Friday picks against the consensus</h3><div class="tw"><table><thead><tr><th>Race</th><th>Jr\'s order</th><th>Consensus top</th><th class="r">Avg gap</th><th>Top pick agrees?</th><th>Note</th></tr></thead><tbody>' + jrRaces.map(function (r) { var a = A[r.id]; var sc = a.D.rows.filter(function (x) { return x.scratched; }); return '<tr class="click" data-go="race-' + r.id + '"><td>' + esc(raceTitle(r)) + '</td><td>' + a.race.jr.picks.map(chip).join(' ') + '</td><td>' + a.C.order.slice(0, a.race.jr.picks.length).map(chip).join(' ') + '</td><td class="r num">' + (a.D.index != null ? a.D.index.toFixed(1) : '—') + '</td><td>' + (a.D.topAgree ? '<span class="tag good">yes</span>' : '<span class="tag warn">no</span>') + '</td><td class="small">' + (sc.length ? '#' + sc.map(function (x) { return x.pgm; }).join(', #') + ' scratched' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  h += '<h3>Questions that would close the last gaps</h3><ul><li>Row 3 (the +6 / −5 row): what is it, and is it the speed-up/down number from his 3-race average?</li><li>Row 4 (0/0, 0/1, 1/1): which record is it?</li><li>Row B: does he use the last race, or the average of the last three?</li><li>The "101" under the 90 in his corner, and what the purple, blue and pink marks on the horse numbers mean.</li><li>Race 9: his third pick, #2 Gaudreau, scratched Wednesday with a fever. Who replaces him?</li></ul>';
  return h;
}

// ---------- model ----------
function vModel() {
  var W = weightsNow(); var base = (S.model && S.model.weights) || E.DEFAULT_WEIGHTS;
  var desc = { market: 'log of the market win chance', experts: 'expert win-pick share minus market share', speed: 'z-score of the 3-race speed average', trend: 'z-score of speed up/down', jrMethod: 'Jr-method greens ÷ race max', jrPicks: 'Jr\'s picks: 1, .75, .5, .25', g1: 'won a G1 or within 1 length in one', factors: 'green count over the 35 non-market factors ÷ race max', situation: 'v1.1 · figure in races most like this one (surface, distance, going, recency) minus the 3-race average, z-scored', pace: 'v1.1 · run style × pace shape (lone speed helps the leader, a contested pace helps closers), scaled by pace-data coverage', bias: 'v1.1 · speed and post bias learned from earlier races on the same surface at this meet', keyRace: 'v1.1 · rivals from the same prep who have since beaten (or missed) the market here', conn: 'v1.1 · jockey + trainer over-performance at this meet (off until the review finds it helps)' };
  var h = '<h2>Claude\'s model</h2><p><b>Each horse gets a score; win chances are the scores passed through a softmax so the field sums to 100%.</b> The market carries most of the weight; every other term nudges it, and each nudge is shown per horse in its waterfall.</p>';
  h += '<div class="mathbox">score(h) = ' + W.market + ' × ln(market%) + ' + W.experts + ' × (expert share − market share) + ' + W.speed + ' × speed + ' + W.trend + ' × up/down\n         + ' + W.jrMethod + ' × Jr-method + ' + W.jrPicks + ' × Jr picks + ' + W.g1 + ' × G1 + ' + (W.factors || 0) + ' × 35-factor\n         + ' + (W.situation || 0) + ' × situation fit + ' + (W.pace || 0) + ' × pace shape + ' + (W.bias || 0) + ' × track bias + ' + (W.keyRace || 0) + ' × key races + ' + (W.conn || 0) + ' × connections\nP(h wins) = exp(score(h)) ÷ Σ exp(score)          (non-market terms centered on the field average)</div>';
  h += '<p class="small ink2">Speed weight is halved in fields that mix US figures and overseas ratings. Overseas ratings are moved onto the US scale by ' + E.T_OFFSET.juvenile + ' for 2-year-olds (from Jr\'s Beyer sheet and the Equibase–Beyer gap in race 6) and ' + E.T_OFFSET.older + ' for older horses (14 horses with both kinds of figure differ by a median of under 1 point). Expect about ±10 points of error per horse.</p>';
  h += '<h3>Weights</h3><div class="tw"><table><thead><tr><th>Term</th><th>What it is</th><th class="r">Saved ' + esc(base.version || '') + '</th><th>What-if</th></tr></thead><tbody>' + Object.keys(desc).map(function (k) { return '<tr><td><b>' + k + '</b></td><td class="small">' + desc[k] + '</td><td class="r num">' + (base[k] != null ? base[k] : 0) + '</td><td><input type="range" min="0" max="' + (k === 'market' || k === 'bias' ? 1.5 : 1) + '" step="0.01" value="' + (W[k] != null ? W[k] : 0) + '" data-w="' + k + '" aria-label="' + k + ' weight"> <span class="num small">' + (W[k] != null ? W[k] : 0) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
  h += '<div class="filters" style="margin-top:8px"><button class="btn" data-act="what-reset"' + (S.ui.what ? '' : ' disabled') + '>Back to saved weights</button><button class="btn primary" data-act="what-save"' + (S.ui.what && canSave() ? '' : ' disabled') + '>Save what-if as a new version</button><span class="small muted">What-if changes recompute every race on this screen only, until saved.</span></div>';
  h += '<h3>Version history</h3><div class="tw"><table><thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Note</th></tr></thead><tbody>' + (S.hist.length ? S.hist.map(function (v) { return '<tr><td><b>' + esc(v.version) + '</b></td><td class="small">' + esc(fmtWhen(v.savedAt)) + '</td><td class="small">' + esc(v.by || '') + '</td><td class="small" style="white-space:normal">' + esc(v.note || '') + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="muted">v1.0 only.</td></tr>') + '</tbody></table></div>';
  h += '<p class="note" style="margin-top:12px">Why these starting weights: the morning line already folds in most public information, so every other term is a nudge. Experts count only where their picks diverge from the odds, and the factor count leaves out the five market factors, so the market is not counted twice. The market term of 0.9 offsets the favorite tilt the other terms add: the average favorite gets 31.6%, against 32% for Breeders\' Cup favorites 1984–2025 and 25% in 2010–17. These are priors, not fitted values; the self-review refits them as results come in, with held-out checks.</p>';
  return h;
}

// ---------- results & review ----------
function scoreboard(graded) {
  var src = {
    pre: { label: 'Claude, race-day pick (locked, v1.1)', n: 0, w: 0, back: 0, unk: 0, t3: null },
    now: { label: 'Claude, current model (in hindsight)', n: 0, w: 0, back: 0, unk: 0, t3: 0, ll: 0, b: 0 },
    mkt: { label: 'Market favorite (morning line unless live odds were entered)', n: 0, w: 0, back: 0, unk: 0, t3: 0, ll: 0, b: 0 },
    exp: { label: 'Expert consensus (most win picks)', n: 0, w: 0, back: 0, unk: 0, t3: null },
    jr: { label: 'Jr\'s top pick', n: 0, w: 0, back: 0, unk: 0, t3: null },
    val: { label: 'Contender-value flags at lock time', n: 0, w: 0, back: 0, unk: 0, t3: null } };
  function hit(o, pick, win, rid) { o.n++; if (pick === win) { o.w++; var pay = payOf(rid); if (pay != null) o.back += pay; else o.unk++; } }
  graded.forEach(function (r) { var a = A[r.id], g = a.G, win = g.winner, pre = S.results[r.id].pre;
    if (pre && pre.top) hit(src.pre, String(pre.top), win, r.id);
    hit(src.now, a.M.order[0], win, r.id); src.now.ll += g.claude.ll; src.now.b += g.claude.brier; if (a.M.order.slice(0, 3).indexOf(win) >= 0) src.now.t3++;
    hit(src.mkt, a.C.order[0], win, r.id); src.mkt.ll += g.consensus.ll; src.mkt.b += g.consensus.brier; if (a.C.order.slice(0, 3).indexOf(win) >= 0) src.mkt.t3++;
    var et = E.expertTop(a.C); if (et) hit(src.exp, et, win, r.id);
    if (a.race.jr && a.race.jr.picks && a.race.jr.picks.length) hit(src.jr, String(a.race.jr.picks[0]), win, r.id);
    if (pre && pre.value) pre.value.forEach(function (pg) { hit(src.val, String(pg), win, r.id); });
  });
  var rows = Object.keys(src).map(function (k) { var o = src[k]; if (!o.n) return '<tr><td>' + esc(o.label) + '</td><td colspan="7" class="muted small">' + (k === 'val' ? 'recorded from the next card on (flags are locked with each result)' : 'no races yet') + '</td></tr>';
    var stake = 2 * o.n, prof = o.back - stake;
    return '<tr><td>' + esc(o.label) + '</td><td class="r num">' + o.n + '</td><td class="r num"><b>' + o.w + '</b> (' + Math.round(100 * o.w / o.n) + '%)</td><td class="r num">' + (o.t3 != null ? o.t3 + '/' + o.n : '—') + '</td><td class="r num">' + (o.ll ? (o.ll / o.n).toFixed(3) : '—') + '</td><td class="r num">' + (o.b ? (o.b / o.n).toFixed(3) : '—') + '</td><td class="r num">$' + o.back.toFixed(2) + ' on $' + stake + (o.unk ? ' <span class="small muted">(' + o.unk + ' payoff' + (o.unk > 1 ? 's' : '') + ' missing)</span>' : '') + '</td><td class="r num" style="color:' + (prof >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + signed(100 * prof / stake, 0) + '%</td></tr>'; }).join('');
  return '<h3>Scoreboard</h3><div class="tw"><table><thead><tr><th>Source</th><th class="r">Races</th><th class="r">Top pick won</th><th class="r">Winner in top 3</th><th class="r">Log loss</th><th class="r">Brier</th><th class="r">Flat $2 win bets</th><th class="r">ROI</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="small muted">Lower log loss and Brier are better. Payoffs are the official $2 win prices recorded with each result. The locked pre-race record is the honest one; the current model is refit on these same races.</p>';
}
function vResults() {
  var graded = S.races.filter(function (r) { return A[r.id] && A[r.id].G; });
  var h = '<h2>Results and self-review</h2><p class="ink2">After each race day the review grades every source against the official results, refits the model on all graded races, and logs the real change in accuracy against a 5% improvement target. It adopts a change only if it lowers the error on the races it has seen.</p>';
  var rk = sourceRecord();
  if (rk.graded) h += '<div class="panel honest"><h3 style="margin-top:0">The honest record</h3>' + leaderboard(rk, { bare: true }) +
    '<ul class="clean small" style="margin-top:10px">' + SRC.filter(function (s0) { return rk[s0.k].n; }).map(function (s0) { var o = rk[s0.k]; return '<li><b>' + esc(o.name) + '</b>: ' + o.w + ' of ' + o.n + ' fits a true hit rate of ' + pctI(o.ci[0]) + '–' + pctI(o.ci[1]) + ' (exact 95% range).</li>'; }).join('') +
    (rk.lockedN ? '<li>Claude\'s locked picks were priced to win ' + rk.lockedExp.toFixed(1) + ' of ' + rk.lockedN + ' and won ' + rk.claude.w + '.</li>' : '') +
    '<li>On this card the race-day picks were written into the record on Oct 31 from the race-day engine (v1.1), not timestamped by an outside service before each post. Only the top pick and its win chance were saved, so locked log loss and Brier scores can\'t be computed for this card; the scores below are for the refit model, in hindsight.</li></ul></div>';
  if (graded.length) {
    var m = { c: { ll: 0, b: 0, t: 0 }, k: { ll: 0, b: 0, t: 0 }, jm: 0, jr: 0, jrn: 0 };
    graded.forEach(function (r) { var g = A[r.id].G; m.c.ll += g.consensus.ll; m.c.b += g.consensus.brier; m.c.t += g.consensus.top1 ? 1 : 0; m.k.ll += g.claude.ll; m.k.b += g.claude.brier; m.k.t += g.claude.top1 ? 1 : 0; m.jm += g.jrMethod.top1 ? 1 : 0; if (g.jr) { m.jrn++; m.jr += g.jr.top1 ? 1 : 0; } });
    var n = graded.length;
    var pr = preRecord();
    h += '<div class="grid g4">' + (pr.n ? kpi(pr.w + '/' + pr.n, 'Race-day pick won', 'the race-day engine\'s picks (v1.1) · current ' + esc(weightsNow().version || '') + ' in hindsight ' + m.k.t + '/' + n + ' · market ' + m.c.t + '/' + n) : kpi(m.k.t + '/' + n, 'Claude top pick won', 'market favorite ' + m.c.t + '/' + n)) + kpi((m.k.ll / n).toFixed(3), 'Claude log loss, refit (hindsight)', 'market ' + (m.c.ll / n).toFixed(3) + ' · lower is better · fitted on these races') + kpi((m.k.b / n).toFixed(3), 'Claude Brier, refit (hindsight)', 'market ' + (m.c.b / n).toFixed(3)) + kpi(m.jrn ? m.jr + '/' + m.jrn : '—', 'Jr\'s top pick won', 'Jr-method on Equibase: ' + m.jm + '/' + n) + '</div>';
    h += scoreboard(graded);
    h += '<div class="tw" style="margin-top:12px"><table><thead><tr><th>Race</th><th>Winner</th><th>Pre-race pick</th><th class="r">Claude chance</th><th class="r">Market chance</th><th class="r">Claude rank</th><th>Jr</th></tr></thead><tbody>' + graded.map(function (r) { var a = A[r.id], g = a.G; var w = horse(r.id, g.winner); var pre = S.results[r.id] && S.results[r.id].pre; var ph = pre && pre.top ? horse(r.id, String(pre.top)) : null; return '<tr><td>' + esc(raceTitle(r)) + '</td><td>' + chip(g.winner) + ' ' + esc(w ? w.name : '') + '</td><td>' + (pre && pre.top ? chip(String(pre.top)) + ' <span class="small">' + esc(ph ? ph.name : '') + ' (' + pct(pre.p, 0) + ', ' + esc(pre.version || '') + ')</span>' + (String(pre.top) === g.winner ? ' <span class="tag good">won</span>' : '') : '<span class="muted small">not locked</span>') + '</td><td class="r num">' + pct(a.M.p[g.winner]) + '</td><td class="r num">' + pct(a.C.q[g.winner]) + '</td><td class="r num">' + g.claude.rankOfWinner + '</td><td>' + (g.jr ? (g.jr.top1 ? '<span class="tag good">top pick won</span>' : g.jr.inPicks ? '<span class="tag acc">in his picks (#' + g.jr.pos + ')</span>' : '<span class="tag">missed</span>') : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  } else h += '<p class="note">No results yet. They are recorded after each race (Race-day updates on each race, or the scheduled review the morning after).</p>';
  h += '<h3>Run a review now</h3><div class="filters"><button class="btn primary" data-act="tune">Grade and refit</button>' + (S.ui.tuneOut && S.ui.tuneOut.ok && S.ui.tuneOut.adopt ? '<button class="btn" data-act="adopt"' + (canSave() ? '' : ' disabled') + '>Adopt the refit as a new version</button>' : '') + '</div>';
  var t = S.ui.tuneOut;
  if (t) h += t.ok ? '<p>On ' + t.graded + ' graded races, log loss goes from <b>' + t.before.toFixed(3) + '</b> to <b>' + t.after.toFixed(3) + '</b> in-sample (' + t.improvementPct + '%), and by <b>' + t.heldOutPct + '%</b> on held-out races. Target: 5%. <b>' + esc(t.why) + '</b></p><div class="mathbox">' + esc(JSON.stringify(t.weights)) + '</div>' : '<p class="note">' + esc(t.reason) + '</p>';
  h += '<h3>Review log</h3><div class="tw"><table><thead><tr><th>Date</th><th>Races graded</th><th class="r">Before</th><th class="r">After</th><th class="r">Change</th><th>Adopted</th><th>Reflection</th></tr></thead><tbody>' + (S.reviews.length ? S.reviews.map(function (v) { return '<tr><td class="small">' + esc(v.date) + '</td><td class="r num">' + esc(v.graded) + '</td><td class="r num">' + (v.before != null ? (+v.before).toFixed(3) : '—') + '</td><td class="r num">' + (v.after != null ? (+v.after).toFixed(3) : '—') + '</td><td class="r num">' + (v.improvementPct != null ? v.improvementPct + '%' : '—') + '</td><td>' + (v.adopted ? '<span class="tag good">' + esc(v.version || 'yes') + '</span>' : '<span class="tag">no</span>') + '</td><td class="small" style="white-space:normal;min-width:260px">' + esc(v.notes || '') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="muted">No reviews yet. The first runs the morning after Friday\'s races.</td></tr>') + '</tbody></table></div>';
  return h;
}

// ---------- data & sources ----------
function vData() {
  var m = S.meta || {};
  var h = '<h2>Data and sources</h2><p class="ink2">Where every number comes from, what was checked, and what could not be.</p><div class="tw"><table><thead><tr><th>Data</th><th>Source</th><th>Status</th></tr></thead><tbody>' + (m.sources || []).map(function (s) { return '<tr><td>' + esc(s.what) + '</td><td class="small" style="white-space:normal">' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>' : esc(s.name)) + '</td><td class="small" style="white-space:normal">' + esc(s.status || '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  if (m.gaps && m.gaps.length) h += '<h3>Could not verify</h3><ul>' + m.gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>';
  if (m.ppLinks && m.ppLinks.length) h += '<h3>Official free past performances (PDF)</h3><ul class="small">' + m.ppLinks.map(function (l) { return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.name) + '</a></li>'; }).join('') + '</ul>';
  h += '<h3>How the situation engine reads the data (v1.1)</h3><ul class="small" style="max-width:80ch">' +
    '<li><b>Surface and going of past races</b> come from the Equibase going code and course mark on each line (for example "ft" fast dirt, "fmp" firm turf, "fmh" inner turf, "fto" fast synthetic). The course-mark letters were decoded from the tracks they appear at (Turfway, Woodbine, Kempton, Newcastle and Dundalk all show "o", which matches their synthetic tracks). Treat them as inferred, not printed.</li>' +
    '<li><b>Run style</b> uses Equibase early-pace figures, which exist only for US races, so horses coming from Europe or Japan have no style and the pace term is scaled down in fields with little pace data.</li>' +
    '<li><b>Track bias</b> uses the pre-race early-speed rank and program number of the first three home; the free result charts give finishing order, not running positions. Program number stands in for post position.</li>' +
    '<li><b>Key races</b> match prep races by date, track, distance, grade, going and field size. Three same-day collisions were split by the Breeders\' Cup race\'s sex; any still ambiguous are dropped.</li>' +
    '<li><b>Horse book</b>: once a result is in, each finisher gets a new past-race line (finish position and field size; no figure unless one is entered) that follows the horse into any future card loaded here.</li>' +
    '<li><b>Weights</b> for the five situation terms are priors, kept small; the self-review can move each by at most 0.05 per review and only when held-out races improve.</li></ul>';
  h += '<h3>Using it for another card</h3><p class="ink2">Open <a href="#cards">Cards</a> to quick-add a race or load a card as JSON, or ask Claude: "Load the [race card] into the Breeders &amp; Jr Engine." Every view, chart and factor fills in with no code change, and horses already in the book bring their history with them.</p>';
  return h;
}

// ---------- v1.1: situations, forecast, connections, cards ----------
function tOff() { return S.model && S.model.tOffset; }
function probsWithout(a, keys) {
  var hs = activeH(a); var sc = {}, mx = -1e9;
  hs.forEach(function (h) { var t = 0, pr = a.M.parts[h.pgm]; Object.keys(pr).forEach(function (k) { if (keys.indexOf(k) < 0) t += pr[k]; }); sc[h.pgm] = t; if (t > mx) mx = t; });
  var tot = 0; hs.forEach(function (h) { tot += Math.exp(sc[h.pgm] - mx); }); var P = {}; hs.forEach(function (h) { P[h.pgm] = Math.exp(sc[h.pgm] - mx) / tot; }); return P;
}
function partPP(a, pgm, key) { return a.M.p[pgm] - probsWithout(a, [key])[pgm]; }
function sitPP(a, pgm) { return a.M.p[pgm] - a.MB.p[pgm]; }
var STYLE_NAME = { E: 'early speed', P: 'presser', S: 'closer', U: 'no US pace figures' };
var SHAPE_NAME = { lone: 'lone speed', honest: 'honest pace', contested: 'contested pace', unknown: 'pace unknown' };
function shapeTag(P) { var cls = P.shape === 'lone' ? 'acc' : (P.shape === 'contested' ? 'warn' : ''); return '<span class="tag ' + cls + '" title="' + esc(P.nE + ' early-speed horse(s); pace data for ' + Math.round(P.coverage * 100) + '% of the field' + (P.overridden ? '; set by hand' : '')) + '">' + SHAPE_NAME[P.shape] + (P.overridden ? ' (what-if)' : '') + '</span>'; }
function biasWords(b, sk) {
  if (!b) return '';
  var nm = SURF_NAME[sk] || sk;
  if (b.src === 'manual') return '<b>' + nm + ':</b> bias set by hand in the what-if (speed ' + signed(b.speed, 2) + ', inside ' + signed(b.inside, 2) + ').';
  if (!b.n) return '<b>' + nm + ':</b> no races run yet on this surface at this meet, so no bias is applied.';
  var sp = b.speed > 0.05 ? 'early-speed horses are doing better than their share' : (b.speed < -0.05 ? 'closers are doing better than their share' : 'no clear edge for speed or closers');
  var ins = b.inside > 0.05 ? '; inside posts are doing better' : (b.inside < -0.05 ? '; outside posts are doing better' : '');
  return '<b>' + nm + ', after ' + b.n + ' race' + (b.n > 1 ? 's' : '') + ':</b> ' + sp + ins + '. Applied as speed ' + signed(b.speed, 2) + ', inside ' + signed(b.inside, 2) + ' (shrunk toward zero; ' + b.nSpeed + ' race' + (b.nSpeed === 1 ? '' : 's') + ' had enough pace data).';
}
function goingSelect(date, sk, cur) {
  var lab = sk === 'T' ? { fast: 'Firm', good: 'Good', off: 'Yielding / soft' } : { fast: 'Fast', good: 'Good', off: 'Sloppy / muddy' };
  var off = S.conds[(S.races[0] ? E.cardOf(S.races.find(function (r) { return r.date === date; }) || S.races[0]) : '') + '-' + date] || {};
  return '<select data-going="' + date + '|' + sk + '" aria-label="' + SURF_NAME[sk] + ' going">' + '<option value="">' + esc('Official: ' + (off[sk] ? lab[off[sk]] : (sk === 'T' ? 'firm (default)' : 'fast (default)'))) + '</option>' +
    ['fast', 'good', 'off'].map(function (g) { return '<option value="' + g + '"' + (cur === g ? ' selected' : '') + '>What-if: ' + lab[g] + '</option>'; }).join('') + '</select>';
}
var BIAS_PRESETS = { none: { speed: 0, inside: 0, label: 'No bias' }, speed: { speed: 0.2, inside: 0, label: 'Favors early speed' }, closers: { speed: -0.2, inside: 0, label: 'Favors closers' }, inside: { speed: 0, inside: 0.2, label: 'Favors inside posts' }, outside: { speed: 0, inside: -0.2, label: 'Favors outside posts' } };
function biasSelect(sk) {
  var cur = S.ui.scn.bias[sk]; var key = '';
  if (cur) Object.keys(BIAS_PRESETS).forEach(function (k) { if (BIAS_PRESETS[k].speed === cur.speed && BIAS_PRESETS[k].inside === cur.inside) key = k; });
  return '<select data-biasset="' + sk + '" aria-label="' + SURF_NAME[sk] + ' bias"><option value="">Learned from results</option>' + Object.keys(BIAS_PRESETS).map(function (k) { return '<option value="' + k + '"' + (key === k ? ' selected' : '') + '>What-if: ' + BIAS_PRESETS[k].label + '</option>'; }).join('') + '</select>';
}
function upcomingDates() { var ds = {}; S.races.forEach(function (r) { if (!hasRes(r.id)) ds[r.date] = 1; }); return Object.keys(ds).sort(); }
function defaultFday() { var ds = upcomingDates(); var t = todayET(); var after = ds.filter(function (d) { return d > t; }); if (after.length) return after[0]; if (ds.length) return ds[ds.length - 1]; var all = raceDates(); return all[all.length - 1]; }

function forecastChart(a, n) {
  var hs = activeH(a).slice().sort(function (x, y) { return a.M.p[y.pgm] - a.M.p[x.pgm]; }).slice(0, n || 6);
  var rowH = 24, top = 20, left = 170, right = 56, W = 560; var H = top + hs.length * rowH + 22; var pw = W - left - right;
  var mx = Math.max.apply(null, hs.map(function (h) { return Math.max(a.M.p[h.pgm], a.MB.p[h.pgm], a.C.q[h.pgm]); }));
  var xmax = Math.min(1, Math.ceil(mx * 10 + 0.0001) / 10); var X = function (p) { return left + pw * p / xmax; };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Win chance before and after what the earlier races show">';
  for (var g = 0; g <= xmax + 1e-9; g += 0.1) { var gx = X(g); s += '<line class="ax" x1="' + gx + '" x2="' + gx + '" y1="' + (top - 6) + '" y2="' + (H - 18) + '" stroke-dasharray="2 3"/><text class="axt" x="' + gx + '" y="' + (H - 4) + '" text-anchor="middle">' + Math.round(g * 100) + '%</text>'; }
  hs.forEach(function (h, i) {
    var y = top + i * rowH + rowH / 2, p0 = a.MB.p[h.pgm], p1 = a.M.p[h.pgm], q = a.C.q[h.pgm];
    var t = '<b>' + esc(h.name) + '</b><br>Without situation terms ' + pct(p0) + '<br>With them ' + pct(p1) + ' (' + signed((p1 - p0) * 100, 1) + ' pp)<br>Market ' + pct(q);
    s += '<g data-tip="' + esc(t) + '"><rect x="0" y="' + (y - rowH / 2) + '" width="' + W + '" height="' + rowH + '" fill="transparent"/>' + svgChip(h.pgm, 4, y) + '<text class="lbl" x="32" y="' + (y + 4) + '">' + esc(h.name.length > 19 ? h.name.slice(0, 18) + '…' : h.name) + '</text>';
    s += '<rect x="' + (X(q) - 1) + '" y="' + (y - 9) + '" width="2" height="18" fill="var(--s-mkt)" opacity=".7"/>';
    s += '<line x1="' + X(p0) + '" x2="' + X(p1) + '" y1="' + y + '" y2="' + y + '" style="stroke:' + (p1 >= p0 ? 'var(--s-claude)' : 'var(--s-jr)') + ';stroke-width:3"/>';
    s += '<circle cx="' + X(p0) + '" cy="' + y + '" r="4" fill="var(--paper)" style="stroke:var(--neutral);stroke-width:2"/><circle cx="' + X(p1) + '" cy="' + y + '" r="5" fill="var(--s-claude)" stroke="var(--paper)" stroke-width="1.5"/>';
    s += '<text class="lbl2" x="' + (Math.max(X(p0), X(p1), X(q)) + 6) + '" y="' + (y + 4) + '">' + pct(p1, 0) + '</text></g>';
  });
  return s + '<text class="axt" x="' + left + '" y="12">hollow = v1.0 terms only · filled = with situation terms · blue = market</text></svg>';
}
function paceChart(a) {
  var P = a.P, F = a.F; var hs = activeH(a).slice().sort(function (x, y) { var u = F[x.pgm].paceE, v = F[y.pgm].paceE; if (u == null) return 1; if (v == null) return -1; return v - u; });
  var vals = hs.map(function (h) { return F[h.pgm].paceE; }).filter(function (v) { return v != null; });
  if (!vals.length) return '<p class="muted">No horse in this field has US early-pace figures.</p>';
  var lo = Math.floor((Math.min.apply(null, vals) - 4) / 5) * 5, hi = Math.ceil((Math.max.apply(null, vals) + 3) / 5) * 5;
  var rowH = 22, top = 22, left = 170, right = 40, W = 600; var H = top + hs.length * rowH + 22; var pw = W - left - right; var X = function (v) { return left + pw * (v - lo) / (hi - lo); };
  var col = { E: 'var(--s-jr)', P: 'var(--neutral)', S: 'var(--s-mkt)' };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Early-speed ratings across the field">';
  s += '<rect x="' + X(P.top - P.window) + '" y="' + (top - 8) + '" width="' + (X(P.top) - X(P.top - P.window) + 4) + '" height="' + (H - top - 12) + '" fill="var(--hl-yellow)" opacity=".45"/>';
  for (var g = lo; g <= hi; g += 5) s += '<line class="ax" x1="' + X(g) + '" x2="' + X(g) + '" y1="' + (top - 8) + '" y2="' + (H - 18) + '" stroke-dasharray="2 3"/>' + (g % 10 === 0 ? '<text class="axt" x="' + X(g) + '" y="' + (H - 4) + '" text-anchor="middle">' + g + '</text>' : '');
  hs.forEach(function (h, i) {
    var y = top + i * rowH + rowH / 2; var v = F[h.pgm].paceE; var st = P.style[h.pgm];
    var t = '<b>' + esc(h.name) + '</b><br>' + STYLE_NAME[st] + (v != null ? '<br>Early-speed rating ' + v + ' (avg ' + F[h.pgm].paceAvg + ', from up to 3 US races)' : '');
    s += '<g data-tip="' + esc(t) + '"><rect x="0" y="' + (y - rowH / 2) + '" width="' + W + '" height="' + rowH + '" fill="transparent"/>' + svgChip(h.pgm, 4, y) + '<text class="lbl" x="32" y="' + (y + 4) + '">' + esc(h.name.length > 19 ? h.name.slice(0, 18) + '…' : h.name) + '</text>';
    if (v != null) s += '<circle cx="' + X(v) + '" cy="' + y + '" r="5.5" fill="' + col[st] + '" stroke="var(--paper)" stroke-width="1.5"/><text class="lbl2" x="' + (X(v) + 9) + '" y="' + (y + 4) + '">' + st + '</text>';
    else s += '<text class="lbl2" x="' + left + '" y="' + (y + 4) + '">no US pace figures</text>';
    s += '</g>';
  });
  return s + '<text class="axt" x="' + left + '" y="12">early-speed rating → (shaded = within ' + P.window + ' of the fastest = early speed)</text></svg>';
}

function vForecast() {
  var dates = raceDates(); var d = (S.ui.fday && dates.indexOf(S.ui.fday) >= 0) ? S.ui.fday : defaultFday();
  var day = S.races.filter(function (r) { return r.date === d; }); if (!day.length) return '<div class="empty">No races on that day.</div>';
  var first = day[0]; var prior = S.races.filter(function (r) { return E.raceKey(r) < E.raceKey(first); });
  var priorOff = prior.filter(function (r) { return hasRes(r.id); }), priorOpen = prior.filter(function (r) { return !hasRes(r.id); });
  var sameDone = day.filter(function (r) { return hasRes(r.id); }).length;
  var priorHyp = priorOpen.filter(function (r) { return S.ui.scn.hypo[r.id] && S.ui.scn.hypo[r.id].length; });
  var rel = relDay(d);
  var h = '<h2>Forecast · ' + esc(dateLong(d)) + (rel === 'today' || rel === 'tomorrow' ? ' <span class="tag acc">' + rel + '</span>' : '') + '</h2>';
  h += '<p class="ink2">Every race starts from the full model, then takes in what the races before it show: the bias on each surface, rivals from the same prep races who have already run here, the going, and the shape of the pace. It re-runs the moment a result, scratch, live odds or going is saved.</p>';
  h += '<div class="filters"><select id="fcday" aria-label="Race day">' + dates.map(function (x) { var rl = relDay(x); return '<option value="' + x + '"' + (x === d ? ' selected' : '') + '>' + esc(dateLong(x)) + (rl === 'today' || rl === 'tomorrow' ? ' (' + rl + ')' : '') + '</option>'; }).join('') + '</select><span class="small muted">' + day.length + ' races · fed by ' + (priorOff.length + sameDone) + ' official result' + ((priorOff.length + sameDone) === 1 ? '' : 's') + (sameDone ? ' (' + sameDone + ' from this day)' : '') + (priorHyp.length ? ' + ' + priorHyp.length + ' hypothetical' : '') + '</span></div>';
  var surfs = {}; day.forEach(function (r) { surfs[E.raceSurface(r)] = surfs[E.raceSurface(r)] || r.id; });
  var keyN = 0; day.forEach(function (r) { var a = A[r.id]; if (!a) return; activeH(a).forEach(function (hh) { if (a.ctx && a.ctx.keyRefs && a.ctx.keyRefs[hh.pgm] && a.ctx.keyRefs[hh.pgm].length) keyN++; }); });
  var moved = 0; day.forEach(function (r) { var a = A[r.id]; if (a && a.M.order[0] !== a.MB.order[0]) moved++; });
  h += '<div class="grid g4" style="margin:10px 0">' + kpi(day.length, 'races', dateShort(d)) + kpi(priorOff.length + sameDone + (priorHyp.length ? '+' + priorHyp.length : ''), 'earlier races feeding it', priorHyp.length ? 'official + hypothetical' : (priorOpen.length ? priorOpen.length + ' earlier race(s) not yet run' : 'all earlier races have results')) +
    kpi(keyN, 'horses with key-race links', 'rivals from the same preps already run') + kpi(moved, 'top picks changed', 'by situation terms vs v1.0 terms') + '</div>';
  // what earlier races teach
  h += '<div class="cols2"><div class="panel"><h3 style="margin-top:0">What the earlier races are saying</h3>';
  h += Object.keys(surfs).map(function (sk) { var a = A[surfs[sk]]; return '<p>' + biasWords(a && a.ctx && a.ctx.bias, sk) + '</p>'; }).join('');
  var links = [];
  day.forEach(function (r) { var a = A[r.id]; if (!a) return; activeH(a).forEach(function (hh) { var refs = a.ctx && a.ctx.keyRefs && a.ctx.keyRefs[hh.pgm]; if (refs && refs.length) links.push({ r: r, h: hh, refs: refs, pp: partPP(a, hh.pgm, 'keyRace') }); }); });
  links.sort(function (x, y) { return Math.abs(y.pp) - Math.abs(x.pp); });
  if (links.length) {
    h += '<h3>Key races</h3><ul class="small" style="padding-left:18px;margin:4px 0">' + links.slice(0, 10).map(function (x) {
      var f = x.refs[0]; var rr = S.races.find(function (q) { return q.id === f.rivalRace; });
      return '<li><a href="#horse-' + x.r.id + '-' + x.h.pgm + '">' + esc(x.h.name) + '</a> <span class="muted">' + esc(raceShort(x.r)) + '</span>: met ' + esc(f.rival) + ' in the ' + esc(f.prep) + ' (' + (f.meFin ? ordinal(f.meFin) : '?') + ' vs ' + (f.rivalFin ? ordinal(f.rivalFin) : '?') + '); ' + esc(f.rival) + ' then ran ' + (f.rivalPos % 1 ? 'unplaced' : ordinal(f.rivalPos)) + ' in ' + esc(rr ? raceShort(rr) : f.rivalRace) + ', ' + (f.rivalOp > 0.01 ? 'better than' : (f.rivalOp < -0.01 ? 'worse than' : 'about as')) + ' the market expected' + (x.refs.length > 1 ? ' (+' + (x.refs.length - 1) + ' more link' + (x.refs.length > 2 ? 's' : '') + ')' : '') + '. Effect <b class="num" style="color:' + (x.pp >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + signed(x.pp * 100, 1) + ' pp</b></li>';
    }).join('') + '</ul>';
  } else h += '<p class="small muted">Key races: no horse on this day has met a rival who has already run here' + (priorOff.length + priorHyp.length ? '' : ' (nothing has run yet)') + '. ' + (S.X ? S.X.keyRaces.filter(function (k) { return k.races.length > 1; }).length : 0) + ' prep races link two or more of these Breeders\' Cup fields; they switch on as results come in.</p>';
  h += '</div><div class="panel"><h3 style="margin-top:0">Conditions and what-if</h3><p class="small ink2">What-if settings stay in this browser and recompute every screen. Official going is saved for everyone.</p>';
  Object.keys(surfs).forEach(function (sk) { var c = (S.ui.scn.going[d] || {})[sk]; h += '<div class="filters"><b style="min-width:70px">' + SURF_NAME[sk] + '</b>' + goingSelect(d, sk, c) + biasSelect(sk) + '</div>'; });
  h += '<div class="filters"><button class="btn" data-act="going-official" data-date="' + d + '"' + (canSave() ? '' : ' disabled') + '>Save the what-if going as official</button></div>';
  if (priorOpen.length) {
    h += '<h3>Hypothetical results for races not yet run</h3><p class="small ink2">Type a finish order (program numbers) to see how this day would change if it happened.</p><div class="tw"><table><tbody>' + priorOpen.map(function (r) { var a = A[r.id]; var v = (S.ui.scn.hypo[r.id] || []).join(' '); return '<tr><td class="small"><a href="#race-' + r.id + '">' + esc(raceTitle(r)) + '</a></td><td><input type="text" size="12" data-hypo="' + r.id + '" value="' + esc(v) + '" placeholder="' + esc(a ? a.M.order.slice(0, 3).join(' ') : '') + '"></td></tr>'; }).join('') + '</tbody></table></div>';
    h += '<div class="filters"><button class="btn primary" data-act="hypo-run">Run what-if</button><button class="btn" data-act="hypo-fill">Fill with each race\'s model top 3</button><button class="btn" data-act="scn-reset"' + (scnParts().length ? '' : ' disabled') + '>Clear what-if</button></div>';
  } else h += '<p class="small muted">Every earlier race has an official result.</p><div class="filters"><button class="btn" data-act="scn-reset"' + (scnParts().length ? '' : ' disabled') + '>Clear what-if</button></div>';
  h += '</div></div>';
  // race table
  h += '<h3>The day, race by race</h3><div class="tw"><table><thead><tr><th>Race</th><th>Post</th><th>Going</th><th>Pace</th><th>Claude\'s top three</th><th>Moved most by situation</th><th>Read</th></tr></thead><tbody>';
  day.forEach(function (r) {
    var a = A[r.id]; if (!a) return; var g = goingOf(r);
    var mv = activeH(a).map(function (hh) { return { h: hh, d: sitPP(a, hh.pgm) }; }).sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); })[0];
    h += '<tr class="click" data-go="race-' + r.id + '"><td><b>' + esc(raceShort(r)) + '</b> ' + esc(r.name) + (hasRes(r.id) ? ' <span class="tag good">result in</span>' : '') + '</td><td class="num">' + esc(r.post || '') + '</td><td class="small">' + esc(SURF_NAME[E.raceSurface(r)] + ' ' + goingLabel(E.raceSurface(r), g.v || 'fast')) + (g.src === 'what-if' ? ' <span class="tag warn">what-if</span>' : '') + '</td><td>' + shapeTag(a.P) + '</td><td>' + a.M.order.slice(0, 3).map(function (p) { return chip(p) + ' <span class="small num">' + pct(a.M.p[p], 0) + '</span>'; }).join(' ') + '</td><td class="small">' + (mv ? esc(mv.h.name) + ' <b class="num" style="color:' + (mv.d >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + signed(mv.d * 100, 1) + ' pp</b>' : '') + '</td><td>' + confTag(a) + (a.M.order[0] !== a.MB.order[0] ? ' <span class="tag warn" title="The situation terms change the top pick">top pick changed</span>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<h3>How each race moved</h3><div class="grid g2w">' + day.map(function (r) { var a = A[r.id]; if (!a) return ''; return '<div class="panel"><div class="eyebrow">' + esc(raceShort(r) + ' · ' + (r.post || '') + ' ET') + '</div><h3 style="margin:2px 0 6px"><a href="#race-' + r.id + '" style="color:inherit">' + esc(r.name) + '</a></h3>' + forecastChart(a, 6) + '</div>'; }).join('') + '</div>';
  h += '<p class="note" style="margin-top:14px">Situation terms are small by design (v1.1 weights are priors, not fitted). The self-review refits them only when held-out races improve. Decision support, not betting advice.</p>';
  return h;
}

function raceSituation(a) {
  var r = a.race, P = a.P, F = a.F, ctx = a.ctx || {}; var sk = E.raceSurface(r); var g = goingOf(r);
  var h = '<p class="ink2">How this field fits today\'s conditions, how the pace should set up, and what earlier races at the meet say. Changes here are what-ifs kept in this browser.</p>';
  h += '<div class="filters"><b>' + SURF_NAME[sk] + ' going</b>' + goingSelect(r.date, sk, (S.ui.scn.going[r.date] || {})[sk]) + '<b style="margin-left:10px">Pace</b><select data-pace="' + r.id + '" aria-label="Pace shape"><option value="">Auto: ' + SHAPE_NAME[P.auto] + '</option>' + ['lone', 'honest', 'contested'].map(function (x) { return '<option value="' + x + '"' + (S.ui.scn.pace[r.id] === x ? ' selected' : '') + '>What-if: ' + SHAPE_NAME[x] + '</option>'; }).join('') + '</select>' + biasSelect(sk) + '</div>';
  h += '<p>' + biasWords(ctx.bias, sk) + '</p>';
  h += '<div class="cols2"><div class="panel"><h3 style="margin-top:0">Pace map ' + shapeTag(P) + '</h3><p class="small ink2">Early-speed rating from each horse\'s last three US early-pace figures. ' + P.nE + ' horse' + (P.nE === 1 ? ' is' : 's are') + ' within ' + P.window + ' points of the fastest. Pace data covers ' + Math.round(P.coverage * 100) + '% of the field' + (P.coverage < 0.7 ? ', so the pace term is scaled down' : '') + '.</p>' + paceChart(a) + '</div>';
  h += '<div class="panel"><h3 style="margin-top:0">What the situation terms add</h3><p class="small ink2">Win chance with the v1.1 situation terms against the same model with them off.</p>' + forecastChart(a, 8) + '</div></div>';
  h += '<h3>Horse by horse</h3><div class="tw"><table><thead><tr><th>#</th><th>Horse</th><th>Style</th><th class="r" title="Halfway between the average and best of the last three US early-pace figures">Early rating</th><th class="r" title="Average figure in races most like this one: same surface, similar distance, same going, recent races count more">Situational fig</th><th class="r" title="Situational figure minus the 3-race average">vs 3-race avg</th><th class="r" title="How many past races resemble today, weighted (1.0 = one identical recent race)">Comparable races</th><th>Closest past race</th><th class="r">On this surface (last 6)</th><th class="r">Wet-track runs</th><th class="r">Key-race links</th><th class="r">Situation effect</th></tr></thead><tbody>';
  activeH(a).slice().sort(function (x, y) { return byNum(x.pgm, y.pgm); }).forEach(function (hh) {
    var f = F[hh.pgm]; var refs = (ctx.keyRefs && ctx.keyRefs[hh.pgm]) || []; var d = sitPP(a, hh.pgm);
    h += '<tr class="click" data-go="horse-' + r.id + '-' + hh.pgm + '"><td>' + chip(hh.pgm) + '</td><td>' + esc(hh.name) + statusTag(hh) + '</td><td class="small">' + STYLE_NAME[P.style[hh.pgm]] + '</td><td class="r num">' + (f.paceE != null ? f.paceE : '—') + '</td><td class="r num">' + (f.sitFig != null ? f.sitFig.toFixed(1) : '—') + '</td><td class="r num">' + (f.sitDelta != null ? signed(f.sitDelta, 1) : '—') + '</td><td class="r num">' + f.evidence.toFixed(2) + '</td><td class="small">' + esc(f.closest || '—') + '</td><td class="r num">' + f.onSurf + '</td><td class="r num">' + f.offRuns + '</td><td class="r num">' + (refs.length || '') + '</td><td class="r num" style="color:' + (d >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + signed(d * 100, 1) + ' pp</td></tr>';
  });
  h += '</tbody></table></div><p class="small muted">Surface and going for past races are read from the Equibase going code and course mark (for example "fmp" = firm turf, "fto" = fast synthetic); the course marks were decoded from the tracks they appear at. Post is taken from the program number.</p>';
  var anyRefs = activeH(a).filter(function (hh) { return ctx.keyRefs && ctx.keyRefs[hh.pgm] && ctx.keyRefs[hh.pgm].length; });
  if (anyRefs.length) h += '<h3>Key-race links</h3><div class="tw"><table><thead><tr><th>Horse</th><th>Prep race</th><th>Finish there</th><th>Rival</th><th>Rival since</th><th class="r">Rival vs market</th></tr></thead><tbody>' + anyRefs.map(function (hh) { return ctx.keyRefs[hh.pgm].map(function (f) { var rr = S.races.find(function (q) { return q.id === f.rivalRace; }); return '<tr><td>' + chip(hh.pgm) + ' ' + esc(hh.name) + '</td><td class="small">' + esc(f.prep) + '</td><td class="r">' + (f.meFin ? ordinal(f.meFin) : '—') + '</td><td>' + esc(f.rival) + ' <span class="muted small">' + (f.rivalFin ? ordinal(f.rivalFin) : '') + '</span></td><td class="small">' + esc(rr ? raceShort(rr) : '') + ' · ' + (f.rivalPos % 1 ? 'unplaced' : ordinal(f.rivalPos)) + '</td><td class="r num" style="color:' + (f.rivalOp >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + signed(f.rivalOp * 100, 0) + '</td></tr>'; }).join(''); }).join('') + '</tbody></table></div><p class="small muted">Rival vs market = (market rank − finish) ÷ field size × 100: positive means the rival ran better than the odds said.</p>';
  return h;
}

function vSituations() {
  var t = S.ui.sitTab; var tabs = [['explorer', 'Situation explorer'], ['pace', 'Pace maps'], ['key', 'Key races'], ['bias', 'Track bias']];
  var h = '<h2>Situations</h2><p class="ink2">Every horse, every race, looked at by the conditions it has run under: surface, distance, going, class, where and at which track. This is what the forecast reads when it projects a race that has not been run yet.</p>';
  h += '<div class="subtabs">' + tabs.map(function (x) { return '<button class="' + (t === x[0] ? 'on' : '') + '" data-st2="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
  var dates = raceDates(); var dsel = '<select id="sitday" aria-label="Day"><option value="all">Every day</option>' + dates.map(function (d) { return '<option value="' + d + '"' + (S.ui.sitDay === d ? ' selected' : '') + '>' + esc(dateLong(d)) + '</option>'; }).join('') + '</select>';
  var races = S.races.filter(function (r) { return S.ui.sitDay === 'all' || r.date === S.ui.sitDay; });
  if (t === 'explorer') {
    var dim = S.ui.sitDim; var vals = {}; var rows = [];
    races.forEach(function (r) { var a = A[r.id]; if (!a) return; var today = E.raceSituation(r, goingOf(r).v);
      activeH(a).forEach(function (hh) { E.sitTable(hh, r, tOff()).forEach(function (x) { if (x.dimKey !== dim) return; vals[x.value] = (vals[x.value] || 0) + 1; rows.push({ r: r, h: hh, x: x, p: a.M.p[hh.pgm], today: today[dim] === x.value }); }); }); });
    var vlist = Object.keys(vals).sort(function (a, b) { return vals[b] - vals[a]; }); var v = vlist.indexOf(S.ui.sitVal) >= 0 ? S.ui.sitVal : vlist[0];
    rows = rows.filter(function (x) { return x.x.value === v; }).sort(function (x, y) { var a1 = x.x.avgFig, b1 = y.x.avgFig; if (a1 == null) return 1; if (b1 == null) return -1; return b1 - a1; });
    h += '<div class="filters"><select id="sitdim" aria-label="Dimension">' + E.SIT_DIMS.map(function (d) { return '<option value="' + d.key + '"' + (d.key === dim ? ' selected' : '') + '>' + d.label + '</option>'; }).join('') + '</select><select id="sitval" aria-label="Value">' + vlist.map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' + dsel + '<span class="small muted">' + rows.length + ' horses have run in this situation</span></div>';
    h += '<div class="tw"><table><thead><tr><th>Horse</th><th>Running in</th><th class="r">Claude</th><th class="r">Starts</th><th class="r">Wins</th><th class="r">Top 3</th><th class="r">Avg fig</th><th class="r">Best fig</th><th>Today is this?</th></tr></thead><tbody>' + rows.map(function (x) {
      return '<tr class="click" data-go="horse-' + x.r.id + '-' + x.h.pgm + '"><td>' + chip(x.h.pgm) + ' ' + esc(x.h.name) + '</td><td class="small">' + esc(raceTitle(x.r)) + '</td><td class="r num">' + pct(x.p) + '</td><td class="r num">' + x.x.starts + '</td><td class="r num">' + x.x.wins + '</td><td class="r num">' + x.x.itm + '</td><td class="r num">' + (x.x.avgFig != null ? x.x.avgFig.toFixed(1) : '—') + '</td><td class="r num">' + (x.x.bestFig != null ? x.x.bestFig : '—') + '</td><td>' + (x.today ? '<span class="tag good">yes</span>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="small muted">From the races in each horse\'s free past performances (up to six). Overseas ratings are placed on the US scale (' + E.T_OFFSET.juvenile + ' for 2-year-olds, ' + E.T_OFFSET.older + ' for older horses). "Today is this?" uses the going currently in force.</p>';
  } else if (t === 'pace') {
    h += '<div class="filters">' + dsel + '</div><div class="grid g2w">' + races.map(function (r) { var a = A[r.id]; if (!a) return ''; return '<div class="panel"><div class="eyebrow">' + esc(raceShort(r)) + '</div><h3 style="margin:2px 0 6px"><a href="#race-' + r.id + '" style="color:inherit">' + esc(r.name) + '</a> ' + shapeTag(a.P) + '</h3>' + paceChart(a) + '</div>'; }).join('') + '</div>';
  } else if (t === 'key') {
    var list = (S.X ? S.X.keyRaces : []).filter(function (k) { return S.ui.keyAll || k.races.length > 1; }).filter(function (k) { return S.ui.sitDay === 'all' || k.races.some(function (id) { var r = S.races.find(function (q) { return q.id === id; }); return r && r.date === S.ui.sitDay; }); });
    list.sort(function (x, y) { if ((x.strength != null) !== (y.strength != null)) return x.strength != null ? -1 : 1; return (E.ppDate(y.d) || 0) - (E.ppDate(x.d) || 0); });
    h += '<p class="ink2">A key race is a prep that sent more than one horse here. When one of them runs better than the market expected, the others from that prep get a nudge up (more if they beat that horse in the prep); when it runs worse, a nudge down. Strength is shrunk toward zero until several have run.</p>';
    h += '<div class="filters">' + dsel + '<label class="small"><input type="checkbox" id="keyall"' + (S.ui.keyAll ? ' checked' : '') + '> include preps whose entrants all run in the same race</label><span class="small muted">' + list.length + ' prep races</span></div>';
    h += '<div class="tw"><table><thead><tr><th>Prep race</th><th>Horses from it running here</th><th class="r">Strength</th></tr></thead><tbody>' + list.map(function (k) {
      return '<tr><td class="small">' + esc(k.d + ' ' + k.trk + ' ' + (k.fl ? k.fl + 'f' : k.dist) + ' ' + (/^[123]$/.test(k.gr || '') ? 'G' + k.gr : (k.gr || '')) + ' · ' + SURF_NAME[E.lineSurface(k)] + (k.abroad ? ' · abroad' : '')) + '</td><td style="white-space:normal;min-width:320px">' + k.grads.map(function (g) { var r = S.races.find(function (q) { return q.id === g.rid; }); return '<span style="display:inline-block;margin:1px 10px 1px 0">' + chip(g.pgm) + ' <a href="#horse-' + g.rid + '-' + g.pgm + '">' + esc(g.name) + '</a> <span class="muted small">' + (g.fin ? ordinal(g.fin) : '—') + ' there → ' + esc(r ? raceShort(r) : '') + (g.ran ? ': ' + (g.pos % 1 ? 'unplaced' : ordinal(g.pos)) + ' (' + signed(g.op * 100, 0) + ')' : '') + '</span></span>'; }).join('') + '</td><td class="r num">' + (k.strength != null ? signed(k.strength * 100, 0) : '<span class="muted">waiting</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="small muted">Same prep = same date, track, distance, grade, going and field size (split by the Breeders\' Cup race\'s sex where two races that day collide). Numbers in brackets: beat (+) or missed (−) the market by that many places per 100 starters.</p>';
  } else if (t === 'bias') {
    var cards = {}; S.races.forEach(function (r) { cards[E.cardOf(r)] = 1; });
    h += '<p class="ink2">After each race, the review checks whether the first three home were the field\'s early-speed horses and whether they drew inside. A surface\'s bias is the average of those readings, shrunk toward zero (three races of evidence count for half), and it is applied only to later races on the same surface at the same meet.</p>';
    Object.keys(cards).forEach(function (c) { var B = S.X && S.X.bias[c]; if (!B) return; ['D', 'T', 'S'].forEach(function (sk) {
      var races = S.races.filter(function (r) { return E.cardOf(r) === c && E.raceSurface(r) === sk; }); if (!races.length) return; var b = B[sk];
      h += '<h3>' + esc(SURF_NAME[sk]) + ' · ' + esc(c) + '</h3><div class="grid g4">' + kpi(b.n + ' / ' + races.length, 'races with results', 'official and hypothetical') + kpi(signed(b.speed, 2), 'speed bias', b.speed > 0.05 ? 'favoring early speed' : (b.speed < -0.05 ? 'favoring closers' : 'no clear edge')) + kpi(signed(b.inside, 2), 'post bias', b.inside > 0.05 ? 'inside doing better' : (b.inside < -0.05 ? 'outside doing better' : 'no clear edge')) + kpi(S.ui.scn.bias[sk] ? 'what-if' : 'learned', 'in force', S.ui.scn.bias[sk] ? 'set by hand on this screen' : 'from results') + '</div>';
      var done = races.filter(function (r) { return S.X.base[r.id] && S.X.base[r.id].done; });
      if (done.length) h += '<div class="tw" style="margin-top:8px"><table><thead><tr><th>Race</th><th>First three</th><th class="r">Their early-speed rank</th><th class="r">Speed reading</th><th class="r">Post reading</th></tr></thead><tbody>' + done.map(function (r) { var o = S.X.base[r.id]; return '<tr><td>' + esc(raceTitle(r)) + (hasRes(r.id) ? '' : ' <span class="tag warn">hypothetical</span>') + '</td><td>' + o.top3.map(function (p) { return chip(p); }).join(' ') + '</td><td class="r num">' + o.top3.map(function (p) { return o.P.pctE[p] != null ? Math.round(o.P.pctE[p] * 100) : '—'; }).join(' · ') + '</td><td class="r num">' + (o.speedObs != null ? signed(o.speedObs, 2) : '—') + '</td><td class="r num">' + (o.insideObs != null ? signed(o.insideObs, 2) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted">Early-speed rank: 100 = fastest early in that field, 0 = slowest. Readings compare the first three with the field average.</p>';
    }); });
  }
  return h;
}

function vConnections() {
  var kind = S.ui.connKind; var people = {};
  S.races.forEach(function (r) { var a = A[r.id]; if (!a) return; var o = S.X && S.X.base[r.id];
    activeH(a).forEach(function (hh) { var raw = kind === 'J' ? hh.jockey : hh.trainer; var k = E.normName(raw); if (!k) return; var m = people[k] || (people[k] = { k: k, name: titleCase(raw), mounts: [], exp: 0, mkt: 0, starts: 0, wins: 0, itm: 0, op: 0 });
      var pos = o && o.done ? o.pos[hh.pgm] : null; var hyp = o && o.done && !hasRes(r.id);
      m.mounts.push({ r: r, h: hh, p: a.M.p[hh.pgm], q: a.C.q[hh.pgm], pos: pos, hyp: hyp }); m.exp += a.M.p[hh.pgm]; m.mkt += a.C.q[hh.pgm];
      if (pos != null) { m.starts++; if (pos === 1) m.wins++; if (pos <= 3) m.itm++; m.op += o.op[hh.pgm]; } }); });
  var rows = Object.keys(people).map(function (k) { return people[k]; }).sort(function (a, b) { return b.exp - a.exp; });
  var h = '<h2>Connections</h2><p class="ink2">Every jockey and trainer across all the races loaded: how many winners the model expects from their mounts, and, as results come in, whether their horses are running better or worse than the market said. That form at the meet is shown for every horse; it moves the model only once the self-review finds it helps (weight ' + (weightsNow().conn || 0) + ').</p>';
  h += '<div class="subtabs"><button class="' + (kind === 'J' ? 'on' : '') + '" data-ck="J">Jockeys</button><button class="' + (kind === 'T' ? 'on' : '') + '" data-ck="T">Trainers</button></div>';
  h += '<div class="tw"><table><thead><tr><th>' + (kind === 'J' ? 'Jockey' : 'Trainer') + '</th><th class="r">Mounts</th><th class="r" title="Sum of Claude win chances over their mounts">Expected wins</th><th class="r">Market expects</th><th class="r">Run so far</th><th class="r">Won</th><th class="r">Top 3</th><th class="r" title="Sum over runs of (market rank − finish) ÷ field size">vs market</th><th>Races</th></tr></thead><tbody>';
  rows.forEach(function (m) {
    var open = S.ui.connSel === kind + m.k;
    h += '<tr class="click" data-conn="' + esc(kind + m.k) + '"><td><b>' + esc(m.name) + '</b></td><td class="r num">' + m.mounts.length + '</td><td class="r num">' + m.exp.toFixed(2) + '</td><td class="r num">' + m.mkt.toFixed(2) + '</td><td class="r num">' + m.starts + '</td><td class="r num">' + m.wins + '</td><td class="r num">' + m.itm + '</td><td class="r num" style="color:' + (m.op > 0 ? 'var(--good)' : (m.op < 0 ? 'var(--bad)' : 'inherit')) + '">' + (m.starts ? signed(m.op * 100, 0) : '—') + '</td><td class="small">' + m.mounts.map(function (x) { return esc(raceShort(x.r)); }).join(', ') + '</td></tr>';
    if (open) h += '<tr><td colspan="9" style="white-space:normal;background:var(--line2)">' + m.mounts.map(function (x) { return '<div style="margin:3px 0">' + chip(x.h.pgm) + ' <a href="#horse-' + x.r.id + '-' + x.h.pgm + '">' + esc(x.h.name) + '</a> <span class="small muted">' + esc(raceTitle(x.r)) + '</span> · Claude ' + pct(x.p) + ' · market ' + pct(x.q) + (x.pos != null ? ' · finished ' + (x.pos % 1 ? 'unplaced' : ordinal(x.pos)) + (x.hyp ? ' (hypothetical)' : '') : '') + '</div>'; }).join('') + '</td></tr>';
  });
  h += '</tbody></table></div><p class="small muted">Click a row for the mounts. ' + rows.length + ' ' + (kind === 'J' ? 'jockeys' : 'trainers') + '. Names are matched as printed in the program; a rider listed two ways counts twice.</p>';
  return h;
}

// ---------- cards: load future cards into the same site ----------
var RACE_TEMPLATE = { id: 'aqu26-nov07-r9', card: 'aqu26', date: '2026-11-07', cardRace: 9, name: 'Example Stakes', distance: '1 1/8 mi', surface: 'dirt', grade: 'G2', purse: '$300,000', post: '4:40 PM', track: 'Aqueduct', trkCode: 'Aqu',
  horses: [{ pgm: '1', name: 'Horse Name', ml: '5-2', jockey: 'Jockey Name', trainer: 'Trainer Name', status: 'starter', wt: 124, races: [{ d: '04Oct26', trk: 'Bel', fo: 0, sc: 'ft', dist: '1N', fl: 9, gr: '1', fig: 101, ft: 'E', pace: 96, fin: 2, mg: 1.5, odds: 3.2, fav: false, fs: 8 }], experts: [] },
    { pgm: '2', name: 'Second Horse', ml: '3-1', jockey: 'Jockey Name', trainer: 'Trainer Name', status: 'starter', wt: 124, races: [], experts: [] }] };
function normRace(x) {
  var errs = []; if (!x || typeof x !== 'object') return { errs: ['not an object'] };
  var r = JSON.parse(JSON.stringify(x));
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(r.id || '') || String(r.id).indexOf('-') < 0) errs.push('id must be lowercase letters, numbers and dashes, card first (e.g. aqu26-nov07-r9)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) errs.push('date must be YYYY-MM-DD');
  r.cardRace = parseInt(r.cardRace, 10); if (!(r.cardRace > 0)) errs.push('cardRace must be the race number');
  if (!r.name) errs.push('name is missing'); if (!E.raceFurlongs(r)) errs.push('distance not understood (use 6f, 5 1/2f, 1 mi, 1 1/16 mi)'); if (!r.surface) errs.push('surface is missing (dirt, turf or synthetic)');
  if (!Array.isArray(r.horses) || r.horses.length < 2) errs.push('needs at least two horses');
  r.card = r.card || String(r.id || '').split('-')[0]; r.jr = r.jr || null;
  var seen = {};
  (r.horses || []).forEach(function (h, i) { h.pgm = String(h.pgm == null ? '' : h.pgm).trim().toUpperCase(); if (!h.pgm) errs.push('horse ' + (i + 1) + ' has no program number'); else if (!/^[0-9]{1,2}[A-Z]?$/.test(h.pgm)) errs.push('program number "' + h.pgm + '" must be a number like 7 or 1A'); if (seen[h.pgm]) errs.push('program number ' + h.pgm + ' appears twice'); seen[h.pgm] = 1;
    if (!h.name) errs.push('horse ' + h.pgm + ' has no name'); if (E.mlToProb(h.ml) == null) errs.push('horse ' + h.pgm + (h.ml == null || h.ml === '' ? ' has no morning line' : ' morning line not understood: ' + h.ml));
    h.status = h.status || 'starter'; h.ae = !!h.ae; h.races = Array.isArray(h.races) ? h.races : []; h.experts = Array.isArray(h.experts) ? h.experts : []; h.note = h.note || null; });
  r.horses = r.horses || []; return { race: r, errs: errs };
}
function parseQuickRace() {
  function v(id) { var el = $('#' + id); return el ? el.value.trim() : ''; }
  var lines = v('qr-horses').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
  var horses = lines.map(function (l) { var p = l.split(/\s*[|,\t]\s*/); return { pgm: p[0], name: p[1], ml: p[2], jockey: p[3] || '', trainer: p[4] || '' }; });
  var card = v('qr-card').toLowerCase(), date = v('qr-date'), no = v('qr-no');
  return { id: card + '-' + date.slice(5).replace('-', '') + '-r' + no, card: card, date: date, cardRace: no, name: v('qr-name'), distance: v('qr-dist'), surface: v('qr-surf'), grade: v('qr-grade'), post: v('qr-post'), track: v('qr-track'), purse: v('qr-purse'), horses: horses };
}
function previewCard(list) {
  var out = { races: [], errs: [], hits: [] };
  list.forEach(function (x, i) { var n = normRace(x); if (n.errs.length) { out.errs.push('Race ' + (x && x.id ? x.id : i + 1) + ': ' + n.errs.join('; ')); return; }
    var hits = E.attachFromBook(n.race, S.book).filter(function (hh) { return !(hh.from.length === 1 && hh.from[0] === n.race.id); });
    out.races.push(n.race); out.hits.push({ rid: n.race.id, hits: hits }); });
  return out;
}
function vCards() {
  var cards = {}; S.races.forEach(function (r) { var c = E.cardOf(r); var o = cards[c] || (cards[c] = { c: c, dates: {}, n: 0, res: 0, horses: 0 }); o.dates[r.date] = 1; o.n++; if (hasRes(r.id)) o.res++; o.horses += r.horses.length; });
  var ed = S.canEdit;
  var h = '<h2>Cards</h2><p class="ink2">Every card loaded into this site. Load a new card and it gets every view here: forecast, situations, factors, Jr\'s method, connections. Horses already in the book (any earlier card, with their Breeders\' Cup results) bring their history with them.</p>';
  h += '<div class="tw"><table><thead><tr><th>Card</th><th>Dates</th><th class="r">Races</th><th class="r">Results in</th><th class="r">Entries</th></tr></thead><tbody>' + Object.keys(cards).map(function (k) { var o = cards[k]; return '<tr><td><b>' + esc(k) + '</b></td><td class="small">' + Object.keys(o.dates).sort().map(dateShort).join(', ') + '</td><td class="r num">' + o.n + '</td><td class="r num">' + o.res + '</td><td class="r num">' + o.horses + '</td></tr>'; }).join('') + '</tbody></table></div>';
  h += '<p class="small muted">Horse book: ' + Object.keys(S.book || {}).length + ' horses, ' + Object.keys(S.book || {}).reduce(function (s, k) { return s + S.book[k].lines.length; }, 0) + ' past races on file.</p>';
  if (!ed) return h + '<p class="note">Only editors of this page can load or remove cards. Ask Claude: "Load the [track, date] card into the Breeders & Jr Engine."</p>';
  h += '<div class="cols2"><div class="panel"><h3 style="margin-top:0">Quick-add a race</h3><p class="small ink2">For a card without full past performances: one line per horse, "program, name, morning line, jockey, trainer". Known horses pick up their history automatically.</p>';
  h += '<div class="filters"><input type="text" id="qr-card" placeholder="Card id, e.g. aqu26" size="10"><input type="text" id="qr-date" placeholder="Date YYYY-MM-DD" size="13"><input type="text" id="qr-no" placeholder="Race #" size="5"><input type="text" id="qr-post" placeholder="Post time" size="8"></div>';
  h += '<div class="filters"><input type="text" id="qr-name" placeholder="Race name" size="22"><input type="text" id="qr-dist" placeholder="Distance, e.g. 1 1/8 mi" size="14"><select id="qr-surf"><option>dirt</option><option>turf</option><option>synthetic</option></select><input type="text" id="qr-grade" placeholder="Grade (G1)" size="6"></div>';
  h += '<div class="filters"><input type="text" id="qr-track" placeholder="Track name" size="14"><input type="text" id="qr-purse" placeholder="Purse" size="10"></div>';
  h += '<textarea id="qr-horses" rows="7" style="width:100%" placeholder="1, Horse Name, 5-2, Jockey Name, Trainer Name"></textarea><div class="filters"><button class="btn" data-act="card-quick">Check this race</button></div></div>';
  h += '<div class="panel"><h3 style="margin-top:0">Load races as JSON</h3><p class="small ink2">One race object or a list of them, in the same shape as the races already here (Claude writes this when it reads a card\'s past performances).</p><textarea id="card-json" rows="10" style="width:100%;font-family:var(--f-mono);font-size:12px" placeholder="[ { &quot;id&quot;: &quot;aqu26-nov07-r9&quot;, ... } ]"></textarea><div class="filters"><button class="btn" data-act="card-check">Check</button><button class="btn" data-act="card-template">Show an example</button></div></div></div>';
  if (S.ui.cardMsg) h += '<p class="note">' + esc(S.ui.cardMsg) + '</p>';
  var pv = S.ui.cardPreview;
  if (pv) {
    h += '<h3>Ready to save</h3>' + (pv.errs.length ? '<ul class="small" style="color:var(--bad)">' + pv.errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '');
    if (pv.races.length) {
      h += '<div class="tw"><table><thead><tr><th>Race id</th><th>Race</th><th class="r">Horses</th><th>Known horses (history attached)</th><th>Note</th></tr></thead><tbody>' + pv.races.map(function (r, i) { var hits = pv.hits[i].hits; var exists = S.races.some(function (q) { return q.id === r.id; }); return '<tr><td class="mono">' + esc(r.id) + '</td><td>' + esc(dateShort(r.date) + ' R' + r.cardRace + ' · ' + r.name + ' · ' + r.distance + ' ' + r.surface) + '</td><td class="r num">' + r.horses.length + '</td><td class="small" style="white-space:normal">' + (hits.length ? hits.map(function (x) { return esc(x.name) + ' (' + x.lines + ' past races)'; }).join(', ') : '<span class="muted">none</span>') + '</td><td>' + (exists ? '<span class="tag warn">replaces the existing race</span>' : '<span class="tag good">new</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      h += '<div class="filters"><button class="btn primary" data-act="card-save">Save ' + pv.races.length + ' race' + (pv.races.length > 1 ? 's' : '') + ' to the database</button><button class="btn" data-act="card-cancel">Cancel</button></div>';
    }
  }
  h += '<h3>Remove a race</h3><div class="filters"><select id="card-del">' + S.races.map(function (r) { return '<option value="' + r.id + '">' + esc(r.id + ' · ' + raceTitle(r)) + '</option>'; }).join('') + '</select><button class="btn" data-act="card-del">Remove…</button><span class="small muted">Asks before deleting; results and odds for that race stay on file.</span></div>';
  return h;
}

function horseSituation(a, hh) {
  var r = a.race, f = a.F[hh.pgm], P = a.P, ctx = a.ctx || {}; var g = goingOf(r).v; var today = E.raceSituation(r, g);
  var refs = (ctx.keyRefs && ctx.keyRefs[hh.pgm]) || []; var act = E.isActive(hh);
  var h = '<h3>Situation</h3><div class="grid g4">' + kpi(STYLE_NAME[P.style[hh.pgm]] || '—', 'run style', f.paceE != null ? 'early rating ' + f.paceE + ' · field ' + SHAPE_NAME[P.shape] : SHAPE_NAME[P.shape]) +
    kpi(f.sitFig != null ? f.sitFig.toFixed(1) : '—', 'situational figure', f.sitDelta != null ? signed(f.sitDelta, 1) + ' vs 3-race average · ' + f.evidence.toFixed(2) + ' comparable races' : 'not enough comparable races') +
    kpi(refs.length, 'key-race links', refs.length ? refs.map(function (x) { return x.rival; }).slice(0, 2).join(', ') + (refs.length > 2 ? '…' : '') : 'none yet') +
    kpi(act ? signed(sitPP(a, hh.pgm) * 100, 1) + ' pp' : '—', 'situation effect', 'v1.1 terms against the same model without them') + '</div>';
  var rows = E.sitTable(hh, r, tOff());
  h += '<div class="tw" style="margin-top:10px"><table><thead><tr><th>Dimension</th><th>Situation</th><th class="r">Starts</th><th class="r">Wins</th><th class="r">Top 3</th><th class="r">Avg fig</th><th class="r">Best fig</th></tr></thead><tbody>' + rows.map(function (x) { var isToday = today[x.dimKey] === x.value; return '<tr><td class="small ink2">' + esc(x.dim) + '</td><td>' + (isToday ? '<span class="hl" style="padding:0 4px">' + esc(x.value) + '</span> <span class="tag good">today</span>' : esc(x.value)) + '</td><td class="r num">' + x.starts + '</td><td class="r num">' + x.wins + '</td><td class="r num">' + x.itm + '</td><td class="r num">' + (x.avgFig != null ? x.avgFig.toFixed(1) : '—') + '</td><td class="r num">' + (x.bestFig != null ? x.bestFig : '—') + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted">From the races in the free past performances (up to six). Green = today\'s conditions' + (g ? ' (going: ' + goingLabel(E.raceSurface(r), g) + ')' : '') + '.</p>';
  var b = S.book && S.book[E.normName(hh.name)];
  if (b && b.entries.length > 1) h += '<p class="small">Also in the book: ' + b.entries.filter(function (e) { return e.rid !== r.id; }).map(function (e) { return '<a href="#horse-' + e.rid + '-' + e.pgm + '">' + esc(dateShort(e.date) + ' ' + e.race) + '</a>'; }).join(', ') + '.</p>';
  return h;
}

// ---------- events ----------
document.addEventListener('click', function (e) {
  var g = e.target.closest('[data-go]'); if (g && !e.target.closest('a,button,input,select,textarea,label')) { location.hash = g.getAttribute('data-go'); return; }
  var b = e.target.closest('[data-rt]'); if (b) { e.preventDefault(); S.ui.raceTab = b.getAttribute('data-rt'); render(); return; }
  var b2 = e.target.closest('[data-st2]'); if (b2) { S.ui.sitTab = b2.getAttribute('data-st2'); render(); return; }
  var b3 = e.target.closest('[data-ck]'); if (b3) { S.ui.connKind = b3.getAttribute('data-ck'); S.ui.connSel = null; render(); return; }
  var b4 = e.target.closest('tr[data-conn]'); if (b4 && !e.target.closest('a')) { var ck = b4.getAttribute('data-conn'); S.ui.connSel = S.ui.connSel === ck ? null : ck; render(); return; }
  var s = e.target.closest('th[data-sort]'); if (s) { var k = s.getAttribute('data-sort'); if (S.ui.sort.key === k) S.ui.sort.dir *= -1; else S.ui.sort = { key: k, dir: (k === 'race' || k === 'name' || k === 'rank') ? 1 : -1 }; render(); return; }
  var act = e.target.closest('[data-act]'); if (!act || act.disabled) return; var x = act.getAttribute('data-act'); var rid = S.ui.raceId;
  if (x === 'play-pick' || x === 'play-reveal' || x === 'play-next' || x === 'play-prev' || x === 'play-reset' || x === 'play-share') { playAct(x, act); return; }
  if (x === 'theme') { var cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); var nt = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', nt); try { localStorage.setItem('bje-theme', nt); } catch (er) { } return; }
  if (x === 'lab') { S.ui.labOpen = !S.ui.labOpen; render(); return; }
  if (x === 'save-status') { var map = {}; document.querySelectorAll('[data-st]').forEach(function (el) { map[el.getAttribute('data-st')] = el.value; }); save('status', rid, { map: map, savedAt: new Date().toISOString() }, 'Statuses saved; model re-run'); }
  else if (x === 'save-live') { var odds = {}, badL = []; document.querySelectorAll('[data-lo]').forEach(function (el) { var v = el.value.trim(); if (v === '') return; if (E.mlToProb(v) == null) badL.push('#' + el.getAttribute('data-lo') + ' "' + v + '"'); else odds[el.getAttribute('data-lo')] = v; });
    if (badL.length) { toast('Not saved. Odds not understood for ' + badL.join(', ') + '. Type them as 5-2, 9/5, 7 or Even.'); return; }
    var aL = A[rid]; var miss = aL ? activeH(aL).filter(function (hh) { return odds[hh.pgm] == null; }).map(function (hh) { return '#' + hh.pgm; }) : [];
    save('live', rid, { odds: odds, savedAt: new Date().toISOString() }, (miss.length && Object.keys(odds).length) ? 'Saved, but live odds only take over once every starter has one. Still missing: ' + miss.join(', ') : 'Live odds saved'); }
  else if (x === 'clear-live') { save('live', rid, { odds: {}, savedAt: new Date().toISOString() }, 'Live odds cleared'); }
  else if (x === 'save-jr') { var v = parseList($('#jrp-' + rid).value); var eJ = checkPgms(rid, v, false); if (eJ) { toast('Not saved: ' + eJ + '.'); return; } v = v.map(function (p) { return canonPgm(rid, p); }); save('jrpicks', rid, { picks: v, source: 'Entered on this page', savedAt: new Date().toISOString() }, v.length ? 'Jr\'s picks saved' : 'Jr\'s picks cleared'); }
  else if (x === 'save-res') { var o = parseList($('#res-' + rid).value); var eR = checkPgms(rid, o, true); if (eR) { toast('Not saved: ' + eR + '.'); return; } o = o.map(function (p) { return canonPgm(rid, p); }); var pay = ($('#pay-' + rid).value || '').trim(); var prev = S.results[rid]; var aR = A[rid];
    var pre = prev && prev.pre ? prev.pre : (aR && aR.M.order.length ? (function () { var bc = E.betCheck(aR.race, aR.M, aR.C, S.live[rid] && S.live[rid].odds, {}); return { top: aR.M.order[0], p: Math.round(aR.M.p[aR.M.order[0]] * 1000) / 1000, version: weightsNow().version || 'v1.0', lockedAt: new Date().toISOString(), basis: bc.basis, fav: bc.fav, experts: bc.expertTop, value: bc.rows.filter(function (x) { return x.contender; }).map(function (x) { return x.pgm; }), bets: bc.bets.map(function (x) { return x.pgm; }) }; })() : null);
    var doc = { order: o, winPay: o.length ? pay : '', source: 'Entered on this page', savedAt: new Date().toISOString() }; if (pre) doc.pre = pre;
    save('results', rid, doc, o.length ? 'Result saved; grading updated' : 'Result cleared'); }
  else if (x === 'what-reset') { S.ui.what = null; recompute(); }
  else if (x === 'scn-reset') { S.ui.scn = emptyScn(); saveScn(); recompute(); toast('What-if cleared'); }
  else if (x === 'hypo-run' || x === 'hypo-fill') {
    var bad = [];
    document.querySelectorAll('[data-hypo]').forEach(function (el) { var id = el.getAttribute('data-hypo'); var a = A[id];
      if (x === 'hypo-fill' && a) el.value = a.M.order.slice(0, 3).join(' ');
      var list = (el.value || '').trim().split(/[\s,\-]+/).filter(Boolean);
      var okP = a ? activeH(a).map(function (hh) { return hh.pgm; }) : [];
      var wrong = list.filter(function (p) { return okP.indexOf(p) < 0; }); var dup = list.length !== new Set(list).size;
      if (wrong.length || dup) { bad.push(raceShort(a ? a.race : { date: '', cardRace: id }) + (wrong.length ? ': ' + wrong.join(', ') + ' not running' : ': a number repeats')); return; }
      if (list.length) S.ui.scn.hypo[id] = list; else delete S.ui.scn.hypo[id]; });
    saveScn(); recompute(); toast(bad.length ? 'Skipped ' + bad.join('; ') : 'What-if re-run');
  }
  else if (x === 'going-official') {
    var dd = act.getAttribute('data-date'); var wi = S.ui.scn.going[dd]; if (!wi || !Object.keys(wi).length) { toast('Pick a what-if going first'); return; }
    var r0 = S.races.find(function (r) { return r.date === dd; }); var cid = E.cardOf(r0) + '-' + dd; var cur = Object.assign({}, S.conds[cid] || {}); Object.keys(wi).forEach(function (k) { cur[k] = wi[k]; }); cur.savedAt = new Date().toISOString(); cur.date = dd;
    save('conditions', cid, cur, 'Going saved as official').then(function (ok) { if (ok) { delete S.ui.scn.going[dd]; saveScn(); recompute(); } });
  }
  else if (x === 'card-template') { var ta = $('#card-json'); if (ta) ta.value = JSON.stringify([RACE_TEMPLATE], null, 2); }
  else if (x === 'card-check') { var txt = ($('#card-json') || {}).value || ''; try { var j = JSON.parse(txt); S.ui.cardPreview = previewCard(Array.isArray(j) ? j : [j]); S.ui.cardMsg = null; } catch (err) { S.ui.cardPreview = null; S.ui.cardMsg = 'That is not valid JSON: ' + err.message; } render(); }
  else if (x === 'card-quick') { S.ui.cardPreview = previewCard([parseQuickRace()]); S.ui.cardMsg = null; render(); }
  else if (x === 'card-cancel') { S.ui.cardPreview = null; render(); }
  else if (x === 'card-save') { var pv = S.ui.cardPreview; if (!pv || !pv.races.length || !S.db) return; act.disabled = true;
    (async function () { var n = 0; for (var i = 0; i < pv.races.length; i++) { try { await S.db.collection('races').doc(pv.races[i].id).set(pv.races[i]); n++; } catch (err) { S.ui.cardMsg = 'Stopped at ' + pv.races[i].id + ': ' + (err.message || err.code); break; } }
      if (n) { S.ui.cardMsg = 'Saved ' + n + ' race' + (n > 1 ? 's' : '') + '. Every view now includes ' + (n > 1 ? 'them' : 'it') + '.'; S.ui.cardPreview = null; } render(); })(); }
  else if (x === 'card-del') { var sel = $('#card-del'); if (!sel || !S.db) return; var id = sel.value; if (!window.confirm('Remove race ' + id + ' from the database for everyone? This cannot be undone from the page.')) return;
    S.db.collection('races').doc(id).delete().then(function () { toast('Removed ' + id); }).catch(function (err) { toast('Not removed: ' + (err.message || err.code)); }); }
  else if (x === 'what-save') { saveVersion(S.ui.what, 'Saved from the what-if sliders'); }
  else if (x === 'tune') { var res = {}; S.races.forEach(function (r) { if (S.results[r.id]) res[r.id] = S.results[r.id]; }); var lives = {}; S.races.forEach(function (r) { if (S.live[r.id]) lives[r.id] = S.live[r.id].odds; }); S.ui.tuneOut = E.tune(S.races.map(raceO), res, (S.model && S.model.weights) || E.DEFAULT_WEIGHTS, { lives: lives, goings: S.goings, tOffset: S.model && S.model.tOffset }); render(); }
  else if (x === 'adopt') { var t = S.ui.tuneOut; if (t && t.ok) { saveVersion(t.weights, 'Refit on ' + t.graded + ' graded races: log loss ' + t.before.toFixed(3) + ' → ' + t.after.toFixed(3) + ' (' + t.improvementPct + '% in-sample, ' + t.heldOutPct + '% held-out)').then(function (ok) { if (ok && S.db) S.db.collection('reviews').doc('r-' + Date.now()).set({ date: new Date().toISOString().slice(0, 16).replace('T', ' '), graded: t.graded, before: t.before, after: t.after, improvementPct: t.improvementPct, heldOutPct: t.heldOutPct, adopted: true, version: nextVersion(), notes: 'Run from the page.' }); }); } }
});
function nextVersion() { var v = String(((S.model && S.model.weights) || E.DEFAULT_WEIGHTS).version || 'v1.0').replace(/^v/, '').split('.'); return 'v' + v[0] + '.' + ((+v[1] || 0) + 1); }
async function saveVersion(W, note) {
  var ver = nextVersion(); var w = JSON.parse(JSON.stringify(W)); w.version = ver; var at = new Date().toISOString();
  var ok = await save('model', 'current', { weights: w, version: ver, savedAt: at, note: note, tOffset: (S.model && S.model.tOffset) || null }, 'Model ' + ver + ' saved');
  if (ok) { try { await S.db.collection('modelhist').doc(ver.replace(/\./g, '-')).set({ version: ver, weights: w, savedAt: at, note: note, by: 'page' }); } catch (e) { toast('Model saved, but its history entry was not: ' + (e.message || e.code)); } S.ui.what = null; }
  return ok;
}
document.addEventListener('keydown', function (e) {
  if (S.ui.view === 'play' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target.closest && e.target.closest('input,select,textarea'))) { e.preventDefault(); playAct(e.key === 'ArrowRight' ? 'play-next' : 'play-prev'); return; }
  if (e.key !== 'Enter' && e.key !== ' ') return; var g = e.target.closest && e.target.closest('[data-go]'); if (!g || g !== e.target) return; e.preventDefault(); location.hash = g.getAttribute('data-go');
});
document.addEventListener('input', function (e) {
  var t = e.target;
  if (t.matches('[data-w]')) { var W = JSON.parse(JSON.stringify(weightsNow())); W[t.getAttribute('data-w')] = +t.value; W.version = (((S.model && S.model.weights) || E.DEFAULT_WEIGHTS).version || 'v1.0'); S.ui.what = W; t.nextElementSibling.textContent = t.value; clearTimeout(t._d); t._d = setTimeout(recompute, 120); }
  else if (t.id === 'fq') { S.ui.q = t.value; clearTimeout(t._d); t._d = setTimeout(function () { render(); var el = $('#fq'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); }
});
document.addEventListener('change', function (e) {
  var t = e.target;
  if (t.matches && t.matches('[data-rd]')) { var d = loadReady(); var k = t.getAttribute('data-rd');
    if (k === 'verified' || k === 'funded') d[k] = !!t.checked; else if (k === 'bankroll') d[k] = Math.max(0, Math.min(1e7, parseFloat(String(t.value).replace(/[^0-9.]/g, '')) || 0)); else if (k === 'minBet') d[k] = +t.value === 1 ? 1 : 2; else if (k === 'margin') d[k] = MARGINS.indexOf(+t.value) >= 0 ? +t.value : 0.15; else d[k] = String(t.value).slice(0, 60);
    saveReady(d); render(); return; }
  if (t.id === 'fday') { S.ui.day = t.value; render(); }
  else if (t.id === 'fmin') { S.ui.minP = +t.value; render(); }
  else if (t.id === 'mxall') { S.ui.matrixAll = t.checked; render(); }
  else if (t.id === 'frace') { S.ui.factorRace = t.value; render(); }
  else if (t.id === 'fcday') { S.ui.fday = t.value; render(); }
  else if (t.id === 'sitdim') { S.ui.sitDim = t.value; S.ui.sitVal = null; render(); }
  else if (t.id === 'sitval') { S.ui.sitVal = t.value; render(); }
  else if (t.id === 'sitday') { S.ui.sitDay = t.value; render(); }
  else if (t.id === 'keyall') { S.ui.keyAll = t.checked; render(); }
  else if (t.matches('[data-going]')) { var gp = t.getAttribute('data-going').split('|'); var c = S.ui.scn.going[gp[0]] || {}; if (t.value) c[gp[1]] = t.value; else delete c[gp[1]]; if (Object.keys(c).length) S.ui.scn.going[gp[0]] = c; else delete S.ui.scn.going[gp[0]]; saveScn(); recompute(); }
  else if (t.matches('[data-biasset]')) { var sk = t.getAttribute('data-biasset'); if (t.value && BIAS_PRESETS[t.value]) S.ui.scn.bias[sk] = { speed: BIAS_PRESETS[t.value].speed, inside: BIAS_PRESETS[t.value].inside }; else delete S.ui.scn.bias[sk]; saveScn(); recompute(); }
  else if (t.matches('[data-pace]')) { var pr = t.getAttribute('data-pace'); if (t.value) S.ui.scn.pace[pr] = t.value; else delete S.ui.scn.pace[pr]; saveScn(); recompute(); }
});

route();
boot().catch(function (e) { console.error(e); S.errors.push(String(e && e.message || e)); S.ready = true; render(); });
})();
