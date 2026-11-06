# Breeders & Jr Engine

**Live site:** https://corycates8298.github.io/breeders-jr-engine/

Who called the 2026 Breeders' Cup? Four handicappers picked the card at Keeneland (Oct 30–31, 2026):
- **Claude:** a model that starts from the market and adjusts with 40 required factors per horse, speed figures, Grade 1 form, pace, track bias, expert picks and Jr's picks.
- **Jr:** a human handicapper's handwritten sheet (Friday card), shown with his written permission.
- **The experts:** named, published win picks, each linked to its source.
- **The market:** the morning-line favorite, or the live-odds favorite once every starter has odds.

The site keeps an honest score for all four and lets visitors try to beat them.

## What's on the site
- **Home:** final standings, the facts the card produced, a race-by-race grid, and what the record can and can't prove.
- **Play the card:** a blind replay. Pick a horse in each race before the reveal and see how you stack up. Picks stay in the browser.
- **The card:** every race with its post time (ET and the viewer's time zone), Claude's race-day pick, the market favorite, the experts, Jr and the result.
- **Race pages:** overview, situation and pace, horse by horse, the 40-factor matrix, Jr vs consensus, exactas and trifectas, and the **Bet check** (expected value at live odds, a chosen safety margin, the minimum odds worth betting, quarter-Kelly stakes with caps). PASS is the usual answer.
- **Scorecard:** the honest record (race-day picks only), exact 95% ranges for every hit rate, the refit history and scores.
- **How it works:** plain-English method, how the record is kept, known data gaps, a glossary, responsible play and credits.
- **Lab:** forecast, horses, factors, Jr's method, situations, connections, model, data and sources.

## How the record is kept
- Claude's record uses only the race-day engine's picks (v1.1). The model was refit afterwards (v2.0) on these same races; anything computed with v2.0 on finished races is labeled "in hindsight" and never enters the record.
- For this card the race-day picks were written into the record on Oct 31 from the race-day engine, not timestamped by an outside service before each post. Only each top pick and its win chance were saved.
- Results and $2 win payoffs come from official charts or reputable results reports, with source links kept in each result.
- Fourteen races can't prove an edge for any source. The site shows the exact 95% range for every hit rate.
- `record.json` holds the graded record and its SHA-256 fingerprint; the page recomputes the fingerprint from its own data and shows whether it matches. Change a pick, finish or payoff and the fingerprint changes.

## Building
The page is one self-contained `index.html` built from `src/`:
- `src/shell.html` (page shell and markers), `src/style.css`, `src/engine.js` (the pure-function model), `src/app.js` and `src/plus.js` (views), `src/data.js` (the read-only database snapshot), `src/shim.js` (in-memory stand-in for the live engine's database).
- Run `python3 build.py` to rebuild `index.html` and `record.json`. `og.png` is the social share image.

## This copy is read-only
- **Data:** every result through the Classic, as of Nov 1, 2026.
- **Your changes stay in your browser only:** what-ifs, play-along picks, the Bet check settings and your bankroll aren't saved for anyone else.
- **Race-day updates** (scratches, live odds, results) are made on the live engine. This copy is refreshed from it.
- **Not indexed:** the site asks search engines not to index it.

## Disclaimer
Decision support, not betting or financial advice. Every win chance is an estimate, and even a correctly priced 40% horse loses 6 times in 10. 21+. Bet only where it is legal for you. Gambling problem? Call or text 1-800-GAMBLER (1-800-426-2537) or 1-800-MY-RESET (1-800-697-3738), 24/7.
