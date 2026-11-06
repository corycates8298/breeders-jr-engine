/* Race Engine — shared by the published page and the self-review task.
   Pure functions only: data in, numbers out. No network, no DOM. */
(function (root) {
  'use strict';
  var ENGINE_VERSION = '2.1.0';

  var DEFAULT_WEIGHTS = {
    version: 'v1.1',
    market: 0.9,    // log of market win chance (morning line, or live tote odds when entered); 0.9 slightly flattens it to offset the favorite tilt of the other terms
    experts: 0.6,   // expert win-pick share minus market share: moves a horse only where experts and the odds disagree
    speed: 0.08,    // z-score of 3-race speed average within the field (halved when the field mixes US and overseas figures)
    trend: 0.02,    // z-score of last-race speed minus 3-race average
    jrMethod: 0.06, // Jr-method green count / race max (centered)
    jrPicks: 0.10,  // Jr's own picks: 1st=1, 2nd=.75, 3rd=.5, 4th=.25 (centered)
    g1: 0.04,       // won a Grade/Group 1 or beaten 1 length or less in one (centered)
    factors: 0.08,  // top-four count over the 30 non-market factors / race max (centered); market, odds and expert factors excluded to avoid counting them twice
    // v1.1 situation terms (all 0 in v1.0, so v1.0 reproduces exactly)
    situation: 0.04, // z-score of (figure in races most like this one, weighted by surface, distance, going, recency) minus the 3-race average
    pace: 0.05,      // run style x pace shape of this field (lone speed helps the leader; a contested pace helps closers), scaled by pace-data coverage
    bias: 0.5,       // track bias learned from races already run at this meet on the same surface (shrunk toward zero), applied to early speed and post
    keyRace: 0.4,    // key races: horses that met in the same prep, where a rival from that prep has since beaten the market here (shrunk)
    conn: 0          // jockey/trainer over-performance at this meet; shown, but 0 until results show it helps
  };

  // ---------- odds helpers ----------
  function mlToProb(ml) {
    if (ml == null) return null;
    var s = String(ml).trim();
    if (/^(even|evn|evs|ev)$/i.test(s)) return 0.5;
    var m = s.match(/^(\d+(?:\.\d+)?)\s*[-\/:]\s*(\d+(?:\.\d+)?)$/);
    if (m) { var a = +m[1], b = +m[2]; return (a > 0 && b > 0) ? b / (a + b) : null; }
    if (/^(\d+(\.\d*)?|\.\d+)$/.test(s)) { var n = +s; return n > 0 ? 1 / (n + 1) : null; } // odds-to-1, e.g. 3.5
    return null;
  }
  function probToOdds(p) {
    if (!(p > 0)) return null;
    return (1 - p) / p;
  }
  function fmtOdds(p) {
    var o = probToOdds(p);
    if (o == null) return '—';
    if (o < 1) return (Math.round(o * 20) / 20).toFixed(2) + '-1';
    if (o < 10) return (Math.round(o * 10) / 10).toString() + '-1';
    return Math.round(o) + '-1';
  }

  // ---------- field helpers ----------
  function isActive(h) { return h.status === 'starter' || h.status === 'doubtful'; }
  function isEntered(h) { return h.status !== 'scratched'; } // starters + AEs (Jr scores AEs too)
  function surfKey(race) { return /turf/i.test(race.surface) ? 'Turf' : 'Dirt'; }
  function courseKey(race) { return /turf/i.test(race.surface) ? 'BCTurf' : 'BCDirt'; }

  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function sd(a) { var m = mean(a); if (a.length < 2) return null; var v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1); return Math.sqrt(v); }

  // Overseas ratings (Equibase prints them as "T-xxx") are not on the US Equibase scale.
  // 2-year-olds: Jr's DRF sheet gives Beyer = T - 22 for 8 Europeans (within 3 points), and Equibase runs
  // about 9.5 above Beyer for the 8 US runners in the same race (range -4 to +16): T - 22 + 9.5 = T - 12.5.
  // Older horses: 14 horses with both kinds of figure this year differ by a median +0.4, so no offset.
  // Both are estimates with about +/-10 points of noise per horse; the model halves the speed weight in mixed fields.
  var T_OFFSET = { juvenile: -12, older: 0 };
  function figAdj(r, race, off) { if (r.fig == null) return null; if (r.ft !== 'T') return r.fig; var juv = /juvenile/i.test(race.name); var adj = off && isFinite(juv ? off.juvenile : off.older) ? +(juv ? off.juvenile : off.older) : (juv ? T_OFFSET.juvenile : T_OFFSET.older); return r.fig + adj; }

  // ---------- situations (v1.1) ----------
  // Equibase prints the going and a course glyph after each past race: "ft" fast dirt, "fmp" firm turf,
  // "fmh" inner turf, "fmy" Santa Anita hillside turf, "fto" fast synthetic (Turfway, Woodbine, Kempton, Newcastle,
  // Dundalk all use it). The glyph letters were decoded from the tracks they appear at, so treat them as inferred.
  var TURF_GOING = { fm: 1, gf: 1, yl: 1, sf: 1, gs: 1, hy: 1 };
  var OFF_GOING = { sy: 1, my: 1, sl: 1, wf: 1, yl: 1, sf: 1, gs: 1, hy: 1 };
  function lineSurface(l) {
    var s = String(l && l.sc || '').toLowerCase(), g = s.slice(0, 2), x = s.slice(2);
    if (TURF_GOING[g]) return 'T';
    if (x === 'o') return 'S';
    if (x === 'p' || x === 'h' || x === 'y') return 'T';
    return 'D';
  }
  function lineGoing(l) {
    var g = String(l && l.sc || '').toLowerCase().slice(0, 2);
    if (lineSurface(l) === 'S') return 'aw';
    if (OFF_GOING[g]) return 'off';
    if (g === 'gd') return 'good';
    return 'fast';
  }
  function raceSurface(race) { var s = String(race.surface || ''); return /turf/i.test(s) ? 'T' : (/synth|tapeta|poly|all.?weather/i.test(s) ? 'S' : 'D'); }
  function distBand(fl) { if (fl == null) return null; return fl <= 7 ? 'sprint' : (fl < 9 ? 'mile' : 'route'); }
  function goingW(target, g) {
    if (g === 'aw') return 0.8;
    if (target === 'off') return g === 'off' ? 1 : (g === 'good' ? 0.7 : 0.45);
    if (target === 'good') return g === 'good' ? 1 : 0.8;
    return g === 'fast' ? 1 : (g === 'good' ? 0.85 : 0.6);
  }
  // Weight of one past race as evidence for today's conditions.
  function simWeight(l, i, S0, D0, G0) {
    var s = lineSurface(l); var w = s === S0 ? 1 : ((s === 'S' || S0 === 'S') ? 0.35 : 0.15);
    if (D0 && l.fl) w *= Math.exp(-Math.abs(l.fl - D0) / 1.5);
    w *= goingW(G0, lineGoing(l));
    return w * Math.pow(0.85, i);
  }
  function sitProfile(h, race, off, going) {
    var S0 = raceSurface(race), D0 = raceFurlongs(race), G0 = going || 'fast';
    var lines = (h.races || []).slice(0, 6); var sw = 0, sf = 0, ev = 0, best = null, bestW = 0;
    lines.forEach(function (l, i) {
      var w = simWeight(l, i, S0, D0, G0); ev += w;
      var f = figAdj(l, race, off);
      if (f != null) { sw += w; sf += w * f; if (w > bestW) { bestW = w; best = l; } }
    });
    var onSurf = lines.filter(function (l) { return lineSurface(l) === S0; }).length;
    var offRuns = lines.filter(function (l) { return lineGoing(l) === 'off'; });
    return { sitFig: sw >= 0.25 ? Math.round(sf / sw * 10) / 10 : null, evidence: Math.round(ev * 100) / 100, onSurf: onSurf, offRuns: offRuns.length,
      closest: best ? best.d + ' ' + best.trk : null };
  }
  // Profile of one horse by situation, from the races in its past performances.
  var SIT_DIMS = [
    { key: 'surface', label: 'Surface', of: function (l) { return { D: 'Dirt', T: 'Turf', S: 'Synthetic' }[lineSurface(l)]; } },
    { key: 'band', label: 'Distance', of: function (l) { var b = distBand(l.fl); return b ? { sprint: 'Sprint (7f or less)', mile: 'Mile range (7½f–8½f)', route: 'Route (9f+)' }[b] : null; } },
    { key: 'going', label: 'Going', of: function (l) { return { fast: 'Fast / firm', good: 'Good', off: 'Wet / soft', aw: 'Synthetic' }[lineGoing(l)]; } },
    { key: 'class', label: 'Class', of: function (l) { var g = String(l.gr || ''); return g === '1' ? 'Grade/Group 1' : (g === '2' || g === '3' ? 'Grade/Group 2–3' : (g === 'S' ? 'Listed / stakes' : 'Allowance / maiden')); } },
    { key: 'where', label: 'Where', of: function (l) { return l.fo ? 'Abroad' : 'North America'; } },
    { key: 'track', label: 'Track', of: function (l) { return l.trk === 'Kee' ? 'Keeneland' : 'Elsewhere'; } }
  ];
  function sitTable(h, race, off) {
    var out = [];
    SIT_DIMS.forEach(function (d) {
      var g = {};
      (h.races || []).forEach(function (l) { var v = d.of(l); if (!v) return; var o = g[v] || (g[v] = { dim: d.label, dimKey: d.key, value: v, starts: 0, wins: 0, itm: 0, figs: [] });
        o.starts++; if (l.fin === 1) o.wins++; if (l.fin != null && l.fin <= 3) o.itm++; var f = figAdj(l, race || {}, off); if (f != null) o.figs.push(f); });
      Object.keys(g).forEach(function (k) { var o = g[k]; o.avgFig = o.figs.length ? Math.round(mean(o.figs) * 10) / 10 : null; o.bestFig = o.figs.length ? Math.max.apply(null, o.figs) : null; delete o.figs; out.push(o); });
    });
    return out;
  }
  // Which value of each dimension today's race is.
  function raceSituation(race, going) {
    var fl = raceFurlongs(race); var S0 = raceSurface(race);
    return { surface: { D: 'Dirt', T: 'Turf', S: 'Synthetic' }[S0], band: { sprint: 'Sprint (7f or less)', mile: 'Mile range (7½f–8½f)', route: 'Route (9f+)' }[distBand(fl)],
      going: { fast: 'Fast / firm', good: 'Good', off: 'Wet / soft' }[going || 'fast'], 'class': /G1/.test(race.grade || '') ? 'Grade/Group 1' : (/G[23]/.test(race.grade || '') ? 'Grade/Group 2–3' : null),
      where: 'North America', track: /kee/i.test(race.track || (String(race.id || '').indexOf('bc26') === 0 ? 'Keeneland' : '')) ? 'Keeneland' : null };
  }

  // Pace map: early-pace figures (US races only) -> run style and the shape of the pace.
  var PACE_FIT = { lone: { E: 1, P: 0, S: -0.3 }, honest: { E: 0, P: 0, S: 0 }, contested: { E: -0.6, P: 0.2, S: 0.6 }, unknown: {} };
  function paceMap(race, F, override) {
    // Early-speed rating = halfway between the average and the best of the last three US early-pace figures.
    var active = race.horses.filter(isActive);
    var withP = active.filter(function (h) { return F[h.pgm].paceE != null; });
    var vals = withP.map(function (h) { return F[h.pgm].paceE; });
    var top = withP.length ? Math.max.apply(null, vals) : null;
    var win = Math.min(8, Math.max(4, 0.5 * (sd(vals) || 0)));
    var sorted = withP.slice().sort(function (a, b) { return F[b.pgm].paceE - F[a.pgm].paceE; });
    var pctE = {}; var n = sorted.length; var i = 0;
    while (i < n) { var j = i; while (j + 1 < n && F[sorted[j + 1].pgm].paceE === F[sorted[i].pgm].paceE) j++; var r = (i + j) / 2; for (var k = i; k <= j; k++) pctE[sorted[k].pgm] = n > 1 ? 1 - r / (n - 1) : 0.5; i = j + 1; }
    var style = {}, nE = 0;
    active.forEach(function (h) { var v = F[h.pgm].paceE; var st = v == null ? 'U' : (v >= top - win ? 'E' : (pctE[h.pgm] >= 0.5 ? 'P' : 'S')); style[h.pgm] = st; if (st === 'E') nE++; });
    var auto = withP.length < 2 ? 'unknown' : (nE <= 1 ? 'lone' : (nE === 2 ? 'honest' : 'contested'));
    var shape = override && PACE_FIT[override] ? override : auto;
    var coverage = active.length ? withP.length / active.length : 0;
    var fit = {}; active.forEach(function (h) { var v = (PACE_FIT[shape] || {})[style[h.pgm]]; fit[h.pgm] = (v || 0) * (override ? 1 : coverage); });
    var byPgm = active.slice().sort(function (a, b) { return parseInt(a.pgm, 10) - parseInt(b.pgm, 10); });
    var inside = {}; byPgm.forEach(function (h, i2) { inside[h.pgm] = byPgm.length > 1 ? 1 - i2 / (byPgm.length - 1) : 0.5; });
    return { style: style, pctE: pctE, nE: nE, window: Math.round(win * 10) / 10, shape: shape, auto: auto, overridden: !!(override && PACE_FIT[override]), coverage: coverage, top: top, fit: fit, inside: inside,
      leaders: active.filter(function (h) { return style[h.pgm] === 'E'; }).map(function (h) { return h.pgm; }) };
  }

  // ---------- cross-race learning ----------
  function normName(n) { return String(n || '').toUpperCase().replace(/\(([A-Z]{2,3})\)/g, ' $1').replace(/[^A-Z0-9]+/g, ' ').trim(); }
  function cardOf(r) { return r.card || String(r.id || '').split('-')[0]; }
  function raceKey(r) { return (r.date || '') + ' ' + String(r.cardRace == null ? 0 : r.cardRace).padStart(2, '0'); }
  function cleanOrder(order) { var seen = {}; return (order || []).map(function (p) { return String(p).trim(); }).filter(function (p) { if (!p || seen[p]) return false; seen[p] = 1; return true; }); }
  function finishPos(active, order) {
    var pos = {}; var listed = order.filter(function (p) { return active.indexOf(p) >= 0; });
    listed.forEach(function (p, i) { pos[p] = i + 1; });
    var rest = active.filter(function (p) { return pos[p] == null; }); var mid = (listed.length + 1 + active.length) / 2;
    rest.forEach(function (p) { pos[p] = mid; });
    return pos;
  }
  function femaleRace(r) { return /fill|mare|distaff|ladies/i.test(r.name || ''); }
  // Same prep race = same date, track, distance, grade, going and field size; split by the
  // Breeders' Cup race's sex when two winners collide (e.g. First Lady and Turf Mile, same day).
  function keyRaceIndex(races) {
    var g = {};
    races.forEach(function (r) { r.horses.filter(isEntered).forEach(function (h) { (h.races || []).forEach(function (l) {
      var k = [l.d, l.trk, l.dist, l.gr, l.sc, l.fs].join('|'); (g[k] || (g[k] = [])).push({ rid: r.id, pgm: h.pgm, name: h.name, nn: normName(h.name), fin: l.fin, line: l, fem: femaleRace(r) });
    }); }); });
    var out = {};
    Object.keys(g).forEach(function (k) {
      var v = g[k]; var seen = {}; v = v.filter(function (x) { var id = x.rid + '#' + x.nn; if (seen[id]) return false; seen[id] = 1; return true; });
      function clean(arr) { var f = arr.map(function (x) { return x.fin; }).filter(Boolean); return f.length === new Set(f).size; }
      if (v.length < 2) return;
      if (clean(v)) { out[k] = v; return; }
      var a = v.filter(function (x) { return x.fem; }), b = v.filter(function (x) { return !x.fem; });
      if (a.length >= 2 && clean(a)) out[k + '|F'] = a; if (b.length >= 2 && clean(b)) out[k + '|O'] = b;
    });
    return out;
  }
  function crossRace(races, results, opts) {
    opts = opts || {}; var lives = opts.lives || {}, goings = opts.goings || {}, manual = opts.manualBias || {}, paceOv = opts.pace || {};
    var sorted = races.slice().sort(function (a, b) { return raceKey(a).localeCompare(raceKey(b)); });
    var base = {};
    sorted.forEach(function (r) {
      var F = features(r, opts.tOffset, { going: goings[r.id] });
      var C = consensus(r, F, lives[r.id]); var P = paceMap(r, F, null);
      var act = r.horses.filter(isActive).map(function (h) { return h.pgm; });
      var res = results[r.id]; var ord = res && res.order ? cleanOrder(res.order) : []; var done = ord.length > 0 && act.indexOf(ord[0]) >= 0;
      var o = { r: r, F: F, C: C, P: P, act: act, done: done, card: cardOf(r), surf: raceSurface(r) };
      if (done) {
        var pos = finishPos(act, ord); o.pos = pos; o.op = {};
        // Over-performance vs the market. Horses outside the listed finishers only tell us they were beaten by
        // all of them, so a fancied one counts as a miss and a long shot as no information (never as a gain).
        var L = ord.filter(function (p) { return act.indexOf(p) >= 0; }).length;
        act.forEach(function (p) { var listed = ord.indexOf(p) >= 0; o.op[p] = listed ? (C.rank[p] - pos[p]) / act.length : Math.min(0, (C.rank[p] - (L + 1)) / act.length); });
        var top3 = ord.filter(function (p) { return act.indexOf(p) >= 0; }).slice(0, 3);
        var eAll = act.filter(function (p) { return P.pctE[p] != null; }), eTop = top3.filter(function (p) { return P.pctE[p] != null; });
        o.speedObs = (eTop.length >= 2 && eAll.length >= 4) ? mean(eTop.map(function (p) { return P.pctE[p]; })) - mean(eAll.map(function (p) { return P.pctE[p]; })) : null;
        o.insideObs = top3.length ? mean(top3.map(function (p) { return P.inside[p]; })) - mean(act.map(function (p) { return P.inside[p]; })) : null;
        o.top3 = top3;
      }
      base[r.id] = o;
    });
    var KR = keyRaceIndex(sorted);
    var horseKeys = {}; Object.keys(KR).forEach(function (k) { KR[k].forEach(function (x) { var id = x.rid + '#' + x.pgm; (horseKeys[id] || (horseKeys[id] = [])).push(k); }); });
    function biasFrom(prior, card, surf) {
      var s = 0, n = 0, si = 0, ni = 0, list = [];
      prior.forEach(function (o) { if (!o.done || o.card !== card || o.surf !== surf) return; if (o.speedObs != null) { s += o.speedObs; n++; } if (o.insideObs != null) { si += o.insideObs; ni++; } list.push(o.r.id); });
      return { speed: Math.round(s / (n + 3) * 1000) / 1000, inside: Math.round(si / (ni + 3) * 1000) / 1000, n: list.length, nSpeed: n, races: list, src: 'learned' };
    }
    function connFrom(prior, card) {
      var J = {}, T = {};
      prior.forEach(function (o) { if (!o.done || o.card !== card) return; o.r.horses.filter(isActive).forEach(function (h) {
        [[J, normName(h.jockey)], [T, normName(h.trainer)]].forEach(function (pair) { if (!pair[1]) return; var m = pair[0][pair[1]] || (pair[0][pair[1]] = { starts: 0, wins: 0, itm: 0, op: 0 }); m.starts++; if (o.pos[h.pgm] === 1) m.wins++; if (o.pos[h.pgm] <= 3) m.itm++; m.op += o.op[h.pgm]; });
      }); });
      return { J: J, T: T };
    }
    var ctxs = {}; var prior = [];
    sorted.forEach(function (r) {
      var o = base[r.id]; var surfKey = o.surf;
      var b = biasFrom(prior, o.card, surfKey);
      var mb = manual[surfKey]; if (mb && (mb.speed != null || mb.inside != null)) b = { speed: +mb.speed || 0, inside: +mb.inside || 0, n: b.n, nSpeed: b.nSpeed, races: b.races, src: 'manual', learned: { speed: b.speed, inside: b.inside } };
      // key races: rivals from the same prep who have already run here
      var key = {}, keyRefs = {};
      r.horses.filter(isActive).forEach(function (h) {
        var ks = horseKeys[r.id + '#' + h.pgm] || []; var sum = 0, cnt = 0, refs = [];
        ks.forEach(function (k) { var me = KR[k].find(function (x) { return x.rid === r.id && x.pgm === h.pgm; });
          KR[k].forEach(function (x) { if (x.rid === r.id || x.nn === me.nn) return; var ob = base[x.rid]; if (!ob || !ob.done || raceKey(ob.r) >= raceKey(r) || ob.op[x.pgm] == null) return;
            var credit = (me.fin && x.fin && me.fin < x.fin) ? 1 : 0.6; sum += credit * ob.op[x.pgm]; cnt++;
            refs.push({ key: k, prep: me.line.d + ' ' + me.line.trk + ' ' + (me.line.gr && /^[123]$/.test(me.line.gr) ? 'G' + me.line.gr : (me.line.gr || '')), meFin: me.fin, rival: x.name, rivalFin: x.fin, rivalRace: x.rid, rivalPos: ob.pos[x.pgm], rivalOp: Math.round(ob.op[x.pgm] * 1000) / 1000, credit: credit }); }); });
        key[h.pgm] = cnt ? sum / (cnt + 2) : 0; keyRefs[h.pgm] = refs;
      });
      var cn = connFrom(prior, o.card); var conn = {}, connInfo = {};
      r.horses.filter(isActive).forEach(function (h) { var j = cn.J[normName(h.jockey)], t = cn.T[normName(h.trainer)];
        conn[h.pgm] = (j ? j.op / (j.starts + 4) : 0) + (t ? t.op / (t.starts + 4) : 0); connInfo[h.pgm] = { j: j || null, t: t || null }; });
      ctxs[r.id] = { going: goings[r.id] || null, pace: paceOv[r.id] || null, bias: b, key: key, keyRefs: keyRefs, conn: conn, connInfo: connInfo, priorDone: prior.filter(function (x) { return x.done; }).length };
      prior.push(o);
    });
    // summary using everything entered so far
    var all = sorted.map(function (r) { return base[r.id]; });
    var cards = {}; all.forEach(function (o) { cards[o.card] = 1; });
    var biasNow = {}; Object.keys(cards).forEach(function (c) { biasNow[c] = { D: biasFrom(all, c, 'D'), T: biasFrom(all, c, 'T'), S: biasFrom(all, c, 'S') }; });
    var connNow = {}; Object.keys(cards).forEach(function (c) { connNow[c] = connFrom(all, c); });
    var keyList = Object.keys(KR).map(function (k) { var v = KR[k]; var l = v[0].line;
      var grads = v.map(function (x) { var ob = base[x.rid]; return { rid: x.rid, pgm: x.pgm, name: x.name, fin: x.fin, ran: !!(ob && ob.done), pos: ob && ob.done ? ob.pos[x.pgm] : null, op: ob && ob.done ? ob.op[x.pgm] : null }; });
      var ran = grads.filter(function (x) { return x.ran && x.op != null; });
      return { key: k, d: l.d, trk: l.trk, dist: l.dist, fl: l.fl, gr: l.gr, sc: l.sc, fs: l.fs, abroad: !!l.fo, grads: grads, races: Array.from(new Set(v.map(function (x) { return x.rid; }))), strength: ran.length ? ran.reduce(function (s, x) { return s + x.op; }, 0) / (ran.length + 2) : null, nRan: ran.length };
    });
    return { ctxs: ctxs, bias: biasNow, conn: connNow, keyRaces: keyList, base: base, order: sorted.map(function (r) { return r.id; }) };
  }

  // ---------- horse book: one record per horse across every card loaded ----------
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ppDateStr(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + MONS[+m[2] - 1] + m[1].slice(2) : null; }
  function resultLine(race, result, pgm, going, live) {
    if (!result || !result.order || !result.order.length) return null;
    var act = race.horses.filter(isActive).map(function (h) { return h.pgm; }); if (act.indexOf(pgm) < 0) return null;
    var i = result.order.map(String).indexOf(String(pgm)); var S0 = raceSurface(race); var g = going || 'fast';
    var sc = S0 === 'T' ? ({ fast: 'fmp', good: 'gdp', off: 'ylp' })[g] : (S0 === 'S' ? 'fto' : ({ fast: 'ft', good: 'gd', off: 'sy' })[g]);
    var h = race.horses.find(function (x) { return x.pgm === pgm; }); var od = live && live[pgm] != null ? mlToProb(live[pgm]) : null;
    return { d: ppDateStr(race.date), trk: race.trkCode || (cardOf(race) === 'bc26' ? 'Kee' : ''), fo: 0, sc: sc, dist: race.distance, fl: raceFurlongs(race), gr: /G1/.test(race.grade || '') ? '1' : (/G2/.test(race.grade || '') ? '2' : (/G3/.test(race.grade || '') ? '3' : 'S')),
      fig: result.figs && result.figs[pgm] != null ? +result.figs[pgm] : null, ft: result.figs && result.figs[pgm] != null ? 'E' : null, pace: null, fin: i >= 0 ? i + 1 : null, mg: null,
      odds: od ? Math.round(probToOdds(od) * 100) / 100 : null, fav: false, fs: act.length, dq: false, src: 'result', race: race.name, rid: race.id, ml: h ? h.ml : null };
  }
  function horseBook(races, results, goings, lives) {
    var book = {};
    races.slice().sort(function (a, b) { return raceKey(a).localeCompare(raceKey(b)); }).forEach(function (r) {
      r.horses.forEach(function (h) {
        var k = normName(h.name); var b = book[k] || (book[k] = { key: k, name: h.name, entries: [], lines: [], seen: {} });
        b.entries.push({ rid: r.id, pgm: h.pgm, status: h.status, date: r.date, race: r.name, card: cardOf(r) });
        (h.races || []).forEach(function (l) { var id = [l.d, l.trk, l.dist, l.fin].join('|'); if (!b.seen[id]) { b.seen[id] = 1; b.lines.push(l); } });
        var rl = resultLine(r, results && results[r.id], h.pgm, goings && goings[r.id], lives && lives[r.id]);
        if (rl) { var id2 = [rl.d, rl.trk, rl.dist, rl.fin].join('|'); if (!b.seen[id2]) { b.seen[id2] = 1; b.lines.push(rl); } }
        b.latest = h; b.name = h.name;
      });
    });
    Object.keys(book).forEach(function (k) { var b = book[k]; b.lines.sort(function (x, y) { return (ppDate(y.d) || 0) - (ppDate(x.d) || 0); }); delete b.seen; });
    return book;
  }
  // Fill a new card's horses from the book: past lines (including Breeders' Cup results), records, G1 runs.
  function attachFromBook(race, book) {
    var hits = [];
    race.horses.forEach(function (h) {
      var b = book[normName(h.name)]; if (!b) return;
      var rd = race.date ? Date.parse(race.date + 'T00:00:00Z') : null;
      var lines = b.lines.filter(function (l) { var d = ppDate(l.d); return !rd || !d || d < rd; });
      if (!h.races || !h.races.length) h.races = lines.slice(0, 8);
      var L = b.latest || {};
      ['rec', 'g1', 'grw', 'works', 'trainer', 'jockey'].forEach(function (f) { if (h[f] == null && L[f] != null) h[f] = JSON.parse(JSON.stringify(L[f])); });
      h.book = b.entries.map(function (e) { return e.rid; });
      hits.push({ pgm: h.pgm, name: h.name, from: h.book, lines: lines.length });
    });
    return hits;
  }

  // ---------- features ----------
  function features(race, off, ctx) {
    var F = {}; var going = ctx && ctx.going;
    race.horses.forEach(function (h) {
      var figs = (h.races || []).filter(function (r) { return r.fig != null; }).map(function (r) { return { fig: figAdj(r, race, off), raw: r.fig, ft: r.ft }; });
      var last3 = figs.slice(0, 3).map(function (r) { return r.fig; });
      var last = last3.length ? last3[0] : null;
      var avg3 = last3.length ? mean(last3) : null;
      var best = figs.length ? Math.max.apply(null, figs.map(function (r) { return r.fig; })) : null;
      var g1 = (h.g1 || []).filter(function (x) { return x && x[0] != null; });
      var g1Best = null, g1Won = 0;
      g1.forEach(function (x) { var m = x[0] === 1 ? 0 : (x[1] == null ? 99 : x[1]); if (x[0] === 1) g1Won++; if (g1Best == null || m < g1Best) g1Best = m; });
      var cls = 0; String(h.grw || '').replace(/G([123])/g, function (_, g) { cls = Math.max(cls, 4 - (+g)); return _; });
      var rec = h.rec || {};
      var dist = rec.Distance || null, surf = rec[surfKey(race)] || null, course = rec[courseKey(race)] || null;
      var works = (h.works || []).filter(function (w) { return w[1] >= 3; });
      var workPct = works.length ? Math.min.apply(null, works.map(function (w) { return w[0] / w[1]; })) : null;
      var lastRaces = (h.races || []).slice(0, 3);
      var formW3 = lastRaces.filter(function (r) { return r.fin === 1; }).length;
      var itm3 = lastRaces.filter(function (r) { return r.fin != null && r.fin <= 3; }).length;
      var exW = (h.experts || []).filter(function (e) { return e.t === 'win'; }).length;
      var exV = (h.experts || []).filter(function (e) { return e.t === 'value'; }).length;
      F[h.pgm] = {
        last: last, avg3: avg3 == null ? null : Math.round(avg3 * 10) / 10, trend: (last != null && avg3 != null) ? Math.round((last - avg3) * 10) / 10 : null,
        best: best, figN: last3.length, figType: figs.length ? figs[0].ft : null, last3raw: figs.slice(0, 3).map(function (r) { return (r.ft === 'T' ? 'T' : '') + r.raw; }),
        last3: last3,
        g1Best: g1Best, g1Won: g1Won, g1Starts: g1.length, cls: cls,
        dist: dist, surf: surf, course: course, workPct: workPct, formW3: formW3, itm3: itm3,
        exW: exW, exV: exV,
        spread: last3.length >= 2 ? Math.max.apply(null, last3) - Math.min.apply(null, last3) : null,
        paceLast: null, paceAvg: null, gradedStarts: (h.races || []).filter(function (r) { return r.gr === '1' || r.gr === '2' || r.gr === '3'; }).length,
        lastFin: lastRaces.length ? lastRaces[0].fin : null,
        lastMargin: lastRaces.length && lastRaces[0].fin != null ? (lastRaces[0].fin === 1 ? 0 : lastRaces[0].mg) : null,
        layoff: null, lifeWin: rec.Life && rec.Life[0] ? Math.round(1000 * rec.Life[1] / rec.Life[0]) / 1000 : null,
        yearWin: rec['2026'] && rec['2026'][0] ? Math.round(1000 * rec['2026'][1] / rec['2026'][0]) / 1000 : null,
        distChange: null, mlProb: mlToProb(h.ml), smartGap: null, workCount: (h.works || []).length,
        lastOdds: lastRaces.length ? lastRaces[0].odds : null, stamina: null,
        wetWins: ((rec.WetDirt || [0, 0])[1] + (rec.WetTurf || [0, 0])[1]),
        starts: rec.Life ? rec.Life[0] : ((rec['2026'] || [null])[0]), abroad: lastRaces.length ? (lastRaces[0].fo ? 1 : 0) : null, wt: h.wt
      };
      var us = (h.races || []).filter(function (r) { return !r.fo && r.pace != null; }).slice(0, 3);
      if (us.length) { F[h.pgm].paceLast = (h.races[0] && !h.races[0].fo) ? h.races[0].pace : null; F[h.pgm].paceAvg = Math.round(mean(us.map(function (r) { return r.pace; })) * 10) / 10; }
      if (us.length) { var pv = us.map(function (r) { return r.pace; }); F[h.pgm].paceE = Math.round((mean(pv) + Math.max.apply(null, pv)) / 2 * 10) / 10; } else F[h.pgm].paceE = null;
      var rd = race.date ? Date.parse(race.date + 'T00:00:00Z') : null; var ld = lastRaces.length ? ppDate(lastRaces[0].d) : null;
      if (rd && ld) F[h.pgm].layoff = Math.round((rd - ld) / 864e5);
      var tf = raceFurlongs(race);
      if (tf && lastRaces.length && lastRaces[0].fl) F[h.pgm].distChange = tf - lastRaces[0].fl;
      var maxF = Math.max.apply(null, (h.races || []).map(function (r) { return r.fl || 0; }).concat([0]));
      if (tf && maxF) F[h.pgm].stamina = maxF - tf;
      // v2 features for the 40-factor catalog (all required; null = no evidence, ranked last, never green)
      var L6 = (h.races || []).slice(0, 6), S0 = raceSurface(race), fx = F[h.pgm];
      var onS = L6.filter(function (l) { return lineSurface(l) === S0 && l.fig != null; }).map(function (l) { return figAdj(l, race, off); });
      fx.spdSurf = onS.length ? Math.max.apply(null, onS) : null;
      fx.spdFloor = last3.length ? Math.min.apply(null, last3) : null;
      fx.g1Top3 = g1.filter(function (x) { return x[0] <= 3; }).length;
      fx.gradedWins = (String(h.grw || '').match(/G[123]/g) || []).length;
      var lg = lastRaces.length ? String(lastRaces[0].gr || '') : null;
      fx.lastGrade = lg == null ? null : (lg === '1' ? 4 : lg === '2' ? 3 : lg === '3' ? 2 : (lg === 'S' || lg === 'L') ? 1 : 0);
      var fins6 = L6.filter(function (l) { return l.fin != null; });
      fx.wins6 = fins6.filter(function (l) { return l.fin === 1; }).length;
      fx.itm6 = fins6.length ? Math.round(1000 * fins6.filter(function (l) { return l.fin <= 3; }).length / fins6.length) / 1000 : null;
      fx.dominance = fins6.length ? Math.max.apply(null, fins6.filter(function (l) { return l.fin === 1; }).map(function (l) { return +l.mg || 0; }).concat([0])) : null;
      var f3 = lastRaces.filter(function (l) { return l.fin != null; }).map(function (l) { return l.fin; });
      fx.avgFin3 = f3.length ? mean(f3) : null;
      var tfx = raceFurlongs(race), band = distBand(tfx);
      var atD = L6.filter(function (l) { return l.fig != null && band && distBand(l.fl) === band; }).map(function (l) { return figAdj(l, race, off); });
      fx.spdDist = atD.length ? Math.max.apply(null, atD) : null;
      fx.racesAtTrip = tfx ? L6.filter(function (l) { return l.fl != null && l.fl >= tfx - 0.5; }).length : null;
      fx.surfShare = L6.length ? Math.round(1000 * L6.filter(function (l) { return lineSurface(l) === S0; }).length / L6.length) / 1000 : null;
      var sk = S0 === 'T' ? 'Turf' : (S0 === 'S' ? 'Synthetic' : 'Dirt'), wk = S0 === 'T' ? 'WetTurf' : (S0 === 'D' ? 'WetDirt' : null);
      if (h.rec && h.rec[sk]) { var wetW = wk && h.rec[wk] ? (h.rec[wk][1] || 0) : 0; fx.goingFit = going === 'off' ? wetW : Math.max(0, (h.rec[sk][1] || 0) - wetW); } else fx.goingFit = null;
      fx.courseScore = h.rec ? (rec[courseKey(race)] ? (rec[courseKey(race)][0] || 0) + 2 * (rec[courseKey(race)][1] || 0) : 0) : null;
      fx.lifeShr = rec.Life && rec.Life[0] != null ? (rec.Life[1] + 1) / (rec.Life[0] + 4) : null;
      fx.yearShr = rec['2026'] && rec['2026'][0] != null ? (rec['2026'][1] + 1) / (rec['2026'][0] + 4) : null;
      fx.surfRate = surf && surf[0] != null ? (surf[1] + 1) / (surf[0] + 4) : null;
      fx.distRate = dist && dist[0] != null ? (dist[1] + 1) / (dist[0] + 4) : null;
      fx.lastWon = lastRaces.length ? (lastRaces[0].fin === 1 ? 1 : 0) : null;
      fx.lastMg = lastRaces.length && lastRaces[0].fin != null ? (+lastRaces[0].mg || 0) : null;
      var sp = sitProfile(h, race, off, going); var f0 = F[h.pgm];
      f0.sitFig = sp.sitFig; f0.evidence = sp.evidence; f0.onSurf = sp.onSurf; f0.offRuns = sp.offRuns; f0.closest = sp.closest;
      f0.sitDelta = (sp.sitFig != null && f0.avg3 != null) ? Math.round((sp.sitFig - f0.avg3) * 10) / 10 : null;
    });
    // field-relative speed (over entered horses, like Jr's sheet)
    var entered = race.horses.filter(isEntered);
    var lastMax = Math.max.apply(null, entered.map(function (h) { return F[h.pgm].last; }).filter(function (x) { return x != null; }).concat([-1e9]));
    var avgMax = Math.max.apply(null, entered.map(function (h) { return F[h.pgm].avg3; }).filter(function (x) { return x != null; }).concat([-1e9]));
    race.horses.forEach(function (h) {
      var f = F[h.pgm];
      f.gapLast = f.last != null ? f.last - lastMax : null;
      f.gapAvg = f.avg3 != null ? Math.round((f.avg3 - avgMax) * 10) / 10 : null;
    });
    return F;
  }

  // ---------- Jr-method (his sheet's rules applied to the free Equibase PPs) ----------
  var JR_CATS = [
    { key: 'g1', label: 'G1 proximity', desc: 'Lengths beaten in his best Grade/Group 1 run (0 = won one). Jr\'s top red row.', get: function (f) { return f.g1Best; }, better: 'low' },
    { key: 'gapLast', label: 'Last speed vs best', desc: 'Last-race speed figure minus the best last-race figure in the field (0 = best). Jr\'s second red row.', get: function (f) { return f.gapLast; }, better: 'high' },
    { key: 'avg3', label: '3-race speed avg', desc: 'Average of the last three speed figures, as Cory describes Jr\'s method.', get: function (f) { return f.avg3; }, better: 'high' },
    { key: 'trend', label: 'Speed up/down', desc: 'Last-race figure minus that 3-race average: + is improving, − is tailing off. Green when positive, as on Jr\'s sheet.', get: function (f) { return f.trend; }, better: 'positive' },
    { key: 'cls', label: 'Class (grade won)', desc: 'Highest grade won: G1 = 3, G2 = 2, G3 = 1.', get: function (f) { return f.cls || null; }, better: 'high' },
    { key: 'surf', label: 'Surface wins', desc: 'Wins on today\'s surface (turf or dirt).', get: function (f) { return f.surf ? f.surf[1] : null; }, better: 'high', min: 1 },
    { key: 'dist', label: 'Distance wins', desc: 'Wins at today\'s distance.', get: function (f) { return f.dist ? f.dist[1] : null; }, better: 'high', min: 1 },
    { key: 'course', label: 'Keeneland course', desc: 'Starts at this Breeders\' Cup course on today\'s surface (wins break ties).', get: function (f) { return f.course && f.course[0] ? f.course[0] + f.course[1] * 2 : null; }, better: 'high' },
    { key: 'form', label: 'Wins, last 3', desc: 'Wins in the last three starts.', get: function (f) { return f.formW3; }, better: 'high', min: 1 },
    { key: 'works', label: 'Best workout rank', desc: 'Best recent workout rank as a share of the horses that worked (1/12 = top 8%).', get: function (f) { return f.workPct; }, better: 'low' }
  ];

  function greensFor(vals, better, min) {
    // vals: [{pgm, v}] with v != null ; Jr's rule: the best four values are green, ties included
    var xs = vals.filter(function (o) { return o.v != null && (min == null || o.v >= min); });
    if (better === 'positive') return xs.filter(function (o) { return o.v > 0; }).map(function (o) { return o.pgm; });
    if (!xs.length) return [];
    var sorted = xs.slice().sort(function (a, b) { return better === 'low' ? a.v - b.v : b.v - a.v; });
    var cut = sorted[Math.min(3, sorted.length - 1)].v;
    return xs.filter(function (o) { return better === 'low' ? o.v <= cut : o.v >= cut; }).map(function (o) { return o.pgm; });
  }

  function jrMethod(race, F) {
    var entered = race.horses.filter(isEntered);
    var cats = JR_CATS.map(function (c) {
      var vals = entered.map(function (h) { return { pgm: h.pgm, v: c.get(F[h.pgm]) }; });
      var g = greensFor(vals, c.better, c.min);
      var map = {}; vals.forEach(function (o) { map[o.pgm] = o.v; });
      return { key: c.key, label: c.label, desc: c.desc, values: map, greens: g };
    });
    var counts = {};
    entered.forEach(function (h) { counts[h.pgm] = 0; });
    cats.forEach(function (c) { c.greens.forEach(function (p) { counts[p] = (counts[p] || 0) + 1; }); });
    var active = race.horses.filter(isActive);
    var order = active.slice().sort(function (a, b) {
      return (counts[b.pgm] - counts[a.pgm]) || ((mlToProb(b.ml) || 0) - (mlToProb(a.ml) || 0)) || (parseInt(a.pgm, 10) - parseInt(b.pgm, 10));
    }).map(function (h) { return h.pgm; });
    return { cats: cats, counts: counts, order: order };
  }

  // ---------- consensus ("Breeders' version": the market plus published experts) ----------
  function consensus(race, F, live) {
    var active = race.horses.filter(isActive);
    var raw = {}, tot = 0, src = 'Morning line';
    var useLive = !!live && active.length > 0 && active.every(function (h) { return mlToProb(live[h.pgm]) != null; });
    active.forEach(function (h) {
      var p = useLive ? mlToProb(live[h.pgm]) : mlToProb(h.ml);
      raw[h.pgm] = p || 0.005; tot += raw[h.pgm];
    });
    if (useLive) src = 'Live odds';
    var q = {}; active.forEach(function (h) { q[h.pgm] = raw[h.pgm] / tot; });
    var exTot = active.reduce(function (s, h) { return s + F[h.pgm].exW; }, 0);
    var E = {}; active.forEach(function (h) { E[h.pgm] = exTot ? F[h.pgm].exW / exTot : 0; });
    var order = active.slice().sort(function (a, b) { return (q[b.pgm] - q[a.pgm]) || (E[b.pgm] - E[a.pgm]) || (parseInt(a.pgm, 10) - parseInt(b.pgm, 10)); }).map(function (h) { return h.pgm; });
    // fractional ranks for ties in q
    var rank = {}; var i = 0;
    var byQ = active.slice().sort(function (a, b) { return q[b.pgm] - q[a.pgm]; });
    while (i < byQ.length) {
      var j = i; while (j + 1 < byQ.length && Math.abs(q[byQ[j + 1].pgm] - q[byQ[i].pgm]) < 1e-9) j++;
      for (var k = i; k <= j; k++) rank[byQ[k].pgm] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return { q: q, E: E, exTot: exTot, order: order, rank: rank, overround: tot, source: src };
  }

  // ---------- Claude model ----------
  function zscores(active, get) {
    var xs = active.map(function (h) { return get(h); }).filter(function (x) { return x != null; });
    var m = mean(xs), s = sd(xs);
    var z = {};
    active.forEach(function (h) { var v = get(h); z[h.pgm] = (v == null || !s) ? 0 : (v - m) / s; });
    return z;
  }
  function centered(active, valOf) {
    var vals = active.map(function (h) { return valOf(h); }); var m = mean(vals);
    var c = {}; active.forEach(function (h, i) { c[h.pgm] = vals[i] - m; }); return c;
  }
  function jrPickPoints(race) {
    var pts = {}; var w = [1, 0.75, 0.5, 0.25];
    if (race.jr && race.jr.picks) cleanOrder(race.jr.picks).forEach(function (p, i) { pts[p] = w[i] != null ? w[i] : 0; });
    return pts;
  }

  var NEW_TERMS = ['situation', 'pace', 'bias', 'keyRace', 'conn'];
  function claudeModel(race, F, J, C, W, V, P, ctx) {
    W = W || DEFAULT_WEIGHTS; var fill = {}; ['factors'].concat(NEW_TERMS).forEach(function (k) { if (W[k] == null) fill[k] = 0; }); if (Object.keys(fill).length) W = Object.assign({}, W, fill);
    ctx = ctx || {};
    var active = race.horses.filter(isActive);
    var zS = zscores(active, function (h) { return F[h.pgm].avg3; });
    var types = {}; active.forEach(function (h) { if (F[h.pgm].figType) types[F[h.pgm].figType] = 1; });
    var mixed = Object.keys(types).length > 1; var spW = W.speed * (mixed ? 0.5 : 1);
    var zT = zscores(active, function (h) { return F[h.pgm].trend; });
    var maxG = Math.max.apply(null, active.map(function (h) { return J.counts[h.pgm] || 0; }).concat([1]));
    var cJ = centered(active, function (h) { return (J.counts[h.pgm] || 0) / maxG; });
    var pts = jrPickPoints(race); var hasJr = race.jr && race.jr.picks && race.jr.picks.length;
    var cA = centered(active, function (h) { return hasJr ? (pts[h.pgm] || 0) : 0; });
    var cE = centered(active, function (h) { return C.exTot ? (C.E[h.pgm] - C.q[h.pgm]) : 0; });
    var cG = centered(active, function (h) { var f = F[h.pgm]; return (f.g1Won > 0 || (f.g1Best != null && f.g1Best <= 1)) ? 1 : 0; });
    var maxV = V ? Math.max.apply(null, active.map(function (h) { return V.form[h.pgm] || 0; }).concat([1])) : 1;
    var cV = centered(active, function (h) { return V ? (V.form[h.pgm] || 0) / maxV : 0; });
    var zSit = zscores(active, function (h) { return F[h.pgm].sitDelta; });
    var cP = centered(active, function (h) { return P ? (P.fit[h.pgm] || 0) : 0; });
    var b = ctx.bias || {}; var biasRaw = {};
    active.forEach(function (h) { var e = P && P.pctE[h.pgm] != null ? P.pctE[h.pgm] : 0.5; var ins = P ? P.inside[h.pgm] : 0.5; biasRaw[h.pgm] = (b.speed || 0) * (e - 0.5) * 2 + (b.inside || 0) * (ins - 0.5) * 2; });
    var cB = centered(active, function (h) { return biasRaw[h.pgm]; });
    var cK = centered(active, function (h) { return (ctx.key && ctx.key[h.pgm]) || 0; });
    var cC = centered(active, function (h) { return (ctx.conn && ctx.conn[h.pgm]) || 0; });
    var s = {}, parts = {}, mx = -1e9;
    active.forEach(function (h) {
      var p = h.pgm;
      var c = {
        market: W.market * Math.log(C.q[p]),
        experts: W.experts * cE[p],
        speed: spW * zS[p],
        trend: W.trend * zT[p],
        jrMethod: W.jrMethod * cJ[p],
        jrPicks: W.jrPicks * cA[p],
        g1: W.g1 * cG[p],
        factors: W.factors * cV[p],
        situation: W.situation * zSit[p],
        pace: W.pace * cP[p],
        bias: W.bias * cB[p],
        keyRace: W.keyRace * cK[p],
        conn: W.conn * cC[p]
      };
      parts[p] = c;
      s[p] = c.market + c.experts + c.speed + c.trend + c.jrMethod + c.jrPicks + c.g1 + c.factors + c.situation + c.pace + c.bias + c.keyRace + c.conn;
      if (s[p] > mx) mx = s[p];
    });
    var tot = 0, Pr = {};
    active.forEach(function (h) { Pr[h.pgm] = Math.exp(s[h.pgm] - mx); tot += Pr[h.pgm]; });
    active.forEach(function (h) { Pr[h.pgm] /= tot; });
    var order = active.slice().sort(function (a, b) { return Pr[b.pgm] - Pr[a.pgm]; }).map(function (h) { return h.pgm; });
    return { p: Pr, parts: parts, order: order, weights: W, mixedScale: mixed, biasRaw: biasRaw };
  }

  // ---------- exotics (Harville) ----------
  function harville(P, order, n) {
    n = n || 5; var top = order.slice(0, 7); var ex = [], tri = [];
    top.forEach(function (a) { top.forEach(function (b) { if (a === b) return; ex.push({ c: [a, b], p: P[a] * P[b] / (1 - P[a]) });
      top.forEach(function (c) { if (c === a || c === b) return; tri.push({ c: [a, b, c], p: P[a] * P[b] / (1 - P[a]) * P[c] / (1 - P[a] - P[b]) }); }); }); });
    ex.sort(function (x, y) { return y.p - x.p; }); tri.sort(function (x, y) { return y.p - x.p; });
    return { exacta: ex.slice(0, n), trifecta: tri.slice(0, n) };
  }

  // ---------- displacement (Jr vs consensus) ----------
  function displacement(race, C, picks) {
    if (!picks || !picks.length) return null;
    var rows = []; var sum = 0, n = 0;
    picks.forEach(function (p, i) {
      var cr = C.rank[p];
      if (cr == null) { rows.push({ pgm: p, jr: i + 1, cons: null, d: null, scratched: true }); return; }
      var d = cr - (i + 1); rows.push({ pgm: p, jr: i + 1, cons: cr, d: d }); sum += Math.abs(d); n++;
    });
    var topAgree = C.order[0] === picks[0];
    var consTop = C.order.slice(0, picks.length);
    var overlap = picks.filter(function (p) { return consTop.indexOf(p) >= 0; }).length;
    return { rows: rows, index: n ? sum / n : null, topAgree: topAgree, overlap: overlap, k: picks.length };
  }

  // ---------- grading ----------
  function grade(race, result, C, M, J) {
    if (!result || !result.order || !result.order.length) return null;
    var active = race.horses.filter(isActive); var ord = cleanOrder(result.order);
    var w = ord[0]; if (!active.some(function (h) { return String(h.pgm) === w; })) return null; // winner not an active runner: fix status/order before grading
    function brier(P) { return active.reduce(function (s, h) { var y = h.pgm === w ? 1 : 0; var p = P[h.pgm] || 0; return s + (p - y) * (p - y); }, 0); }
    function ll(P) { var p = P[w]; return p > 0 ? -Math.log(p) : null; }
    var jrPicks = race.jr && race.jr.picks ? race.jr.picks.filter(function (p) { return C.q[p] != null; }) : null;
    return {
      winner: w,
      consensus: { ll: ll(C.q), brier: brier(C.q), top1: C.order[0] === w, rankOfWinner: C.order.indexOf(w) + 1 },
      claude: { ll: ll(M.p), brier: brier(M.p), top1: M.order[0] === w, rankOfWinner: M.order.indexOf(w) + 1 },
      jrMethod: { top1: J.order[0] === w, rankOfWinner: J.order.indexOf(w) + 1 },
      jr: jrPicks ? { top1: jrPicks[0] === w, inPicks: jrPicks.indexOf(w) >= 0, pos: jrPicks.indexOf(w) + 1 } : null
    };
  }


  // ---------- distance and date helpers ----------
  var MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  function ppDate(d) { var m = String(d || '').match(/^(\d{2})([A-Z][a-z]{2})(\d{2})$/); return m ? Date.UTC(2000 + (+m[3]), MON[m[2]], +m[1]) : null; }
  function raceFurlongs(race) {
    var s = String(race.distance || '').toLowerCase().trim(); var m;
    var WORDS = { four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    s = s.replace(/^(four|five|six|seven|eight|nine|ten|eleven|twelve)\b/, function (w) { return String(WORDS[w]); }).replace(/\s*and a half\b/, ' 1/2');
    if ((m = s.match(/^(\d+)\s*1\/2\s*f/))) return +m[1] + 0.5;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*f(?:urlongs?)?\b/))) return +m[1];
    if ((m = s.match(/^(\d+)f/))) return +m[1];
    var mi = 0; if ((m = s.match(/^(\d+)(?:\s+(\d+)\/(\d+))?\s*mi/))) { mi = +m[1] + (m[2] ? m[2] / m[3] : 0); return mi * 8; }
    if ((m = s.match(/^1\s*([⅛¼⅜½⅝¾⅞])\s*mi/))) { return 8 + ({'⅛':1,'¼':2,'⅜':3,'½':4,'⅝':5,'¾':6,'⅞':7})[m[1]]; }
    return null;
  }
  // ---------- 40-factor catalog (all required, no optional) ----------
  // Each factor has a display value (get) and a ranking score (higher = better) that folds in its own tie-breaks,
  // so greens separate horses instead of tying half the field. Missing data = no evidence: ranked last, never green.
  function FX(key, group, label, better, get, desc, fmt, x) { x = x || {}; return { key: key, group: group, label: label, better: better, get: get, desc: desc, fmt: fmt || 'num', market: !!x.market, minPos: !!x.minPos, target: x.target, score: x.score || null, required: true, optional: false }; }
  function nz(x, d) { return x == null || isNaN(x) ? (d == null ? 0 : d) : x; }
  var FACTORS = [
    FX('spdLast','Speed','Last-race speed','high',function(f){return f.last;},'Speed figure from the last race (Equibase; overseas ratings moved onto the US scale).'),
    FX('avg3','Speed','3-race speed average','high',function(f){return f.avg3;},'Average of the last three speed figures (Jr\'s method, per Cory).','1'),
    FX('spdBest','Speed','Best recent speed','high',function(f){return f.best;},'Best figure in the last six races.'),
    FX('trend','Speed','Speed up/down','high',function(f){return f.trend;},'Last-race figure minus the 3-race average. Higher = improving into the race.','s1'),
    FX('sitFig','Speed','Situational figure','high',function(f){return f.sitFig;},'Figures weighted toward the races most like today\'s (surface, distance, going, recency).','1'),
    FX('spdSurf','Speed','Best figure on this surface','high',function(f){return f.spdSurf;},'Best figure on today\'s surface in the last six races.'),
    FX('spdFloor','Speed','Speed floor','high',function(f){return f.spdFloor;},'Lowest of the last three figures: how bad a bad day is.'),
    FX('consist','Speed','Speed consistency','low',function(f){return f.spread;},'Spread (high minus low) of the last three figures. Smaller = more reliable.'),
    FX('paceLast','Pace','Early pace, last race','high',function(f){return f.paceLast;},'Equibase early-pace figure from the last US race. Higher = more early speed.'),
    FX('paceAvg','Pace','Early pace average','high',function(f){return f.paceAvg;},'Average early-pace figure over the last three US races.','1'),
    FX('paceFit','Pace','Pace-shape fit','high',function(f){return f.paceFit;},'Run style against today\'s projected pace: a lone speed horse gains, closers gain in a contested pace.','s2'),
    FX('cls','Class','Highest grade won','high',function(f){return f.cls;},'G1 = 3, G2 = 2, G3 = 1; ties broken by the number of graded wins.','grade',{minPos:1,score:function(f){return f.cls + nz(f.gradedWins)/100;}}),
    FX('g1','Class','G1 proximity','low',function(f){return f.g1Best;},'Lengths beaten in the best Grade/Group 1 run (0 = won one). Jr\'s top row.','len',{score:function(f){return -f.g1Best + nz(f.g1Won)/100;}}),
    FX('g1Wins','Class','G1 wins','high',function(f){return f.g1Won;},'Grade/Group 1 wins; ties broken by G1 top-three finishes.','num',{minPos:1,score:function(f){return f.g1Won + nz(f.g1Top3)/100;}}),
    FX('g1Top3','Class','G1 top-three finishes','high',function(f){return f.g1Top3;},'First, second or third in a Grade/Group 1.','num',{minPos:1,score:function(f){return f.g1Top3 - nz(f.g1Best,99)/1000;}}),
    FX('gradedStarts','Class','Graded starts (last 6)','high',function(f){return f.gradedStarts;},'Grade/Group 1–3 races among the last six starts; ties broken by graded wins.','num',{minPos:1,score:function(f){return f.gradedStarts + nz(f.gradedWins)/100;}}),
    FX('lastGrade','Class','Class of last race','high',function(f){return f.lastGrade;},'Last race level: G1 = 4, G2 = 3, G3 = 2, other stakes = 1, other = 0. Ties broken by finish there.','lvl',{score:function(f){return f.lastGrade - nz(f.lastFin,20)/100;}}),
    FX('formW3','Form','Wins, last 3','high',function(f){return f.formW3;},'Wins in the last three starts; ties broken by top-three finishes, then average finish.','num',{minPos:1,score:function(f){return f.formW3 + f.itm3/10 - nz(f.avgFin3,20)/1000;}}),
    FX('itm3','Form','Top-3 finishes, last 3','high',function(f){return f.itm3;},'First, second or third in the last three starts; ties broken by wins, then average finish.','num',{minPos:1,score:function(f){return f.itm3 + f.formW3/10 - nz(f.avgFin3,20)/1000;}}),
    FX('lastFin','Form','Last finish','low',function(f){return f.lastFin;},'Finishing position last time out; ties broken by the margin.','pos',{score:function(f){return -f.lastFin - nz(f.lastMg)/100 + (f.lastFin === 1 ? nz(f.lastMg)/50 : 0);}}),
    FX('lastMargin','Form','Last margin','low',function(f){return f.lastMargin;},'Lengths behind the winner last time (0 = won; winners ranked by how far they won).','len',{score:function(f){return f.lastWon ? nz(f.lastMg) : -nz(f.lastMg);}}),
    FX('layoff','Form','Days since last race','target',function(f){return f.layoff;},'Freshness: best near six weeks (42 days); further either way ranks lower.','days',{target:42}),
    FX('dominance','Form','Biggest winning margin','high',function(f){return f.dominance;},'Largest winning margin in the last six races (0 = no wins); ties broken by wins.','len',{minPos:1,score:function(f){return f.dominance + nz(f.wins6)/100;}}),
    FX('lifeWin','Record','Lifetime win %','high',function(f){return f.lifeWin;},'Wins ÷ starts, lifetime; ranked on a shrunk rate so 1-for-1 does not beat 7-for-12.','pct',{score:function(f){return f.lifeShr;}}),
    FX('yearWin','Record','2026 win %','high',function(f){return f.yearWin;},'Wins ÷ starts this year, ranked on a shrunk rate.','pct',{score:function(f){return f.yearShr;}}),
    FX('itm6','Record','Top-3 rate, last 6','high',function(f){return f.itm6;},'Share of the last six races finished first, second or third.','pct',{score:function(f){return f.itm6 + nz(f.wins6)/100;}}),
    FX('surfWins','Record','Wins on this surface','high',function(f){return f.surf?f.surf[1]:null;},'Wins on today\'s surface; ties broken by the win rate.','num',{minPos:1,score:function(f){return f.surf[1] + nz(f.surfRate);}}),
    FX('distWins','Record','Wins at this distance','high',function(f){return f.dist?f.dist[1]:null;},'Wins at today\'s distance; ties broken by the win rate.','num',{minPos:1,score:function(f){return f.dist[1] + nz(f.distRate);}}),
    FX('course','Record','Keeneland course record','high',function(f){return f.courseScore;},'Starts at this course on today\'s surface, wins counted double (0 = never run here).','num',{minPos:1}),
    FX('goingFit','Record','Wins on today\'s going','high',function(f){return f.goingFit;},'Wins on today\'s going: dry-track wins on a fast or firm day, wet-track wins when it is off.','num',{minPos:1,score:function(f){return f.goingFit + nz(f.surfRate)/10;}}),
    FX('distChange','Trip','Distance change','nearZero',function(f){return f.distChange;},'Today\'s distance minus last race, in furlongs. Best when it is the same trip; ties broken by how well it ran last time.','s1f',{score:function(f){return -Math.abs(f.distChange) - nz(f.lastFin,20)/100;}}),
    FX('stamina','Trip','Proven at the trip','high',function(f){return f.stamina;},'Longest race run minus today\'s distance (0 or more = has gone this far; credit capped at +2f); ties broken by races run at the trip.','s1f',{score:function(f){return Math.min(f.stamina, 2) + nz(f.racesAtTrip)/100;}}),
    FX('spdDist','Trip','Best figure at this distance range','high',function(f){return f.spdDist;},'Best figure in the last six races at today\'s distance range (sprint, mile or route).'),
    FX('works','Conditioning','Best workout rank','low',function(f){return f.workPct;},'Best recent workout as a share of horses working that day (lower = better).','pct'),
    FX('workCount','Conditioning','Workouts listed','high',function(f){return f.workCount;},'Recent workouts in the past performances; ties broken by the best workout rank.','num',{minPos:1,score:function(f){return f.workCount + (1 - nz(f.workPct,1))/10;}}),
    FX('mlProb','Market','Morning-line chance','high',function(f){return f.mlProb;},'Morning line turned into a win chance, before the track\'s cut is removed.','pct',{market:1}),
    FX('exW','Market','Expert win picks','high',function(f){return f.exW;},'Published handicappers naming this horse to win.','num',{market:1,minPos:1}),
    FX('exV','Market','Expert value picks','high',function(f){return f.exV;},'Named as a value or long-shot play.','num',{market:1,minPos:1}),
    FX('smartGap','Market','Experts vs market','high',function(f){return f.smartGap;},'Share of expert picks minus market share. Positive = experts like it more than the odds do.','pp',{market:1}),
    FX('lastOdds','Market','Last-race odds','low',function(f){return f.lastOdds;},'Odds last time out. Low = the public liked it then.','odds',{market:1})
  ];
  function greenK(n) { return Math.max(1, Math.min(4, Math.round(n / 3))); }
  function scoreOf(c, f, v) {
    if (v == null || (typeof v === 'number' && isNaN(v))) return null;
    var s;
    if (c.score) s = c.score(f, v);
    else if (c.better === 'low') s = -v; else if (c.better === 'nearZero') s = -Math.abs(v); else if (c.better === 'target') s = -Math.abs(v - c.target); else s = +v;
    return (s == null || isNaN(s)) ? null : Math.round(s * 1e6) / 1e6;
  }
  // Filtration: green = the top third of the starters on this factor (at most four). A tie at the cut is
  // included only while it adds at most one extra horse; otherwise only horses strictly above the tie are green.
  // Zero values never turn green on count factors (minPos). A factor with fewer than two distinct values in a
  // race is "not decisive" there and turns nobody green.
  function factorValues(race, F) {
    var entered = race.horses.filter(isEntered); var active = race.horses.filter(isActive); var out = {}; var K = greenK(active.length);
    FACTORS.forEach(function (c) {
      var map = {}; entered.forEach(function (h) { var v = c.get(F[h.pgm]); map[h.pgm] = (v == null || (typeof v === 'number' && isNaN(v))) ? null : v; });
      var xs = active.map(function (h) { return { pgm: h.pgm, v: map[h.pgm], s: scoreOf(c, F[h.pgm], map[h.pgm]) }; }).filter(function (o) { return o.s != null; });
      xs.sort(function (a, b) { return b.s - a.s; });
      var rank = {}; xs.forEach(function (o, i) { var j = i; while (j > 0 && xs[j - 1].s === o.s) j--; rank[o.pgm] = j + 1; });
      var distinct = new Set(xs.map(function (o) { return o.s; })).size;
      var elig = xs.filter(function (o) { return !c.minPos || o.v > 0; });
      var greens = [];
      if (distinct >= 2 && elig.length) {
        var k = Math.min(K, elig.length), cut = elig[k - 1].s;
        var atOrAbove = elig.filter(function (o) { return o.s >= cut; });
        greens = (atOrAbove.length <= k + 1 ? atOrAbove : elig.filter(function (o) { return o.s > cut; })).map(function (o) { return o.pgm; });
        if (greens.length >= xs.length) greens = [];  // a factor that greens every horse with data filters nothing
      }
      out[c.key] = { values: map, greens: greens, rank: rank, n: xs.length, coverage: active.length ? xs.length / active.length : 0, decisive: greens.length > 0, k: K };
    });
    var all = {}, form = {};
    entered.forEach(function (h) { all[h.pgm] = 0; form[h.pgm] = 0; });
    FACTORS.forEach(function (c) { out[c.key].greens.forEach(function (p) { all[p]++; if (!c.market) form[p]++; }); });
    var nForm = FACTORS.filter(function (c) { return !c.market; }).length;
    return { byFactor: out, core: all, all: all, form: form, nForm: nForm, k: K };
  }
  // Filter quality over graded races: how often each factor is decisive, how many horses it greens, its data
  // coverage, and how often the winner was green against what chance would give (lift).
  function factorQuality(list) {
    return FACTORS.map(function (c) {
      var dec = 0, greensN = 0, cov = 0, n = 0, wG = 0, exp = 0, graded = 0;
      list.forEach(function (x) { var bf = x.a.V.byFactor[c.key]; var act = x.a.race.horses.filter(isActive).length; n++; cov += bf.coverage; if (bf.decisive) dec++; greensN += bf.greens.length;
        if (x.winner) { graded++; if (bf.greens.indexOf(x.winner) >= 0) wG++; exp += act ? bf.greens.length / act : 0; } });
      return { key: c.key, label: c.label, group: c.group, races: n, decisive: dec, avgGreens: n ? greensN / n : 0, coverage: n ? cov / n : 0, graded: graded, winnersGreen: wG, expected: exp, lift: exp > 0 ? wG / exp : null };
    });
  }

  // ---------- one call for everything ----------
  function analyze(race, opts) {
    opts = opts || {};
    var ctx = opts.ctx || {};
    var F = features(race, opts.tOffset, ctx);
    var J = jrMethod(race, F);
    var C = consensus(race, F, opts.live);
    race.horses.forEach(function (h) { var f = F[h.pgm]; f.smartGap = (C.q[h.pgm] != null && C.exTot) ? Math.round((C.E[h.pgm] - C.q[h.pgm]) * 1000) / 10 : null; });
    var P = paceMap(race, F, ctx.pace);
    race.horses.forEach(function (h) { var st = P.style[h.pgm]; F[h.pgm].paceFit = (st && st !== 'U' && P.shape !== 'unknown') ? Math.round(P.fit[h.pgm] * 100) / 100 : null; });
    var V = factorValues(race, F);
    var M = claudeModel(race, F, J, C, opts.weights, V, P, ctx);
    var W0 = JSON.parse(JSON.stringify(opts.weights || DEFAULT_WEIGHTS)); W0.jrPicks = 0;
    var M0 = claudeModel(race, F, J, C, W0, V, P, ctx); // the same model with Jr's picks switched off
    var Wb = JSON.parse(JSON.stringify(opts.weights || DEFAULT_WEIGHTS)); NEW_TERMS.forEach(function (k) { Wb[k] = 0; });
    var MB = claudeModel(race, F, J, C, Wb, V, P, ctx); // v1.0 baseline: the same weights with every situation term off
    var X = harville(M.p, M.order, 5);
    var D = displacement(race, C, race.jr && race.jr.picks);
    var DM = displacement(race, C, J.order.slice(0, 4));
    var G = grade(race, opts.result, C, M, J);
    return { F: F, J: J, C: C, V: V, P: P, M: M, M0: M0, MB: MB, X: X, D: D, DM: DM, G: G, ctx: ctx };
  }

  // ---------- bet check (master prompt v2.3, sections 7-8) ----------
  // Live price decides bets: with morning-line odds only, nothing is a bet. EV = p x D - 1 with D = odds-to-1 + 1.
  // Bet only if EV >= +3% and p >= 5%. Stake = quarter Kelly, capped at 2% of bankroll per race, rounded down to the
  // venue's minimum increment; a stake below the minimum is no bet.
  function oddsToOne(s) { var p = mlToProb(s); return p == null ? null : (1 - p) / p; }
  function expertTop(C) { if (!C || !C.exTot) return null; var best = null; Object.keys(C.E).forEach(function (k) { if (best == null || C.E[k] > C.E[best] + 1e-12 || (Math.abs(C.E[k] - C.E[best]) < 1e-12 && C.q[k] > C.q[best])) best = k; }); return best; }
  function betCheck(race, M, C, live, opts) {
    opts = opts || {}; var bank = +opts.bankroll > 0 ? +opts.bankroll : 0, minBet = +opts.minBet > 0 ? +opts.minBet : 2;
    var minEV = isFinite(+opts.minEV) && +opts.minEV >= 0.03 && +opts.minEV <= 1 ? +opts.minEV : 0.03; // never below the master method's +3%
    var active = race.horses.filter(isActive);
    var liveOK = !!live && active.length > 0 && active.every(function (h) { return mlToProb(live[h.pgm]) != null; });
    var fav = C.order[0], rows = [];
    active.forEach(function (h) {
      var os = liveOK ? live[h.pgm] : h.ml; var o = oddsToOne(os); var p = M.p[h.pgm], q = C.q[h.pgm];
      var D = o == null ? null : o + 1; var ev = D == null ? null : p * D - 1;
      var k = (D == null || D <= 1) ? null : (p * D - 1) / (D - 1);
      var minOdds = p > 0 ? (1 + minEV) / p - 1 : null;
      var qualifies = liveOK && ev != null && ev >= minEV - 1e-12 && p >= 0.05;
      var stake = 0;
      if (qualifies && bank > 0 && k > 0) { stake = Math.min(0.25 * k * bank, 0.02 * bank); stake = Math.floor(stake / minBet) * minBet; }
      var verdict = !liveOK ? 'ML' : (qualifies ? (bank > 0 && stake < minBet ? 'PASS' : 'BET') : 'PASS');
      rows.push({ pgm: h.pgm, name: h.name, odds: os, basis: liveOK ? 'LIVE' : 'ML', p: p, q: q, D: D, ev: ev, kelly: k, minOdds: minOdds, stake: stake, verdict: verdict,
        overbetFav: h.pgm === fav && p <= q - 0.04, contender: (p - q) >= 0.02 && p >= 0.05 });
    });
    rows.sort(function (a, b) { return b.p - a.p; });
    return { basis: liveOK ? 'LIVE' : 'ML', minEV: minEV, rows: rows, bets: rows.filter(function (r) { return r.verdict === 'BET'; }), expertTop: expertTop(C), fav: fav };
  }

  // ---------- self-review: tune weights on graded races ----------
  // Minimizes mean log loss of the winner + L2 pull toward the previous weights.
  // Step cap per review keeps changes small; change is adopted only if leave-one-race-out loss improves.
  var TUNABLE = ['market', 'experts', 'speed', 'trend', 'jrMethod', 'jrPicks', 'g1', 'factors', 'situation', 'pace', 'bias', 'keyRace', 'conn'];
  function lossFor(races, results, W, lives, skip, ctxs, tOff) {
    var s = 0, n = 0;
    races.forEach(function (r, i) {
      if (i === skip) return; var res = results[r.id]; if (!res || !res.order || !res.order.length) return;
      var A = analyze(r, { weights: W, live: lives && lives[r.id], ctx: ctxs && ctxs[r.id], tOffset: tOff }); var p = A.M.p[cleanOrder(res.order)[0]];
      if (p > 0) { s += -Math.log(p); n++; }
    });
    return n ? s / n : null;
  }
  function fitWeights(graded, results, W0, lives, lam, cap, ctxs, tOff) {
    function obj(W) { var l = lossFor(graded, results, W, lives, null, ctxs, tOff); var pen = 0; TUNABLE.forEach(function (k) { pen += (W[k] - W0[k]) * (W[k] - W0[k]); }); return l + lam * pen / graded.length; }
    var W = JSON.parse(JSON.stringify(W0)); var step = cap / 4;
    for (var it = 0; it < 4; it++) {
      TUNABLE.forEach(function (k) {
        var best = obj(W), bestV = W[k];
        [-step, step, -2 * step, 2 * step].forEach(function (d) {
          var v = Math.max(W0[k] - cap, Math.min(W0[k] + cap, W[k] + d)); if (k === 'market') v = Math.max(0.5, v); else v = Math.max(0, v);
          var T = JSON.parse(JSON.stringify(W)); T[k] = v; var o = obj(T); if (o < best - 1e-9) { best = o; bestV = v; }
        });
        W[k] = Math.round(bestV * 1000) / 1000;
      });
    }
    return W;
  }
  // Refit with guardrails: small steps (cap), a pull back toward the current weights (lambda),
  // and a split-half check: fit on half the races, score on the other half, both ways.
  // A change is adopted only with >= minRaces graded and when both held-out halves improve.
  function tune(races, results, W0, opts) {
    opts = opts || {}; var lam = opts.lambda != null ? opts.lambda : 2, cap = opts.cap != null ? opts.cap : 0.05, lives = opts.lives, minRaces = opts.minRaces || 6;
    var ctxs = opts.ctxs || crossRace(races, results, { lives: lives, goings: opts.goings, tOffset: opts.tOffset }).ctxs, tOff = opts.tOffset;
    W0 = JSON.parse(JSON.stringify(W0)); TUNABLE.forEach(function (k) { if (W0[k] == null) W0[k] = 0; });
    var graded = races.filter(function (r) { return results[r.id] && results[r.id].order && results[r.id].order.length; });
    if (graded.length < 3) return { ok: false, reason: 'Need at least 3 graded races; have ' + graded.length + '.', graded: graded.length };
    var W = fitWeights(graded, results, W0, lives, lam, cap, ctxs, tOff);
    var before = lossFor(graded, results, W0, lives, null, ctxs, tOff), after = lossFor(graded, results, W, lives, null, ctxs, tOff);
    var A1 = graded.filter(function (_, i) { return i % 2 === 0; }), B1 = graded.filter(function (_, i) { return i % 2 === 1; });
    var wA = fitWeights(A1, results, W0, lives, lam, cap, ctxs, tOff), wB = fitWeights(B1, results, W0, lives, lam, cap, ctxs, tOff);
    var hoB = { base: lossFor(B1, results, W0, lives, null, ctxs, tOff), fit: lossFor(B1, results, wA, lives, null, ctxs, tOff) };
    var hoA = { base: lossFor(A1, results, W0, lives, null, ctxs, tOff), fit: lossFor(A1, results, wB, lives, null, ctxs, tOff) };
    var heldOutOK = hoB.fit < hoB.base && hoA.fit < hoA.base;
    var impr = before ? (before - after) / before : 0;
    var heldImpr = (hoA.base + hoB.base) ? ((hoA.base + hoB.base) - (hoA.fit + hoB.fit)) / (hoA.base + hoB.base) : 0;
    var adopt = after < before && heldOutOK && graded.length >= minRaces;
    var why = adopt ? 'Adopt: in-sample and both held-out halves improve.' : (graded.length < minRaces ? 'Hold: only ' + graded.length + ' graded races (need ' + minRaces + ').' : (!heldOutOK ? 'Hold: the refit did not improve on held-out races, so it is likely noise.' : 'Hold: no in-sample gain.'));
    return { ok: true, graded: graded.length, before: before, after: after, improvementPct: Math.round(impr * 1000) / 10, heldOutPct: Math.round(heldImpr * 1000) / 10, heldOut: { a: hoA, b: hoB }, weights: W, adopt: adopt, why: why };
  }

  var api = { ENGINE_VERSION: ENGINE_VERSION, T_OFFSET: T_OFFSET, FACTORS: FACTORS, factorValues: factorValues, factorQuality: factorQuality, greenK: greenK, betCheck: betCheck, oddsToOne: oddsToOne, expertTop: expertTop, raceFurlongs: raceFurlongs, DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, JR_CATS: JR_CATS, mlToProb: mlToProb, probToOdds: probToOdds, fmtOdds: fmtOdds,
    isActive: isActive, isEntered: isEntered, features: features, jrMethod: jrMethod, consensus: consensus, claudeModel: claudeModel, harville: harville,
    displacement: displacement, grade: grade, analyze: analyze, tune: tune, lossFor: lossFor,
    lineSurface: lineSurface, lineGoing: lineGoing, raceSurface: raceSurface, distBand: distBand, sitProfile: sitProfile, sitTable: sitTable, SIT_DIMS: SIT_DIMS, raceSituation: raceSituation,
    paceMap: paceMap, crossRace: crossRace, keyRaceIndex: keyRaceIndex, normName: normName, cardOf: cardOf, raceKey: raceKey, horseBook: horseBook, attachFromBook: attachFromBook, resultLine: resultLine, ppDate: ppDate, NEW_TERMS: NEW_TERMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RaceEngine = api;
})(typeof window !== 'undefined' ? window : this);
