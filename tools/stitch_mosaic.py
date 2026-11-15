#!/usr/bin/env python3
"""Stitch the photo tiles of a walk patch into one image.

    python3 tools/stitch_mosaic.py jezero jezero_delta
    python3 tools/stitch_mosaic.py --level 16 --max-size 4096 jezero

Reads  data/walk/<site>/walk.json and data/walk/<site>/tiles/<level>/<x>/<y>.jpg
Writes data/walk/<site>/mosaic_<level>.jpg

The output covers exactly the walk.json rectangle (west, south, east, north),
with row 0 at the north edge and column 0 at the west edge, so it lines up
with dem.bin and can be draped with texture coordinates running 0..1 across
the patch.

Tiles are 256 px squares in DEGREES (not metres):
    x = floor((lon + 180) / (180 / 2**level))
    y = floor((90 - lat)  / (180 / 2**level))
so tile pixel coordinates are linear in longitude and latitude. The patch
rectangle is therefore an axis-aligned (sub-pixel) window in the tile mosaic,
and it is resampled once, by longitude/latitude, to the output size.

Needs numpy and Pillow. Fails (non-zero exit) if any tile is missing.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

TILE_PX = 256
REPO = Path(__file__).resolve().parent.parent


def stitch(site: str, level: int, max_size: int, quality: int, walk_root: Path) -> dict:
    folder = walk_root / site
    meta = json.loads((folder / "walk.json").read_text())
    west, south, east, north = (meta[k] for k in ("west", "south", "east", "north"))

    tile_deg = 180.0 / 2**level
    # The patch rectangle in continuous tile units (x grows east, y grows south).
    fx0, fx1 = (west + 180.0) / tile_deg, (east + 180.0) / tile_deg
    fy0, fy1 = (90.0 - north) / tile_deg, (90.0 - south) / tile_deg
    tx0, tx1 = math.floor(fx0), math.floor(fx1)
    ty0, ty1 = math.floor(fy0), math.floor(fy1)

    canvas = np.zeros(((ty1 - ty0 + 1) * TILE_PX, (tx1 - tx0 + 1) * TILE_PX), dtype=np.uint8)
    missing = []
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            path = folder / "tiles" / str(level) / str(tx) / f"{ty}.jpg"
            if not path.exists():
                missing.append(str(path.relative_to(walk_root)))
                continue
            tile = Image.open(path).convert("L")
            if tile.size != (TILE_PX, TILE_PX):
                raise SystemExit(f"{path}: tile is {tile.size}, expected {TILE_PX} px square")
            r, c = (ty - ty0) * TILE_PX, (tx - tx0) * TILE_PX
            canvas[r : r + TILE_PX, c : c + TILE_PX] = np.asarray(tile)
    if missing:
        raise SystemExit(
            f"{site}: {len(missing)} level-{level} tile(s) missing, not writing a mosaic "
            f"with made-up pixels. First: {missing[0]}"
        )

    # Window of the patch rectangle in canvas pixels (sub-pixel accurate).
    box = (
        (fx0 - tx0) * TILE_PX,
        (fy0 - ty0) * TILE_PX,
        (fx1 - tx0) * TILE_PX,
        (fy1 - ty0) * TILE_PX,
    )
    native_w, native_h = box[2] - box[0], box[3] - box[1]
    scale = min(1.0, max_size / native_w, max_size / native_h)
    out_w = min(max_size, max(1, round(native_w * scale)))
    out_h = min(max_size, max(1, round(native_h * scale)))

    source = Image.fromarray(canvas)
    if scale < 1.0:
        # Shrinking: area-average so fine detail does not alias.
        out = source.resize((out_w, out_h), Image.LANCZOS, box=box)
    else:
        out = source.transform((out_w, out_h), Image.EXTENT, box, Image.BICUBIC)

    out_path = folder / f"mosaic_{level}.jpg"
    out.save(out_path, quality=quality, optimize=True)

    pixels = np.asarray(out)
    return {
        "site": site,
        "level": level,
        "tiles": (tx1 - tx0 + 1) * (ty1 - ty0 + 1),
        "tile_x": [tx0, tx1],
        "tile_y": [ty0, ty1],
        "native_px": [round(native_w, 2), round(native_h, 2)],
        "size": [out_w, out_h],
        "metres_per_px": [
            round(meta["width"] * meta["spacingM"] / out_w, 4),
            round(meta["height"] * meta["spacingM"] / out_h, 4),
        ],
        "mean_grey": round(float(pixels.mean()), 2),
        "black_share": round(float((pixels == 0).mean()), 6),
        "bytes": out_path.stat().st_size,
        "path": str(out_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("sites", nargs="+", help="walk patch folder names, e.g. jezero jezero_delta")
    parser.add_argument("--level", type=int, default=16)
    parser.add_argument("--max-size", type=int, default=4096, help="largest allowed width/height in px")
    parser.add_argument("--quality", type=int, default=88, help="JPEG quality")
    parser.add_argument("--walk-root", type=Path, default=REPO / "data" / "walk")
    args = parser.parse_args()
    for site in args.sites:
        print(json.dumps(stitch(site, args.level, args.max_size, args.quality, args.walk_root)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
