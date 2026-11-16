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

## Mission B3: EVA clock and HUD (2026-11-15)

- **Mission time is a budget, not a stopwatch.** Real seconds are not counted. The clock moves
  only when (1) ground is covered and (2) another part of the mission charges it (20 minutes per
  station with `clock.chargeStop(id)`, once per station; a map teleport with `clock.charge`).
  Reason: a visit lasts minutes and the EVA 8 hours, so a real-time clock would never move, and a
  sped-up one would punish reading the cards. Standing still costs nothing.
- **Ground covered costs its walking time, however it was covered.** Each frame the explorer's
  ground position (under the head) is compared with the last charged spot. Once it is 0.25 m or
  more away (so head sway is not charged), the straight line between the two is priced with the
  route's own pace rule: km/h = min(3.3, 0.8 x 6 x exp(-3.5 x |tan(slope along the line) + 0.05|)),
  heights read from the terrain at most every 2 m. So a desktop walk (3 m/s on screen), a run
  (15 m/s), real steps in the room and a teleport of N metres all cost the same: the walking time
  of those N metres. A 30.7 m teleport cost 33.4 s in the test; a 114 m jump 131 s. A teleport is
  never free. Snap turns cost nothing (no ground covered).
- **The straight line of a teleport ignores the 15 degree limit**: it is priced over whatever
  ground lies between, steep or not (Tobler makes steep ground slow, it does not forbid it). The
  B4 map teleport must instead charge the route distance: `clock.charge(clock.routeSeconds(first,
  last), { metres, reason: 'teleport' })` then `clock.moveCharged(x, z)`, so the jump is not
  charged a second time.
- **Time to walk home.** Within 30 m of the planned route: walking time along the route from the
  nearest route point to the airlock, the quicker way round the loop (forward and backward times
  differ, because uphill and downhill are priced differently), plus the straight walk to that
  route point. Farther from the route: the fastest slope-limited walk found by A* from the nearest
  ground that can be walked home from (looked for within 60 m), plus the straight walk to it. The
  search (43 ms in headless desktop Chromium, 174 m off the route) runs again only after moving
  10 m or 5% of the distance to the airlock, whichever is more, never every frame. Its cost on a
  Quest is not measured.
- **Margin = time left - reserve (1 h) - time to walk home.** Amber when margin is under 1 hour,
  red when it is under 0, which is the brief's "walk-home time exceeds time left minus reserve".
  (If the reserve were not subtracted, the brief's amber and red rules would be the same line.)
  At the start: 8:00 left, margin 6:59. The planned walk uses about 2 h 24 min, so amber is not
  reached on the planned route; that is what the numbers give.
- **Never game over**: below zero the clock keeps counting (shown with a minus sign), "RETURN"
  flashes once when the status gets worse, and everything keeps working.
- **HUD strip**: one panel 1.24 m x 0.13 m, 1.15 m from the head and 24 degrees below eye level,
  turned to face the eyes. It is an object in the scene, not a child of the camera. It stays put
  for head turns up to 28 degrees, then glides back in front (rate 4 per second) and stops within
  1.5 degrees; it is never left more than 55 degrees behind. It follows the head's position
  softly but is never more than 0.1 m behind it (so it keeps its place when walking, running or
  teleporting). It does not follow looking up or down. Large digits are about
  4 cm tall at 1.15 m (about 2 degrees); labels about 1.5 cm. Legibility in a headset is not
  tested.
- **Flashes** ("SLOPE CAUTION", "SCAN", "SAMPLE SEALED", "RETURN") are the one thing fixed to the
  head: a small panel 17 degrees above the view centre for about 2.5 seconds, then gone.
- **Slope caution**: slope underfoot is the bilinear sample of the terrain slope grid (the B1
  method). Amber from 10 degrees, red above 15 (bands read from the mission file). A flash is
  shown on entering a band, not while standing in it; the caution ends once the ground is 1 degree
  under the band; amber flashes at most every 5 seconds. `mission.slopeWarnings` counts them for
  the debrief.
- **Redraws**: the strip's canvas is drawn only when a shown value changes and at most 5 times a
  second. To keep that rare, heading is shown in 5 degree steps, times in whole minutes (time left
  and margin rounded down, walk home rounded up), slope in whole degrees, distance in metres up to
  100 m and in 10 m steps beyond.
- **"NEXT" is the straight-line distance** to the next station, not the distance along the route.
  The next station is S2 until a later step calls `mission.setNextStation(id)`.
- **SIM values are made up**: oxygen = 100 - 85 x share of the EVA used, battery = 100 - 75 x
  share, temperature = 20 + 4 x share (degrees C). They are not data, are labelled SIM on the
  strip, and nothing depends on them.
- **Cost**: 130 triangles, 2 draw calls (3 while a flash shows), two canvas textures (2400 x 252
  and 1024 x 208).

## Mission B4: forearm tablet, layers, map teleport

- **UI kit (`src/mission/ui.js`)**: a panel is a flat mesh with a canvas texture; its owner draws
  on the canvas and names the rectangles that can be tapped. A pointer ray is tested against the
  panels with plane maths (no scene raycast, no allocations). The canvas is uploaded only when its
  content changes. Hovering lights a separate see-through quad over the button, so pointing at
  things never redraws or uploads a canvas. Later cards, the Field Check, the cabin console and
  the debrief are meant to use the same kit.
- **A press fires on trigger down**, not on release: with the tablet on the other arm, both hands
  move a little, and "release on the same button" would miss often.
- **Tablet before teleport**: a trigger press whose ray lands anywhere on a panel (button or not)
  is used up by the panel; no teleport aim starts and the release does nothing. `xr.js` only
  offers the hook (`xr.hooks.select`), it knows nothing about the tablet.
- **Where the tablet is worn**: on the left controller's pointing-ray space, not its grip space.
  On Touch controllers the grip space is pitched 45 degrees from the pointing ray (values in the
  iwer emulator's Quest profile), and the pointing ray is the direction that runs along the
  forearm with a straight wrist. The screen centre is 0.25 m back from the ray origin, 7.5 cm
  above the arm, and tilted 30 degrees toward the body. This pose is a reasoned guess: it is
  right in the emulator for a forearm raised across the chest, and has not been tried on a
  person's arm.
- **Y or a look**: Y on the left controller pins the screen on or off. Without Y, the screen
  lights after the explorer has looked at the tablet for 0.3 s (within 20 degrees of the view
  centre, closer than 0.8 m, screen facing the eyes) and goes dark 0.6 s after they look away
  (38 degrees). After Y turned it off it stays off until it has been looked away from. The slate
  itself is always on the arm in VR; only the screen switches.
- **Desktop**: Tab or Y slides the tablet up in front of the camera (it is a child of the camera
  there; the "nothing locked to the head" rule is about VR) and frees the mouse so the buttons
  can be clicked. A click that lands on the tablet does not capture the mouse. After a map
  teleport the desktop tablet closes to show the new place; in VR it stays lit.
- **Text size**: screen 0.34 m x 0.238 m, canvas 1280 x 896, so 1 px is 0.266 mm. Nothing is
  drawn smaller than 42 px: 11.2 mm of font size, 1.4 degrees at 0.45 m (capital letters about
  8 mm, 1.0 degree). The brief's "about 1.2 degrees" is read as font size. Five layer chips do
  not fit one screen at that size, so LAYERS has two pages of chips and a third page of credits.
- **Controller buttons with the mission loaded**: left Y is the tablet, right A is kept for scan
  and right B for the airlock door (they do nothing until those steps exist), left X is the only
  button left for the frame-time readout. `?tablet=0` loads the mission without the tablet and
  leaves all four buttons on the frame-time readout, as in the plain viewer. The step-5
  regression test presses A and Y for the readout, so it is now run with `&tablet=0`.
- **Map**: the real photo of the patch (736 px for 2000 m), tinted to the same surface colour as
  the ground, north up, with the planned route, the rover path and sample sites drawn from the
  mission file, and the slope bands when that layer is on. Two stops are closer on the map than a
  finger-sized pin (the airlock and stop 2 are 62 m, 23 px, apart), so pins closer than 70 px are
  pushed apart and a line leads to the true place; the same stops are also a list of large
  buttons beside the map. Sample sites lie under the pins of stops 4 and 5 at this scale, so
  those pins get an amber ring instead.
- **You-are-here** is a small arrow mesh on top of the screen (position from the head, direction
  from where the head looks), so walking and turning cost no canvas upload.
- **What a map teleport costs**: the walking time of the route distance (brief). In detail: the
  straight walk from where the explorer stands to the nearest point of the planned route, then
  the route to the landing point, the quicker way round the loop (straight through the route
  points between, or the other way past the airlock). Where the route runs out and back over the
  same ground, route points within 3 m of the nearest are tried too and the cheapest wins. The
  confirm box shows the time rounded up to whole minutes and the metres; the clock is charged the
  exact seconds, once (`clock.charge` then `clock.moveCharged`).
- **Where it lands**: on the route, the last route point at least 5 m before the stop (5 to 8 m
  from it), looking at the stop, so the explorer is not put inside the beacon. In VR the room is
  turned about the head so the view faces the stop.
- **Layers** (`src/mission/layers.js`): names and credits are the mission file's `layers` list.
  Photo off draws the ground in the plain surface colour with its real shape. The slope hazard is
  a 1000 x 1000 one-byte texture (4 steps per degree) made from the same slope grid the route
  planner uses, sampled in the ground shader: amber from 10 degrees, red above 15 (from the
  mission file), mixed 62% over the lit ground. Both are uniforms, so switching does not
  recompile the shader. Default: slope off, everything else on.
- **Layer behaviour (the brief's section added on 2026-11-15, done in the B4 review)**:
  - Each chip has an eye (open = on, shut with a stroke = off) and an "i". Tapping the chip
    anywhere else switches the layer; the "i" swaps the credit lines for a one-line explanation
    and back. The explanations are short rewordings of the brief's layer list; their numbers
    (10, 15) and stop numbers come from the mission file.
  - The slope chip carries its legend (amber and red squares with the limits) and the note that
    15 degrees is an ASSUMPTION.
  - Rover traverse: the chip is on from the start and puts the path and its stops on the MAP. In
    the world the orange line stays hidden until `mission.layerSet.reveal('traverse')` is called;
    stop 3 (B6) must call it. Until then the chip says "map only until stop 3". After the reveal
    the chip switches the map and the world together. This changed B2's start-up picture (the
    orange line was visible from the start) and two checks of B2's own test.
  - Rover stops: `tools/build_mission.py` now also writes `traverse.waypoints` (the 43 waypoints
    of `data/stops/m20.json` inside the patch; nothing else in the mission file changed). They are
    small dots on the MAP and small six-sided studs on the ground (40, because some share a spot;
    960 triangles, one draw call, shown and hidden with the line).
  - Sample sites: every site in the mission file is at stop 4 or stop 5, so those are the only
    markers. Each has a three-sided sign reading "APPROXIMATE POSITION" on its tall post (one
    512 x 232 texture and one 18-triangle mesh for all three), readable from any side.
  - Panoramas: a camera icon beside the pin of the stop that has panoramas (stop 5) and in the map
    key. The chip only keeps its state for B7.
  - Backdrop terrain: no chip, always on, credited on the credits page as "(always on)".
    `mission.setLayer('backdrop', ...)` still exists for code (the cabin step may need it).
  - Credits page: "Missions covered" and every layer's source, all from the mission file.
- **Desktop teleport and the tablet**: while the tablet is up, T and the right mouse button start
  no teleport aim (`xr.hooks.desktopAim`); the aim ray would go through the tablet.
- **Sample-site markers**: a ring of six low-poly stakes, 2.6 m in radius, around each rover
  waypoint where a core in the mission file was taken (three places for five cores). A ring and
  not a pin because the positions are approximate, and because Berea's waypoint is exactly where
  the stop 4 beacon stands. They are in their own scene group (`mission-layer-objects`), not in
  `mission.group`, so `mission.stats()` still counts only the route, the rover path and the beacons.
- **Surface panoramas switch**: it keeps its state (`mission.layerVisible('panoramas')`) but
  shows nothing yet; the panoramas come with S5.
- **Cost**: tablet 128 triangles, 2 draw calls lit (plus 1 for the arrow, 1 for the hover light,
  and a dot and a beam per pointing controller), one 1280 x 896 canvas texture; sample markers
  516 triangles, 1 draw call, plus the signs (18 triangles, 1 draw call) and, once shown, the
  rover stop studs (960 triangles, 1 draw call); slope map 1 MB plus mipmaps.
