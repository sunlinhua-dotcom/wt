# 瓷砖速查 (willtile)

A mobile-first lookup for the 850 tile SKUs in my JD direct-install spec sheet (诺贝尔 + 4 other brands). Built to use on-site at the showroom — search by SKU, browse renders, snap a photo to OCR the model number, and mark what's picked.

## What it does

- 850 SKUs across 金意陶 / 马可波罗 / 蒙娜丽莎 / 诺贝尔 / 欧神诺
- 247 high-res images (诺贝尔 only — the source xlsx had embedded images for that brand only)
- Mobile-first, installable to Home Screen (PWA manifest, but no offline SW yet — needs network)
- Camera capture → Mimo `mimo-v2-omni` OCR → fuzzy-match against the local SKU index
- "Add to my picks" toggle, deep links to 淘宝/京东 search per SKU

## Layout

```
docs/                 deployed as-is to GitHub Pages
├─ index.html
├─ style.css
├─ app.js
├─ manifest.webmanifest
├─ icon.png
├─ data/tiles.json    extracted from the xlsx (~250 KB)
└─ images/
   ├─ thumb/  *.webp  (~8 KB each, list view)
   └─ full/   *.jpg   (~130 KB each, detail view)
scripts/
└─ extract.py         one-shot: xlsx → tiles.json + thumbs + fulls
```

The 1.7 GB source `.xlsx` is **not committed** (gitignored). To regenerate the data:

```
python3 -m pip install openpyxl pillow
python3 scripts/extract.py
```

## Mimo API key

The app calls Mimo's OpenAI-compatible endpoint **directly from the browser**. The key is stored only in `localStorage` on your device and never enters the repo. First launch: open ⚙ Settings, paste:

- Base URL: `https://token-plan-cn.xiaomimimo.com/v1`
- Model: `mimo-v2-omni` (the one Mimo model in this plan that supports vision; pro hallucinates, 2.5/2.5-pro reject image input)
- Key: your `tp-...` key

Shortcut: open `https://<host>/wt/#key=tp-yourkey` once and the app stores the key + scrubs the hash from the URL. Hash bootstrap only sets `key` — not base/model — to prevent a crafted link from redirecting the next OCR call to a third party.

## Local dev

```
python3 -m http.server 8000 -d docs
# open http://localhost:8000
```
