# Called the Card (Breeders & Jr Engine)

**Live site:** https://corycates8298.github.io/breeders-jr-engine/

**Called the Card** runs on the Breeders & Jr Engine. Who called the 2026 Breeders' Cup? Four handicappers picked the card at Keeneland (Oct 30–31, 2026):
- **Claude:** a model that starts from the market and adjusts with expert picks, Jr's picks, speed figures, Grade 1 form, pace and track bias. The race-day version (v1.1) used 30 form factors; engine 2.x scores 40. On this card its race-day pick was the morning-line favorite in 12 of 14 races and the experts' top pick in the other two.
- **Jr:** a human handicapper's handwritten sheet (Friday's five races), shown with his written permission. On his five races all four sources went 4-for-5, so the standings don't rank him against full-card sources.
- **The experts:** named, published picks from about 30 outlets, linked to the outlet's page where one is on file.
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
- Reproducible check: the v1.1 weights (saved Oct 30, 4:30 a.m. ET, before the first race), fed only the results known before each race, reproduce all 14 race-day picks with `src/engine.js`; win chances agree within about a point (the current engine is 2.1).
- On race day, finishes came from published results (Sporting Life, DRF and others) and the $2 payoffs mostly from one results page (US Racing). On Nov 6, 2026 every winner, finish order and payoff was re-checked against independent pages (America's Best Racing chart data, NBC Sports' results tracker); all matched. `src/verify.js` holds those links and each race page shows them.
- Fourteen races can't prove an edge for any source. The site shows the exact 95% range for every hit rate.
- `record.json` holds the graded record and its SHA-256 fingerprint; the page recomputes the fingerprint from its own data and shows whether it matches. Change a pick, finish or payoff and the fingerprint changes.

## Building
The page is one self-contained `index.html` built from `src/`:
- `src/shell.html` (page shell and markers), `src/style.css`, `src/engine.js` (the pure-function model), `src/app.js` and `src/plus.js` (views), `src/data.js` (the read-only database snapshot), `src/verify.js` (the Nov 6 re-check links), `src/shim.js` (in-memory stand-in for the live engine's database).
- Run `python3 build.py` to rebuild `index.html` and `record.json`. `og.png` is the social share image.

## This copy is read-only
- **Data:** every result through the Classic, as of Nov 1, 2026.
- **Your changes stay in your browser only:** what-ifs, play-along picks, the Bet check settings and your bankroll aren't saved for anyone else.
- **Race-day updates** (scratches, live odds, results) are made on the live engine. This copy is refreshed from it.
- **Not indexed:** the site asks search engines not to index it.

## Disclaimer
Decision support, not betting or financial advice. Every win chance is an estimate, and even a correctly priced 40% horse loses 6 times in 10. 21+. Bet only where it is legal for you. Gambling problem? Call or text 1-800-GAMBLER (1-800-426-2537) or 1-800-MY-RESET (1-800-697-3738), 24/7.
