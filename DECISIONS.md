# Decisions

Choices made while building the viewer, with the measurements behind them. Numbers were measured
from the files in this repo on 2026-11-15.

## Step 4: photo texture and distant terrain

### The photo

- `tools/stitch_mosaic.py` stitches the level-16 photo tiles of a walk patch into one image,
  `data/walk/<site>/mosaic_16.jpg`, covering exactly the `walk.json` rectangle. The page loads that
  one file instead of 182 tiles. Re-run it after rebuilding a patch:
  `python3 tools/stitch_mosaic.py jezero jezero_delta`.
- Tiles are square in degrees, not metres, so the mosaic is cut and resampled by longitude/latitude.
  Sizes: jezero 3315 x 3145 px, jezero_delta 3316 x 3145 px (both under the 4096 limit, about
  0.60 m per pixel east-west and 0.64 m north-south). All 182 tiles were present for each patch.
- Level 16 is the sharpest level that fits in 4096 x 4096. Level 17 (about 0.3 m per pixel) would
  need about 6630 x 6290 px. So the ground looks soft when you stand on it and sharp from a few
  tens of metres away. This is a limit of the 4096 rule, not of the data.
- Registration check: shading computed from the terrain lines up with the photo best at a shift of
  0 to 1 sample (2 m) in both patches, so the photo sits on the terrain correctly.

### Colour is cosmetic

- The HiRISE photo is greyscale. The viewer multiplies it by a tint so that the photo's average
  brightness comes out as one chosen Mars surface colour (`MARS_SURFACE` in `src/materials.js`,
  `#96704f`). **The colour is cosmetic. Only the light/dark pattern is real data.**
- Very bright outcrops are several times brighter than the average and would clip to flat white, so
  the brightest values are compressed (only above 55 % of full brightness). Also cosmetic.
- The sun was moved from the south-west to the west (azimuth 265 degrees, 22 degrees up). Measured:
  the photo's own shading matches the terrain best for a sun azimuth of 285 degrees (jezero) and
  255 degrees (jezero_delta), so a western sun keeps the computed shading consistent with the
  shadows already in the photo. The photo already contains real shading, so the computed sun was
  made weaker and the sky fill stronger to avoid doubling the contrast.

### Distant terrain and the height offset

- The 2 m walk patch is surrounded by the 20 m grid in `data/sites/jezero`, placed by
  longitude/latitude in the same local frame. `jezero_delta` uses the `jezero` grid (set in
  `REGION_FOR_SITE` in `src/main.js`).
- The two terrains come from different source models and do not agree exactly. Fine minus coarse,
  over all 1,000,000 samples of each patch (coarse grid interpolated to the same points):

  | Patch | Mean | Median | Spread (std dev) | Lowest | Highest | Mean on the patch edge |
  |---|---|---|---|---|---|---|
  | jezero | -1.84 m | -1.68 m | 2.40 m | -15.46 m | +8.95 m | -1.64 m |
  | jezero_delta | -2.00 m | -2.00 m | 3.66 m | -13.56 m | +13.60 m | -0.31 m |

  So the fine patch is about 2 m lower than the coarse grid at both places. There is almost no tilt
  between them (under 1.2 m per km).
- **The constant offset is applied to the coarse grid**: it is lowered by the mean difference
  (1.84 m for jezero, 2.00 m for jezero_delta) so it meets the fine patch. The fine patch is treated
  as the truth and is never changed. The viewer measures this mean itself at load time (it gets the
  same numbers: -1.838 m and -1.997 m), so nothing is hard-coded and a new patch works unchanged.
- What is left after the offset is local disagreement of a few metres (the spread above). At the
  patch edge the distant terrain is therefore bent to meet the fine terrain exactly, and that
  correction fades out over 400 m. The distant terrain within 400 m of the patch is slightly
  adjusted for this reason; beyond that it is the coarse grid plus the constant offset.
- The distant terrain has no triangles inside the patch footprint, so it cannot poke through the
  fine terrain. Its inner edge follows the fine edge every 2.6 m. The two surfaces still do not meet
  exactly once level of detail is active: a review measured the drawn height step across the join
  (2000 points per patch, one player position) at up to 0.84 m (jezero) and 2.62 m (jezero_delta).
  An earlier figure of 0.10 m / 0.31 m could not be reproduced and is withdrawn. Both sides have a
  hidden vertical strip ("skirt", 6 m or more on the patch, 30 m on the distant terrain) that covers
  the step; no see-through pixels were found in 38 test views.
- There is no photo outside the patch, so the distant terrain is one plain colour. To avoid a hard
  line where the photo stops, it takes the photo's brightness along the patch edge and fades to the
  plain colour over 300 m. Cosmetic.
- The coarse grid is not centred on the delta patch: it ends 3.4 km west of the patch centre (and
  reaches 8.2 km east, 5.2 km north, 6.6 km south). Beyond that there is no terrain, only haze.

### Level of detail

- The walk patch is cut into 16 x 16 chunks of 128 m. Each chunk is drawn at 2, 4, 8, 16 or 32 m
  spacing depending on its distance from the viewer (closer than 90 m, 280 m, 640 m, 1300 m, or
  farther). Chunks are rebuilt from the full-resolution heights on demand, so it works wherever the
  player walks or teleports.
- Ground following does not use the drawn mesh. It always samples the full-resolution heights, so
  the player's height is exact at every level of detail.
- The distant terrain is a fixed set of square rings that get larger with distance (about 21 m cells
  next to the patch, about 170 m at 8 km). It never changes, because the player cannot leave the
  patch.
- Measured triangle counts (renderer.info with view culling turned off, so everything is counted):
  between 107,000 and 232,000 depending on where the player stands; the worst of 5,625 positions
  tested was 231,530 (jezero) and 230,056 (jezero_delta), of which about 52,000 are distant terrain.
  The limit is about 300,000.
- Textures: one photo of 3316 x 3145 px (3315 x 3145 for jezero) plus the 256 x 256 "N" sign of the
  temporary north marker.

## Mission step B1: mission data file and source recheck (2026-11-15)

### The mission data file

- `tools/build_mission.py` writes `data/mission/jezero_delta.json` from `docs/mission-brief.md` and
  the data files. Run it with `uv run --python 3.12 --with numpy tools/build_mission.py` (needs numpy
  and the standard library only). It uses no clock, network or random numbers: two runs give the
  same bytes. Do not edit the JSON by hand.
- No coordinate is typed. Sample positions come from `data/activities.json`; panorama positions come
  from the rover waypoint in `data/stops/m20.json` named by the panorama id (`<site>_<drive>` in
  `data/pano/m20/index.json`). They are converted with the same formula as `src/data.js` and snapped
  to the terrain.
- The brief prints some data values inside card texts (sols, dates, core lengths, "about 20 m
  apart", "about 1.4 km from Berea"). The tool checks each against the data and stops on a
  mismatch. All agree: the two ridge stops are 20.1 m apart and 1413 m from Berea.
- **Start spot rule**: the centre of the 30 m x 30 m window (15 x 15 terrain samples) with the lowest
  mean slope, among windows whose centre is within 300 m of the patch centre and that contain no
  sample steeper than 15 degrees. Ties go to the window nearest the centre. Result: 227 m east,
  95 m north of the centre (246 m away), mean slope 1.04 degrees, steepest sample 2.99 degrees.
- **Slope** is computed by central differences on the 2 m grid (13.11 % of the patch is above
  15 degrees, the same figure as in `PROGRESS.md`). A station's slope is that grid sampled at the
  station.
- **Sols of the traverse** come from `data/stops/m20.json`. `data/layers/traverses.geojson` carries
  no sols (its only property is the rover name). Each drive line in it ends at a rover waypoint, so
  each point takes the sol of the waypoint that ends its drive. `{sol_min}` and `{sol_max}` are the
  lowest and highest sol among the 34 drives that have any part inside the patch: 443 and 764. The
  drive of sol 764 starts inside the patch and ends just outside, so the rover was still driving
  inside on that sol. (The 43 waypoints that lie inside the patch span sols 443 to 763; the file
  keeps that range too, as `traverse.waypointSolRange`.)
- **Traverse clipped to the patch**: 3 lines, 4016 m in total: 396 m (sols 443 to 536), 17 m (sol
  539, a drive that only cuts the south-east corner) and 3603 m (sols 708 to 764, passes Berea).
  The review found the 17 m corner piece missing (the tool had skipped drives with no point inside
  the patch); it now clips every piece of every drive.
- **S2 leg**: straight lines between the stations with fixed positions, sampled every 1 m, in
  walking order. The first one that crosses ground above 15 degrees is start to Berea (highest slope
  19.5 degrees, first steep sample 73 m from the start), so `{direct_max_slope}` = 19.5. The other
  two lines are steeper (Berea to ridge 29.4, ridge to start 32.3 degrees).
- **S2 and S3 positions** were provisional in B1 and are set by the planned route since B2 (see
  "Mission B2" below). `{route_km}`, `{extra_min}` and `{station_count}` are filled since B2.
- **Igneous cores**: entries of `data/activities.json` whose rock type is exactly "Igneous": 8 cores,
  sols 194 to 377, all within 0.9 km of the first rover waypoint. This matches the brief's fallback
  list. Entries typed "Igneous/impactite" (28, 29), "Igneous or sedimentary" (30) and "Likely mixed
  sedimentary and igneous grains" (17, 18) are not counted.
- **Field Check wrong choices** are plain distractors, not claims about Jezero: the other rock
  classes for Q1 and Q2 (sedimentary / igneous / metamorphic), "a sheet of ice" and "a field of sand
  dunes" for Q3, "dust blowing in the air" and "loose boulders on the surface" for Q4.
- The Tobler formula stored with the assumptions is the standard published form,
  6 km/h x exp(-3.5 x |tan(slope) + 0.05|). The brief only names the function; the x 0.8 factor and
  the 3.3 km/h cap are the brief's ASSUMPTIONS.

### Recheck of the two sources flagged in the brief (done 2026-11-15)

**NASA Science, "Mars Rock Samples"**
(https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/): reachable. The page
says "Page Last Updated: Jun 20, 2026" and "Samples Collected: 30 of 38". The five cores used by the
mission match `data/activities.json` in every field checked (sol sealed, date sealed, sample type,
rock type, sample height, current location, feature name):

| No. | Name | Sol | Date sealed | Height | Rock type | Current location | Feature |
|---|---|---|---|---|---|---|---|
| 10 | Swift Run | 490 | July 7, 2022 | 6.69 cm (2.63 in) | Sedimentary | Perseverance Rover | Skinner Ridge |
| 11 | Skyland | 495 | July 12, 2022 | 5.85 cm (2.30 in) | Sedimentary | Sample Depot | Skinner Ridge |
| 12 | Hazeltop | 509 | July 27, 2022 | 5.97 cm (2.35 in) | Sedimentary | Perseverance Rover | Wildcat Ridge |
| 13 | Bearwallow | 516 | Aug. 3, 2022 | 6.24 cm (2.46 in) | Sedimentary | Sample Depot | Wildcat Ridge |
| 19 | Melyn | 749 | March 30, 2023 | 6.04 cm (2.38 in) | Sedimentary | Perseverance Rover | Berea |

No mismatch. The data in `data/activities.json` keeps its "retrieved 2026-09-29" label, because that
is when it was fetched; the table above is a separate re-check on 2026-11-15. Only these five rows
were compared, not the other 25. Sample positions are not on NASA's page; they remain the rover
waypoint at the stated sol (approximate).

**EVA-EXP-0075**
(https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf):
reachable, 35 slides, 6.8 MB. Title: "Exploration EVA System Concept of Operations Summary for
Artemis Phase 1 Lunar Surface Mission", EVA-EXP-0075, EVA Exploration Workshop, February 2020. The
quote in the brief (F7) is confirmed. Slide 34: "Crewmembers will be able to conduct EVAs of up to
8 hours in duration, while walking up to 2 kilometers away from the lander and on terrain of up to
a 20° slope." Slide 6 says the same and adds "(6±2 hours)" for the duration. So F7's "Original not
opened" no longer applies; the mission file cites the document directly.

One thing the brief does not mention: slide 22 of the same document "Assumes ~2 km/hr walking pace"
for its range circles (and says that figure "Does not account for slope or obstacles"). Our 3.3 km/h
cap is faster than that. It stays as the brief's ASSUMPTION and is labelled so; nothing was changed.

### Small data notes found on the way

- `data/activities.json` has 30 entries (not 25). Samples 29 and 30 have no sol or position yet.
- `data/pano/m20/26_1222.json` does not exist; that panorama's frame list is inside
  `data/pano/m20/index.json` instead. Both panorama images are present.

## Mission B2: planned route, beacons, rover traverse (2026-11-15)

- **One implementation of the route maths**: `src/mission/route.js` (plain JavaScript, no Three.js).
  The page uses it, and `tools/build_mission.py` runs the same file through `tools/route_cli.mjs`
  (Node.js) to store the route in `data/mission/jezero_delta.json`. So the tool now needs Node.js
  on the PATH. The page does not search at load: it reads the stored line and computes the numbers
  it shows from that line and the terrain. Planning again in the page gives the same 1416 points
  (checked in the headless test; about 70 ms on a desktop).
- **Rules**: 2 m grid, 8 neighbours. A cell is walkable when its slope (central differences, the
  B1 method) is at most 15 degrees. A diagonal step also needs both cells it passes between to be
  walkable; with that, the bilinear terrain slope anywhere under the route cannot exceed 15.
  Cost = walking time: km/h = min(3.3, 0.8 x 6 x exp(-3.5 x |tan(slope along the path) + 0.05|)).
  Lengths are horizontal map distances, not distances along the slope. Search is A* with the
  straight grid distance at 3.3 km/h as the lower bound, so the result is the fastest grid path
  (confirmed against a separate Dijkstra in Python). No smoothing: the route follows grid moves,
  so it is up to about 8% longer than a free-angle path would be.
- **Result**: START, S4, S5, START = 3429 m, 64.3 minutes walking; with 4 stops of 20 minutes,
  144.3 minutes of the 480. Steepest ground under the route 14.55 degrees (bilinear slope sampled
  every 0.5 m). Route ends are the nearest reachable terrain sample: 0.87 m from the Berea
  position and 1.04 m from the ridge position; neither station is on or cut off by steep ground.
  If a station could not be reached the tool stops with "NO ROUTE"; it never relaxes the limit.
- **S2** is the route point nearest to the first place where the straight line start-to-Berea gets
  steeper than 15 degrees (it is 26 m from that place and 62 m along the route from the start).
- **S3** is the first place after S2 where the route comes within 2 m (one grid spacing) of the
  rover traverse: 409 m after S2, 202 m before Berea, on the sol-732 drive. The route crosses the
  rover's path there, so the distance is 0.
- **`{extra_min}` is 0.2.** Straight line start-to-Berea: 620 m, 12.34 minutes with the same pace
  rule (it ignores the slope limit and reaches 19.5 degrees). Planned: 673 m, 12.58 minutes. The
  difference is 14 seconds, so the S2 card reads "takes 0.2 more minutes". Values under 10 minutes
  are shown with one decimal so a small difference is not printed as 0. The team may want to
  reword the card or compare distance instead; the number itself is what the data gives.
- **`{station_count}` is 4**: the stations walked to (S2 to S5). S1, the briefing, is in the cabin
  at the start. Each of the 4 costs 20 minutes on the clock.
- **Drawing**: the route is one ribbon mesh 1.2 m wide (7,106 triangles), laid on the heights of
  the full-detail terrain triangles and lifted in the vertex shader by 8 cm plus 4 mm per metre
  from the eye; the lift covers the coarser far terrain and depth precision. Chevrons are drawn in
  the fragment shader and move at 1.5 m/s in the walking direction. Fog is off for it. The rover
  traverse is a second ribbon, 0.5 m wide, orange, slightly higher (8,246 triangles), with its own
  on/off switch. Five beacons (4 stations + the airlock at the start) are one merged flat-shaded
  mesh each plus a canvas-text label that turns to the viewer about the vertical axis only and
  grows with distance between 12 m and 260 m (0.085 x distance tall) so it reads the same from
  200 m as from 20 m. Total added: 15,816 triangles, 12 draw calls.
- **Start**: with the mission loaded the walk starts on the route 6 m past the start marker, at
  (221, -95), facing along the route, instead of the patch centre. (Starting exactly on the marker
  put the viewer inside its pillar; found in review.) `?mission=0` gives the plain viewer.
- **Where the route doubles back** (about 66 m in two stretches near the ridge lookout, where the
  walk to the ridge and the walk back use the same terrain samples) the two directions were drawn
  on top of each other, so the chevrons a walker saw pointed the wrong way. Each direction is now
  drawn 0.65 m to its own right there (keep right, like a road), fading in over 3 route points.
  The stored route is unchanged; only the drawing is shifted. The ribbon also rises evenly by
  3 cm from its first to its last point, so where the route crosses itself the later part lies
  cleanly on top.
- **Labels in line**: every second beacon's label is raised by 1.15 label heights when seen from
  more than 60 m (full raise from 160 m), so a station standing behind another keeps a readable
  label. Up close every label sits on its pillar.
- **Which slope is "crossed"**: the limit is applied to the slope of each 2 m terrain sample, and
  the 14.55 degrees is that slope interpolated along the route. Measured another way (the tilt of
  the interpolated height surface between samples, 5 cm steps) the steepest spot under the route
  is 15.1 degrees. Both come from the same data; the first is the rule the route follows.
