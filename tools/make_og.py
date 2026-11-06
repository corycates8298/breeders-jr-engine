"""Render og.png (1200x630 share card) from the built index.html's live standings.
Usage: python3 tools/make_og.py [work_dir]   (needs Playwright + Chrome; put fonts.css in work_dir for the brand fonts)"""
import asyncio, pathlib, json, html, sys
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = (ROOT / 'index.html').as_uri()
WORK = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/og-work').resolve(); WORK.mkdir(parents=True, exist_ok=True)
FONTS = (WORK / 'fonts.css').read_text() if (WORK / 'fonts.css').exists() else ''  # optional: @font-face rules pointing at local Barlow Condensed / IBM Plex Sans files
COL = {'c': '#2a9d6c', 'j': '#d08a1a', 'e': '#a585e8', 'm': '#5b8ef0'}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        await pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        await pg.goto(SITE + '#home'); await pg.wait_for_timeout(1500)
        lanes = await pg.eval_on_selector_all('.lane', '''els=>els.map(e=>({cls:[...e.classList].find(c=>c.startsWith("lane-")).slice(5), name:e.querySelector(".who b").innerText, who:e.querySelector(".who span").innerText, rec:e.querySelector(".rec b").innerText.replace(/\\s+/g,""), roi:e.querySelector(".roi b").innerText, w:e.querySelector(".track i").style.width}))''')
        print(json.dumps(lanes))
        rows = ''.join(f'''<div class="ln" style="--c:{COL[l['cls']]}"><span class="n">{html.escape(l['name'])}{'<small>Friday only, unranked: on his 5 races all four went 4-for-5</small>' if 'played' in l['who'] else ''}</span><span class="t"><i style="width:{l['w']}"></i></span><span class="r">{html.escape(l['rec'])}</span><span class="o">{html.escape(l['roi'])}</span></div>''' for l in lanes)
        doc = f'''<!doctype html><html><head><style>{FONTS}
        body{{margin:0;width:1200px;height:630px;overflow:hidden;font-family:"IBM Plex Sans";color:#f3f1e8;
        background:repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 16px,transparent 16px 32px),radial-gradient(110% 130% at 100% 0%,rgba(215,162,72,.32),transparent 55%),linear-gradient(160deg,#1c5a40,#0b2a1e)}}
        .w{{padding:52px 64px}} .eb{{font:600 22px "Barlow Condensed";letter-spacing:.14em;text-transform:uppercase;color:#d9c58f}}
        h1{{font:700 92px/.92 "Barlow Condensed";margin:10px 0 22px}}
        .ln{{display:grid;grid-template-columns:300px 1fr 110px 120px;gap:22px;align-items:center;margin:10px 0;padding:8px 18px;border-left:8px solid var(--c);background:rgba(0,0,0,.22);border-radius:10px}}
        .n{{font:600 34px "Barlow Condensed";white-space:nowrap}} .n small{{display:block;font:500 19px/1.1 "IBM Plex Sans";color:#cfd8cf;white-space:normal}} .cta{{position:absolute;left:64px;bottom:34px;font:700 30px "Barlow Condensed";color:#e6b45c}} .cap{{font:500 19px "IBM Plex Sans";color:#cfd8cf;margin-top:14px}} .t{{height:16px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden}} .t i{{display:block;height:100%;background:var(--c);border-radius:99px}}
        .r{{font:700 38px "Barlow Condensed";text-align:right}} .o{{font:600 30px "Barlow Condensed";text-align:right;color:#cfe8d8}}
        .bar{{position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#2a9d6c 0 25%,#d08a1a 25% 50%,#a585e8 50% 75%,#5b8ef0 75%)}}
        .rg{{position:absolute;right:64px;bottom:40px;font:500 18px "IBM Plex Sans";color:#cfd8cf}} .ft{{position:absolute;right:64px;top:58px;font:600 24px "Barlow Condensed";color:#cfd8cf;letter-spacing:.04em}}
        </style></head><body><div class="w"><div class="eb">Breeders' Cup 2026 · Keeneland · final standings</div><h1>Who called the Breeders' Cup?</h1>{rows}<div class="cap">Winners picked, and return on a flat $2 win bet on each top pick at the $2 win payoffs. Misses included.</div><div class="cta">Can you beat them? Play the card free →</div></div><div class="ft">Called the Card</div><div class="rg">21+ · Not betting advice · 1-800-GAMBLER</div><div class="bar"></div></body></html>'''
        pg2 = await b.new_page(viewport={'width': 1200, 'height': 630})
        f = WORK / 'og.html'; f.write_text(doc)
        await pg2.goto(f.as_uri()); await pg2.wait_for_timeout(1200)
        await pg2.screenshot(path=str(ROOT / 'og.png'))
        await b.close()
asyncio.run(main())
