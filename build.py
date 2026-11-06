#!/usr/bin/env python3
"""Build index.html (one self-contained file for GitHub Pages) from src/.
src/shell.html holds /*@@file@@*/ markers; markers inside the filled files are filled too."""
import pathlib, re
root = pathlib.Path(__file__).parent
pat = re.compile(r'/\*@@([a-z_.]+)@@\*/')
out = (root / 'src' / 'shell.html').read_text()
for _ in range(5):
    nxt = pat.sub(lambda m: (root / 'src' / m.group(1)).read_text(), out)
    if nxt == out: break
    out = nxt
assert not pat.search(out), 'unfilled marker'
(root / 'index.html').write_text(out)
print('index.html', len(out), 'bytes')
