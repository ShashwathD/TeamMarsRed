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
