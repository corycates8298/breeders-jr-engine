#!/usr/bin/env python3
"""Build index.html (one self-contained file for GitHub Pages) from src/.
src/shell.html holds /*@@file@@*/ markers; markers inside the filled files are filled too."""
import hashlib, json, pathlib, re
root = pathlib.Path(__file__).parent

# ---- record fingerprint: a SHA-256 of every graded race's stored record ----
# [race id, race-day pick, its win chance, model version, official order, $2 win payoff, Jr's picks]
# The page rebuilds the same list from its data and checks it matches record.json.
dump = (root / 'src' / 'data.js').read_text().strip()
db = json.loads(dump[dump.index('=') + 1:].rstrip(';'))
rows = []
for rid in sorted(db['results']):
    res = db['results'][rid]; pre = res.get('pre') or {}; race = db['races'].get(rid) or {}
    if not res.get('order'): continue
    jr = [str(x) for x in ((race.get('jr') or {}).get('picks') or [])]
    rows.append([rid, str(pre.get('top', '')), pre.get('p'), str(pre.get('version', '')), [str(x) for x in res['order']], str(res.get('winPay', '')), jr])
canon = json.dumps(rows, separators=(',', ':'), ensure_ascii=False)
sha = hashlib.sha256(canon.encode('utf-8')).hexdigest()
(root / 'record.json').write_text(json.dumps({
    'what': "Graded record of the Breeders & Jr Engine: per race [id, Claude's race-day pick, its win chance, model version, official finish order, $2 win payoff, Jr's picks].",
    'how_to_check': 'sha256 of the "races" array serialized as compact JSON (no spaces, UTF-8) equals "sha256".',
    'sha256': sha, 'races': rows}, indent=1, ensure_ascii=False) + '\n')
print('record sha256', sha)
pat = re.compile(r'/\*@@([a-z_.]+)@@\*/')
out = (root / 'src' / 'shell.html').read_text().replace('@@RECORD_SHA@@', sha)
for _ in range(5):
    # inlined scripts must never contain '</script' (a name or note holding it would end the tag early)
    def fill(m):
        body = (root / 'src' / m.group(1)).read_text()
        return re.sub(r'</(script)', lambda x: '<\\/' + x.group(1), body, flags=re.I) if m.group(1).endswith('.js') else body
    nxt = pat.sub(fill, out)
    if nxt == out: break
    out = nxt
assert not pat.search(out), 'unfilled marker'
(root / 'index.html').write_text(out)
print('index.html', len(out), 'bytes')
