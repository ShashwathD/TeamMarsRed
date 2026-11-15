#!/usr/bin/env python3
"""Build data/mission/<site>.json for the Jezero Marswalk mission (build step B1).

Run from anywhere:

    uv run --python 3.12 --with numpy tools/build_mission.py            # jezero_delta
    python3 tools/build_mission.py                                      # same, if numpy is installed

Needs Python 3 with numpy and the standard library only. It reads only files in
this repo and writes one JSON file. It has no clock, no network and no random
numbers, so running it twice gives the same bytes.

What is typed in here and what is computed:
  * Card texts, the fact bank, the Field Check and the layer credits are copied
    from docs/mission-brief.md. {braced} words in card texts stay as placeholders;
    the viewer fills them from "computed" in the output file.
  * Every coordinate comes from data/activities.json or data/stops/m20.json
    (panoramas are found through data/pano/m20/index.json). None is typed.
  * Numbers that the brief prints inside card texts (sols, core lengths, dates)
    are checked against data/activities.json; the tool stops if one differs.
"""

import json
import math
import re
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
SITE = sys.argv[1] if len(sys.argv) > 1 else "jezero_delta"
if not re.fullmatch(r"[A-Za-z0-9_-]+", SITE):
    sys.exit(f"bad site name {SITE!r}")

MARS_RADIUS_M = 3396190.0  # same value as src/data.js
DATA_RETRIEVED = "2026-09-29"  # when the team fetched NASA's sample list (docs/data-sources.md)

# ---- ASSUMPTIONS (mission brief F7 and SYSTEMS). All labelled ASSUMPTION in the output. ----
EVA_HOURS = 8
RESERVE_HOURS = 1
SLOPE_LIMIT_DEG = 15.0
SLOPE_AMBER_DEG = 10.0  # brief S2: "amber 10-15, red above 15"
PACE_CAP_KMH = 3.3
STOP_MINUTES = 20
TOBLER_FACTOR = 0.8

# ---- Rules chosen in B1 (recorded in the output) ----
START_RADIUS_M = 300.0  # brief: "within ~300 m of the patch centre"
START_WINDOW_M = 30.0  # mean slope is taken over a square of this size
LINE_STEP_M = 1.0  # sampling step along straight lines
S2_BACKOFF_M = 10.0  # provisional S2 stands this far before the first steep sample
WAYPOINT_MATCH_M = 0.5  # traverse line ends are matched to rover waypoints within this

# ---- Mission anchors named by the brief (numbers and ids only; positions come from the data) ----
BEREA_SAMPLE = 19
RIDGE_SAMPLES = [10, 11, 12, 13]
CORE_NUMBERS = [10, 11, 12, 13, 19]
PANORAMAS = ["26_1004", "26_1222"]  # brief S5; the key is "<site>_<drive>" of a rover waypoint


def load_json(rel):
    with open(REPO / rel, encoding="utf-8") as f:
        return json.load(f)


def r1(v):
    return round(float(v), 1)


def r2(v):
    return round(float(v), 2)


# ------------------------------------------------------------------ terrain
walk = load_json(f"data/walk/{SITE}/walk.json")
COLS, ROWS, SPACING = walk["width"], walk["height"], walk["spacingM"]
SIZE_X, SIZE_Z = COLS * SPACING, ROWS * SPACING
raw = np.fromfile(REPO / f"data/walk/{SITE}/dem.bin", dtype="<i2")
if raw.size != COLS * ROWS:
    sys.exit(f"dem.bin has {raw.size} samples, expected {COLS * ROWS}")
raw = raw.reshape(ROWS, COLS)
if (raw == walk["nodata"]).any():
    sys.exit("dem.bin has no-data samples; this tool assumes a complete patch")
if walk.get("maxSafeSlopeDeg") != SLOPE_LIMIT_DEG:
    sys.exit("walk.json maxSafeSlopeDeg differs from the brief's 15 degree limit")
HEIGHT = walk["heightOffsetM"] + raw.astype(np.float64) * walk["heightStepM"]  # row 0 = north

# Slope: central differences on the 2 m grid (one-sided on the patch edge), the
# same method as the figures in PROGRESS.md / DATA_NOTES.md.
d_south, d_east = np.gradient(HEIGHT, SPACING)
SLOPE = np.degrees(np.arctan(np.hypot(d_east, d_south)))


def bilinear(grid, x, z):
    """Same sampling as patch.elevationAt in src/data.js (cell-centred, clamped)."""
    fc = min(max((x + SIZE_X / 2) / SPACING - 0.5, 0), COLS - 1)
    fr = min(max((z + SIZE_Z / 2) / SPACING - 0.5, 0), ROWS - 1)
    c0 = min(int(math.floor(fc)), COLS - 2)
    r0 = min(int(math.floor(fr)), ROWS - 2)
    tx, tz = fc - c0, fr - r0
    return float(
        grid[r0, c0] * (1 - tx) * (1 - tz)
        + grid[r0, c0 + 1] * tx * (1 - tz)
        + grid[r0 + 1, c0] * (1 - tx) * tz
        + grid[r0 + 1, c0 + 1] * tx * tz
    )


ORIGIN_HEIGHT_M = bilinear(HEIGHT, 0.0, 0.0)  # the viewer's y = 0


def lonlat_to_local(lon, lat):
    """Same linear mapping as patch.lonLatToLocal in src/data.js."""
    x = ((lon - walk["west"]) / (walk["east"] - walk["west"]) - 0.5) * SIZE_X
    z = ((walk["north"] - lat) / (walk["north"] - walk["south"]) - 0.5) * SIZE_Z
    return x, z


def local_to_lonlat(x, z):
    lon = walk["west"] + (x / SIZE_X + 0.5) * (walk["east"] - walk["west"])
    lat = walk["north"] - (z / SIZE_Z + 0.5) * (walk["north"] - walk["south"])
    return lon, lat


# Walkable square, as in src/data.js (spanned by the sample centres).
MIN_X, MAX_X = 0.5 * SPACING - SIZE_X / 2, (COLS - 0.5) * SPACING - SIZE_X / 2
MIN_Z, MAX_Z = 0.5 * SPACING - SIZE_Z / 2, (ROWS - 0.5) * SPACING - SIZE_Z / 2


def inside(x, z):
    return MIN_X <= x <= MAX_X and MIN_Z <= z <= MAX_Z


def place(x, z):
    """Snap a local position to the terrain."""
    lon, lat = local_to_lonlat(x, z)
    elev = bilinear(HEIGHT, x, z)
    return {
        "x": r2(x),
        "z": r2(z),
        "y": r2(elev - ORIGIN_HEIGHT_M),
        "elevationM": r2(elev),
        "slopeDeg": r1(bilinear(SLOPE, x, z)),
        "lon": round(lon, 8),
        "lat": round(lat, 8),
    }


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


# Check that the patch really is the size the mapping assumes.
ns_m = math.radians(walk["north"] - walk["south"]) * MARS_RADIUS_M
ew_m = (
    math.radians(walk["east"] - walk["west"])
    * MARS_RADIUS_M
    * math.cos(math.radians((walk["north"] + walk["south"]) / 2))
)
if abs(ns_m - SIZE_Z) > 0.5 or abs(ew_m - SIZE_X) > 0.5:
    sys.exit(f"patch is {ew_m:.2f} x {ns_m:.2f} m on the sphere, expected {SIZE_X} x {SIZE_Z}")

# ------------------------------------------------------------------ start spot
win = int(round(START_WINDOW_M / SPACING))  # cells per side


def window_sum(grid):
    s = np.zeros((ROWS + 1, COLS + 1))
    s[1:, 1:] = grid.cumsum(0).cumsum(1)
    return s[win:, win:] - s[:-win, win:] - s[win:, :-win] + s[:-win, :-win]


mean_slope = window_sum(SLOPE) / (win * win)
steep_cells = window_sum((SLOPE > SLOPE_LIMIT_DEG).astype(np.float64))
# Window with top-left sample (r, c) covers samples r..r+win-1; its centre in local metres:
wr, wc = np.indices(mean_slope.shape)
win_x = (wc + win / 2) * SPACING - SIZE_X / 2
win_z = (wr + win / 2) * SPACING - SIZE_Z / 2
win_d = np.hypot(win_x, win_z)
allowed = (win_d <= START_RADIUS_M) & (steep_cells == 0)
if not allowed.any():
    sys.exit("no start window without steep ground near the patch centre")
# Lowest mean slope; ties go to the window nearest the centre, then north, then west.
order = np.lexsort((wc.ravel(), wr.ravel(), win_d.ravel(), np.where(allowed, mean_slope, np.inf).ravel()))
best = int(order[0])
br, bc = divmod(best, mean_slope.shape[1])
start_xz = (float(win_x[br, bc]), float(win_z[br, bc]))
start = place(*start_xz)
start.update(
    {
        "windowMeanSlopeDeg": r2(mean_slope[br, bc]),
        "windowMaxSlopeDeg": r2(SLOPE[br : br + win, bc : bc + win].max()),
        "distanceFromCentreM": r1(win_d[br, bc]),
        "candidateWindows": int(allowed.sum()),
        "rule": (
            f"Centre of the {START_WINDOW_M:g} m x {START_WINDOW_M:g} m window "
            f"({win} x {win} terrain samples) with the lowest mean slope, among windows whose centre is "
            f"within {START_RADIUS_M:g} m of the patch centre and that contain no sample steeper than "
            f"{SLOPE_LIMIT_DEG:g} degrees. Ties: nearest the centre."
        ),
    }
)

# ------------------------------------------------------------------ samples and waypoints
activities_file = load_json("data/activities.json")
activities = {a["number"]: a for a in activities_file["activities"]}
stops = load_json("data/stops/m20.json")
pano_index = load_json("data/pano/m20/index.json")

CORE_FIELDS = ["number", "name", "sol", "feature", "sampleType", "dateSealed", "rockType", "height", "location", "positionBasis"]
cores = []
for n in CORE_NUMBERS:
    a = activities[n]
    x, z = lonlat_to_local(a["lon"], a["lat"])
    if not inside(x, z):
        sys.exit(f"sample {n} is outside the patch")
    core = {k: a[k] for k in CORE_FIELDS}
    m = re.match(r"\s*([0-9.]+)\s*cm", a["height"])
    core["lengthCm"] = float(m.group(1))
    core["waypointSol"] = int(re.search(r"sol (\d+)", a["positionBasis"]).group(1))
    core["position"] = place(x, z)
    core["positionApproximate"] = True
    core["locationRetrieved"] = DATA_RETRIEVED
    core["station"] = "S4" if n == BEREA_SAMPLE else "S5"
    cores.append(core)
core_by_number = {c["number"]: c for c in cores}

# Igneous cores "near the landing area": rockType exactly "Igneous" (this leaves out the
# later "Igneous/impactite" and "Igneous or sedimentary" entries, which are far to the west).
landing = stops[0]  # first rover waypoint = landing site (see data/layers/landing_sites.geojson source note)
igneous = [a for a in activities_file["activities"] if a.get("rockType") == "Igneous"]


def great_circle_m(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MARS_RADIUS_M * math.asin(math.sqrt(a))


ig_dist = [great_circle_m(landing["lon"], landing["lat"], a["lon"], a["lat"]) for a in igneous]
other_ig = [
    a
    for a in activities_file["activities"]
    if "igneous" in str(a.get("rockType", "")).lower() and a.get("rockType") != "Igneous"
]

# Panoramas: the index key is "<site>_<drive>"; the position is that rover waypoint.
panoramas = []
for key in PANORAMAS:
    entry = pano_index[key]
    site_id, drive = (int(v) for v in key.split("_"))
    wp = [s for s in stops if s["site"] == site_id and s["drive"] == drive]
    if len(wp) != 1:
        sys.exit(f"panorama {key}: {len(wp)} matching waypoints")
    wp = wp[0]
    if wp["sol"] != entry["sol"]:
        sys.exit(f"panorama {key}: index sol {entry['sol']} != waypoint sol {wp['sol']}")
    x, z = lonlat_to_local(wp["lon"], wp["lat"])
    if not inside(x, z):
        sys.exit(f"panorama {key} is outside the patch")
    feature = sorted({a["feature"] for a in activities.values() if a.get("positionBasis") == f"rover waypoint at sol {wp['sol']}"})
    if len(feature) != 1:
        sys.exit(f"panorama {key}: cannot name its feature from activities.json")
    panoramas.append(
        {
            "id": key,
            "file": f"data/pano/m20/{entry['file']}",
            "widthPx": entry["width"],
            "sol": entry["sol"],
            "feature": feature[0],
            "roverYawDeg": wp["yawDeg"],
            "coveredFraction": entry["coveredFraction"],
            "position": place(x, z),
            "positionBasis": f"rover waypoint site {site_id} drive {drive} (data/stops/m20.json)",
            "samples": sorted(a["number"] for a in activities.values() if a.get("feature") == feature[0]),
            "credit": "NASA/JPL-Caltech, Mars 2020 Navcam, stitched by the team",
        }
    )

# ------------------------------------------------------------------ rover traverse
feature = [f for f in load_json("data/layers/traverses.geojson")["features"] if f["properties"].get("rover") == "Perseverance"]
if len(feature) != 1:
    sys.exit("traverses.geojson: expected one Perseverance feature")
segments = feature[0]["geometry"]["coordinates"]  # MultiLineString: one line per drive
stop_xz = np.array([lonlat_to_local(s["lon"], s["lat"]) for s in stops])


def nearest_stop(x, z):
    """Latest waypoint at this spot, or None. (Several waypoints can share a spot.)"""
    d = np.hypot(stop_xz[:, 0] - x, stop_xz[:, 1] - z)
    hits = np.flatnonzero(d <= WAYPOINT_MATCH_M)
    return None if hits.size == 0 else stops[int(hits[-1])]


def clip_to_patch(a, b):
    """Liang-Barsky: part of segment a-b inside the walkable square, or None."""
    t0, t1 = 0.0, 1.0
    dx, dz = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0] - MIN_X), (dx, MAX_X - a[0]), (-dz, a[1] - MIN_Z), (dz, MAX_Z - a[1])):
        if p == 0:
            if q < 0:
                return None
        else:
            t = q / p
            if p < 0:
                if t > t1:
                    return None
                t0 = max(t0, t)
            else:
                if t < t0:
                    return None
                t1 = min(t1, t)
    return (a[0] + t0 * dx, a[1] + t0 * dz), (a[0] + t1 * dx, a[1] + t1 * dz)


# Each drive line ends at a rover waypoint; the drive's sol is that waypoint's sol.
runs = []  # contiguous in-patch pieces: {"points": [(x, z)...], "sols": [sol per point]}
unmatched_drives = 0
drive_sols = []  # sol of every drive with a part inside the patch
for seg in segments:
    pts = [lonlat_to_local(lon, lat) for lon, lat in seg]
    # Clip every piece: a drive can cut a corner of the patch without any of its points inside.
    pieces = [clip_to_patch(a, b) for a, b in zip(pts, pts[1:]) if a != b]
    pieces = [c for c in pieces if c is not None and c[0] != c[1]]
    if not pieces:
        continue
    end = nearest_stop(*pts[-1])
    if end is None:
        unmatched_drives += 1
    sol = None if end is None else end["sol"]
    if sol is not None:
        drive_sols.append(sol)
    for ca, cb in pieces:
        if runs and dist(runs[-1]["points"][-1], ca) < WAYPOINT_MATCH_M:
            runs[-1]["points"].append(cb)
            runs[-1]["sols"].append(sol)
        else:
            runs.append({"points": [ca, cb], "sols": [sol, sol]})
if unmatched_drives:
    sys.exit(f"{unmatched_drives} in-patch drives do not end at a known waypoint")

waypoints_in = [(s, xz) for s, xz in zip(stops, stop_xz) if inside(*xz)]
# {sol_min}/{sol_max}: the sols of the drives that have any part inside the patch. A drive that
# leaves the patch ends at a waypoint outside it, but the rover was still driving inside on that sol.
sol_min, sol_max = min(drive_sols), max(drive_sols)
waypoint_sol_min = min(s["sol"] for s, _ in waypoints_in)
waypoint_sol_max = max(s["sol"] for s, _ in waypoints_in)

traverse_lines = []
traverse_len = 0.0
for run in runs:
    pts = run["points"]
    length = sum(dist(a, b) for a, b in zip(pts, pts[1:]))
    traverse_len += length
    sols = [s for s in run["sols"] if s is not None]
    traverse_lines.append(
        {
            "solFirst": min(sols),
            "solLast": max(sols),
            "lengthM": r1(length),
            "pointFields": ["x", "z", "y", "sol"],
            "points": [[r2(x), r2(z), r2(bilinear(HEIGHT, x, z) - ORIGIN_HEIGHT_M), s] for (x, z), s in zip(pts, run["sols"])],
        }
    )

# ------------------------------------------------------------------ fixed stations
berea = core_by_number[BEREA_SAMPLE]
berea_xz = (berea["position"]["x"], berea["position"]["z"])
ridge_xz = tuple(float(np.mean([p["position"][k] for p in panoramas])) for k in ("x", "z"))
pano_gap_m = dist(*[(p["position"]["x"], p["position"]["z"]) for p in panoramas])
ridge_from_berea_m = dist(berea_xz, ridge_xz)


def line_profile(a, b):
    """Terrain slope sampled every LINE_STEP_M along the straight line a-b."""
    length = dist(a, b)
    n = max(1, int(math.ceil(length / LINE_STEP_M)))
    t = np.linspace(0.0, 1.0, n + 1)
    xs, zs = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
    slopes = np.array([bilinear(SLOPE, x, z) for x, z in zip(xs, zs)])
    return length, t * length, xs, zs, slopes


# Legs between the stations whose positions do not depend on the route.
anchors = [("START", start_xz), ("S4", berea_xz), ("S5", ridge_xz), ("START", start_xz)]
legs = []
for (name_a, a), (name_b, b) in zip(anchors, anchors[1:]):
    length, along, xs, zs, slopes = line_profile(a, b)
    steep = slopes > SLOPE_LIMIT_DEG
    first = int(np.argmax(steep)) if steep.any() else None
    worst = int(np.argmax(slopes))
    legs.append(
        {
            "from": name_a,
            "to": name_b,
            "straightLengthM": r1(length),
            "directMaxSlopeDeg": r1(slopes.max()),
            "directMaxSlopeAt": {"x": r1(xs[worst]), "z": r1(zs[worst]), "alongM": r1(along[worst])},
            "exceedsLimit": bool(steep.any()),
            "steepShare": round(float(steep.mean()), 3),
            "firstSteepAlongM": None if first is None else r1(along[first]),
            "_profile": (along, xs, zs, slopes, first),
        }
    )
steep_legs = [leg for leg in legs if leg["exceedsLimit"]]
s2_leg = steep_legs[0] if steep_legs else max(legs, key=lambda leg: leg["directMaxSlopeDeg"])
s2_fallback = not steep_legs  # brief: "if none exists in the patch, use the steepest line"

# Provisional S2: on that straight line, S2_BACKOFF_M before the first sample above the limit
# (or before the steepest sample in the fallback case). B2 moves it onto the planned route.
along, xs, zs, slopes, first = s2_leg["_profile"]
target = first if first is not None else int(np.argmax(slopes))
i2 = int(np.searchsorted(along, max(0.0, along[target] - S2_BACKOFF_M), side="right") - 1)
s2_xz = (float(xs[i2]), float(zs[i2]))

# Provisional S3: the point of the rover traverse nearest to provisional S2 ("where the route
# meets the traverse line" cannot be known before B2 plans the route).
best_s3 = None
for li, run in enumerate(runs):
    pts = run["points"]
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        dx, dz = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((s2_xz[0] - a[0]) * dx + (s2_xz[1] - a[1]) * dz) / (dx * dx + dz * dz)))
        p = (a[0] + t * dx, a[1] + t * dz)
        d = dist(p, s2_xz)
        if best_s3 is None or d < best_s3[0]:
            best_s3 = (d, p, li, run["sols"][k + 1])
s3_dist, s3_xz, s3_line, s3_sol = best_s3

for leg in legs:
    del leg["_profile"]

# ------------------------------------------------------------------ fact bank, cards (text from the brief)
FACTS = {
    "F1": {
        "text": "Perseverance landed in Jezero crater on 18 Feb 2021 (Octavia E. Butler Landing site).",
        "source": "Team Protikriti data-sources.md",
    },
    "F2": {
        "text": "The delta is a massive fan-shaped collection of rocks and sediment on the crater's western edge, built where a river met a crater lake billions of years ago; it rises about 40 m (130 ft) above the crater floor.",
        "source": "JPL news, 19 Apr 2022",
    },
    "F3": {
        "text": "Scientists think fine-grained sediment at the delta's base was once mud on the bottom of Lake Jezero; higher up are sand and rock fragments carried from upstream. JPL calls it one of the best places on Mars to look for signs of ancient microbial life.",
        "source": "JPL news, 19 Apr 2022",
    },
    "F4": {
        "text": "Crater-floor rocks are igneous: Séítah is coarsely crystalline, olivine-rich rock formed at the base of a magma body; Máaz is lava flows or the chemical counterpart. Water altered them. Cores are stored aboard Perseverance for potential return to Earth.",
        "source": "Farley et al. 2022, Science 377, eabo2196",
    },
    "F5": {
        "text": "At the delta front the team found sandstones, siltstones and boulder-rich conglomerates, interpreted as deposited underwater by density currents in a distal deltaic setting; boulder-rich conglomerates are consistent with high-energy floods.",
        "source": "Williams et al., LPSC 2023 abstract (NTRS 20230000588)",
    },
    "F6": {
        "text": "One sol = 24 h 39 min 35 s (NASA says about 24.6 h).",
        "source": "NASA GISS Mars24 / NASA Science",
    },
    "F7": {
        "text": "EVA precedent: NASA's Artemis EVA concept of operations (EVA-EXP-0075, 2020): EVAs of up to 8 h, up to 2 km from the lander, terrain up to 20 degrees (Moon). Our 8 h EVA, 1 h reserve, 15 degree slope limit, 3.3 km/h pace and 20 min per stop are ASSUMPTIONS.",
        "source": "NASA EVA-EXP-0075 (Artemis EVA concept of operations summary, Feb 2020)",
    },
    "F8": {
        "text": "Astronauts can make connections, solve problems quickly and apply context in real time.",
        "source": "Space Apps challenge text",
    },
    "F9": {
        "text": "Photo: MRO HiRISE, 25 cm per pixel. Terrain: USGS HiRISE stereo model, 1 m (shown at 2 m).",
        "source": "MRO HiRISE; USGS HiRISE terrain model",
    },
}

SAMPLES_SOURCE = "NASA Science, Mars Rock Samples"
TRAVERSE_SOURCE = "NASA/JPL MMGIS traverse"


def source_line(refs, extra=()):
    parts = list(extra) + [FACTS[r]["source"] for r in refs]
    seen = []
    for p in parts:
        if p not in seen:
            seen.append(p)
    return ("Source: " if len(seen) == 1 else "Sources: ") + "; ".join(seen)


def card(title, text, refs, extra=(), **more):
    out = {
        "title": title,
        "text": text,
        "placeholders": sorted(set(re.findall(r"\{([a-z_0-9]+)\}", text))),
        "words": len(text.split()),
        "sourceRefs": list(refs),
        "source": source_line(refs, extra),
    }
    out.update(more)
    return out


S1_TEXT = (
    "Today's Marswalk: Jezero crater delta. Perseverance landed here on 18 February 2021. The delta is a "
    "fan of rock and sediment built where a river met a crater lake billions of years ago. Plan: {route_km} km, "
    "{station_count} stops, back before the clock runs out."
)
S2_TEXT = (
    "Slope matters. We assume suited explorers avoid ground steeper than 15 degrees (ASSUMPTION; NASA's "
    "Artemis plan cites up to 20 degrees for the Moon). Turn on the slope layer: amber 10-15, red above 15. "
    "The straight line reaches {direct_max_slope} degrees; the planned route stays under 15 and takes "
    "{extra_min} more minutes."
)
S3_TEXT = (
    "The orange line is Perseverance's real path. Inside this patch it drove between sols {sol_min} "
    "and {sol_max} (a sol is a Mars day, 24 h 39 min). Rovers scout; people can look, decide and adapt on the "
    "spot: astronauts solve problems quickly and apply context in real time."
)
S4_TEXT = (
    "Berea. Sample #19, Melyn, sealed on sol 749 (30 March 2023). NASA classes it a sedimentary rock "
    "core, 6.04 cm (2.38 in) long. NASA's list showed it aboard the rover (retrieved 2026-09-29). Position is "
    "approximate (rover waypoint, sol 736). Coring here is simulated."
)
S5A_TEXT = (
    "Four cores were sealed here in 2022: Swift Run (sol 490, 6.69 cm), Skyland (495, 5.85 cm), Hazeltop "
    "(509, 5.97 cm), Bearwallow (516, 6.24 cm). NASA classes all four sedimentary. At the delta front the team "
    "found sandstones, siltstones and boulder-rich conglomerates laid down underwater."
)
S5B_IGNEOUS = (
    "Cooled from magma or lava. Séítah is olivine-rich; Máaz is lava flows or related. Near the landing "
    "area NASA classes {n_igneous} cores as igneous (sols {ig_min} to {ig_max})."
)
S5B_SEDIMENTARY = "Laid down by water: sandstones, siltstones, conglomerates."


def require(cond, what):
    if not cond:
        sys.exit(f"BRIEF/DATA MISMATCH: {what}")
    return what


# The brief prints these data values inside card texts; make sure the data agrees.
brief_checks = []
b = berea
brief_checks.append(require(b["name"] == "Melyn" and b["feature"] == "Berea", "sample 19 is Melyn at Berea"))
brief_checks.append(require(b["sol"] == 749 and b["dateSealed"] == "March 30, 2023", "sample 19 sealed on sol 749, March 30, 2023"))
brief_checks.append(require(b["height"] == "6.04 cm (2.38 in)", "sample 19 is 6.04 cm (2.38 in)"))
brief_checks.append(require(b["rockType"] == "Sedimentary" and b["sampleType"] == "Rock Core", "sample 19 is a sedimentary rock core"))
brief_checks.append(require(b["location"] == "Perseverance Rover", "sample 19 listed aboard the rover"))
brief_checks.append(require(b["waypointSol"] == 736, "sample 19 positioned at the rover waypoint of sol 736"))
for num, name, sol, cm in ((10, "Swift Run", 490, 6.69), (11, "Skyland", 495, 5.85), (12, "Hazeltop", 509, 5.97), (13, "Bearwallow", 516, 6.24)):
    c = core_by_number[num]
    brief_checks.append(
        require(
            c["name"] == name and c["sol"] == sol and c["lengthCm"] == cm and c["rockType"] == "Sedimentary" and c["dateSealed"].endswith("2022"),
            f"sample {num} is {name}, sol {sol}, {cm} cm, sedimentary, sealed in 2022",
        )
    )
brief_checks.append(
    require([p["sol"] for p in panoramas] == [477, 502] and [p["feature"] for p in panoramas] == ["Skinner Ridge", "Wildcat Ridge"], "panoramas 26_1004 (sol 477, Skinner Ridge) and 26_1222 (sol 502, Wildcat Ridge)")
)
brief_checks.append(require(15 <= pano_gap_m <= 25, f"the two ridge stops are about 20 m apart (computed {pano_gap_m:.1f} m)"))
brief_checks.append(require(1350 <= ridge_from_berea_m <= 1450, f"the ridge is about 1.4 km from Berea (computed {ridge_from_berea_m:.0f} m)"))

LOCATION_WORDS = {"Perseverance Rover": "on rover", "Sample Depot": "sample depot"}
s5a_locations = [
    {
        "number": n,
        "name": core_by_number[n]["name"],
        "location": core_by_number[n]["location"],
        "label": f"{core_by_number[n]['name']}: {LOCATION_WORDS[core_by_number[n]['location']]}",
    }
    for n in RIDGE_SAMPLES
]

cards = {
    "S1": card("Briefing", S1_TEXT, ["F1", "F2"]),
    "S2": card("Read the ground", S2_TEXT, ["F7", "F9"]),
    "S3": card("Follow the rover", S3_TEXT, ["F6", "F8"], extra=[TRAVERSE_SOURCE]),
    "S4": card("Berea: first core", S4_TEXT, [], extra=[SAMPLES_SOURCE]),
    "S5A": card(
        "Ridge lookout",
        S5A_TEXT,
        ["F5"],
        extra=[SAMPLES_SOURCE],
        coreLocations=s5a_locations,
        coreLocationsNote=f"Where each tube is now, from NASA's list (retrieved {DATA_RETRIEVED})",
    ),
    "S5B": {
        "title": "Igneous vs sedimentary",
        "columns": [
            {"heading": "Igneous (crater floor)", "text": S5B_IGNEOUS, "words": len(S5B_IGNEOUS.split())},
            {"heading": "Sedimentary (delta)", "text": S5B_SEDIMENTARY, "words": len(S5B_SEDIMENTARY.split())},
        ],
        "placeholders": ["ig_max", "ig_min", "n_igneous"],
        "words": len(S5B_IGNEOUS.split()) + len(S5B_SEDIMENTARY.split()),
        "sourceRefs": ["F3", "F4", "F5"],
        "source": source_line(["F4", "F5", "F3"], extra=[SAMPLES_SOURCE + " (core counts)"]),
    },
}

FIELD_CHECK = [
    {
        "id": "Q1",
        "question": "Which kind of rock did Perseverance sample on Jezero's crater floor?",
        "choices": ["Sedimentary", "Igneous", "Metamorphic"],
        "answer": 1,
        "sourceRefs": ["F4"],
        "source": source_line(["F4"]),
    },
    {
        "id": "Q2",
        "question": "Which kind did it sample at the delta?",
        "choices": ["Igneous", "Metamorphic", "Sedimentary"],
        "answer": 2,
        "sourceRefs": ["F5"],
        "source": source_line(["F5"], extra=[SAMPLES_SOURCE]),
    },
    {
        "id": "Q3",
        "question": "What does the delta suggest once existed here?",
        "choices": ["A river flowing into a lake", "A sheet of ice", "A field of sand dunes"],
        "answer": 0,
        "sourceRefs": ["F2"],
        "source": source_line(["F2"]),
    },
    {
        "id": "Q4",
        "question": "Where do scientists most hope to find signs of ancient microbial life?",
        "choices": ["Dust blowing in the air", "Fine-grained sediment at the delta's base", "Loose boulders on the surface"],
        "answer": 1,
        "sourceRefs": ["F3"],
        "source": source_line(["F3"]),
    },
]
for q in FIELD_CHECK:
    q["rightAnswer"] = q["choices"][q["answer"]]
FIELD_CHECK_NOTE = (
    "Wrong choices are plain distractors (the other rock classes, or clearly different settings); they are "
    "not claims about Jezero. A wrong answer shows the right one plus its source; no penalty."
)

LAYERS = [
    {"id": "photo", "name": "Photo", "mission": "Mars Reconnaissance Orbiter (MRO)", "instrument": "HiRISE", "source": "MRO HiRISE orthomosaic, 25 cm per pixel", "note": ""},
    {
        "id": "slope",
        "name": "Terrain and slope hazard",
        "mission": "Mars Reconnaissance Orbiter (MRO)",
        "instrument": "HiRISE stereo",
        "source": "USGS HiRISE terrain model, 1 m (shown at 2 m)",
        "note": "Slope derived by us; the 15 degree limit is an ASSUMPTION",
    },
    {"id": "traverse", "name": "Rover traverse", "mission": "Mars 2020 Perseverance", "instrument": "Rover localization", "source": "NASA/JPL MMGIS", "note": ""},
    {"id": "samples", "name": "Sample sites", "mission": "Mars 2020 Perseverance", "instrument": "Sampling and caching system", "source": "NASA Mars Rock Samples", "note": "Positions approximate (rover waypoint at that sol)"},
    {"id": "panoramas", "name": "Surface panoramas", "mission": "Mars 2020 Perseverance", "instrument": "Navcam", "source": "Mars 2020 Navcam", "note": ""},
    {"id": "backdrop", "name": "Backdrop terrain", "mission": "Mars Reconnaissance Orbiter (MRO)", "instrument": "CTX", "source": "MRO CTX, 20 m", "note": ""},
]

ASSUMPTIONS = [
    {"id": "evaHours", "value": EVA_HOURS, "unit": "h", "label": "ASSUMPTION", "text": "One EVA lasts 8 hours in total."},
    {"id": "reserveHours", "value": RESERVE_HOURS, "unit": "h", "label": "ASSUMPTION", "text": "1 hour of the EVA is kept as reserve."},
    {"id": "slopeLimitDeg", "value": SLOPE_LIMIT_DEG, "unit": "deg", "label": "ASSUMPTION", "text": "Suited explorers avoid ground steeper than 15 degrees."},
    {"id": "paceCapKmh", "value": PACE_CAP_KMH, "unit": "km/h", "label": "ASSUMPTION", "text": "Walking pace is capped at 3.3 km/h."},
    {"id": "stopMinutes", "value": STOP_MINUTES, "unit": "min", "label": "ASSUMPTION", "text": "Each station takes 20 minutes."},
    {
        "id": "toblerFactor",
        "value": TOBLER_FACTOR,
        "unit": "x",
        "label": "ASSUMPTION",
        "text": "Pace on slopes follows Tobler's hiking function times 0.8.",
        "formula": "speed_kmh = min(paceCapKmh, toblerFactor * 6 * exp(-3.5 * abs(tan(slope_along_path) + 0.05)))",
    },
]

# ------------------------------------------------------------------ stations
def station(sid, title, xz, basis, **more):
    out = {"id": sid, "title": title}
    out.update(place(*xz))
    out["distanceFromStartM"] = r1(dist(xz, start_xz))
    out["positionBasis"] = basis
    out.update(more)
    return out


stations = [
    station("S1", "Briefing", start_xz, "The start spot (rover cabin); see start.rule.", kind="cabin", provisional=False, card="S1"),
    station(
        "S2",
        "Read the ground",
        s2_xz,
        f"PROVISIONAL (B2 moves it onto the planned route). On the straight line {s2_leg['from']} to {s2_leg['to']}, "
        f"{S2_BACKOFF_M:g} m before the first sample steeper than {SLOPE_LIMIT_DEG:g} degrees.",
        kind="slope",
        provisional=True,
        card="S2",
        leg=[s2_leg["from"], s2_leg["to"]],
    ),
    station(
        "S3",
        "Follow the rover",
        s3_xz,
        "PROVISIONAL (B2 sets it where the planned route meets the traverse). The point of the rover traverse nearest to provisional S2.",
        kind="traverse",
        provisional=True,
        card="S3",
        traverseLine=s3_line,
        traverseSol=s3_sol,
        distanceFromS2M=r1(s3_dist),
    ),
    station(
        "S4",
        "Berea: first core",
        berea_xz,
        f"Sample {BEREA_SAMPLE} in data/activities.json ({berea['positionBasis']}). Approximate.",
        kind="core",
        provisional=False,
        approximate=True,
        card="S4",
        samples=[BEREA_SAMPLE],
        feature=berea["feature"],
    ),
    station(
        "S5",
        "Ridge lookout",
        ridge_xz,
        "Midpoint of the rover waypoints of panoramas " + " and ".join(PANORAMAS) + " (data/stops/m20.json). Approximate.",
        kind="lookout",
        provisional=False,
        approximate=True,
        card=["S5A", "S5B"],
        samples=RIDGE_SAMPLES,
        panoramas=PANORAMAS,
        panoramaGapM=r1(pano_gap_m),
        distanceFromBereaM=r1(ridge_from_berea_m),
    ),
]

computed = {
    "sol_min": sol_min,
    "sol_max": sol_max,
    "direct_max_slope": s2_leg["directMaxSlopeDeg"],
    "n_igneous": len(igneous),
    "ig_min": min(a["sol"] for a in igneous),
    "ig_max": max(a["sol"] for a in igneous),
    "route_km": None,
    "extra_min": None,
    "station_count": None,
}

out = {
    "schema": 1,
    "mission": "Jezero Marswalk",
    "site": SITE,
    "generatedBy": "tools/build_mission.py (build step B1); do not edit by hand, re-run the tool",
    "brief": "docs/mission-brief.md",
    "dataRetrieved": DATA_RETRIEVED,
    "inputs": [
        f"data/walk/{SITE}/walk.json",
        f"data/walk/{SITE}/dem.bin",
        "data/activities.json",
        "data/stops/m20.json",
        "data/layers/traverses.geojson",
        "data/pano/m20/index.json",
    ],
    "frame": {
        "note": "Local metres: x east, z south, y up, origin at the patch centre; y = 0 is the ground at the centre. Same as src/data.js.",
        "originElevationM": r2(ORIGIN_HEIGHT_M),
        "sizeM": [SIZE_X, SIZE_Z],
        "spacingM": SPACING,
        "bounds": {"minX": MIN_X, "maxX": MAX_X, "minZ": MIN_Z, "maxZ": MAX_Z},
    },
    "terrain": {
        "slopeMethod": "Central differences on the 2 m height grid; slope = atan(|gradient|). Point values are bilinear samples of that slope grid.",
        "shareSteeperThanLimit": round(float((SLOPE > SLOPE_LIMIT_DEG).mean()), 4),
        "shareAmber": round(float(((SLOPE > SLOPE_AMBER_DEG) & (SLOPE <= SLOPE_LIMIT_DEG)).mean()), 4),
        "medianSlopeDeg": r2(np.median(SLOPE)),
        "slopeBandsDeg": {"amberFrom": SLOPE_AMBER_DEG, "redAbove": SLOPE_LIMIT_DEG},
    },
    "assumptions": ASSUMPTIONS,
    "start": start,
    "stations": stations,
    "legs": {
        "note": f"Straight lines between the stations whose positions do not depend on the route, sampled every {LINE_STEP_M:g} m.",
        "list": legs,
        "s2Leg": [s2_leg["from"], s2_leg["to"]],
        "s2Rule": (
            "Steepest straight line (no line in the patch exceeds the limit)."
            if s2_fallback
            else f"First leg, in walking order, whose straight line crosses ground steeper than {SLOPE_LIMIT_DEG:g} degrees."
        ),
        "s2UsesFallback": s2_fallback,
    },
    "route": {
        "status": "not computed in B1; B2 fills these",
        "order": ["START", "S2", "S3", "S4", "S5", "START"],
        "lengthM": None,
        "route_km": None,
        "extra_min": None,
        "station_count": None,
        "directMinutes": None,
        "plannedMinutes": None,
        "points": None,
    },
    "traverse": {
        "source": "data/layers/traverses.geojson (Perseverance, NASA/JPL MMGIS), clipped to the patch; one line per unbroken stretch inside the patch",
        "solsFrom": (
            "data/stops/m20.json. The traverse file carries no sols (its only property is the rover name). Each drive line "
            f"ends at a rover waypoint (matched within {WAYPOINT_MATCH_M:g} m); a point's sol is the sol of the waypoint that ends its drive."
        ),
        "solRangeBasis": (
            "Lowest and highest sol among the drives that have any part inside the patch (a drive that crosses the "
            "patch edge counts). The same sols are on the points of the lines below."
        ),
        "sol_min": sol_min,
        "sol_max": sol_max,
        "drivesInside": len(drive_sols),
        "waypointsInside": len(waypoints_in),
        "waypointSolRange": [waypoint_sol_min, waypoint_sol_max],
        "lengthM": r1(traverse_len),
        "lines": traverse_lines,
    },
    "cores": cores,
    "coresNote": f"Copied from data/activities.json (NASA Science, Mars Rock Samples, retrieved {DATA_RETRIEVED}). Positions are approximate: the rover's waypoint at the sol named in positionBasis.",
    "igneous": {
        "rule": 'Entries of data/activities.json whose rockType is exactly "Igneous".',
        "numbers": [a["number"] for a in igneous],
        "names": [a["name"] for a in igneous],
        "features": sorted({a["feature"] for a in igneous}),
        "n_igneous": len(igneous),
        "ig_min": min(a["sol"] for a in igneous),
        "ig_max": max(a["sol"] for a in igneous),
        "farthestFromLandingKm": r2(max(ig_dist) / 1000),
        "landingBasis": "first rover waypoint in data/stops/m20.json",
        "notCounted": [{"number": a["number"], "rockType": a["rockType"]} for a in other_ig],
    },
    "panoramas": panoramas,
    "computed": computed,
    "computedNote": "Values for the {placeholders} in card texts. null = depends on the route, filled by B2 at runtime.",
    "facts": FACTS,
    "cards": cards,
    "fieldCheck": {"note": FIELD_CHECK_NOTE, "questions": FIELD_CHECK},
    "layers": LAYERS,
    "missionsCovered": ["MRO", "Mars 2020 Perseverance"],
    "telemetryNote": "Suit oxygen, battery and temperature are cosmetic and tagged SIM.",
    "briefChecks": brief_checks,
}

# Every placeholder used by a card must have a slot in "computed".
for cid, c in cards.items():
    for p in c["placeholders"]:
        if p not in computed:
            sys.exit(f"card {cid} uses {{{p}}} but nothing computes it")

dest = REPO / "data" / "mission" / f"{SITE}.json"
dest.parent.mkdir(parents=True, exist_ok=True)
text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
dest.write_text(text, encoding="utf-8")

# ------------------------------------------------------------------ report
print(f"wrote {dest.relative_to(REPO)} ({len(text.encode('utf-8'))} bytes)")
print(f"slope: {out['terrain']['shareSteeperThanLimit'] * 100:.2f}% of the patch is steeper than {SLOPE_LIMIT_DEG:g} degrees")
print(f"start: ({start['x']}, {start['z']}) m, window mean slope {start['windowMeanSlopeDeg']} deg, max {start['windowMaxSlopeDeg']} deg, {start['candidateWindows']} candidate windows")
print()
print("| Station | x east (m) | z south (m) | Elevation (m) | y local (m) | Slope (deg) | From start (m) | Position |")
print("|---|---|---|---|---|---|---|---|")
print(f"| START | {start['x']:.1f} | {start['z']:.1f} | {start['elevationM']:.1f} | {start['y']:.1f} | {start['slopeDeg']:.1f} | 0.0 | rule |")
for s in stations:
    print(
        f"| {s['id']} {s['title']} | {s['x']:.1f} | {s['z']:.1f} | {s['elevationM']:.1f} | {s['y']:.1f} | {s['slopeDeg']:.1f} | "
        f"{s['distanceFromStartM']:.1f} | {'provisional' if s['provisional'] else ('data, approximate' if s.get('approximate') else 'rule')} |"
    )
print()
print("| Straight leg | Length (m) | Max slope (deg) | Share above 15 deg | First steep at (m) |")
print("|---|---|---|---|---|")
for leg in legs:
    print(f"| {leg['from']} -> {leg['to']} | {leg['straightLengthM']:.1f} | {leg['directMaxSlopeDeg']:.1f} | {leg['steepShare'] * 100:.1f}% | {leg['firstSteepAlongM']} |")
print()
print(f"S2 leg: {s2_leg['from']} -> {s2_leg['to']} (fallback: {s2_fallback}); direct_max_slope = {computed['direct_max_slope']}")
print(f"traverse: {len(traverse_lines)} line(s), {traverse_len:.0f} m inside the patch, sols {sol_min}-{sol_max} from {len(drive_sols)} drives ({len(waypoints_in)} waypoints inside, sols {waypoint_sol_min}-{waypoint_sol_max})")
for line in traverse_lines:
    print(f"  line sols {line['solFirst']}-{line['solLast']}, {len(line['points'])} points, {line['lengthM']} m")
print(f"igneous: n={computed['n_igneous']}, sols {computed['ig_min']}-{computed['ig_max']}, farthest {out['igneous']['farthestFromLandingKm']} km from landing; not counted: {out['igneous']['notCounted']}")
print(f"ridge: panoramas {pano_gap_m:.1f} m apart, {ridge_from_berea_m:.0f} m from Berea")
print("card words: " + ", ".join(f"{k} {v['words']}" for k, v in cards.items()))
