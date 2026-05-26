#!/usr/bin/env python3
"""Fetch tile images from Bing image search.

Strategy: Bing's image-search HTML embeds full-size image URLs and product-page
URLs in the `m=` attribute of `a.iusc` elements. We hit the HTML page server-side
(no JS needed), extract the JSON, pick the first 1-2 results, download to
docs/images/scraped_full/, resize to docs/images/scraped_thumb/, and patch
tiles.json.

This is the only path I found that returns SKU-specific tile renders: the
factory SKU codes like GA01715E aren't directly searchable on JD/Tmall, but Bing
indexes them because their product pages (img12.360buyimg.com etc) embed the SKU
in alt text.
"""
from __future__ import annotations

import io
import json
import re
import sys
import time
import urllib.parse
from html import unescape
from pathlib import Path

import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TILES_JSON = ROOT / "docs" / "data" / "tiles.json"
FULL_DIR = ROOT / "docs" / "images" / "scraped_full"
THUMB_DIR = ROOT / "docs" / "images" / "scraped_thumb"
PROGRESS = ROOT / "scrape_progress.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.5 Safari/605.1.15")

# Bing CN endpoint (uncensored from the user's POV, returns Chinese pages first)
BING_URL = "https://cn.bing.com/images/search?q={q}&form=HDRSC2&first=1"

THUMB_MAX = 480
FULL_MAX = 1600


def slugify(sku: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", sku).strip("_")
    return s or "unknown"


def fetch(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def bing_search(brand: str, sku: str) -> list[dict]:
    """Return list of candidate {murl, purl, title} from Bing image search."""
    q = urllib.parse.quote(f"{brand} {sku}")
    url = BING_URL.format(q=q)
    try:
        html = fetch(url).decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"  ! bing fetch failed for {sku}: {exc}", file=sys.stderr)
        return []
    # The a.iusc element has m="<escaped JSON>". Extract m attribute payloads.
    candidates = []
    for m in re.finditer(r'class="iusc"[^>]*\bm="([^"]+)"', html):
        raw = unescape(m.group(1))
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        murl = obj.get("murl")
        if not murl:
            continue
        candidates.append({
            "murl": murl,
            "purl": obj.get("purl", ""),
            "title": obj.get("t", ""),
        })
        if len(candidates) >= 3:
            break
    return candidates


def score_candidate(c: dict, brand: str, sku: str) -> int:
    """Heuristic score — higher is better."""
    title = (c.get("title") or "").lower()
    purl = (c.get("purl") or "").lower()
    sku_l = sku.lower()
    score = 0
    if sku_l in title:
        score += 10
    if brand in title:  # brand is Chinese, no case fold needed
        score += 5
    # JD product pages tend to embed clean product renders
    if "jd.com" in purl or "360buyimg.com" in c.get("murl", ""):
        score += 3
    if "oceano" in purl or "oceano" in c.get("murl", ""):
        score += 4
    if "tmall" in purl or "tbcdn" in c.get("murl", "") or "alicdn" in c.get("murl", ""):
        score += 3
    return score


def pick_best(candidates: list[dict], brand: str, sku: str) -> dict | None:
    if not candidates:
        return None
    scored = sorted(candidates, key=lambda c: score_candidate(c, brand, sku), reverse=True)
    return scored[0]


def download_and_resize(murl: str, slug: str) -> dict | None:
    try:
        data = fetch(murl, timeout=30)
    except Exception as exc:
        print(f"  ! image fetch failed: {exc}", file=sys.stderr)
        return None
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGB")
            w, h = im.size
            # Save full
            full = im.copy()
            if max(w, h) > FULL_MAX:
                full.thumbnail((FULL_MAX, FULL_MAX), Image.LANCZOS)
            full_path = FULL_DIR / f"{slug}.jpg"
            full.save(full_path, "JPEG", quality=84, optimize=True, progressive=True)
            # Thumb
            thumb = im.copy()
            thumb.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)
            thumb_path = THUMB_DIR / f"{slug}.webp"
            thumb.save(thumb_path, "WEBP", quality=78, method=6)
        return {
            "thumb": f"images/scraped_thumb/{slug}.webp",
            "full": f"images/scraped_full/{slug}.jpg",
            "orig_w": w,
            "orig_h": h,
        }
    except Exception as exc:
        print(f"  ! image decode/save failed: {exc}", file=sys.stderr)
        return None


def load_progress() -> dict:
    if PROGRESS.exists():
        try:
            return json.loads(PROGRESS.read_text("utf-8"))
        except Exception:
            pass
    return {"done": {}, "failed": []}


def save_progress(p: dict) -> None:
    PROGRESS.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")


def load_tiles() -> dict:
    return json.loads(TILES_JSON.read_text("utf-8"))


def save_tiles_atomic(data: dict) -> None:
    tmp = TILES_JSON.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(TILES_JSON)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--brand", default="欧神诺")
    p.add_argument("--spec", default="750*1500")
    p.add_argument("--limit", type=int, default=999)
    p.add_argument("--sleep", type=float, default=1.5)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    FULL_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)

    data = load_tiles()
    tiles = data["tiles"]
    progress = load_progress()
    done_skus: dict[str, dict] = progress.get("done", {})  # sku -> image meta
    failed = progress.get("failed", [])

    targets = [t for t in tiles if t["brand"] == args.brand and t["spec"] == args.spec]
    # Dedupe by SKU — multiple rows can share the same SKU
    unique = {}
    for t in targets:
        unique.setdefault(t["sku"], []).append(t)

    print(f"Target: {args.brand} {args.spec}  →  {len(targets)} rows, {len(unique)} unique SKUs")

    processed = 0
    for sku, rows in unique.items():
        if processed >= args.limit:
            break
        # Check if we already have a successful download for this SKU
        if sku in done_skus:
            meta = done_skus[sku]
            print(f"  skip (already done): {sku}")
        else:
            print(f"  search: {args.brand} {sku}")
            cands = bing_search(args.brand, sku)
            print(f"    {len(cands)} candidates")
            for i, c in enumerate(cands[:3]):
                print(f"      [{i}] {c['title'][:50]} ← {c['murl'][:80]}")
            best = pick_best(cands, args.brand, sku)
            if not best:
                print(f"  ! no candidates for {sku}")
                failed.append({"sku": sku, "reason": "no candidates"})
                processed += 1
                save_progress({"done": done_skus, "failed": failed})
                time.sleep(args.sleep)
                continue

            slug_base = slugify(sku)
            # Use the first tile id for slug consistency with extract.py
            slug = f"{slug_base}_{rows[0]['id']}"
            if args.dry_run:
                print(f"  DRY: would download {best['murl']} → {slug}")
                processed += 1
                continue

            meta = download_and_resize(best["murl"], slug)
            if not meta:
                failed.append({"sku": sku, "reason": "download failed", "murl": best["murl"]})
                processed += 1
                save_progress({"done": done_skus, "failed": failed})
                time.sleep(args.sleep)
                continue
            meta["source"] = "bing"
            meta["source_purl"] = best.get("purl", "")
            meta["source_title"] = best.get("title", "")
            done_skus[sku] = meta
            save_progress({"done": done_skus, "failed": failed})
            print(f"  ✓ {sku} → {meta['full']}")

        # Patch every row that uses this SKU
        for t in rows:
            t["single"] = {
                "thumb": meta["thumb"],
                "full": meta["full"],
                "orig_w": meta.get("orig_w"),
                "orig_h": meta.get("orig_h"),
                "source": meta.get("source", "bing"),
                "source_url": meta.get("source_purl", ""),
            }
            t["has_images"] = True

        processed += 1
        time.sleep(args.sleep)

    save_tiles_atomic(data)
    print(f"\nDone. {len(done_skus)} successful, {len(failed)} failed.")
    print(f"  tiles.json updated.")


if __name__ == "__main__":
    main()
