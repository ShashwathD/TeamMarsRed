# Data notes (step 1 audit)

Audit of `data/` done on 2026-11-15. No app code was written. Every number below was measured from
the files in this repo with a throwaway Python script (numpy + Pillow); nothing is estimated.

## What is in data/

| Path | Size | What it is |
|---|---|---|
| `sites.json` | 4 KB | List of 8 regional sites (jezero, gale, insight, columbia_hills, viking2, pathfinder, ius_chasma, meridiani) with bounds and source. Only 3 of them have a folder in `sites/`. |
| `activities.json` | 16 KB | 30 Perseverance sample-tube records (name, sol, rock type, lon/lat, NASA image link). |
| `layers/` | 200 KB | `traverses.geojson`: the Perseverance and Curiosity drive paths. `landing_sites.geojson`: 16 landing/crash points, all missions. |
| `stops/` | 204 KB | Rover waypoints with sol, lon/lat, elevation and heading: `m20.json` (703, Perseverance), `msl.json` (1384, Curiosity). |
| `pano/m20/` | 3.9 MB | 4 stitched Perseverance Navcam panoramas (JPEG) plus an index and per-panorama frame lists. |
| `sites/` | 7.2 MB | Coarse regional terrain for jezero (20 m), gale (32 m) and ius_chasma (about 5 m): `grid.bin` + `grid.json`, a `slope_hazard.png`, and for some sites `thermal.bin` (THEMIS) and, until 2026-11-15, `crism.bin` (jezero only; deleted as wrong, see "Minerals: data" in `DECISIONS.md`; the minerals are now in `walk/jezero_delta/minerals.json`). |
| `walk/` | 53 MB | Fine 2 m "walk" patches for jezero and gale: `dem.bin` + `walk.json` + photo tiles. There is no `jezero_delta` yet (that is step 2). |

## Walk patch format (data/walk/<site>/)

- `dem.bin`: 1000 x 1000 little-endian int16, exactly 2,000,000 bytes. Height in metres =
  `heightOffsetM + value * heightStepM` (step is 0.02 m). No-data value is -32768.
- Row 0 is the north edge, column 0 is the west edge. Spacing is 2 m, so the patch is
  2000 m x 2000 m (measured from the bounds with Mars radius 3,396,190 m: 2000.0 by 2000.0 m).
- Samples are cell-centred: sample (row r, col c) sits (2c+1) m east of the west bound and
  (2r+1) m south of the north bound.
- `walk.json` uses camelCase keys (`west`, `south`, `east`, `north`, `spacingM`, `heightOffsetM`,
  `heightStepM`, `nodata`, `start`, `tiles.rect`). `start` is the exact centre of the patch.
- `tiles/{level}/{x}/{y}.jpg`: 256 px greyscale JPEGs, levels 13 to 17. Jezero has 6, 16, 49, 182
  and 676 tiles at levels 13 to 17 (20 MB). Tiles are whole lon/lat tiles that overhang the patch,
  so the photo has to be cropped by longitude/latitude to `tiles.rect`.

## Jezero walk patch: measured results

Centred on the Octavia E. Butler landing site (lon 77.4509, lat 18.4446).

| Check | Result |
|---|---|
| Height range | -2609.86 m to -2544.78 m (65.08 m of relief, mean -2572.06 m) |
| No-data share | 0.0000 % (0 of 1,000,000 samples) |
| Ground steeper than 15 degrees | 0.817 % |
| Slope, other | median 3.2 degrees, 95th percentile 9.9 degrees, steepest 33.2 degrees |

Slope was computed from central differences on the 2 m grid.

Independent sanity check: the height at the patch centre is -2569.90 m, and the first Perseverance
waypoint in `stops/m20.json` (same lon/lat) lists -2569.9 m.

For comparison, the gale walk patch: -4529.46 to -4491.30 m, 0 % no-data, 0.388 % steeper than 15 degrees.

## Orientation check against the 20 m grid

The walk patch was averaged into 20 m blocks (100 x 100) and compared with
`data/sites/jezero/grid.bin` sampled at the same longitudes/latitudes (grid rows 292 to 391,
columns 291 to 390). Correlation of heights:

| Walk patch orientation | Correlation |
|---|---|
| As stored (row 0 north, col 0 west) | **0.9735** |
| Flipped north-south | 0.2160 |
| Flipped east-west | -0.0919 |
| Flipped both | -0.6505 |
| Transposed (rows and columns swapped) | 0.6606 |

So the stated orientation is confirmed: row 0 = north, col 0 = west, and the 20 m grid uses the
same convention.

Two things to carry forward to step 4:

- The walk patch is on average **1.84 m lower** than the 20 m grid (median 1.69 m, spread 2.38 m
  standard deviation, worst cells -15.2 m and +7.9 m). They come from different source terrain
  models (HiRISE 1 m vs CTX 20 m), so a constant offset will be needed where they join.
- Sliding the 20 m grid by one cell (20 m) south-east gives a marginally higher correlation
  (0.9753 vs 0.9735). That difference is too small to call a real misalignment, but it means the
  two datasets may be off by up to about 20 m horizontally.

## Regional grid format (data/sites/<site>/)

`grid.bin` is int16 like the walk DEM, but `grid.json` uses snake_case keys (`height_offset_m`,
`height_step_m`, `pixel_size_m`). Jezero is 562 x 593 at 20 m, no no-data cells, heights
-2651.1 m to -2246.9 m. It covers about 11.2 x 11.9 km around the walk patch.

## Picture

`docs/audit/jezero_height.png`: the jezero walk patch, 1000 x 1000 px (1 px = 2 m), north up.
Colour is height (dark brown low, pale high) with a hillshade lit from the north-west. No-data
would show as magenta; there is none.

## Not checked in this step

- The photo tiles were counted and one was inspected for format; they were not stitched or
  compared against the terrain (step 4).
- `thermal.bin`, `crism.bin`, the panoramas and `activities.json` were only inspected through
  their metadata, since this run does not use them.
- `data/sites.json` lists 8 sites but only 3 have data folders; I did not investigate why.
