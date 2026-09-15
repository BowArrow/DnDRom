"""Measure the reproduced horizon moire and write a visual comparison."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/research-tools311'))
from PIL import Image, ImageChops, ImageStat, ImageFilter

folder = ROOT / 'artifacts/reveal-038'
results = {}
for name in ('horizon-16km', 'horizon-65km'):
    scores = {}
    for version in ('before', 'after'):
        picture = Image.open(folder / version / (name + '.png')).convert('RGB')
        roi = picture.crop((0, 430, 1280, 550))
        scores[version] = sum(ImageStat.Stat(ImageChops.difference(roi, roi.filter(ImageFilter.GaussianBlur(2)))).mean) / 3
    assert scores['after'] < .8 and scores['after'] < scores['before'] * .3, (name, scores)
    results[name] = scores
(folder / 'horizon-checks.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
rows = ''.join(f'<h2>{label}</h2><div><figure><img src="before/{name}.png"><figcaption>0.3.7</figcaption></figure><figure><img src="after/{name}.png"><figcaption>0.3.8</figcaption></figure></div>' for name, label in [('horizon-16km', 'Loading front at 16 km'), ('horizon-65km', 'Loading front at 65 km')])
page = '<!doctype html><meta charset="utf-8"><title>DnDRom distant reveal comparison</title><style>body{background:#17222b;color:#e0e9ec;font:16px system-ui;max-width:1600px;margin:32px auto;padding:20px}div{display:flex;gap:16px}figure{margin:0;flex:1;min-width:0}img{width:100%}figcaption{padding:8px}</style><h1>Distant loading fog — 0.3.8</h1><p>Same packaged beach fixture and camera, with the loading front deliberately held at two distances. The empty background beyond the small test beach is intentional. The loading effect is active in both columns; completion disables it.</p>' + rows
(folder / 'comparison.html').write_text(page, encoding='utf-8')
print(json.dumps(results, indent=2))
