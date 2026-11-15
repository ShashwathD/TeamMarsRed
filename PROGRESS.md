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
