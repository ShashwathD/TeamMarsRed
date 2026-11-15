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
