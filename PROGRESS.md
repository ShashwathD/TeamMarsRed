# Progress log

Plain-English status after each step of the Jezero delta terrain work (branch `jezero-delta-terrain`).

## Step 1: Audit the data

Done. No app code was written in this step.

- Wrote `DATA_NOTES.md`, covering every folder in `data/` (sites.json, activities.json, layers, stops,
  pano, sites, walk).
- Decoded `data/walk/jezero/dem.bin` (1000 x 1000 little-endian int16, 2 m spacing, 2000 x 2000 m).
  Heights run from -2609.86 m to -2544.78 m (65.08 m of relief). No-data share is 0.0000%.
  0.817% of the ground is steeper than 15 degrees (median slope 3.2 degrees, maximum 33.2 degrees).
- Orientation confirmed against the 20 m grid in `data/sites/jezero/grid.bin`: correlation 0.9735 as
  stored (row 0 = north, col 0 = west), against 0.2160 flipped north-south, -0.0919 flipped east-west,
  -0.6505 flipped both ways and 0.6606 transposed.
- The 2 m walk patch is on average 1.84 m lower than the 20 m grid (median 1.69 m, standard deviation
  2.38 m). The two come from different source terrain models.
- Independent check: the patch-centre height is -2569.90 m, and the first Perseverance waypoint in
  `data/stops/m20.json` lists -2569.9 m.
- Height-shaded picture: `docs/audit/jezero_height.png` (north up, lit from the north-west). It was
  looked at: craters and the delta-front scarp read correctly.

Not verified, or worth knowing:

- Shifting the 20 m grid one cell (20 m) to the south-east gives a marginally higher correlation
  (0.9753 against 0.9735). That is too small to call a misalignment, but the two datasets may be up to
  about 20 m apart horizontally. To be re-checked in step 4.
- The photo tiles were only counted (182 at level 16 for jezero) and one was checked for format
  (256 px greyscale JPEG). They were not stitched or compared with the terrain in this step.
- `thermal.bin`, `crism.bin` and the panoramas were inspected through their metadata only.
- `data/sites.json` lists 8 sites but only jezero, gale and ius_chasma have folders in `data/sites/`.
  Not investigated.
- The analysis script lives in a scratch folder outside the repository and is not committed.

## Step 2: Build the new delta patch

Passed. The `jezero_delta` walk patch was built from the live public USGS files and is complete.

- Made a temporary config (kept outside the repository) holding only the Jezero entry from
  `pipeline/data/sites.json`, with id `jezero_delta` and walk centre lon 77.3903, lat 18.4722, 2 km.
- Ran, from `pipeline/`: `uv run --python 3.12 python -m marsmap walk --config <temp config> --out ../data`.
  It took 4 min 11 s, including installing Python 3.12.13 and 40 packages, and exited with code 0.
  The pipeline source was not modified.
- Output is in `data/walk/jezero_delta/`: 1000 x 1000 samples at 2 m (2000 x 2000 m), centred exactly
  on the requested point.
- No-data share: 0.0000% (0 of 1,000,000 cells). The pass limit was 2%.
- Heights: -2543.84 m to -2404.74 m (139.1 m of relief, median -2463.20 m).
- Slope: 13.11% of the ground is steeper than 15 degrees, 0.70% steeper than 30 degrees; median 6.26
  degrees, maximum 61.14 degrees.
- Photo tiles per level: 6 at level 13, 16 at 14, 49 at 15, 182 at 16 (none missing), 702 at 17. All
  are 256 px greyscale and none is blank.
- The level-16 photo cropped to the patch is 3145 x 3316 px, so it fits within the 4096 limit for step 4.
- Height-shaded picture: `docs/audit/jezero_delta_height.png`. The picture, a photo preview and two
  tiles were looked at: real delta terrain with layered beds, ripples and a dune-filled crater in the
  north-west.
- `data/walk/jezero/` was not touched: checksums of dem.bin and walk.json and the file count (931) are
  the same before and after.
- The centre did not need to be shifted toward the Perseverance traverse.
- `.gitignore` now also ignores `pipeline/.venv` and `__pycache__/` (both created by the pipeline run).

Not verified, or worth knowing:

- 0.43% of the level-17 photo inside the patch is near-black (0.07% exactly black), scattered in
  small pieces, the largest about 4,480 square metres near the south edge. They look like deep shadows
  beside scarps, but they were not checked against the source photo, so some could be true gaps in
  the photo. The terrain heights have no gaps.
- A straight brightness seam runs roughly north-south through the patch centre. It is in the USGS
  source photo and will be visible when the photo is draped in step 4.
- The slope figures come from our own check script (central differences on the 2 m grid), not from the
  pipeline's slope code.

## Step 3: Desktop terrain viewer

Done. The rotating-cube starter is replaced by a desktop terrain viewer (`index.html`, `style.css`,
`src/*.js`), plain HTML and ES modules with Three.js pinned through an import map, no build step.

- `?site=<folder>` picks the walk patch (default is still `jezero`; step 6 changes it). A missing site
  shows an error message instead of crashing.
- Frame: x east, z south, y up, origin at the patch centre. A temporary red "N" pole stands 60 m north
  of the start.
- Terrain at true scale, using every 3rd sample: 334 x 334 vertices, 221,778 triangles (222,788 drawn
  including sky and marker). Plain tan surface for now; the photo comes in step 4.
- Mars sky gradient, light haze, WASD + mouse walking at 1.7 m eye height following the ground.
- Automated test in headless Chromium: 61 of 61 checks passed across jezero, gale and jezero_delta,
  with no console errors, warnings or failed requests.
  - Ground height in the viewer matches the raw dem.bin at 7 sample centres (including all four
    corners) to 0.0001 m, and matches an independent calculation at 4 other points.
  - The north marker is centred on screen when facing north and absent facing south, east and west.
  - Real key presses move the player the right way, the camera stays 1.7 m above the ground, and the
    position stops at the patch edge (+/-999 m). Mouse look turned and pitched correctly.
- `README.md` run instructions are updated.

Not verified, or worth knowing:

- Tested only in headless Chromium with software graphics (about 10 frames per second there). Frame
  rate on a real graphics card was not measured; no real desktop browser and no headset was used.
- Only the jezero screenshots were looked at by eye. The jezero_delta and gale screenshots passed the
  automated checks but were not viewed, and jezero_delta was still being built while the test ran, so
  it should be retested now that step 2 is final.
- After the last small lighting change the full test was rerun and passed, but only one screenshot
  from that run was viewed.
- The test script and screenshots are in a scratch folder, not in the repository. It used a copy of
  playwright already installed elsewhere on this machine; nothing was installed.
- Three.js loads from jsDelivr, so the page needs an internet connection.
- Added beyond the brief: arrow-key turn/walk, Shift to run (15 m/s; walking is 3 m/s), a one-line
  on-page instructions strip (HTML, so invisible in VR) and an empty inline favicon.
- No-data cells would be left as holes and the player cannot step onto them. This is untested because
  all three patches have no gaps.
- The mesh spans the sample centres, so it is 1998 m wide, 1 m short of the nominal edge on each side.

## Step 4

Photo texture and distant terrain. Done for both `jezero` and `jezero_delta`.

- Photo: `tools/stitch_mosaic.py` stitched all 182 level-16 tiles of each patch into one
  `mosaic_16.jpg` in the patch folder, cropped by longitude/latitude to the patch bounds
  (jezero 3315 x 3145 px, 3.9 MB; jezero_delta 3316 x 3145 px, 3.0 MB; both under 4096). The page
  makes one photo request. The photo lines up with the terrain to within 2 m. The Mars tint is
  cosmetic.
- Distant terrain: the 20 m grid from `data/sites/jezero` surrounds the 2 m patch, placed by
  longitude/latitude. It has no triangles inside the patch.
- Height agreement where they overlap (fine minus coarse): jezero mean -1.84 m, spread 2.40 m;
  jezero_delta mean -2.00 m, spread 3.66 m. The viewer measures the mean at load and lowers the
  coarse grid by it. Recorded in `DECISIONS.md`.
- Level of detail: the patch is 256 chunks, full resolution under the player and coarser further
  away. Triangles drawn range from about 112k to 233k depending on position. Worst found by the
  reviewer's 120 x 120 position sweep: 232,956 (jezero) and 231,482 (jezero_delta), about 52k of
  that being distant terrain. Under the 300k limit.
- Textures: the one photo (sizes above) plus the 256 x 256 north-marker sign.
- Tests: 22 of 22 checks passed in headless Chromium at both sites with no console errors. Player
  height matches the full-resolution heights to 0.0001 m after teleports.

Corrected after review:

- The join between patch and distant terrain is not as tight as first reported (0.10 m / 0.31 m).
  The drawn height step at the edge is up to 0.84 m (jezero) and 2.62 m (jezero_delta). Skirts
  hide it: no see-through pixels in 38 test views. `DECISIONS.md` now carries the reviewed numbers.

Not verified, or worth knowing:

- Only headless Chromium with software graphics. Frame rate was not measured; no real graphics
  card and no headset was used.
- Draw calls: up to 155 in view from a patch edge, and 259-260 with the whole patch in view. This
  is the main untested frame-time risk on the Quest.
- The photo is soft when standing on it: level 16 is about 0.6 m per pixel, and level 17 would need
  about 6630 x 6290 px, over the 4096 limit. This will matter for the "photo is sharp" headset check.
- The line where the photo stops is visible as a change from detailed to smooth ground. Next to the
  patch the distant terrain also shows radial light/dark streaks and a dark diagonal crease from
  each patch corner. Cosmetic, not fixed.
- The coarse grid ends 3.4 km west of the delta patch centre, toward the crater rim; beyond that
  there is only haze. This will limit the step 6 view toward the rim.
- Possible depth flicker on far terrain (camera near 0.1 m, far 20,000 m). Calculated only, not
  observed; to be checked in step 5 or on the headset.
- Beyond the brief: the sun in `src/sky.js` was moved to the west and softened to match the shadows
  in the photo, the brightest highlights are compressed, and the photo's edge brightness fades into
  the distant terrain over 300 m. All cosmetic.
- `?site=gale` still loads with plain terrain but logs one 404 for its missing mosaic (out of scope).
- The two mosaics add 6.9 MB to the repository.
- The no-data path (holes) is still untested because no patch has gaps.
- The test script and screenshots are in a scratch folder, not the repository.

## Step 5

WebXR is added to the viewer (`src/xr.js`, `src/frameMeter.js`, changes in `src/controls.js` and
`src/main.js`). Nothing in this step has run on a real Quest 3S or any headset. All VR behaviour was
tested only with a headset emulator (iwer 2.8.0, Quest 3 profile) in headless Chromium with
software graphics.

What was done:

- VR button, local-floor reference space, desktop fallback kept. No smooth movement.
- Teleport: hold the trigger on either controller to aim (arc + ring marker), release to jump.
  It only lands on the walk patch and snaps to the ground height. Aiming off the patch gives a red
  arc, no marker and no move.
- Snap turn: 45 degrees per thumbstick push, one turn per push.
- Frame-time readout, hidden by default: F on desktop, A/B/X/Y in VR. It shows the average and the
  worst of the last 144 frames, and is drawn in the scene (on the camera on desktop, on the left
  controller in VR) because HTML overlays do not show in VR.
- The level of detail follows the head after every jump, and the floor follows the ground as the
  user takes real steps.

Measured (emulator only):

- 110 of 110 automated checks passed on jezero_delta and jezero, with no console errors.
- Head height above the floor equals the emulated headset height (1.600 m), also after a 1.1 m
  real step inside the room.
- 6 teleports per site (3 to 41 m): the head landed within 7 mm of a landing point computed
  independently from dem.bin; floor height error under 0.1 mm. The reviewer repeated this with 8
  aims: marker within 11 mm.
- Snap turn: exactly 45.000 degrees, head moved less than 1e-13 m. A half-pushed stick does nothing.
- Triangles after jumps: 192k to 227k, under the 300k limit.
- Re-levelling the terrain after a far jump took 7 to 9 ms on this Mac, in the same frame.

Choices not in the brief: arc speed 20 m/s (about 10 m reach aimed level, about 40 m aimed 45
degrees up); the page asks the headset for 72 Hz when it offers a choice; controllers are drawn as
plain white pointer sticks, not Quest models, to avoid a download from another server.

Known problems found in review, NOT fixed in this commit:

- Leaving VR does not restore the desktop field of view. Eye height (1.7 m) and window size come
  back, but the view stays wide-angle (70 degrees became 90 in the emulator) until the page is
  reloaded.
- The landing marker is hard to see: at 9.4 m the 0.3-0.4 m ring is only a few pixels tall. It is
  in the right place but may need to be bigger on the headset.
- Outside this step and unconfirmed: the photo may sit 1 to 2.5 m east of the terrain on sloped
  ground. Orientation is certainly right (no mirroring). The shift follows the sun direction in
  both patches, so it may be cast shadows in the measurement rather than a real offset.

Not verified:

- Frame time on the headset. The emulated runs took about 150-170 ms per frame in software
  graphics, which says nothing about the Quest.
- Real floor height, readability of the readout on the left controller, arc and marker visibility
  in stereo, flicker, whether the 72 Hz request is honoured, and the real Quest mapping for the
  A/B/X/Y buttons (assumed from the standard layout).
- A far teleport re-levels up to about 200 terrain chunks in one frame. On the Quest this may show
  as a one-frame hitch; there is no fade to hide it.
- Mouse look on desktop: headless Chromium refuses pointer lock, so only keyboard walking, strafing
  and arrow-key turning were tested after this step's changes.
- The first page load in a fresh headless browser logged four software-graphics performance
  warnings ("GPU stall due to ReadPixels"). They look like test-browser noise; there were no errors.
- The test script, the emulator install and the screenshots are in a scratch folder, not the
  repository. The shipped page does not reference the emulator.

## Step 6

Made the delta the default site, took the four screenshots, and prepared the folder for GitHub
Pages. Nothing was pushed. The real headset test is still open.

What was done:

- jezero_delta is now the default site; ?site=jezero still loads the old patch. The north marker
  now only appears with ?debug=1.
- Four screenshots (1600x900) are in docs/screenshots/, with positions and headings in its
  README.md:
  - Steepest spot: x -625, z 821, heading 241. A 10 m window there averages 51.8 degrees (steepest
    single sample 61.1).
  - Flattest spot: x 369, z 799, heading 0. A 30 m window there averages 0.73 degrees.
  - Toward the crater rim: x -789, z -227, heading 273.
  - Ground level: the start point 0, 0, heading 0.
- Added .nojekyll, PUBLISH.md (publish steps, Quest 3S steps, the six-item headset checklist) and
  CREDITS.md. README.md updated for the new default and the debug flag.

Measured:

- Subpath check: a copy of exactly the files git would publish was served at /TeamMarsRed/ and
  loaded four ways in headless Chromium (default, ?site=jezero, ?site=jezero_delta, ?debug=1).
  Each load made 19 requests (17 local, 2 to jsDelivr), all answered 200, no console errors.
- Triangles: 209,160 (jezero_delta) and 210,634 (jezero).
- Published size: 94.4 MB in 2,938 files, largest file 5.5 MB, no symlinks.

Known problems, NOT fixed in this commit:

- The crater rim crest is not in the data. The coarse grid ends about 3.4 km west of the patch
  centre and is still climbing there. The "toward the rim" picture points at the nearest ground at
  least 100 m above the patch centre (3.24 km away, bearing 273), which is the inner wall of the
  western rim. The 100 m threshold was our choice. The picture shows a faint ridge on the horizon.
- The steepest-spot picture looks along the scarp, not at it. A view from below made it too small.
- Ground within about 20 m of the camera looks blurred, because the photo is about 0.6 m per pixel
  (the 4096-pixel limit). It may read as "not sharp" on the headset.
- PUBLISH.md gives the wrong button text in two places. It says "VR NOT SUPPORTED" for an address
  without https; Three.js 0.170.0 actually shows "WEBXR NEEDS HTTPS" there, and "WEBXR NOT
  AVAILABLE" when the browser has no WebXR.
- The "frame time under 14 ms" check has almost no margin. The readout measures the gap between
  frames, which a 72 Hz headset holds at 13.9 ms at best, so one or two dropped frames in the
  average can read 14.0 ms or more on a healthy run. Judge by the "worst" figure and by readings
  near 27.8 ms rather than by the average alone.
- PUBLISH.md assumes the repository https://github.com/ShashwathD/TeamMarsRed. An anonymous
  request to it returned 404, so it is private or absent. Pages on a free account needs a public
  repository; PUBLISH.md says so in prose and gives a fallback, but has no numbered step for it.
- CREDITS.md: its statement that ?site=gale loads was not tested.
- The published site carries about 80 MB the viewer never requests (2,825 photo tile files, plus
  pipeline/ and web/). Within GitHub limits; left in place.
- Carried over from step 5: wide-angle view after leaving VR, small teleport ring, possible
  one-frame hitch after a long teleport.

Not verified:

- Nothing ran on a real Quest 3S or on real GitHub Pages. The subpath test used a local static
  server and headless Chromium with software graphics. VR was not re-tested in this step, not even
  in the emulator.
- The subpath test copy was made before the screenshots, docs/screenshots/README.md and the final
  PUBLISH.md wording existed. The page does not load those files.
- Whether the user can push to the assumed repository or turn Pages on there.

## After step 6: three small fixes

- Leaving VR now restores the normal desktop view angle (70 degrees). Fixed in `src/main.js`; the
  change is two lines and was not measured directly, only by the rerun below.
- The teleport landing marker is easier to see: it grows faster with distance and has a 1.2 m
  upright post, so it shows even when the ring is seen edge-on. Not looked at by eye or on a headset.
- PUBLISH.md now gives the real button texts ("WEBXR NOT AVAILABLE", "WEBXR NEEDS HTTPS").
- The emulated VR test was rerun on jezero_delta after these changes: 55 of 55 checks passed.
  It was not rerun on jezero.
- Still open: everything listed under steps 5 and 6 that needs a real Quest 3S.

## Desktop teleport added for testing

- Teleport was VR-controller only, so it could not be tried on a desktop browser. Added: hold T (or
  the right mouse button) to aim where you look, release to jump. It uses the same arc, marker and
  landing code as the VR trigger.
- Tested in headless Chromium: 4 keyboard aims and 1 right-mouse aim all moved the player (2 to 37 m)
  and landed within 6 mm of the marker at ground height; aiming off the patch showed the arc with no
  marker and did not move. One aim screenshot was looked at.
- The emulated VR test was rerun on jezero_delta afterwards: 55 of 55 passed. Not rerun on jezero.
- Still not tested on a real headset.

## Mission B1: mission data file

What was done:

- New tool `tools/build_mission.py` writes `data/mission/jezero_delta.json` from the team's brief
  (`docs/mission-brief.md`) and the data files. Run it with
  `uv run --python 3.12 --with numpy tools/build_mission.py` (needs numpy). Two runs give the same
  bytes. The viewer itself was not changed and does not read the file yet.
- The file holds the start spot, the five stations, the straight-line slope check, the rover path
  clipped to the patch, the five cores, the card texts with their `{placeholders}` and one-line
  sources, the four Field Check questions, the six assumptions and the layer credits.

Measured numbers (local metres, x east, z south):

| Station | x | z | Height (m) | Slope (deg) | From start (m) |
|---|---|---|---|---|---|
| START and S1 Briefing | 227.0 | -95.0 | -2460.4 | 0.9 | 0 |
| S2 Read the ground (provisional) | 168.8 | -73.7 | -2456.9 | 9.8 | 62.0 |
| S3 Follow the rover (provisional) | 213.5 | -187.9 | -2475.0 | 6.5 | 93.9 |
| S4 Berea: first core (approximate) | -354.9 | 117.9 | -2449.1 | 3.0 | 619.6 |
| S5 Ridge lookout (approximate) | 885.3 | 796.0 | -2522.5 | 9.1 | 1107.8 |

- Start spot: the flattest 30 m square within 300 m of the patch centre with no ground above
  15 degrees (average slope 1.0 degrees, 246 m from the centre).
- Straight lines: start to Berea 620 m, reaches 19.5 degrees; Berea to ridge 1413 m, 29.4 degrees;
  ridge to start 1108 m, 32.3 degrees. The first one is the S2 example, so `{direct_max_slope}` is 19.5.
- Rover path inside the patch: 4016 m in 3 pieces; `{sol_min}` 443, `{sol_max}` 764. The sols come
  from the rover waypoint list, because the path file has none.
- Igneous cores near the landing area: 8, sols 194 to 377.
- The two ridge panoramas are 20.1 m apart and 1413 m from Berea, as the brief says.
- `{route_km}`, `{extra_min}` and `{station_count}` are in the file but empty; step B2 fills them.

Review (a second, independent pass):

- Found and fixed: a 17 m piece of the rover path that only cuts the south-east corner was missing.
- Changed: `{sol_max}` was 763 (last waypoint inside the patch); it is now 764, because the rover
  was still driving inside the patch on the sol-764 drive that leaves it.
- An independent script recomputed everything from the raw files with its own code (start spot by
  brute force, positions on the sphere instead of the tool's linear map, slopes, sols, path length,
  card texts compared word for word with the brief): 71 checks pass.
- In headless Chromium on desktop: the file loads over HTTP, the player can be placed on every
  station and stands at the height in the file (within 6 mm), no console errors, 149,006 triangles
  (unchanged). The builder's test and the older emulated-VR test (55 of 55) also pass.
- The two outside sources were opened on 2026-11-15: NASA's Mars Rock Samples page matches the five
  cores, and the NASA EVA document has the "8 hours, 2 kilometers, 20 degree" sentence on slide 34.
  Details are in DECISIONS.md.

Not verified:

- Nothing ran on a real Quest 3S. B1 draws nothing new, so there was nothing new to see in VR and
  the screenshots show only the plain terrain.
- Only the five mission cores were compared with NASA's page, not the other 25.

Known problems:

- S2 and S3 positions are placeholders until B2 plans the route (marked `"provisional": true`).
- Steep ground starts 3 m from the S5 point on the way back to the start; B2 must route from a
  walkable cell.
- The NASA EVA document assumes about 2 km/h walking; our 3.3 km/h cap is the brief's ASSUMPTION.
- The wrong answers of the Field Check and the written-out Tobler formula are our wording, not
  from the brief (listed in DECISIONS.md for the team to veto).
- Which way the panorama images face (north column) is not recorded yet; B7 needs it.

## Mission B2: route, ribbon, beacons, rover path (2026-11-15)

What was done:

- The walking route is planned on the 2 m terrain: it never steps on ground steeper than
  15 degrees and is the fastest such path with the brief's pace rule. The same JavaScript file
  (`src/mission/route.js`) plans it in the data tool and measures it in the page. The planned line
  (1416 points) is stored in `data/mission/jezero_delta.json`, so the headset does not search at load.
- In the viewer: a blue ribbon on the ground with chevrons moving in the walking direction, the
  rover's real path as an orange line (can be switched off on its own), and five low-poly beacons
  with name labels that turn to the viewer (Airlock, 2 Read the ground, 3 Follow the rover,
  4 Berea: first core, 5 Ridge lookout).
- All mission code is in the new folder `src/mission/`, loaded from one place in `main.js`.
  `?mission=0` gives the plain viewer.

Measured numbers:

| Leg | Length (m) | Time (min) | Steepest ground (deg) |
|---|---|---|---|
| Start to S2 | 62.0 | 1.14 | 7.30 |
| S2 to S3 | 409.0 | 7.76 | 14.10 |
| S3 to S4 Berea | 202.1 | 3.68 | 7.15 |
| S4 to S5 ridge | 1520.8 | 27.67 | 14.29 |
| S5 back to start | 1235.0 | 24.09 | 14.55 |

- Whole route: 3429 m (`{route_km}` 3.4), 64.3 minutes walking. With 4 stops of 20 minutes
  (`{station_count}` 4) that is 144.3 of the 480 minutes.
- Steepest ground under the route: 14.55 degrees (limit 15). No station was on or cut off by steep
  ground; the route ends 0.87 m from the Berea position and 1.04 m from the ridge position (the
  nearest terrain sample).
- S2 comparison, start to Berea: the straight line is 620 m, 12.34 minutes and reaches
  19.5 degrees (`{direct_max_slope}`); the planned route is 673 m and 12.58 minutes, so
  `{extra_min}` is 0.2 (14 seconds).
- S2 is on the route 62 m from the start, at the route point nearest to where the straight line
  first gets too steep. S3 is where the route crosses the rover's path (sol-732 drive), 409 m on.
- Cost added: 15,816 triangles and 12 draw calls. Whole scene at the start, counting everything:
  241,808 triangles, 270 draw calls. In emulated VR, in view and summed over both eyes: 316,700
  triangles and 278 draw calls (285,468 and 262 with the mission hidden).

Review (a second, independent pass):

- An independent script (own code, raw terrain file) confirmed: every route step is a legal move
  on ground of 15 degrees or less; length, time and steepest slope per leg; the S2 and S3 rules;
  `{route_km}`, `{extra_min}`, `{direct_max_slope}`, `{station_count}`; and, with its own
  shortest-path search, that no faster route exists for any of the three legs. 28 checks pass.
- Fixed: the player started exactly on the Airlock marker, inside its pillar. The walk now starts
  on the route 6 m from it.
- Fixed: near the ridge the way out and the way back use the same ground for about 66 m, and the
  two ribbons lay on top of each other with chevrons pointing against the walker. Each direction
  is now drawn to its own right, side by side.
- Fixed: a label of a station standing behind another one was hidden; every second label now
  sits higher when seen from far away.
- Checked in headless Chromium, desktop: both ribbons are above the terrain that is actually
  drawn at every sampled point from five viewpoints (also far away, where the terrain is drawn
  coarser); beacon bases neither float nor sink; label text fits its panel; nothing is created
  or redrawn per frame; a missing mission file leaves the plain viewer working with a note.
  21 checks pass; 12 screenshots looked at.
- Checked in emulated VR: two eyes, labels are objects in the world and follow a real head move,
  chevrons move, no errors. 7 checks pass; 2 screenshots looked at.
- The builder's tests (25 desktop, 4 VR) and the older step-5 test (55 of 55) pass. The data tool
  gives the same file byte for byte when run again.

Not verified:

- Nothing ran on a real Quest 3S: frame rate, label legibility at 200 m in the headset, and
  flicker between ribbon and ground are untested there. All checks used software rendering.
- Label legibility at 200 m was judged from 1280 x 720 desktop screenshots only.
- The ribbon-above-terrain check samples points while standing at five places, not every view.

Known problems:

- `{extra_min}` is 0.2, so the S2 card reads "takes 0.2 more minutes". That is what the data
  gives; the team may want to reword the card or compare distance (54 m more).
- `{station_count}` is 4 (S2 to S5; S1 is the cabin briefing). The team can decide it should be 5.
- The route follows the terrain grid, so it bends in 45 degree steps and is up to about 8% longer
  than a smooth path. Lengths are map distances, not along the slope.
- The 14.55 degrees is the slope of the terrain samples under the route. Measured as the tilt of
  the surface between samples, the steepest spot is 15.1 degrees (see DECISIONS.md).
- The data tool now needs Node.js as well as Python.
- Far away the ribbon is lifted a little above the ground (4 mm per metre of distance) so the
  coarser distant terrain does not hide it; it can look slightly raised from the side.
- In VR the number of triangles drawn per frame over both eyes (about 317,000) is above the
  300,000 guide, and was close to it before this step (285,000). The scene itself holds 242,000.
- The rover path has no button yet; the tablet's LAYERS tab (B4) will switch it.
- Three checks in the old B1 test scripts (outside the repo) expect the B1 placeholders and now
  fail by design.
- Still open from B1: which way the panoramas face (B7), and 3.3 km/h against NASA's about 2 km/h.

## Mission B3: EVA clock and suit HUD (2026-11-15)

What was done:

- An EVA clock: 8 hours in total, 1 hour reserve, 20 minutes per station (all read from the
  mission file, all ASSUMPTIONS). Mission time does not follow real seconds. It is charged the
  walking time of the ground covered, at the brief's pace rule (Tobler x 0.8, capped at 3.3 km/h),
  whether that ground was walked, run or teleported. Standing still and turning cost nothing.
- Time to walk home: along the planned route (the quicker way round the loop) when within 30 m
  of it, otherwise the fastest slope-limited walk to the airlock.
- Margin = time left - reserve - walk home. Amber under 1 hour, red under zero, with a "RETURN"
  flash. Nothing stops: below zero the clock keeps counting and the walk goes on.
- A HUD strip floating 1.15 m in front of the head and 24 degrees below eye level. It is an object
  in the world: it stays put for small head turns and glides back in front after bigger ones.
  Real values: EVA left, walk home, margin, heading, slope underfoot, distance to the next
  station. Oxygen, battery and temperature are made up and labelled SIM.
- Short flashes near the top of the view (the only head-fixed thing, about 2.5 seconds): "SLOPE
  CAUTION" (amber from 10 degrees, red above 15), "SCAN", "SAMPLE SEALED", "RETURN".
- For later steps: `mission.clock` and `mission.hud.flash(kind)` (see README.md and DECISIONS.md).

Measured (headless Chromium, software rendering):

- At the start: 8:00 left, 0:01 to walk home, margin 6:59.
- Jumps of 79, 135, 305 and 894 m were charged 112, 189, 342 and 1000 seconds. A 20.8 m teleport
  in emulated VR was charged 22.7 seconds.
- Walk home from Berea 12.4 minutes; from the ridge lookout 24.1 minutes.
- The HUD adds 130 triangles, 2 draw calls (3 during a flash) and two canvas textures (2400 x 252
  and 1024 x 208). The strip is redrawn only when a shown value changes, at most 5 times a second.
- Whole scene, counting everything: 241,930 triangles, 272 draw calls. Emulated VR, in view and
  summed over both eyes: 305,000 to 314,000 triangles depending on the view.

Review (a second, independent pass):

- An independent script (own code, reading the raw terrain file) recomputed and confirmed: the
  cost of each jump, the VR teleport and a keyboard walk; walk-home time at the start, Berea and
  the ridge; walk-home time at three places 350 to 620 m off the route, using its own
  shortest-path search; the slope shown on amber and red ground; the amber and red thresholds to
  within a minute; the 20 minute stop charged once. 32 desktop checks and 18 emulated-VR checks
  pass.
- Fixed: while walking or running on desktop at a normal frame rate the strip fell behind the
  head (0.25 m too close when walking; behind the head when running). The slow test renderer had
  hidden this. The strip is now never more than 0.1 m behind.
- Fixed: a flash asked for while the HUD is hidden (the cabin, later) still appeared.
- Checked in emulated VR: entering and leaving VR, head turns, snap turns and 15 cm of head sway
  cost no mission time; the strip is a world object and does not move for a 25 degree head turn;
  looking 24 degrees down puts it mid-view.
- The builder's tests (34 desktop, 17 VR) and all earlier tests (step 5: 55 of 55, B2 and its
  review) pass. 9 screenshots looked at: text fits, colours right, nothing buried or overlapping.

Not verified:

- Nothing ran on a real Quest 3S. Whether the strip is readable in the headset (digits about
  4 cm tall at 1.15 m, labels about 1.5 cm), whether the trailing feels comfortable, the
  head-fixed flash, and the frame rate are all untested there.
- The strip following at 72 frames per second was checked by stepping the HUD code by hand, not
  by rendering at that rate.

Known problems:

- Amber and red are never reached on the planned walk (it uses about 2 h 24 min of 8 h). They
  were tested by charging the clock directly.
- The clock ignores real time by design. If the team wants a ticking clock, that is a rule change.
- An ordinary teleport is priced along the straight line, steep ground included (slow, not
  forbidden). The tablet teleport in B4 must charge the route time itself (recipe in DECISIONS.md).
- Off the route, the walk-home search took 43 ms on a desktop; on a Quest it may cause a
  one-frame hitch. It runs again only after moving 10 m or more.
- About 29% of the patch is 10 degrees or steeper, so roaming off the route shows the amber
  slope flash often (at most every 5 seconds). Not tuned on a headset.
- The strip does not follow looking up or down; on desktop it leaves the screen when looking up.
  Close objects can cover it; the flash draws over everything.
- "NEXT" is the straight-line distance and stays on S2 until a later step moves it on.
- `__mars.setPose` now costs mission time like a teleport; tests that do not want this should
  call `mission.clock.reset()` or `mission.clock.moveCharged(x, z)`.
- In VR the triangles drawn over both eyes are still slightly above the 300,000 guide (from B2;
  the HUD adds about 250).
- Still open from earlier steps: which way the panoramas face (B7), 3.3 km/h against NASA's about
  2 km/h, `{extra_min}` 0.2, `{station_count}` 4.

## Mission B4: forearm tablet, layers, map teleport

What was done:

- A low-poly tablet. On desktop Tab or Y slides it up and frees the mouse; in VR it is worn on
  the left controller and its screen lights with Y (left) or by looking down at it.
- Four tabs. MAP: the real photo with the planned route, the rover path and its stops, sample
  sites, a camera icon where panoramas are, a pin and a list button per stop, and a
  you-are-here arrow. Tapping a stop asks first and shows the cost; GO moves you there and
  charges the clock the walking time along the route, once. LOG: empty for now. LAYERS: one chip
  per layer with an eye (on or off), an "i" (one-line explanation), mission, instrument and
  source; the last page is the credits. HELP: Quest and desktop controls.
- A small UI kit (`src/mission/ui.js`) that later cards, the Field Check, the cabin console and
  the debrief can reuse.
- The right controller's ray and trigger tap the tablet. A press that lands on the tablet never
  starts a teleport. On desktop, T does not aim a teleport while the tablet is up.
- Slope hazard overlay on the ground: amber from 10 to 15 degrees, red above 15, limits read
  from the mission file.
- The review brought the tablet into line with the brief's new "layer behaviour" section: eye
  icons, "i" explanations, no chip for the backdrop terrain (always on, credited), the rover
  path hidden on the ground until stop 3 turns it on (it is on the map from the start), dots at
  the 43 rover stops, an "APPROXIMATE POSITION" sign at each sample site, a camera icon at
  stop 5, and a credits page.
- The mission data tool now also writes the rover stops into the mission file. Nothing else in
  that file changed.

Measured (headless Chromium with software rendering; VR emulated with iwer):

- Reviewer's desktop test 47 of 47, reviewer's emulated-VR test 17 of 17. Builder's desktop test,
  updated for the new section, all 60 checks pass; builder's VR test unchanged 26 of 26.
- Teleport cost checked against sums made from the raw terrain file: 1371.1 s from the start to
  stop 5, 521.0 s to stop 3 in VR; the clock was charged exactly that, once.
- The slope map's red share is 13.1%, the same as my own slope of the terrain file.
- Rover stops: 43 in the mission file, the same 43 from my own conversion of the waypoint file
  (worst difference 6 mm).
- Smallest text 42 px = 11.2 mm = 1.4 degrees at 0.45 m. No text cut short, off-screen or
  overlapping on any tab or page.
- Whole scene about 207,000 to 242,000 triangles depending on where you stand. Tablet 128
  triangles, sample markers and signs 534, rover stop studs 960.
- 25 frames with the tablet open: no canvas redraw, no new textures or geometries.
- I looked at 9 desktop and 4 VR screenshots: text fits, the tablet faces the eyes and reads
  upright on the raised arm, signs and studs sit on the ground.

Earlier tests:

- Step-5 regression, unchanged: 54 of 55. The one failure is "A shows the frame meter": with
  the mission loaded, A is now kept for scan. With `&tablet=0` it is 55 of 55.
- B2 builder test: 22 of 24. Both failures come from the rover path now being hidden at the
  start, as the new section asks. B2 reviewer test, B3 builder and reviewer tests: all pass.

Not verified:

- Nothing ran on a real Quest 3S. Where the tablet sits on a real forearm, whether the look-down
  timing feels right, legibility in the headset, the cost of redrawing the screen on a tap, and
  the frame rate are all untested there.
- The tablet's place on the arm is a reasoned guess from the emulator's controller profile.

Known problems:

- The uncommitted "layer behaviour" section of the brief appeared during this step. Neither the
  builder nor I wrote it; I followed it and committed it with this step. The team should
  confirm it is theirs.
- Stop 3 (B6) must call `mission.layerSet.reveal('traverse')`, or the rover path never shows on
  the ground.
- A, B, E and the grip do nothing yet; later steps fill them in. The panoramas chip only changes
  the camera icon on the map until B7.
- The teleport cost takes the quicker way round the loop, so from the start stop 5 is priced
  backward along the last leg (23 min) and not through stops 2 to 4 (40 min).
- A map teleport lands 5 to 8 m short of the stop and does not move "NEXT" on; that is B5's job.
- With no left controller in VR the tablet cannot be opened by the user (Y and the look-down both
  need it). The floating fallback works when opened by code.
- In VR the frame-time readout (a developer tool) sits on the left controller and may overlap
  the tablet. On a 1280 x 720 desktop window the status line overlaps the tablet's top nub.
- From some angles a short stake stands in front of a sample site's sign.
- In emulated VR about 302,000 triangles are drawn over both eyes at the start (about 151,000
  per eye), at the guide.

## Mission B5 to B8 and credits: built in parallel, then merged (2026-11-15)

Five steps were built at the same time on separate branches (`mission-b5`, `-b6`, `-b7`, `-b8`,
`-docs`), each reviewed by a second engineer, then merged into `marswalk-mission` in that order.
The five merges had no text conflicts. The sections below say what each step did, then what the
merge changed and what was tested on the merged page.

Nothing in any of these sections ran on a real Quest 3S. Every check is headless Chromium with
software rendering; VR is emulated with iwer. Frame rate, legibility, comfort and how a held
tube sits in a real hand are all unverified.

## Mission B5: station framework and stop 2

Done:

- `src/mission/stations/index.js`: the list of stations, which one is active (within 14 m of
  its beacon, off again 6 m beyond), the station card (above the forearm tablet in VR, right of
  the view on desktop), who gets a press (tablet and panels, then the station, then teleport),
  the right-hand hold, and completion (20 min stop once, done beacon, notebook entry, NEXT).
- Stop 2, Read the ground: the slope layer, then DIRECT and PLANNED signs and a white straight
  line to stop 4. DIRECT gives the slope caution; PLANNED adds the real time difference.
- `stations/tube.js`: the shared sample tube (96 triangles).

Measured (step's own review): straight line reaches 19.5 degrees; planned route 14.14 s longer;
route 3.4 km, 4 stops, all recomputed from the raw terrain file. Stop 2 is 768 triangles in 5
meshes. 30 desktop and 20 VR frames at a station: no card redraw, no new textures or geometries.

Known problems:

- DIRECT costs no time because the straight line is 14 s quicker on this terrain; PLANNED adds
  14.1 s on top of the normal movement charge. A penalty for DIRECT would be a new rule.
- The signs and the white line disappear about 20 m from stop 2, so the line cannot be followed.
- On desktop the card covers the upper right of the view and has no hide key (it hides while the
  tablet is up). At stop 5 it overlaps part of the stand's screen.
- With no left controller in VR the card stands in the world and slightly overlaps the HUD strip.

## Mission B6: stops 3 and 4

Done:

- Stop 3, Follow the rover: reveals the rover path on arrival; A / E sends a pulse along it
  toward the next stop, writes "Rover path scanned" and completes the stop.
- Stop 4, Berea: grip / G takes the tube from its holder; trigger / click at the marked rock
  with the tube held runs a 2.65 s simulated coring, flashes SAMPLE SEALED and writes the core's
  name, sol, size and type from the data. A press aimed at the rock never teleports.

Measured: stop 3 is 492 triangles in 1 mesh, stop 4 about 280 in 5 meshes. The rock stands
3.67 m from the route and 2.49 m from the rover path. A whole pulse creates no geometries,
textures or shader programs.

Known problems:

- The held tube leans 1.05 rad inside the framework's own hand tilt; in the emulator the two
  nearly cancel in VR. The pose in a real hand is unknown.
- Looking down at the rock from close up, the HUD strip crosses it (it does not block the click).

## Mission B7: stop 5 and the Field Check

Done:

- Stop 5, Ridge lookout: a pad with a see-through dome. Standing on it opens the 360 view of
  Skinner Ridge (sol 477) or Wildcat Ridge (sol 502), each a 4096 x 2048 stitched Navcam
  panorama loaded only when near; A / E switches ridge. A stand shows which ridge is up and holds
  four tubes; grip / G or a trigger on a tube logs that core (name, sol, length, type, where it
  is now, "retrieved 2026-09-29", "approximate").
- Field Check on the tablet after the four cores: four questions from the mission file, the
  right answer and its source shown after a wrong pick, score kept for the debrief, no penalty.

Measured: station objects 592 triangles, sphere 1,600. Inside the 360 view the emulated VR frame
is about 6,750 triangles over both eyes. Compass direction of the panorama confirmed against the
terrain for Wildcat Ridge (skyline correlation 0.98, mean error 1.3 degrees).

Known problems:

- The same compass check for Skinner Ridge was inconclusive (rover deck in the frame).
- The pad is about 10 m from where each panorama was really taken.
- With `?tablet=0` the Field Check cannot open, so stop 5 can never be done in that mode.
- Logging a core and switching ridge both flash SCAN; the brief names no HUD reaction here.
- From 4 m on a desktop window the stand screen is too small to read; it reads at about 1.2 m.
- The upload hitch of a 4096 x 2048 texture on a headset is unknown.

## Mission B8: cabin, DEPART, airlock, return, debrief

Done:

- `src/mission/cabin.js`: the experience starts in a low-poly rover cabin at the start spot:
  hologram table with a 0.9 m relief of the whole patch, the dotted route and the S1 briefing
  card, a console, a mission log panel, an airlock door with a red / green lamp.
- DEPART plays a starfield for about 6 s (the cabin does not move); then the door opens by B, by
  a click or by a trigger on it. Outside, the rover stands as a return marker: trigger / click on
  it from up to 40 m, or B within 8 m, goes back inside for the debrief (EVA time, distance,
  stations, cores, slope warnings, Field Check, a replay of the path taken).
- Inside: clock stopped, HUD hidden, no teleport, map jumps refused, the world hidden.
- `?skipcabin=1` starts outside as before.

Measured: cabin 2,954 triangles and 21 draw calls; marker 322 triangles. Emulated VR inside:
about 7,600 triangles over both eyes (11,700 after arrival, with the window view).

Known problems:

- After arrival the window shows a 33 x 33 low-poly copy of the terrain, not the terrain itself.
- In VR the user can physically step through the cabin walls; only desktop walking is clamped.
- The debrief console's small note lines (23 px) are 2.9 m from the standing spot in VR.
- Debrief distance includes teleports and map jumps (the console says so). After a short walk
  the replay line is tiny.
- B at the start spot does nothing (the rover is 9.8 m away, B works within 8 m).
- Lamp green 0x3fd07a is the one colour outside the shared palette.

## Credits and docs

Done:

- `src/mission/credits.js` and CREDITS pages at the end of the tablet's LAYERS tab (2 chip
  pages + 7 credits pages); no credit is split across a page turn.
- `CREDITS.md` rewritten with every data source, the fact sources F1 to F9; README controls and URL flags; a Quest 3S checklist in `PUBLISH.md`.
- Mission file: `cards.S5A.positionNote`, a retrieved date on the samples layer, new panorama
  credit wording. `tools/build_mission.py` reproduces the committed file byte for byte.

Known problems:

- There are no addresses for fact
  sources F2 to F6 because the repository has none.
- `PUBLISH.md` Part 4 was written from the brief before the code was merged; only the
  `skipcabin` note and the branch name were corrected at the merge.

## The merge

What the merge changed on top of the five branches:

- Stops 3, 4 and 5 now load through the framework's list; all four stops are real modules.
- One tube shape: stops 4 and 5 use `stations/tube.js`; their private copies are gone.
- `mission.stats.path`: the framework and the cabin wrote two different formats into the same
  array. The cabin's flat format is kept; the framework writes it only when there is no cabin.
- No station is active and no station card shows while inside the cabin. The S1 briefing shows
  on the cabin hologram only (outside at the start spot only with `?skipcabin=1`).
- Stops 3 and 4 give their control hint as `action` on the card; the framework now shows it as
  the "what to do now" line.
- The stop 5 card shows the mission file's `positionNote`. The longer panorama credit was cut
  off on the stand screen; it now wraps onto two lines.
- A refused tablet map jump now gives back the distance as well as the time.
- README controls and flags no longer say "planned"; DECISIONS.md has a section for these steps.

Tested on the merged page (server on port 8151):

- My combined walk-through (`merge/own/walk.cjs`), once on desktop and once in emulated VR:
  32 of 32 each, no console errors. It goes cabin, DEPART (mouse click / ray), door (B), then
  each stop by tablet map jump: stop 2 (A / E, then a click or ray on PLANNED), stop 3 (A / E),
  stop 4 (grip, then a click or ray at the rock, wait for the seal), stop 5 (onto the pad, A / E
  to switch ridge, grip four times, Field Check by taps with one wrong answer), back to the
  start, a click or ray on the rover, debrief. The debrief showed 4 of 4 stops, 5/5 cores, 3/4
  right, 3.44 km and 2 h 25 min. No trigger aimed at a sign, the rock or the rover started a
  teleport; no teleport or map jump worked inside the cabin.
- I looked at 12 desktop and 4 VR screenshots of that run (cabin card, signs, held tube, sealed
  rock, pulse, 360 view, Field Check, rover marker, debrief). Text is legible; nothing floats,
  is buried or overflows, apart from the known overlaps listed above.
- B5 reviewer tests: desktop 29 of 29, VR 13 of 13 (two desktop checks changed to complete stops
  4 and 5 by `stationSet.complete`, since those stops are no longer placeholders). B5 contract
  test, never run before: 6 of 7; the one failure is the test's own check (`ray.isRay` does not
  exist in Three.js). B5 builder tests: VR 10 of 10; desktop 24 of 29, all five failures being
  checks that expect placeholder stops.
- B6 reviewer tests, re-pointed at the real framework: desktop 30 of 31 (the failure is a
  texture count that went down by one, not a leak), VR 11 of 11.
- B7 reviewer tests, re-pointed at the real framework: desktop 52 of 53 (the failure is a check
  I mis-edited; the same fact passes in the combined test), VR 16 of 16. The first run found a
  real fault: the longer panorama credit was cut off on the stand screen (fixed, see above).
- B8 reviewer tests: desktop 42 of 42, VR 21 of 21. B8 builder tests: 42 of 42 and 21 of 21.
- Credits tests: reviewer desktop 54 of 54, VR 24 of 24, builder desktop 27 of 27.
- Earlier steps, with `?skipcabin=1`: B4 reviewer desktop 46 of 47 and VR 16 of 17 (both
  failures are the old single-page credits checks, replaced by the credits tests), B4 builder VR
  26 of 26, B3 reviewer 32 of 32 and 18 of 18, B2 reviewer 20 of 20 and 7 of 7, step-5 with
  `&tablet=0` 55 of 55.
- The docs, B8 and regression runs were made before two late one-line changes (the `action`
  line on the card, the two-line panorama credit); the combined test, B5, B6, B7 and B8 reviewer
  desktop tests were run again after them.

Measured on the merged page:

- Whole scene from the start spot: 235,508 triangles, 288 draw calls (141,018 and 131 in view).
- Station objects: stop 2 768 triangles, stop 3 492, stop 4 278, stop 5 2,240 (sphere included).
- Emulated VR, triangles and draw calls over both eyes: start 302,308 / 298; stop 2 301,692 /
  286; stop 3 299,368 / 200; stop 4 288,736 / 154; stop 5 off the pad 202,348 / 64. The start
  and stop 2 are at the ~300k guide, as they were before these steps.

Not verified:

- Anything on a real Quest 3S.
- The B6 and B7 builders' own tests, the B2 and B3 builders' tests and the B4 builder's desktop
  test were not rerun (the reviewers' versions were).
- Walking between stops on foot: the combined test moves by tablet map jump and one direct move
  onto the stop 5 pad. Earlier steps tested walking and arc teleports separately.
- Mouse clicks with the mouse captured (pointer lock) on the cabin door and the rover.

## Mission B9 (part 2): content, layer and low-poly audit

Method: one headless desktop run through the whole mission (cabin, DEPART, door, stops 2 to 5,
Field Check, return, debrief) that saved every text canvas as an image (87 canvases: cabin
panels in each phase, every tablet page, the five "i" lines, all credits pages, station cards,
stand screen, HUD strip and flashes, beacon labels, signs) plus 42 scene screenshots, and a
second shorter run after the fixes. All images were looked at. Desktop only; no emulated-VR run
was made for this part, and nothing ran on a real headset.

Content (rules 1 to 7):

- Card texts S1 to S5B and the four Field Check questions match the brief; every card and the
  debrief end with a source line; ASSUMPTION is on the S2 card, the slope chip, the cabin
  console, the map-jump box and the credits; SIM is on the three HUD suit values and the console.
- {braced} values: a search of `src/` for the computed numbers, core names, sols and dates found
  none typed into shown text; they come from the mission file or are computed in the page.
- Fixed: the notebook line of a logged core at stop 5 ended "Position approximate." and that
  word was cut off on the tablet LOG ("... Position") and the cabin log ("Position appr...").
  The entry is now two short lines with "approximate position" on the first; the ridge name is
  no longer in the notebook line (it stays on the stand screen).
- Fixed: the stand screen said "Shown in its true compass direction."; the compass check was
  only conclusive for Wildcat Ridge, so it now says "Turned to its compass direction."
- Fixed: the two-line source on the slope and sample-site chips touched the chip's lower edge.
- HELP tab: scan now says "at stops 2, 3 and 5", grip says "Take or stow a sample tube".
- No text overflowed a canvas in either run (checked by a draw-call recorder and by eye).

Layer behaviour, item by item (all as the brief asks, nothing to fix): photo on, slope off with
legend, eye icons and "i" one-liners on all five chips; rover path on the map from the start
and on the ground (with stop dots) only from stop 3; sample markers only at the stop 4 and
stop 5 sites, each with an APPROXIMATE POSITION sign; camera icon at stop 5 and the 360 view
only on its pad; backdrop has no chip and is credited "always on"; missions covered listed;
the route is not a layer.

Low-poly look: cabin, console, joystick, window frame, hologram table, door and lamp, tablet
body, HUD frame, beacons, sample markers, tubes, coring rock, tube holder, stop 2 signs, stop 5
pad and rack, and the return rover were each looked at in screenshots and in the code (boxes,
cylinders of 3 to 8 sides, icosahedra of detail 0 or 1, one flat-shaded material, the shared
palette). Nothing needed changing.

Credits and docs:

- The app's credits gained two lines that `CREDITS.md` already had ("Mission code", "EVA
  clock"); the two now match word for word. LAYERS is 2 chip pages + 8 credits pages.
- README: removed "belong to later steps" / "set by later steps"; says the experience starts in
  the cabin and that `tablet=0` leaves stop 5 unfinishable.
- PUBLISH.md: Parts 2 and 3 now say they are for the plain viewer (`?mission=0`), since the
  default page starts in the cabin; mission flags added to the address list; Part 4 no longer
  says it was written before the code, and items 9 to 13 describe the controls as built (A for
  the slope layer and DIRECT / PLANNED signs, grip pressed once not held, four grip presses at
  the rack, Field Check opening by itself, the rover as the return marker).

Known problems:

- Stop 2: choosing DIRECT gives the red SLOPE CAUTION but charges no time (the straight line is
  the quicker one); the brief says "the time cost". The card says what the planned route costs.
- The cabin console in the briefing, transit and arrived phases is an instruction panel and has
  no source line (it carries the ASSUMPTION and SIM note).
- Older test scripts that expect 7 credits pages or the old notebook wording will fail.
- PUBLISH.md Part 1 still names the branch `jezero-delta-terrain` in its push commands.

## Mission B9 (part 1): end-to-end runs, fixes and performance

Everything here ran in headless Chromium with software rendering; VR was emulated with iwer.
Nothing ran on a real Quest 3S.

End-to-end playthroughs (new test `b9a/e2e.cjs`, one run on desktop choosing DIRECT at stop 2,
one in emulated VR choosing PLANNED; 59 checks each, all pass, no console errors or warnings):

- Cabin briefing; B, scan and grip refused; the tablet opened inside (Y), all four tabs, a map
  jump refused with nothing charged; DEPART by mouse click / ray; door refused in transit; the
  6 s transit left to run its own course; door by B (desktop) and by a ray on the door sign (VR).
- To stop 2 by seven real teleports along the route (T on desktop, the trigger arc in VR), then
  A / E for the slope layer and a click / ray on the DIRECT or PLANNED sign.
- Stop 3 scan (and a second scan, which costs nothing). Stop 4: a trigger at the rock before
  taking the tube (no coring, no teleport), grip, grip again to stow, grip, trigger at the
  rock, sealed. Stop 5: a real teleport onto the pad, A / E and a click / ray on the stand
  screen to switch ridge, four tubes by grip (a fifth adds nothing), the Field Check with one
  wrong answer, all nine taps by mouse (desktop) or by the right-hand ray on the tablet (VR).
- Map jump to the airlock, return by a click on the rover (desktop) or B at the start spot
  (VR), debrief, out through the door again and back in.
- The test keeps its own ledger from the raw terrain file (its own slope grid, walking pace,
  route sums and landing rule; nothing imported from `src/`) and compares after every stop and
  at the debrief. Desktop / DIRECT: 8669.3 s and 3435.7 m on the page against 8669.3 s and
  3435.7 m of my own; 4 of 4 stops, 5/5 cores, 3/4, slope warnings amber 1, red 1 (the red one
  is the DIRECT choice). VR / PLANNED: 8685.1 s and 3437.3 m against 8684.3 s and 3437.3 m;
  amber 1, red 0. The 0.8 s gap is the PLANNED surcharge: the page charges 14.1 s, my own sum
  along the straight line gives 13.3 s (a different sampling step). The console text showed
  "2 h 24 min" / "2 h 25 min", "3.44 km", "4 of 4", "5/5", "3/4 right" as expected.
- I looked at 14 screenshots of the two runs (tablet in the cabin, outside start on desktop and
  in VR, stop 2 signs, stop 4, the 360 view, the wrong-answer page, both debriefs, the zero
  debrief, the tablet after LATER) and 3 of the horizon after the backdrop change.

"Never stuck" run (new test `b9a/edge.cjs`, desktop, 33 checks, all pass, no console errors):
every key and three mouse clicks (left and right) in the briefing, in transit and outside; an
immediate return (debrief with zeros, "not taken", no NaN) and out again; a tablet jump to
every pin from every other pin (20 jumps, each cost equal to my own sum; the clock ended over
8 h and nothing stopped working); stop 5 first with stops 2 and 3 skipped (NEXT then points at
stop 2, not the airlock); panoramas layer switched off inside the 360 view; leaving stop 5 with
a tube in the hand; leaving stop 4 holding the tube and in the middle of coring (sealed, counted
once); Field Check LATER, reopened from the stand screen, tablet closed and opened half-way,
an answered question tapped again, REVIEW; an early return with 2 of 4 stops; the skipped stops
done late; the final debrief.

Fixed:

- B at the walk's start spot did nothing (the rover is 9.8 m away, B worked within 8 m), and a
  tablet jump to the airlock lands exactly there. B now works within 12 m.
- After LATER on the Field Check the card kept saying "Take the Field Check on the tablet",
  but the tablet no longer showed it. The card now says "Select FIELD CHECK on the stand
  screen: it opens on the tablet."
- With `?tablet=0` stop 5 could never be done; without a tablet the four logged cores now
  finish it.
- Backdrop terrain: it was one 51,622-triangle mesh, always drawn whole. It is now 22 pieces
  (8 compass sectors by 3 distance bands) that share one vertex buffer, so pieces behind the
  viewer are culled. Same triangles, same look; `surround.mesh` is now a Group.

Performance, emulated VR, triangles / draw calls summed over both eyes (new `b9a/perf.cjs`):

| state | first view after arriving, before | same view, after | worst of 8 headings, after |
| --- | --- | --- | --- |
| cabin, briefing | not measured | 7,936 / 36 | 7,936 / 36 |
| cabin, arrived (window view) | not measured | 12,008 / 32 | 12,008 / 32 |
| cabin, debrief | not measured | 12,048 / 36 | one heading only |
| outside, start spot | 302,308 / 298 | 244,716 / 314 | 262,832 / 314 |
| stop 2, slope layer on | 301,692 / 286 | 245,640 / 314 | 263,252 / 314 |
| stop 3, rover path on | 299,368 / 200 | 242,860 / 222 | 294,320 / 342 |
| stop 4 | 288,736 / 154 | 233,388 / 172 | 289,280 / 396 |
| stop 5, off the pad | 202,348 / 64 | 150,068 / 84 | 317,520 / 578 |
| stop 5, inside the 360 view | not measured | 6,644 / 24 | 7,116 / 28 |

- The one state over the ~300k guide is stop 5 off the pad when looking north-west across the
  whole patch from its corner: 317,520 triangles and 578 draw calls (289 per eye), nearly all
  terrain chunks. Not changed: it would mean retuning the viewer's level-of-detail distances.
- Textures: 21 at most (in the 360 view). Largest: the panorama 4096 x 2048 and the photo
  3316 x 3145; all others are UI canvases of 2400 x 252 or smaller. One panorama is held at a
  time, plus the other after the first switch; both are freed on leaving the stop.
- Over 30 still frames in every state: no canvas redraw (tablet, station card, cabin panels,
  stand screen, HUD strip), no new texture, no new geometry.
- Chrome's sampling heap profiler over 40 to 150 frames in five states (cabin, transit, start
  spot, stop 3 pulse, 360 view; `b9a/alloc.cjs`): no allocation attributed to any function in
  `src/`, except 7 bytes per frame during the transit. What remains comes from the emulator.

Regressions after the changes: the merge walk-through 32 of 32 on desktop and in VR; step-5
viewer regression (`&tablet=0`, emulated VR) 55 of 55; B2 reviewer desktop 20 of 20; B3
reviewer desktop 32 of 32; B5 reviewer desktop 29 of 29; credits desktop 56 of 56; B4 reviewer
desktop 46 of 47, B6 reviewer desktop 30 of 31 and B7 reviewer desktop 52 of 53 (the same known
test-expectation failures as before). B8 reviewer tests now fail 2 (desktop) and 3 (VR) checks,
all of them "B at the spawn does nothing" and the steps that follow it: the behaviour changed
on purpose (first fix above); the tests were not edited.

Not verified:

- Anything on a real Quest 3S: frame rate, the 578-draw-call view at stop 5, legibility,
  comfort, the panorama upload hitch.
- Walking with W/A/S/D between stops (the runs use real teleports to stop 2 and onto the stop 5
  pad, and tablet jumps for the long legs).
- Mouse clicks with the mouse captured (pointer lock) on the door, the rover and the signs:
  headless clicks were made with the pointer free.
- The other VR regressions (B2 to B7 reviewer VR tests, credits VR) were not rerun after these
  changes; the VR end-to-end run, the merge VR walk-through and the step-5 VR regression were.

## Mission B9: final check

Run against the committed tree (794fefd, nothing uncommitted), headless Chromium with software
rendering; VR is the iwer emulator. Nothing ran on a real Quest 3S.

- End-to-end playthrough, desktop, DIRECT at stop 2: 59 of 59 checks, no console errors or
  warnings. Debrief 8669.3 s and 3435.7 m, the same as the test's own sum; 4 of 4 stops, 5/5
  cores, Field Check 3/4, slope warnings amber 1, red 1.
- End-to-end playthrough, emulated VR, PLANNED at stop 2: 58 of 58 checks (the DIRECT-only
  caution check does not apply), no console errors or warnings. Debrief 8685.1 s and 3437.3 m
  against an own sum of 8684.3 s and 3437.3 m (the 0.8 s is the PLANNED surcharge, as before);
  4 of 4 stops, 5/5 cores, Field Check 3/4, slope warnings amber 1, red 0.
- Subpath check: the 2,961 files `git ls-files` lists (97 MB) copied to a folder named
  `TeamMarsRed` and served from its parent, as GitHub Pages does. Both `/TeamMarsRed/` and
  `/TeamMarsRed/?skipcabin=1` reached ready and drew 40 frames with 39 responses each, no 404,
  no failed request, no console error or warning, and no request outside the subpath. The only
  outside addresses are the two Three.js 0.170.0 files from the import map.

Not covered by the subpath check: files loaded later in a walk (far terrain chunks, the
panoramas). No address in `index.html` or `src/` starts with `/`, and the server log of the
check shows no 404.

## Minerals: CRISM layer and mineral-sampling objective (2026-11-15)

Built (five parts, merged into one commit):

- **Data.** `tools/build_minerals.py` reads the Zenodo GeoTIFF (Parente, Saranathan and Itoh
  2021, CC BY 4.0), snaps every pixel to the nearest key colour and writes
  `data/walk/jezero_delta/minerals.json`: classes, five groups with colours, the 59 x 55 grid,
  percentages, ten candidate deposits and the group under each station. The old
  `data/sites/jezero/crism.bin` and `crism.json` were wrong and are deleted (why: `DECISIONS.md`,
  "Minerals: data").
- **Layer.** A "Minerals" chip on the tablet's LAYERS tab (off at the start, eye, "i" line,
  legend), a translucent overlay on the ground from one 59 x 55 texture (no extra geometry), a
  credits entry, and the line "Orbit says: <group> (CRISM, approximate)" on the cards.
- **Cabin.** A wall map on the right-hand wall with the mineral groups over the photo, the
  stations, ten deposit pins and rows, a legend, the plan summary, CONFIRM and CHANGE; a sample
  shelf with three slots by the airlock. The door stays shut until three deposits are confirmed.
- **Route.** The route is re-planned through every station in the stored order plus the three
  deposits, each placed where it adds the least walking, every leg by the existing A* under 15
  degrees. The ribbon, tablet MAP, HUD NEXT, walk-home time and cabin hologram follow it.
- **Sampling.** A marker at each picked deposit, collect by click / trigger or G / grip, a carry
  slot with labelled containers, a LOG line per sample, shelving in the cabin, the complete
  state, a debrief card and a next-spot page.

Checked (headless Chromium, software rendering, served from the working copy):

- Desktop end to end, DIRECT at stop 2: 85 of 85 checks, no console errors or warnings. The run
  is the earlier 59-check playthrough with the mineral steps added: door refused before picks;
  three picks by mouse (two rows, one pin); a fourth refused; picks changed and changed back;
  CONFIRM; all four stations as before; the three deposits collected (two by click, one by G);
  return; containers shelved three ways (container then slot, click on a slot, G); mission
  complete; debrief card; next-spot page and back. The debrief time and distance equal the
  test's own sum (13101 s, 4085 m) with 20 min charged once per deposit.
- The same run with PLANNED at stop 2: 84 of 84.
- The same run in the emulated headset (iwer, Quest 3 profile), ray and trigger for everything
  and grip for one collect: 84 of 84.
- Different picks change the route and the cost: D3 D4 D6 gives 4239 m and 219.6 min of EVA
  (order START S2 D4 D3 S3 S4 S5 D6 START); D2 D3 D8 gives 5228 m and 239.5 min (order START S2
  D3 S3 S4 D8 S5 D2 START). Both keep the reserve. Steepest ground on them: 14.7 and 14.9 degrees.
- `?skipcabin=1`: starts outside on the stored 1416-point route, no picks, no markers, NEXT is
  S2, no console errors.
- The Minerals chip's eye switches the overlay on the ground; the "i" shows the info line.
- Looked at: the wall map, the door sign, a deposit marker with the carry slot, the full shelf,
  the debrief card, the next-spot page, the hologram, the tablet chip, the high view.

Results against the brief's expected results (not tuned):

| | Expected | Built |
|---|---|---|
| Pixels | 3,304 | 3,245 (59 x 55) |
| Olivine + clay | about 62% | 63.11% (Olivine + smectite alone 61.66%) |
| Unclassified | about 20% | 19.60% |
| Carbonate | about 6% | 5.86% |
| Kaolinite | about 5% | 5.08% |
| Fe/Mg-smectite | about 4% | 4.07% |
| The rest | about 4% or less | 2.28% (Low-Ca pyroxene 2.00, High-Ca pyroxene 0.15, Olivine 0.09, Mg-smectite 2 0.03) |
| Stations | all five on Olivine + smectite | START, S3, S4, S5 yes; S2 on Unclassified |
| Carbonate patch | about 3.5 ha near 77.3887 E 18.4708 N | 3.50 ha, 27 pixels, centre 77.38871 E 18.47082 N: in the data, but not one of the ten candidates |

Candidate deposits: D1 Olivine + clay 248.31 ha; D2 Clay 16.59; D3 Carbonate 8.29; D4 Carbonate
1.68; D5 Carbonate 1.04; D6 Clay 1.04; D7 Olivine + clay 0.91; D8 Olivine + clay 0.91; D9
Carbonate 0.78; D10 Volcanic 0.39.

Mismatches:

1. 3,245 pixels, not 3,304: the tool counts pixel centres inside the patch (55 rows); rounding
   the window start and length separately gives 56 rows. The percentages agree either way.
2. S2 is on Unclassified, so the stations do not all return one group. Its pixel is a dark blend
   that is nearer black than the Olivine + smectite colour.
3. The 3.5 ha carbonate patch is 77 m from D1's marker, under the tool's 80 m spacing rule, so
   it is not offered as a candidate.
4. Areas use 36 m x 36 m per pixel as the brief says; on the ground a pixel is about 34 m wide
   east-west at this latitude, so areas read about 5% high.
5. D1 is one connected patch covering most of the area; D1 and D2 touch the patch edge.

Overlay alignment:

- The overlay is drawn where the georeferencing puts it. In a top-down render at 2 m per pixel,
  every drawn overlay pixel is one the georeferencing says is classified (100.00%; 99.79% the
  other way), and the carbonate patch near 77.3887 E 18.4708 N is drawn within 2 m of where its
  cells should be.
- Against the photo itself the check is weak. At the dune field in the north-west, the strong
  Olivine + clay block ends at the dune field's east and south edges to within about one 36 m
  pixel by eye. A shift search (how well the classes predict photo brightness and texture) for
  the dune field and for the clay area in the east gave broad best values within 36 m of zero
  shift, in different directions for the two areas. So no shift bigger than about one CRISM
  pixel shows, and a shift smaller than that cannot be ruled out. Nothing was nudged.

SOURCE NEEDED lines: none.

Not verified:

- Anything on a real Quest 3S: frame rate with the overlay on, wall-map legibility (smallest
  text 22 px), the pause while a route is searched, comfort.
- VR only as far as the emulator: ray and trigger on the wall map, markers and shelf, grip to
  collect, and (independent check, below) grip-grab of a container released at a shelf slot.
- Walking between stops with W/A/S/D (the runs use teleports, tablet jumps and direct moves).
- GO on the next-spot page (it reloads the page with `?site=<id>`): the rows were checked, the
  reload was not.
- The earlier B2 to B8 reviewer tests were not rerun. Any that open the airlock straight after
  arrival will now need three picks first.
- The browser test log shows the three HEAD requests of the next-spot check as "failed"
  requests although they answer 200 and the rows are right; not looked into further.
- The tablet MAP does not draw the minerals (the wall map and the ground overlay do).

Independent check (after the integration, same day):

- Recomputed from the cached GeoTIFF with a separate script: 59 x 55 = 3,245 pixel centres in
  the patch, every class and group percentage equal to `minerals.json`, all 3,245 grid cells
  equal, the same group under START, S2 (Unclassified), S3, S4, S5 and under every deposit
  marker, and a 27-pixel (3.50 ha) carbonate patch at 77.3887 E 18.4708 N.
- Desktop playthrough with other picks (D5, D10, D2; preview D1, D5, D7): 83 checks pass, no
  console errors. Order walked START S2 S3 S4 S5 D2 D5 D10 START, planned 4,325 m and
  222.0 min (82.0 walking + 4 x 20 + 3 x 20). Debrief: 4 of 4 stations, Clay / Carbonate /
  Volcanic shelved, EVA 13,529 s against 13,529 s summed by the test, shown as 3 h 45 min.
- Emulated VR (`?skipcabin=1`, iwer): door refused without picks, three picks by controller
  ray and trigger (two rows, one pin), a fourth refused, CONFIRM, door sign, one deposit
  collected by trigger on its marker (20 min charged once), container grabbed with the grip
  and released at shelf slot 2. 14 checks pass.
- Triangles / draw calls with view culling off, before this part and after: cabin 3,886 / 16
  and 4,034 / 19; outside at the start 235,508 / 309 before, after, and with the Minerals
  layer on (one more texture, no geometry). Not measured with the three deposit markers out.
- Fixed: the mineral debrief hint no longer starts with "No fail state:"; CREDITS.md keeps
  its sentence "The other three:" unchanged, with the minerals entry after that list.
