# Progress log

Plain-English status after each step of the Jezero delta terrain work (branch `jezero-delta-terrain`).
Note: the brief said to read CLAUDE.md first. There is no CLAUDE.md in this repository, so the
constraints from the brief itself were used instead.

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
- CREDITS.md credits an "open source Team Protikriti project". Nothing else in the repository
  mentions that name and there is no licence file, so the claim is unverified. CREDITS.md asks the
  team to add the licence and link. Its statement that ?site=gale loads was not tested.
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
