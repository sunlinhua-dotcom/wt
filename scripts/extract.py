#!/usr/bin/env python3
"""Extract tile data + embedded images from the xlsx into JSON + compressed images."""
from __future__ import annotations

import io
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "诺贝尔-瓷砖高清素材图+实铺效果图.xlsx"
SITE = ROOT / "docs"
THUMB_DIR = SITE / "images" / "thumb"
FULL_DIR = SITE / "images" / "full"
DATA_OUT = SITE / "data" / "tiles.json"

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}

THUMB_MAX = 480
FULL_MAX = 1600
THUMB_QUALITY = 78
FULL_QUALITY = 82


def slugify(sku: str) -> str:
    """Make a SKU safe for filesystem — keep ASCII alnum, drop everything else."""
    s = re.sub(r"[^A-Za-z0-9]+", "_", sku).strip("_")
    return s or "unknown"


def text(el: ET.Element | None) -> str:
    return "" if el is None else (el.text or "")


def parse_shared_strings(z: zipfile.ZipFile) -> list[str]:
    with z.open("xl/sharedStrings.xml") as f:
        tree = ET.parse(f)
    out = []
    for si in tree.getroot().findall("main:si", NS):
        # Concatenate all <t> nodes (could be split by formatting runs)
        parts = [t.text or "" for t in si.iter(f"{{{NS['main']}}}t")]
        out.append("".join(parts))
    return out


def parse_sheet_rows(
    z: zipfile.ZipFile, path: str, strings: list[str]
) -> list[tuple[int, list[str]]]:
    """Return [(sheet_row_1indexed, cells)] so callers can map drawing anchors,
    which use the true 0-indexed sheet row, back to the right row even if Excel
    omits empty rows from sheetData."""
    with z.open(path) as f:
        tree = ET.parse(f)
    out: list[tuple[int, list[str]]] = []
    sheet_data = tree.getroot().find("main:sheetData", NS)
    if sheet_data is None:
        return out
    fallback_row = 0
    for row_el in sheet_data.findall("main:row", NS):
        fallback_row += 1
        try:
            sheet_row = int(row_el.get("r") or fallback_row)
        except ValueError:
            sheet_row = fallback_row
        cells = ["" for _ in range(6)]
        next_col = 0
        for c in row_el.findall("main:c", NS):
            ref = c.get("r", "")
            m = re.match(r"([A-Z]+)", ref) if ref else None
            if m:
                col_letter = m.group(1)
                col_idx = 0
                for ch in col_letter:
                    col_idx = col_idx * 26 + (ord(ch) - ord("A") + 1)
                col_idx -= 1
            else:
                col_idx = next_col
            next_col = col_idx + 1
            if col_idx < 0 or col_idx >= 6:
                continue
            ctype = c.get("t", "")
            v = c.find("main:v", NS)
            inline = c.find("main:is", NS)
            if ctype == "s" and v is not None and v.text is not None:
                try:
                    idx = int(v.text)
                except ValueError:
                    idx = -1
                cells[col_idx] = strings[idx] if 0 <= idx < len(strings) else ""
            elif ctype == "inlineStr" and inline is not None:
                cells[col_idx] = "".join(
                    t.text or "" for t in inline.iter(f"{{{NS['main']}}}t")
                )
            elif v is not None:
                cells[col_idx] = v.text or ""
        out.append((sheet_row, cells))
    return out


def parse_drawing_anchors(z: zipfile.ZipFile, drawing_path: str, rels_path: str) -> list[dict]:
    """Return list of {row, col, image_path} for each picture anchor in the drawing."""
    # Read rels: rId -> image path
    with z.open(rels_path) as f:
        rels_tree = ET.parse(f)
    rid_to_target: dict[str, str] = {}
    for rel in rels_tree.getroot().findall("pr:Relationship", NS):
        rid = rel.get("Id")
        target = rel.get("Target", "")
        # Targets are relative to the drawing file's directory: xl/drawings/
        # Normalize: drop leading ../ etc.
        norm = target
        if norm.startswith("../"):
            norm = "xl/" + norm[len("../"):]
        elif not norm.startswith("xl/"):
            norm = "xl/drawings/" + norm
        rid_to_target[rid] = norm

    with z.open(drawing_path) as f:
        tree = ET.parse(f)
    out: list[dict] = []
    root = tree.getroot()

    def parse_anchor(anchor: ET.Element) -> None:
        frm = anchor.find("xdr:from", NS)
        if frm is None:
            return
        col_el = frm.find("xdr:col", NS)
        row_el = frm.find("xdr:row", NS)
        if col_el is None or row_el is None:
            return
        col = int(col_el.text)
        row = int(row_el.text)
        pic = anchor.find("xdr:pic", NS)
        if pic is None:
            return
        blip_fill = pic.find("xdr:blipFill", NS)
        if blip_fill is None:
            return
        blip = blip_fill.find("a:blip", NS)
        if blip is None:
            return
        embed = blip.get(f"{{{NS['r']}}}embed")
        if not embed or embed not in rid_to_target:
            return
        out.append({"row": row, "col": col, "image": rid_to_target[embed]})

    for tag in ("twoCellAnchor", "oneCellAnchor", "absoluteAnchor"):
        for anchor in root.iter(f"{{{NS['xdr']}}}{tag}"):
            parse_anchor(anchor)
    return out


def process_image(src_bytes: bytes, sku_slug: str, kind: str) -> dict:
    """Save thumb + full versions, return metadata dict."""
    with Image.open(io.BytesIO(src_bytes)) as im:
        im = im.convert("RGB")
        w, h = im.size

        # Thumb
        thumb = im.copy()
        thumb.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)
        thumb_name = f"{sku_slug}_{kind}.webp"
        thumb_path = THUMB_DIR / thumb_name
        thumb.save(thumb_path, "WEBP", quality=THUMB_QUALITY, method=6)

        # Full
        full = im.copy()
        if max(w, h) > FULL_MAX:
            full.thumbnail((FULL_MAX, FULL_MAX), Image.LANCZOS)
        full_name = f"{sku_slug}_{kind}.jpg"
        full_path = FULL_DIR / full_name
        full.save(full_path, "JPEG", quality=FULL_QUALITY, optimize=True, progressive=True)

    return {
        "thumb": f"images/thumb/{thumb_name}",
        "full": f"images/full/{full_name}",
        "orig_w": w,
        "orig_h": h,
    }


def parse_workbook_sheets(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    """Return list of (sheet_name, sheet_path) in order matching the workbook."""
    with z.open("xl/workbook.xml") as f:
        wb_tree = ET.parse(f)
    with z.open("xl/_rels/workbook.xml.rels") as f:
        rels_tree = ET.parse(f)
    rid_to_target = {
        r.get("Id"): r.get("Target")
        for r in rels_tree.getroot().findall("pr:Relationship", NS)
    }
    out = []
    for s in wb_tree.getroot().find("main:sheets", NS).findall("main:sheet", NS):
        name = s.get("name")
        rid = s.get(f"{{{NS['r']}}}id")
        target = rid_to_target.get(rid, "")
        if target and not target.startswith("xl/"):
            target = "xl/" + target
        out.append((name, target))
    return out


def find_sheet_drawing(z: zipfile.ZipFile, sheet_path: str) -> str | None:
    """If this sheet references a drawing, return the drawing path."""
    # Sheet rels live at xl/worksheets/_rels/<sheetN>.xml.rels
    sheet_file = sheet_path.split("/")[-1]
    rels_path = f"xl/worksheets/_rels/{sheet_file}.rels"
    try:
        with z.open(rels_path) as f:
            tree = ET.parse(f)
    except KeyError:
        return None
    for rel in tree.getroot().findall("pr:Relationship", NS):
        if "drawing" in rel.get("Type", ""):
            target = rel.get("Target", "")
            if target.startswith("../"):
                target = "xl/" + target[len("../"):]
            return target
    return None


def drawing_rels_path(drawing_path: str) -> str:
    name = drawing_path.split("/")[-1]
    return f"xl/drawings/_rels/{name}.rels"


def main() -> int:
    if not XLSX.exists():
        print(f"ERR: xlsx not found at {XLSX}", file=sys.stderr)
        return 1

    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    FULL_DIR.mkdir(parents=True, exist_ok=True)
    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)

    print(f"Reading {XLSX.name} ({XLSX.stat().st_size/1e6:.0f} MB)...")
    with zipfile.ZipFile(XLSX, "r") as z:
        strings = parse_shared_strings(z)
        print(f"  shared strings: {len(strings)}")
        sheets = parse_workbook_sheets(z)
        print(f"  sheets: {[s[0] for s in sheets]}")

        # Pull image anchors for sheets that have drawings
        anchor_map_per_sheet: dict[str, dict[tuple[int, int], str]] = {}
        for sheet_name, sheet_path in sheets:
            drawing = find_sheet_drawing(z, sheet_path)
            if not drawing:
                anchor_map_per_sheet[sheet_name] = {}
                continue
            anchors = parse_drawing_anchors(z, drawing, drawing_rels_path(drawing))
            print(f"  {sheet_name}: {len(anchors)} image anchors via {drawing}")
            anchor_map: dict[tuple[int, int], str] = {}
            for a in anchors:
                anchor_map[(a["row"], a["col"])] = a["image"]
            anchor_map_per_sheet[sheet_name] = anchor_map

        tiles: list[dict] = []
        next_id = 1

        for sheet_name, sheet_path in sheets:
            rows = parse_sheet_rows(z, sheet_path, strings)
            anchor_map = anchor_map_per_sheet[sheet_name]
            for sheet_row, row in rows:
                if sheet_row == 1:
                    continue  # header row in 1-indexed sheet coords
                category, brand, sku, spec, _e, _f = row
                if not any(x.strip() for x in (category, brand, sku, spec)):
                    continue
                tile_id = next_id
                next_id += 1
                sku_clean = sku.strip()
                slug = f"{slugify(sku_clean)}_{tile_id}"

                # Drawing anchors use 0-indexed sheet rows; sheet_row is 1-indexed.
                drawing_row = sheet_row - 1
                single_img_path = anchor_map.get((drawing_row, 4))  # col E
                room_img_path = anchor_map.get((drawing_row, 5))    # col F

                tile_entry: dict = {
                    "id": tile_id,
                    "brand": brand.strip(),
                    "sku": sku_clean,
                    "spec": spec.strip(),
                    "category": category.strip(),
                    "category_short": category.split("->")[-1].strip() if "->" in category else category.strip(),
                    "has_images": False,
                }

                def grab(src_path: str | None, kind: str) -> dict | None:
                    if not src_path:
                        return None
                    try:
                        with z.open(src_path) as imf:
                            data = imf.read()
                    except KeyError:
                        return None
                    try:
                        return process_image(data, slug, kind)
                    except (OSError, Image.UnidentifiedImageError) as exc:
                        print(f"  ! skip {src_path} for {sku_clean}: {exc}", file=sys.stderr)
                        return None

                single_meta = grab(single_img_path, "single")
                room_meta = grab(room_img_path, "room")
                if single_meta:
                    tile_entry["single"] = single_meta
                    tile_entry["has_images"] = True
                if room_meta:
                    tile_entry["room"] = room_meta
                    tile_entry["has_images"] = True

                tiles.append(tile_entry)

        out = {
            "generated_at_xlsx": XLSX.name,
            "brand_counts": {},
            "tiles": tiles,
        }
        for t in tiles:
            b = t["brand"] or "(未知)"
            out["brand_counts"][b] = out["brand_counts"].get(b, 0) + 1

        DATA_OUT.write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        n_with_img = sum(1 for t in tiles if t["has_images"])
        print(f"\nDone. {len(tiles)} tiles, {n_with_img} with images.")
        print(f"  data → {DATA_OUT.relative_to(ROOT)}")
        print(f"  brands: {out['brand_counts']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
