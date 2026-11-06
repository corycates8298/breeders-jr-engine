// ===================================================================
// Front door: Home, Play the card, How it works, shared record-keeping.
// Everything here reads the same data and analyses as the rest of the
// page (S, A) and never writes to the shared database. Play-along picks
// stay in this browser only.
// ===================================================================

// ---------- the four handicappers ----------
var SRC = [
  { k: 'claude', name: 'Claude', who: 'Race-day pick from the 40-factor model (locked)', cls: 'c' },
  { k: 'jr', name: 'Jr', who: 'Top pick from his handwritten sheet', cls: 'j' },
  { k: 'exp', name: 'The experts', who: 'Most published win picks', cls: 'e' },
  { k: 'mkt', name: 'The market', who: 'Morning-line favorite', cls: 'm' }
];
function hName(rid, p) { var hh = horse(rid, p); return hh ? hh.name : '#' + p; }
function hMl(rid, p) { var hh = horse(rid, p); return hh ? hh.ml : ''; }
function gradedRaces() { return S.races.filter(function (r) { return A[r.id] && hasRes(r.id) && canonWinner(r.id); }); }
// Every source's call in one race. The locked pick is the honest Claude record; the refit model is never used here.
function callsOf(r) {
  var a = A[r.id]; if (!a) return null; var res = S.results[r.id] || {}; var pre = res.pre || null;
  var o = (res.order || []).map(String);
  return {
    r: r, a: a, win: canonWinner(r.id), pay: payOf(r.id), order: o,
    claude: pre && pre.top ? String(pre.top) : null, claudeP: pre && pre.p != null ? +pre.p : null, claudeV: pre && pre.version,
    jr: r.jr && r.jr.picks && r.jr.picks.length ? String(r.jr.picks[0]) : null, jrPicks: r.jr && r.jr.picks ? r.jr.picks.map(String) : [],
    exp: E.expertTop(a.C), mkt: a.C.order[0] || null, mktSrc: a.C.source
  };
}
// Exact (Clopper-Pearson) 95% interval for k wins in n races.
function lnFact(n) { var s = 0; for (var i = 2; i <= n; i++) s += Math.log(i); return s; }
function binTail(n, k, p, upper) { if (p <= 0) return upper ? (k <= 0 ? 1 : 0) : 1; if (p >= 1) return upper ? 1 : (k >= n ? 1 : 0);
  var lf = lnFact(n), s = 0; for (var i = 0; i <= n; i++) { if (upper ? i >= k : i <= k) s += Math.exp(lf - lnFact(i) - lnFact(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p)); } return s; }
function binomCI(k, n) { if (!n) return null; function solve(f) { var lo = 0, hi = 1; for (var t = 0; t < 60; t++) { var m = (lo + hi) / 2; if (f(m)) hi = m; else lo = m; } return (lo + hi) / 2; }
  var lo = k === 0 ? 0 : solve(function (p) { return binTail(n, k, p, true) >= 0.025; });
  var hi = k === n ? 1 : solve(function (p) { return binTail(n, k, p, false) <= 0.025; });
  return [lo, hi]; }
function sourceRecord() {
  var rec = {}; SRC.forEach(function (s) { rec[s.k] = { k: s.k, name: s.name, who: s.who, cls: s.cls, n: 0, w: 0, back: 0, unk: 0, hits: [] }; });
  var g = gradedRaces(), lockedP = 0, lockedN = 0;
  g.forEach(function (r) { var c = callsOf(r); if (!c) return;
    SRC.forEach(function (s) { var pick = c[s.k]; if (!pick) return; var o = rec[s.k]; o.n++;
      if (pick === c.win) { o.w++; o.hits.push(r.id); if (c.pay != null) o.back += c.pay; else o.unk++; } });
    if (c.claude && c.claudeP != null) { lockedP += c.claudeP; lockedN++; } });
  SRC.forEach(function (s) { var o = rec[s.k]; o.stake = 2 * o.n; o.roi = o.n ? (o.back - o.stake) / o.stake : null; o.ci = binomCI(o.w, o.n); o.rate = o.n ? o.w / o.n : null; });
  rec.graded = g.length; rec.lockedExp = lockedP; rec.lockedN = lockedN;
  return rec;
}
function pctI(x) { return x == null || isNaN(x) ? '—' : Math.round(x * 100) + '%'; }
function money(x) { return '$' + (+x).toFixed(2); }
function roiTag(o) { if (o.roi == null) return '—'; return '<span style="color:' + (o.roi >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + (o.roi >= 0 ? '+' : '') + Math.round(o.roi * 100) + '%</span>'; }

// ---------- the leaderboard (tote board) ----------
function leaderboard(rec, opts) {
  opts = opts || {};
  var rows = SRC.map(function (s) { return rec[s.k]; }).filter(function (o) { return o.n; });
  rows.sort(function (x, y) { return (y.rate - x.rate) || (y.n - x.n); });
  var h = '<div class="board" role="table" aria-label="Final standings">';
  rows.forEach(function (o, i) {
    h += '<div class="lane lane-' + o.cls + '" role="row"><div class="pos num" role="cell">' + (i + 1) + '</div>' +
      '<div class="who" role="cell"><b>' + esc(o.name) + '</b><span>' + esc(o.who) + (o.n < rec.graded ? ' · played ' + o.n + ' of ' + rec.graded : '') + '</span></div>' +
      '<div class="track" role="cell" aria-label="' + o.w + ' winners from ' + o.n + ' races"><i style="width:' + (100 * o.rate).toFixed(1) + '%"></i></div>' +
      '<div class="rec num" role="cell"><b>' + o.w + '<small>/' + o.n + '</small></b><span>' + pctI(o.rate) + ' won</span></div>' +
      '<div class="roi num" role="cell"><b>' + roiTag(o) + '</b><span>' + money(o.back) + ' back on ' + money(o.stake) + (o.unk ? ' · ' + o.unk + ' payoff missing' : '') + '</span></div></div>';
  });
  h += '</div>';
  if (!opts.bare) h += '<p class="small muted" style="margin-top:8px">A flat $2 win bet on each source\'s top pick in every race it played, at the official $2 payoffs. Ranked by share of winners. With so few races these are records, not proof of skill: see <a href="#how-score">how we keep score</a>.</p>';
  return h;
}

// ---------- facts the card produced (all computed, nothing typed in) ----------
function cardFacts(rec) {
  var g = gradedRaces(), out = [];
  if (!g.length) return out;
  var m = rec.mkt; if (m.n) out.push({ t: 'Chalk ruled', d: 'The morning-line favorite won ' + m.w + ' of ' + m.n + ' races.' });
  if (rec.lockedN) out.push({ t: 'Claude beat its own odds', d: 'Its locked picks were priced to win about ' + rec.lockedExp.toFixed(1) + ' of ' + rec.lockedN + ' races and won ' + rec.claude.w + '. Favorites winning drove most of that.' });
  var miss = g.filter(function (r) { var c = callsOf(r); return c.exp === c.win && c.claude !== c.win; });
  if (miss.length) out.push({ t: 'Where the experts saw more', d: 'The experts\' top pick caught ' + miss.length + ' winner' + (miss.length > 1 ? 's' : '') + ' Claude\'s locked pick missed: ' + miss.map(function (r) { return hName(r.id, canonWinner(r.id)); }).join(', ') + '.' });
  var big = null; g.forEach(function (r) { var p = payOf(r.id); if (p != null && (!big || p > big.p)) big = { r: r, p: p }; });
  if (big) { var c = callsOf(big.r); var had = SRC.filter(function (s) { return c[s.k] === c.win; }).map(function (s) { return s.name; });
    out.push({ t: 'Biggest price', d: hName(big.r.id, c.win) + ' paid ' + money(big.p) + ' to win the ' + big.r.name + '. ' + (had.length ? 'Top pick of: ' + had.join(', ') + '.' : 'Nobody\'s top pick.') }); }
  var jx = g.filter(function (r) { var c = callsOf(r); return c.jrPicks.length >= 2 && c.order.length >= 2 && c.jrPicks[0] === c.order[0] && c.jrPicks[1] === c.order[1]; });
  if (jx.length) out.push({ t: 'Jr\'s one-two', d: 'His top two picks finished first and second in the ' + jx.map(function (r) { return r.name; }).join(' and the ') + '.' });
  return out;
}

// ---------- race tiles (who hit each race) ----------
function tileGrid() {
  var g = gradedRaces(); if (!g.length) return '';
  return '<div class="tiles">' + g.map(function (r) { var c = callsOf(r);
    return '<a class="tile" href="#play-' + esc(r.id) + '"><span class="eyebrow">' + esc(raceShort(r)) + '</span><b>' + esc(r.name) + '</b><span class="tw2">' + chip(c.win) + ' <span class="small">' + esc(hName(r.id, c.win)) + '</span></span><span class="dots">' +
      SRC.map(function (s) { var p = c[s.k]; var st = !p ? 'none' : p === c.win ? 'hit' : 'miss'; return '<i class="d-' + s.cls + ' ' + st + '" title="' + esc(s.name + ': ' + (!p ? 'no pick' : (p === c.win ? 'had the winner' : 'missed'))) + '">' + s.name.replace('The ', '').charAt(0) + '</i>'; }).join('') + '</span></a>'; }).join('') + '</div>' +
    '<p class="small muted" style="margin-top:6px">Letters: C = Claude (locked), J = Jr, E = experts, M = market. Filled = that source\'s top pick won.</p>';
}

// ---------- Home ----------
function vHome() {
  var rec = sourceRecord(), g = gradedRaces(), open = S.races.filter(function (r) { return !hasRes(r.id); });
  var cardName = (S.meta && S.meta.card) || 'Breeders\' Cup 2026, Keeneland';
  var h = '<section class="hero"><div class="eyebrow">' + esc(cardName) + ' · ' + (open.length ? open.length + ' race' + (open.length > 1 ? 's' : '') + ' still to run' : 'all ' + g.length + ' races final') + '</div>' +
    '<h1 class="htitle">Who called the Breeders\' Cup?</h1>' +
    '<p class="lede">An AI model reading 40 factors per horse. Jr\'s handwritten sheet. The published experts. The betting market. All four picked every race they played, and we kept score, misses included.</p>' +
    '<div class="cta"><a class="btn big primary" href="#play">Can you beat them? Play the card</a><a class="btn big" href="#dashboard">See every race</a></div>' +
    '<p class="small muted">Play first if you don\'t know the results yet. The standings below give them away.</p></section>';
  if (open.length) { var nx = nextRace();
    if (nx && A[nx.id]) { var an = A[nx.id], pn = an.M.order[0];
      h += '<a class="panel nextup" href="#race-' + esc(nx.id) + '"><div class="eyebrow">Next post</div><b>' + esc(raceTitle(nx)) + ' · ' + esc(nx.post) + ' ET' + (localPost(nx) ? ' (' + esc(localPost(nx)) + ' your time)' : '') + '</b><div class="small ink2">Claude\'s pick ' + chip(pn) + ' ' + esc(hName(nx.id, pn)) + ' (' + pct(an.M.p[pn], 0) + '). Open the race, then its Bet check, 2–5 minutes before post.</div></a>'; } }
  if (g.length) {
    h += '<h2>Final standings</h2>' + leaderboard(rec);
    var f = cardFacts(rec);
    if (f.length) h += '<h2>What the card taught us</h2><div class="facts">' + f.map(function (x) { return '<div class="panel fact"><b>' + esc(x.t) + '</b><p>' + esc(x.d) + '</p></div>'; }).join('') + '</div>';
    h += '<h2>Race by race</h2>' + tileGrid();
  }
  h += '<h2>Why you can trust this record</h2><div class="promises">' +
    promise('Misses stay on the board', 'Every graded race counts, for every source. Nothing is dropped after the fact.') +
    promise('Hindsight is labeled hindsight', 'The model was refit on these same races after they ran. Its refit picks never enter the record; only the picks it made on race day do.') +
    promise('Results from official charts', 'Each finish and $2 payoff is checked against the official chart or two independent reports, with the links kept.') +
    promise('No guarantees, nothing for sale', 'This is a free, read-only record. It sells no picks and promises no profit.') + '</div>' +
    '<p class="small ink2" style="margin-top:8px">One limit up front: on this card the race-day picks were written into the record on Oct 31 from the race-day engine, not stamped by an outside clock before each post. <a href="#how-score">Details</a>.</p>';
  return h;
}
function promise(t, d) { return '<div class="panel promise"><b>' + esc(t) + '</b><p class="small">' + esc(d) + '</p></div>'; }

// ---------- Play the card (blind replay) ----------
var PLAY_KEY = 'bje-play-v1';
function loadPlay() { var d = { picks: {}, shown: {} }; try { var v = JSON.parse(localStorage.getItem(PLAY_KEY) || 'null');
  if (v && typeof v === 'object') { ['picks', 'shown'].forEach(function (k) { if (v[k] && typeof v[k] === 'object') Object.keys(v[k]).forEach(function (rid) { var x = v[k][rid]; if (k === 'picks' && typeof x === 'string' && /^[0-9]{1,2}[A-Z]?$/.test(x)) d.picks[rid] = x; if (k === 'shown' && x === true) d.shown[rid] = true; }); }); } } catch (e) { } return d; }
function savePlay(d) { try { localStorage.setItem(PLAY_KEY, JSON.stringify(d)); } catch (e) { } }
var PLAY = loadPlay();
function playIndex(g) { var i = g.findIndex(function (r) { return r.id === S.ui.playRace; }); if (i < 0) { i = g.findIndex(function (r) { return !PLAY.shown[r.id]; }); if (i < 0) i = 0; } return i; }
function playTally(g) {
  var t = { you: { n: 0, w: 0, back: 0 } }; SRC.forEach(function (s) { t[s.k] = { n: 0, w: 0, back: 0 }; });
  g.forEach(function (r) { if (!PLAY.shown[r.id]) return; var c = callsOf(r);
    function add(o, pick) { if (!pick) return; o.n++; if (pick === c.win) { o.w++; if (c.pay != null) o.back += c.pay; } }
    add(t.you, PLAY.picks[r.id]); SRC.forEach(function (s) { add(t[s.k], c[s.k]); }); });
  return t;
}
function vPlay() {
  var g = gradedRaces();
  if (!g.length) return '<div class="empty"><h2>Nothing to play yet</h2><p>Play opens once races have official results. Until then, follow the live card.</p><p><a class="btn" href="#dashboard">Open the card</a></p></div>';
  var i = playIndex(g), r = g[i], c = callsOf(r), a = c.a, shown = !!PLAY.shown[r.id], mine = PLAY.picks[r.id] || null;
  S.ui.playRace = r.id; // pin the race so a reveal doesn't move the 'next' target
  var h = '<div class="play">';
  h += '<div class="pbar" role="tablist" aria-label="Races">' + g.map(function (x, j) { var st = PLAY.shown[x.id] ? (PLAY.picks[x.id] && PLAY.picks[x.id] === canonWinner(x.id) ? 'won' : 'done') : ''; return '<a href="#play-' + esc(x.id) + '" class="pd ' + st + (j === i ? ' on' : '') + '" role="tab" aria-selected="' + (j === i) + '" title="' + esc(raceShort(x) + ' · ' + x.name) + '">' + (j + 1) + '</a>'; }).join('') + '</div>';
  h += '<div class="pcard panel">';
  h += '<div class="eyebrow">Race ' + (i + 1) + ' of ' + g.length + ' · ' + esc(dateLong(r.date)) + ' · ' + esc(r.post) + ' ET</div><h2 class="ptitle">' + esc(r.name) + '</h2><div class="small ink2">' + esc(r.distance) + ' ' + esc(r.surface) + (r.grade ? ' · ' + esc(r.grade) : '') + (r.purse ? ' · ' + esc(r.purse) : '') + ' · ' + activeH(a).length + ' starters</div>';
  // the calls
  h += '<div class="calls">' + SRC.map(function (s) { var p = c[s.k]; var res = shown && p ? (p === c.win ? ' hit' : ' miss') : '';
    return '<div class="call call-' + s.cls + res + '"><span class="eyebrow">' + esc(s.name) + '</span>' + (p ? '<span class="cn">' + chip(p) + ' <b>' + esc(hName(r.id, p)) + '</b></span><span class="small muted">' + (s.k === 'claude' && c.claudeP != null ? 'locked at ' + pct(c.claudeP, 0) + ' to win' : s.k === 'mkt' ? 'morning line ' + esc(hMl(r.id, p)) : s.k === 'jr' ? 'his top pick' : 'most win picks') + '</span>' : '<span class="small muted">' + (s.k === 'jr' ? 'Jr didn\'t play this race' : 'no pick') + '</span>') + (shown && p ? '<span class="verdict">' + (p === c.win ? 'Winner' : 'Missed') + '</span>' : '') + '</div>'; }).join('') + '</div>';
  // the field: pick a horse
  var field = activeH(a).slice().sort(function (x, y) { return byNum(x.pgm, y.pgm); });
  h += '<h3>' + (shown ? 'The field' : 'Your pick: tap a horse') + '</h3><div class="field">' + field.map(function (hh) { var isMine = mine === String(hh.pgm), isWin = shown && String(hh.pgm) === c.win;
    return '<button class="horse' + (isMine ? ' mine' : '') + (isWin ? ' win' : '') + '" data-act="play-pick" data-pgm="' + esc(hh.pgm) + '"' + (shown ? ' disabled' : '') + ' aria-pressed="' + isMine + '">' + chip(hh.pgm) + '<span class="hn">' + esc(hh.name) + '</span><span class="ml num">' + esc(hh.ml) + '</span>' + (isWin ? '<span class="tag good">won</span>' : '') + (isMine && shown ? '<span class="tag">' + (isWin ? 'your pick' : 'yours') + '</span>' : '') + '</button>'; }).join('') + '</div>';
  if (!shown) h += '<div class="filters" style="margin-top:12px"><button class="btn big primary" data-act="play-reveal">' + (mine ? 'Lock it in and reveal' : 'Reveal without a pick') + '</button><span class="small muted">Odds shown are the morning line. Only calls made before the race are shown; the refit model stays out of it.</span></div>';
  else {
    var hits = SRC.filter(function (s) { return c[s.k] === c.win; }).map(function (s) { return s.name; });
    var you = mine ? (mine === c.win ? 'You had it.' : 'You had ' + hName(r.id, mine) + '.') : 'You sat this one out.';
    h += '<div class="reveal"><div class="rv-win">' + chip(c.win) + '<div><span class="eyebrow">Winner</span><b>' + esc(hName(r.id, c.win)) + '</b><span class="small">' + (c.pay != null ? '$2 win paid ' + money(c.pay) : 'payoff not on file') + ' · morning line ' + esc(hMl(r.id, c.win)) + '</span></div></div>' +
      '<p><b>' + esc(you) + '</b> ' + esc(hits.length === 4 ? 'All four sources had the winner.' : hits.length ? 'Had the winner: ' + hits.join(', ') + '.' : 'None of the four had the winner on top.') + '</p>' +
      (c.order.length > 1 ? '<p class="small ink2">Official order: ' + c.order.slice(0, 4).map(function (p, j) { return ordinal(j + 1) + ' ' + chip(p) + ' ' + esc(hName(r.id, p)); }).join(' · ') + '</p>' : '') +
      '<p class="small"><a href="#race-' + esc(r.id) + '">Open the full race: factors, pace, exactas and the bet check →</a></p></div>';
  }
  h += '<div class="pnav"><button class="btn" data-act="play-prev"' + (i === 0 ? ' disabled' : '') + '>← Previous</button><button class="btn primary" data-act="play-next"' + (i === g.length - 1 ? ' disabled' : '') + '>Next race →</button></div>';
  h += '</div>';
  // scoreboard so far
  var t = playTally(g), done = Object.keys(PLAY.shown).filter(function (k) { return g.some(function (x) { return x.id === k; }); }).length;
  h += '<div class="panel ptally"><div class="eyebrow">Your scorecard · ' + done + ' of ' + g.length + ' revealed</div><table><thead><tr><th></th><th class="r">Winners</th><th class="r">$2 win bets</th></tr></thead><tbody>' +
    '<tr class="me"><td><b>You</b></td><td class="r num"><b>' + t.you.w + '</b>/' + t.you.n + '</td><td class="r num">' + (t.you.n ? money(t.you.back) + ' on ' + money(2 * t.you.n) : '—') + '</td></tr>' +
    SRC.map(function (s) { var o = t[s.k]; return '<tr><td>' + esc(s.name) + '</td><td class="r num">' + o.w + '/' + o.n + '</td><td class="r num">' + (o.n ? money(o.back) + ' on ' + money(2 * o.n) : '—') + '</td></tr>'; }).join('') + '</tbody></table>';
  if (done === g.length) { h += '<p><b>' + esc(finalLine(t)) + '</b></p><div class="filters"><button class="btn primary" data-act="play-share">Share my score</button><button class="btn" data-act="play-reset">Play again</button></div>'; }
  else if (done) h += '<div class="filters"><button class="btn" data-act="play-reset">Start over</button></div>';
  h += '<p class="small muted">Your picks stay in this browser. Nothing is sent anywhere, and this is a game, not a bet.</p></div></div>';
  return h;
}
function finalLine(t) { var best = SRC.map(function (s) { return { n: s.name, w: t[s.k].w, k: s.k }; }).sort(function (x, y) { return y.w - x.w; })[0];
  var cl = t.claude.w; var y = t.you.w;
  return 'You picked ' + y + ' winner' + (y === 1 ? '' : 's') + '. ' + (y > cl ? 'You beat Claude (' + cl + ').' : y === cl ? 'You tied Claude (' + cl + ').' : 'Claude got ' + cl + '.') + ' Best on the card: ' + best.n + ' with ' + best.w + '.'; }
function shareText() { var g = gradedRaces(), t = playTally(g); return 'I played the 2026 Breeders\' Cup blind and picked ' + t.you.w + ' of ' + g.length + ' winners. Claude\'s AI got ' + t.claude.w + ', the experts ' + t.exp.w + '. Can you beat them?'; }
function shareUrl() { return location.href.split('#')[0] + '#play'; }
async function doShare() { var txt = shareText(), url = shareUrl();
  try { if (navigator.share) { await navigator.share({ title: 'Breeders & Jr Engine', text: txt, url: url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(txt + ' ' + url); toast('Copied to your clipboard'); } catch (e) { toast(txt + ' ' + url); } }

// ---------- How it works ----------
var GLOSS = [
  ['Morning line', 'The track handicapper\'s forecast of the odds, set days before the race. It is a guess about how the public will bet, not a price you can get.'],
  ['Live odds (the tote)', 'The odds set by the money actually bet, which keep moving until the gates open. Your payout is set by the final odds, after the track takes its cut.'],
  ['Takeout', 'The share of every betting pool the track and the state keep before paying winners, roughly 15–25% depending on the pool. It is why most bets lose money over time.'],
  ['Win chance', 'The model\'s estimate of how often a horse wins this race if it were run many times. A 30% horse still loses 7 times in 10.'],
  ['Fair odds', 'The odds that match a win chance exactly: a 25% horse is fair at 3-1. Below fair odds a bet loses money in the long run.'],
  ['Bet only at', 'The lowest odds at which a horse clears the safety margin you pick in the Bet check. If the tote shows less, the answer is PASS.'],
  ['Expected value (EV)', 'Win chance × (odds + 1) − 1. +10% means a $2 bet returns $2.20 on average over many tries, if the win chance is right.'],
  ['Quarter-Kelly', 'A stake rule that bets a quarter of the mathematically optimal fraction of your bankroll, capped at 2% a race, to survive the model being wrong.'],
  ['Locked pick', 'The model\'s top pick as it stood on race day, before the result. Only locked picks count in the record.'],
  ['In hindsight', 'Numbers recomputed with the model after it was refit on these same races. Useful for learning, never counted as a record.'],
  ['Log loss and Brier score', 'Two standard scores for probability forecasts. Lower is better. They reward giving the winner a high chance and punish confident misses.'],
  ['95% range', 'With few races, a record is noisy. The range shows the hit rates the record is consistent with. Seven wins in 14 fits anything from about 23% to 77%.'],
  ['Factor greens', 'For each of the 40 factors, the top third of the field goes green. More greens means more strengths, not a guaranteed win.'],
  ['Jr gap (the displacement)', 'How far Jr\'s ranking sits from the consensus ranking. Big gaps are where he disagrees with the crowd.'],
  ['Exacta / trifecta', 'Bets on the first two (exacta) or first three (trifecta) finishers in exact order.'],
  ['Scratch / AE', 'A scratched horse has been withdrawn. An AE (also-eligible) runs only if a horse scratches in time.'],
  ['Grade 1 (G1)', 'The top class of stakes race. Every race on this card is listed as a Grade 1.']
];
function vHow() {
  var rec = sourceRecord(); var gaps = (S.meta && S.meta.gaps) || [];
  var h = '<h2>How it works</h2><p class="lede" style="max-width:68ch">Four handicappers, one card, one honest scorecard. Here is what each number means, how the record is kept, and what we still don\'t know.</p>';
  h += '<nav class="toc small"><a href="#how-four">The four handicappers</a> · <a href="#how-value">Winners vs value</a> · <a href="#how-score">How we keep score</a> · <a href="#how-gaps">Known gaps</a> · <a href="#how-gloss">Glossary</a> · <a href="#how-play">Responsible play</a> · <a href="#how-credits">Credits</a></nav>';
  h += '<h3 id="how-four">The four handicappers</h3><div class="facts">' +
    '<div class="panel fact"><b>Claude</b><p>A model that starts from the market\'s odds and moves them with speed figures, Grade 1 form, pace, track bias, expert picks, Jr\'s picks and 40 factors per horse. It refits itself after each race day and keeps a change only if it predicts better on races it was not fitted to.</p></div>' +
    '<div class="panel fact"><b>Jr</b><p>A human handicapper working from a handwritten sheet: green boxes for the best values on each row, then judgment. His method and picks appear with his written permission. The page\'s "Jr\'s method" tab is an approximation of his sheet, not Jr himself.</p></div>' +
    '<div class="panel fact"><b>The experts</b><p>Published win picks from named handicappers at outlets such as DRF and Racing Post, each linked to its source. Picks on scratched horses don\'t count.</p></div>' +
    '<div class="panel fact"><b>The market</b><p>The morning-line favorite, or the live-odds favorite once every starter\'s odds are entered. The crowd is hard to beat: it is the bar everyone else is measured against.</p></div></div>';
  h += '<h3 id="how-value">Winners vs value</h3><p>Picking winners and making money are different games. Favorites win often but pay little, and the track keeps its cut of every pool. A bet only makes sense when the odds on the board are longer than the horse\'s fair odds, with room to spare for the model being wrong.</p>' +
    '<div class="panel" style="max-width:680px"><b>The rule the Bet check runs</b><p class="small">Expected value = win chance × (odds + 1) − 1. Bet only when it clears your safety margin and the win chance is at least 5%. Example: a horse at 25% has fair odds of 3-1. With a 15% margin it needs at least 3.6-1 on the tote; at 3-1 the answer is PASS.</p><p class="small">The Bet check opens a 15% margin by default because the model has very few graded races; 3% is the minimum the master method allows. Expect PASS most of the time.</p></div>';
  var cl = rec.claude;
  h += '<h3 id="how-score">How we keep score</h3><ul class="clean">' +
    '<li><b>Locked picks only.</b> Claude\'s record uses the top pick the race-day engine (v1.1) made before each result. The model was refit afterwards (v2.0) on these same races; anything shown with v2.0 numbers on finished races is labeled "in hindsight" and never enters the record.</li>' +
    '<li><b>What "locked" means on this card.</b> For the 2026 Breeders\' Cup the race-day picks were written into the record on Oct 31 from the race-day engine, rather than stamped by an outside clock before each post. Treat the record as the engine\'s own log, not a third-party-timestamped one.</li>' +
    '<li><b>Payoffs.</b> Each $2 win payoff comes from the official chart or reputable results reports, with source links kept in the race\'s result record.</li>' +
    '<li><b>Sample size.</b> ' + (cl.n ? 'Claude\'s ' + cl.w + ' winners from ' + cl.n + ' races fits a true hit rate anywhere from ' + pctI(cl.ci[0]) + ' to ' + pctI(cl.ci[1]) + ' (exact 95% range). ' : '') + 'No source on this card has enough races to prove an edge. Judging a method takes hundreds of locked races.</li>' +
    '<li><b>Win chances, not certainties.</b> ' + (rec.lockedN ? 'Claude\'s locked picks were priced to win about ' + rec.lockedExp.toFixed(1) + ' races and won ' + cl.w + '. Running hot on a small card is luck as much as skill.' : '') + '</li></ul>';
  h += '<h3 id="how-gaps">Known gaps</h3>' + (gaps.length ? '<ul class="clean">' + gaps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">None recorded.</p>') + '<p class="small muted">These are the data gaps the engine recorded when it loaded the card (as of ' + esc((S.meta && S.meta.asOf) || '—') + ').</p>';
  h += '<h3 id="how-gloss">Glossary</h3><dl class="gloss">' + GLOSS.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>';
  h += '<h3 id="how-play">Responsible play</h3><div class="panel rg"><p><b>This is decision support, not betting advice.</b> Nothing here is a tip to bet, a promise of profit or licensed financial advice. Most bets lose; the track\'s cut makes sure of it.</p><ul class="clean small"><li>Betting is for adults of legal age where you live, through a licensed, legal outlet.</li><li>Set a budget before the first race and treat it as spent. Never chase losses.</li><li>If money is tight, or you are in a bankruptcy or other financial proceeding, the right bet is no bet.</li><li>Gambling problem? Call or text the National Problem Gambling Helpline, <b>1-800-GAMBLER</b>, any time.</li></ul></div>';
  h += '<h3 id="how-credits">Credits and sources</h3><ul class="clean small"><li>Past performances: the Breeders\' Cup\'s free program PPs (Equibase data). Results and payoffs: official charts and the reports linked on each race. Expert picks: linked to each outlet\'s own page.</li><li>Jr\'s method and picks appear with his written permission.</li><li>Model and page: built with Claude. Full source lists are under <a href="#data">Data &amp; sources</a>.</li></ul>';
  return h;
}
function playAct(x, el) {
  var g = gradedRaces(); if (!g.length) return; var i = playIndex(g), r = g[i];
  if (x === 'play-pick') { if (PLAY.shown[r.id]) return; var pg = el && el.getAttribute('data-pgm'); if (!pg || !horse(r.id, pg)) return; PLAY.picks[r.id] = PLAY.picks[r.id] === pg ? undefined : pg; if (!PLAY.picks[r.id]) delete PLAY.picks[r.id]; savePlay(PLAY); render(); }
  else if (x === 'play-reveal') { PLAY.shown[r.id] = true; savePlay(PLAY); render(); var rv = document.querySelector('.reveal'); if (rv && rv.scrollIntoView) rv.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  else if (x === 'play-next' && i < g.length - 1) location.hash = 'play-' + g[i + 1].id;
  else if (x === 'play-prev' && i > 0) location.hash = 'play-' + g[i - 1].id;
  else if (x === 'play-reset') { if (!confirm('Clear your picks and start the card again?')) return; PLAY = { picks: {}, shown: {} }; savePlay(PLAY); if (location.hash === '#play-' + g[0].id) render(); else location.hash = 'play-' + g[0].id; }
  else if (x === 'play-share') doShare();
}
