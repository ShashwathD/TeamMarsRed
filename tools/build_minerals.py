#!/usr/bin/env python3
"""Build data/walk/jezero_delta/minerals.json from the CRISM dominant-mineralogy map.

Run from the repo root:
    uv run --python 3.12 --with numpy --with pillow tools/build_minerals.py

Source (brief fact M1): Parente, Saranathan and Itoh 2021, "Map of the dominant
mineralogy over and around the Mars2020 landing ellipse with correspondent spectral
signatures", Zenodo doi:10.5281/zenodo.5575824, CC BY 4.0, file jezeroFinal.tif.
Made from MRO CRISM data (NASA/JPL-Caltech/JHUAPL).

What it does:
  1. downloads jezeroFinal.tif once into a cache folder OUTSIDE the repo;
  2. reads the georeferencing from the GeoTIFF tags and checks it against M2
     (614 x 751 px, 36 m, equirectangular, R = 3,396,190 m, centre 0 / 0);
  3. snaps every pixel to the nearest key colour (M3; black = unclassified);
  4. keeps the pixels whose CENTRES fall inside the walk patch bounds;
  5. counts classes and groups, finds connected deposits, reads the class under
     each station, and writes minerals.json (Interface 1).

Nothing here is a hazard value: the map says which minerals are probably at the
surface and says nothing about danger. No number is typed by hand; every output
value is computed from the GeoTIFF, walk.json, dem.bin and the mission file.
"""

import argparse
import datetime
import hashlib
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SITE = "jezero_delta"
URL = "https://zenodo.org/api/records/5575824/files/jezeroFinal.tif/content"
DEFAULT_CACHE = Path(
    "/private/tmp/claude-501/-Users-tript/cb48754f-3c60-4060-9e17-22f6f9d79f2e/scratchpad/minerals/w1/raw"
)

# ---- brief facts M1, M2, M4, M5 (text only; no numbers beyond the brief's) ----
SOURCE = (
    "Parente, Saranathan and Itoh 2021, \"Map of the dominant mineralogy over and around the "
    "Mars2020 landing ellipse with correspondent spectral signatures\", Zenodo"
)
DOI = "10.5281/zenodo.5575824"
LICENCE = "CC BY 4.0"
MADE_FROM = "MRO CRISM data (NASA/JPL-Caltech/JHUAPL)"
CAVEAT = (
    "Class names are closest matches to known spectra; exact mineral attributions can only be "
    "verified after further analysis."
)
SURFACE_NOTE = "CRISM sees only the top few micrometres of the surface; dust hides what is under it."
EXPECT_SIZE = (614, 751)
EXPECT_PIXEL_M = 36.0
MARS_RADIUS_M = 3396190.0  # same as src/data.js

# ---- brief fact M3: key colours, high / medium confidence ----
KEY = [
    ("olivine", "Olivine", (255, 0, 0), (153, 0, 0), "volcanic"),
    ("mg_carbonate", "Mg-carbonate", (0, 255, 0), (0, 153, 0), "carbonate"),
    ("fe_mg_smectite", "Fe/Mg-smectite", (0, 255, 255), (0, 153, 153), "clay"),
    ("olivine_smectite", "Olivine + smectite", (255, 128, 114), (153, 77, 68), "olivine_clay"),
    ("olivine_smectite_2p2um", "Olivine/smectite + 2.2 um", (128, 128, 0), (77, 77, 0), "olivine_clay"),
    ("carbonate_2p2um", "Carbonate + 2.2 um", (255, 215, 0), (153, 129, 0), "carbonate"),
    ("high_ca_pyroxene", "High-Ca pyroxene", (255, 128, 0), (153, 77, 0), "volcanic"),
    ("low_ca_pyroxene", "Low-Ca pyroxene", (218, 165, 32), (130, 99, 19), "volcanic"),
    ("kaolinite", "Kaolinite", (139, 69, 19), (83, 41, 11), "clay"),
    ("mg_smectite_2", "Mg-smectite 2", (0, 0, 255), (0, 0, 153), "clay"),
]
UNCLASSIFIED = "Unclassified"

# ---- display colours for the five groups (a design choice, not data) ----
# Flat, and checked below against the colours already in use: slope amber and red
# (src/materials.js), route blue and rover-path orange (src/mission/lowpoly.js).
# paleColor is the same hue mixed half-way to white, for medium-confidence pixels.
GROUPS = [
    ("carbonate", "Carbonate", "#12a150"),
    ("clay", "Clay", "#8e4be0"),
    ("olivine_clay", "Olivine + clay", "#b4e02a"),
    ("volcanic", "Volcanic", "#e23fb4"),
    ("unclassified", "Unclassified", "#7d8794"),  # drawn transparent on the map
]
RESERVED = {
    "slope amber": "#ffb020",
    "slope red": "#e5412d",
    "route blue": "#2f7fe6",
    "rover path orange": "#ff8a1f",
}
MIN_COLOUR_DISTANCE = 80  # RGB distance; the build stops if a group colour is closer than this

# ---- deposit rules ----
SLOPE_LIMIT_DEG = 15.0  # the mission's limit (walk.json maxSafeSlopeDeg)
MIN_SEPARATION_M = 80.0  # between deposits, and from the patch edge
MAX_DEPOSITS = 10


def hex_rgb(h):
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def pale(h):
    return "#" + "".join(f"{round((c + 255) / 2):02x}" for c in hex_rgb(h))


def load_json(rel):
    with open(REPO / rel, encoding="utf-8") as f:
        return json.load(f)


parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="folder for jezeroFinal.tif (not in the repo)")
args = parser.parse_args()

# ------------------------------------------------------------------ download
cache = args.cache.resolve()
if REPO in cache.parents or cache == REPO:
    sys.exit("the cache folder must be outside the repo")
cache.mkdir(parents=True, exist_ok=True)
tif = cache / "jezeroFinal.tif"
if not tif.exists():
    print(f"downloading {URL}")
    req = urllib.request.Request(URL, headers={"User-Agent": "build-minerals/1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        tif.write_bytes(r.read())
blob = tif.read_bytes()
retrieved = datetime.date.fromtimestamp(tif.stat().st_mtime).isoformat()
print(f"GeoTIFF: {tif.name}, {len(blob)} bytes, sha256 {hashlib.sha256(blob).hexdigest()[:16]}..., retrieved {retrieved}")

# ------------------------------------------------------------------ georeferencing
im = Image.open(tif)
tags = im.tag_v2
if im.size != EXPECT_SIZE or im.mode != "RGB":
    sys.exit(f"GeoTIFF is {im.size} {im.mode}, expected {EXPECT_SIZE} RGB (M2)")
scale = tags.get(33550)  # ModelPixelScale
tie = tags.get(33922)  # ModelTiepoint: raster (i, j, k) -> model (x, y, z)
geokeys = tags.get(34735)
doubles = tags.get(34736)
if not scale or not tie or not geokeys or doubles is None:
    sys.exit("GeoTIFF has no ModelPixelScale / ModelTiepoint / GeoKey tags")
if abs(scale[0] - EXPECT_PIXEL_M) > 1e-6 or abs(scale[1] - EXPECT_PIXEL_M) > 1e-6:
    sys.exit(f"pixel size {scale[:2]}, expected {EXPECT_PIXEL_M} m (M2)")
if len(tie) != 6:
    sys.exit("expected exactly one tiepoint")
if not isinstance(doubles, (tuple, list)):
    doubles = (doubles,)


def geokey(key):
    """Value of a GeoKey: a short stored inline, or a double from tag 34736."""
    for i in range(4, len(geokeys), 4):
        kid, loc, count, value = geokeys[i : i + 4]
        if kid == key:
            if loc == 0:
                return value
            if loc == 34736:
                return doubles[value]
            return None
    return None


checks = {
    "raster type is pixel-is-area (1025 = 1)": geokey(1025) == 1,
    "projection is equirectangular (3075 = 17)": geokey(3075) == 17,
    "linear unit is the metre (3076 = 9001)": geokey(3076) == 9001,
    f"sphere radius is {MARS_RADIUS_M:.0f} m (2057)": geokey(2057) == MARS_RADIUS_M,
    "central meridian is 0 (3088)": geokey(3088) == 0,
    "centre latitude / standard parallel is 0 (3089)": geokey(3089) == 0,
    "false easting and northing are 0 (3082, 3083)": geokey(3082) == 0 and geokey(3083) == 0,
    "no second standard parallel key (3078)": geokey(3078) is None,
}
for text, ok in checks.items():
    if not ok:
        sys.exit(f"GeoTIFF georeferencing check failed: {text}")

PX = scale[0]
# Pixel-is-area: the tiepoint is the outer corner of raster position (i, j).
X0 = tie[3] - tie[0] * PX  # projected x of the WEST edge of column 0
Y0 = tie[4] + tie[1] * PX  # projected y of the NORTH edge of row 0
DEG = 180.0 / math.pi


def col_edge_lon(c):
    return (X0 + c * PX) / MARS_RADIUS_M * DEG


def row_edge_lat(r):
    return (Y0 - r * PX) / MARS_RADIUS_M * DEG


print(
    f"georeferencing: {im.size[0]} x {im.size[1]} px, {PX:g} m, equirectangular R {MARS_RADIUS_M:.0f} m; "
    f"image lon {col_edge_lon(0):.5f} to {col_edge_lon(im.size[0]):.5f} E, "
    f"lat {row_edge_lat(im.size[1]):.5f} to {row_edge_lat(0):.5f} N"
)

# ------------------------------------------------------------------ classify
classes = []
for cid, name, hi, med, group in KEY:
    classes.append({"id": f"{cid}_high", "name": name, "confidence": "high", "rgb": list(hi), "group": group})
    classes.append({"id": f"{cid}_medium", "name": name, "confidence": "medium", "rgb": list(med), "group": group})
palette = np.array([c["rgb"] for c in classes] + [[0, 0, 0]], dtype=np.int32)  # last = black
rgb = np.asarray(im, dtype=np.int32)  # rows, cols, 3; row 0 = north
dist2 = ((rgb[:, :, None, :] - palette[None, None, :, :]) ** 2).sum(axis=3)
nearest = dist2.argmin(axis=2)
snap_dist = np.sqrt(dist2.min(axis=2))
CLASS = np.where(nearest == len(classes), -1, nearest).astype(np.int16)  # -1 = unclassified

# ------------------------------------------------------------------ crop to the walk patch
walk = load_json(f"data/walk/{SITE}/walk.json")
img_w, img_h = im.size
centre_lon = np.array([(col_edge_lon(c) + col_edge_lon(c + 1)) / 2 for c in range(img_w)])
centre_lat = np.array([(row_edge_lat(r) + row_edge_lat(r + 1)) / 2 for r in range(img_h)])
cols_in = np.nonzero((centre_lon >= walk["west"]) & (centre_lon <= walk["east"]))[0]
rows_in = np.nonzero((centre_lat >= walk["south"]) & (centre_lat <= walk["north"]))[0]
if cols_in.size == 0 or rows_in.size == 0:
    sys.exit("the walk patch does not overlap the mineral map")
c0, c1 = int(cols_in[0]), int(cols_in[-1]) + 1
r0, r1 = int(rows_in[0]), int(rows_in[-1]) + 1
if c0 == 0 or r0 == 0 or c1 == img_w or r1 == img_h:
    sys.exit("the walk patch reaches the edge of the mineral map")
GRID = CLASS[r0:r1, c0:c1]
H, W = GRID.shape
N = W * H
grid_meta = {
    "width": W,
    "height": H,
    "west": round(col_edge_lon(c0), 8),
    "east": round(col_edge_lon(c1), 8),
    "south": round(row_edge_lat(r1), 8),
    "north": round(row_edge_lat(r0), 8),
}
snap_patch = snap_dist[r0:r1, c0:c1]
print(
    f"crop: columns {c0}..{c1 - 1}, rows {r0}..{r1 - 1} = {W} x {H} = {N} pixels; "
    f"exact key colours {100 * (snap_patch == 0).mean():.1f}%, largest snap distance {snap_patch.max():.1f} (RGB units)"
)

# ------------------------------------------------------------------ local frame and slope (as tools/build_mission.py)
COLS, ROWS, SPACING = walk["width"], walk["height"], walk["spacingM"]
SIZE_X, SIZE_Z = COLS * SPACING, ROWS * SPACING
raw = np.fromfile(REPO / f"data/walk/{SITE}/dem.bin", dtype="<i2")
if raw.size != COLS * ROWS:
    sys.exit(f"dem.bin has {raw.size} samples, expected {COLS * ROWS}")
raw = raw.reshape(ROWS, COLS)
if (raw == walk["nodata"]).any():
    sys.exit("dem.bin has no-data samples")
if walk.get("maxSafeSlopeDeg") != SLOPE_LIMIT_DEG:
    sys.exit("walk.json maxSafeSlopeDeg differs from the 15 degree limit")
HEIGHT = walk["heightOffsetM"] + raw.astype(np.float64) * walk["heightStepM"]
d_south, d_east = np.gradient(HEIGHT, SPACING)
SLOPE = np.degrees(np.arctan(np.hypot(d_east, d_south)))
MIN_X, MAX_X = 0.5 * SPACING - SIZE_X / 2, (COLS - 0.5) * SPACING - SIZE_X / 2
MIN_Z, MAX_Z = 0.5 * SPACING - SIZE_Z / 2, (ROWS - 0.5) * SPACING - SIZE_Z / 2


def bilinear(grid, x, z):
    fc = min(max((x + SIZE_X / 2) / SPACING - 0.5, 0), COLS - 1)
    fr = min(max((z + SIZE_Z / 2) / SPACING - 0.5, 0), ROWS - 1)
    cc = min(int(math.floor(fc)), COLS - 2)
    rr = min(int(math.floor(fr)), ROWS - 2)
    tx, tz = fc - cc, fr - rr
    return float(
        grid[rr, cc] * (1 - tx) * (1 - tz)
        + grid[rr, cc + 1] * tx * (1 - tz)
        + grid[rr + 1, cc] * (1 - tx) * tz
        + grid[rr + 1, cc + 1] * tx * tz
    )


def lonlat_to_local(lon, lat):
    """Same linear mapping as patch.lonLatToLocal in src/data.js."""
    x = ((lon - walk["west"]) / (walk["east"] - walk["west"]) - 0.5) * SIZE_X
    z = ((walk["north"] - lat) / (walk["north"] - walk["south"]) - 0.5) * SIZE_Z
    return x, z


def pixel_centre_lonlat(r, c):
    """Centre of cropped-grid pixel (r, c)."""
    return float(centre_lon[c0 + c]), float(centre_lat[r0 + r])


def pixel_at(lon, lat):
    """Cropped-grid (row, col) of the pixel containing lon/lat, or None outside the grid."""
    c = math.floor((lon / DEG * MARS_RADIUS_M - X0) / PX) - c0
    r = math.floor((Y0 - lat / DEG * MARS_RADIUS_M) / PX) - r0
    return (r, c) if 0 <= r < H and 0 <= c < W else None


# ------------------------------------------------------------------ percentages
group_of_class = np.array([[g[0] for g in GROUPS].index(c["group"]) for c in classes])
GROUP_IDS = [g[0] for g in GROUPS]
UNCL = GROUP_IDS.index("unclassified")
GGRID = np.where(GRID < 0, UNCL, group_of_class[np.clip(GRID, 0, None)])


def pct(n):
    return round(100.0 * int(n) / N, 2)


by_class = {}
for _, name, _, _, _ in KEY:
    idx = [i for i, c in enumerate(classes) if c["name"] == name]
    by_class[name] = pct(np.isin(GRID, idx).sum())
by_class[UNCLASSIFIED] = pct((GRID < 0).sum())
by_class_conf = {c["id"]: pct((GRID == i).sum()) for i, c in enumerate(classes)}
by_group = {gid: pct((GGRID == gi).sum()) for gi, gid in enumerate(GROUP_IDS)}

# ------------------------------------------------------------------ group colours
groups_out = []
for gid, gname, colour in GROUPS:
    names = [name for _, name, _, _, g in KEY if g == gid]
    groups_out.append({"id": gid, "name": gname, "color": colour, "paleColor": pale(colour), "classes": names})


def rgb_distance(a, b):
    return math.dist(hex_rgb(a), hex_rgb(b))


full = [(g["name"], g["color"]) for g in groups_out]
pales = [(g["name"] + " (pale)", g["paleColor"]) for g in groups_out if g["id"] != "unclassified"]
others = full + list(RESERVED.items())


def closest_pair(mine, against):
    best = (1e9, "", "")
    for na, ca in mine:
        for nb, cb in against:
            if na != nb and not nb.startswith(na) and not na.startswith(nb):
                best = min(best, (rgb_distance(ca, cb), na, nb))
    return best


# Full colours against each other and the colours in use; pale colours (half-way to
# white, so half as far apart by construction) against everything, at half the limit.
for label, pair, limit in (
    ("full", closest_pair(full, others), MIN_COLOUR_DISTANCE),
    ("pale", closest_pair(pales, others + pales), MIN_COLOUR_DISTANCE / 2),
):
    if pair[0] < limit:
        sys.exit(f"group colours too close: {pair[1]} vs {pair[2]} ({pair[0]:.0f} RGB units, limit {limit:g})")
    print(f"colours, {label}: closest pair is {pair[1]} vs {pair[2]}, {pair[0]:.0f} RGB units apart (limit {limit:g})")

# ------------------------------------------------------------------ deposits
# A deposit is a 4-connected patch of pixels of one mineral group inside the crop.
seen = np.zeros((H, W), dtype=bool)
candidates = []
for r in range(H):
    for c in range(W):
        gi = int(GGRID[r, c])
        if seen[r, c] or gi == UNCL:
            continue
        seen[r, c] = True
        stack, members = [(r, c)], []
        while stack:
            rr, cc = stack.pop()
            members.append((rr, cc))
            for nr, nc in ((rr - 1, cc), (rr + 1, cc), (rr, cc - 1), (rr, cc + 1)):
                if 0 <= nr < H and 0 <= nc < W and not seen[nr, nc] and GGRID[nr, nc] == gi:
                    seen[nr, nc] = True
                    stack.append((nr, nc))
        mr = np.array([m[0] for m in members], dtype=float)
        mc = np.array([m[1] for m in members], dtype=float)
        # Centroid, snapped to the nearest member pixel centre (ties: north, then west).
        d2 = (mr - mr.mean()) ** 2 + (mc - mc.mean()) ** 2
        best = min(range(len(members)), key=lambda i: (d2[i], members[i][0], members[i][1]))
        pr, pc = members[best]
        lon, lat = pixel_centre_lonlat(pr, pc)
        x, z = lonlat_to_local(lon, lat)
        confs = {classes[int(GRID[m])]["confidence"] for m in members}
        candidates.append(
            {
                "group": GROUP_IDS[gi],
                "pixels": len(members),
                "row": pr,
                "col": pc,
                "lon": lon,
                "lat": lat,
                "x": x,
                "z": z,
                "confidence": confs.pop() if len(confs) == 1 else "mixed",
                "slopeDeg": bilinear(SLOPE, x, z),
                "touchesCropEdge": bool(
                    (mr.min() == 0) or (mr.max() == H - 1) or (mc.min() == 0) or (mc.max() == W - 1)
                ),
            }
        )
# Rank by area; ties: north, then west.
candidates.sort(key=lambda d: (-d["pixels"], d["row"], d["col"]))


def usable(d, chosen):
    if d["slopeDeg"] >= SLOPE_LIMIT_DEG:
        return "slope"
    if (
        d["x"] - MIN_X < MIN_SEPARATION_M
        or MAX_X - d["x"] < MIN_SEPARATION_M
        or d["z"] - MIN_Z < MIN_SEPARATION_M
        or MAX_Z - d["z"] < MIN_SEPARATION_M
    ):
        return "edge"
    if any(math.hypot(d["x"] - o["x"], d["z"] - o["z"]) < MIN_SEPARATION_M for o in chosen):
        return "near another deposit"
    return None


chosen, skipped = [], {"slope": 0, "edge": 0, "near another deposit": 0}
skipped_list = []
# Pass 1: the largest usable patch of every group that exists.
for gid in GROUP_IDS:
    for d in candidates:
        if d["group"] == gid and usable(d, chosen) is None:
            chosen.append(d)
            break
# Pass 2: fill up by area.
for d in candidates:
    if len(chosen) >= MAX_DEPOSITS:
        break
    if d in chosen:
        continue
    why = usable(d, chosen)
    if why is None:
        chosen.append(d)
    else:
        skipped[why] += 1
        skipped_list.append((d, why))
chosen.sort(key=lambda d: (-d["pixels"], d["row"], d["col"]))
groups_present = sorted({d["group"] for d in candidates})
groups_missing = [g for g in groups_present if g not in {d["group"] for d in chosen}]

deposits = []
for i, d in enumerate(chosen):
    deposits.append(
        {
            "id": f"D{i + 1}",
            "group": d["group"],
            "lon": round(d["lon"], 8),
            "lat": round(d["lat"], 8),
            "area_ha": round(d["pixels"] * PX * PX / 10000.0, 2),
            "confidence": d["confidence"],
            "pixels": d["pixels"],
            "x": round(d["x"], 2),
            "z": round(d["z"], 2),
            "slopeDeg": round(d["slopeDeg"], 1),
            "touchesCropEdge": d["touchesCropEdge"],
        }
    )

# ------------------------------------------------------------------ stations
mission = load_json(f"data/mission/{SITE}.json")
points = {"START": mission["start"]}
for s in mission["stations"]:
    if s["id"] != "S1":  # S1 is the briefing in the cabin, at START
        points[s["id"]] = s
stations = {}
for sid, s in points.items():
    rc = pixel_at(s["lon"], s["lat"])
    if rc is None:
        sys.exit(f"{sid} is outside the mineral grid")
    k = int(GRID[rc])
    stations[sid] = {
        "group": "unclassified" if k < 0 else classes[k]["group"],
        "class": UNCLASSIFIED if k < 0 else classes[k]["name"],
        "confidence": None if k < 0 else classes[k]["confidence"],
    }

# ------------------------------------------------------------------ write
out = {
    "generatedBy": "tools/build_minerals.py; do not edit by hand, re-run the tool",
    "source": f"{SOURCE} doi:{DOI}, {LICENCE}",
    "doi": DOI,
    "url": URL,
    "licence": LICENCE,
    "madeFrom": MADE_FROM,
    "retrieved": retrieved,
    "pixelSizeM": int(PX) if PX == int(PX) else PX,
    "caveat": CAVEAT,
    "surfaceNote": SURFACE_NOTE,
    "notHazard": "This map shows which minerals are probably at the surface. It says nothing about danger.",
    "classes": classes,
    "groups": groups_out,
    "grid": {**grid_meta, "data": [int(v) for v in GRID.ravel()]},
    "pixelCount": N,
    "percentages": {"byClass": by_class, "byGroup": by_group, "byClassConfidence": by_class_conf},
    "depositRule": (
        "4-connected patches of one mineral group among the cropped pixels, ranked by area "
        f"(pixels x {PX:g} m x {PX:g} m); position = centroid snapped to the nearest pixel centre in the patch; "
        f"kept only where the 2 m terrain slope at that point is under {SLOPE_LIMIT_DEG:g} degrees and the point is "
        f"at least {MIN_SEPARATION_M:g} m from the patch edge and from every other deposit; the largest of each "
        f"group first, then by area, at most {MAX_DEPOSITS}. Reachability on foot is checked by the route planner."
    ),
    "deposits": deposits,
    "stations": stations,
}
dest = REPO / f"data/walk/{SITE}/minerals.json"
with open(dest, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
    f.write("\n")

# ------------------------------------------------------------------ report
print(f"\nPERCENTAGES, delta walk patch, {N} pixels")
gname = {g[0]: g[1] for g in GROUPS}
for gid, v in sorted(by_group.items(), key=lambda kv: -kv[1]):
    print(f"  group {gname[gid]:<16}{v:6.2f}%")
for name, v in sorted(by_class.items(), key=lambda kv: -kv[1]):
    print(f"  class {name:<28}{v:6.2f}%")
print(f"\nDEPOSITS ({len(candidates)} patches found; kept {len(deposits)}; skipped while filling: {skipped})")
for d in deposits:
    print(
        f"  {d['id']:<4}{gname[d['group']]:<16}{d['area_ha']:7.2f} ha {d['pixels']:5d} px  {d['confidence']:<7}"
        f"{d['lon']:.5f} E {d['lat']:.5f} N  x {d['x']:8.1f} z {d['z']:8.1f}  slope {d['slopeDeg']:4.1f}"
    )
for d, why in skipped_list:
    print(
        f"  skipped ({why}): {gname[d['group']]}, {d['pixels'] * PX * PX / 10000.0:.2f} ha, {d['pixels']} px, "
        f"{d['lon']:.5f} E {d['lat']:.5f} N, x {d['x']:.1f} z {d['z']:.1f}, slope {d['slopeDeg']:.1f}"
    )
if groups_missing:
    print(f"  NO USABLE DEPOSIT for group(s): {', '.join(groups_missing)}")
print("\nSTATIONS")
for sid, s in stations.items():
    print(f"  {sid:<6}{s['class']} ({s['confidence']}) -> {gname[s['group']]}")
print(f"\nwrote {dest.relative_to(REPO)} ({dest.stat().st_size} bytes)")
