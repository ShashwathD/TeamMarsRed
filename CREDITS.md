# Credits

Everything the terrain viewer shows or loads, and where it comes from. Only sources that the
viewer actually uses are listed here; the wider list for the original map project is in
`docs/data-sources.md`.

## Mars data

- **Walk-patch terrain (2 m), `data/walk/jezero/dem.bin` and `data/walk/jezero_delta/dem.bin`.**
  USGS Astrogeology Science Center, Mars 2020 Terrain Relative Navigation HiRISE digital terrain
  model mosaic of Jezero crater, 1 m per pixel (shown here at 2 m), file
  `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif` from
  <https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/>. Made from images taken by the
  HiRISE camera on NASA's Mars Reconnaissance Orbiter. Credit: NASA/JPL-Caltech/University of
  Arizona/USGS.
- **Ground photo, `data/walk/<site>/tiles/` and `mosaic_16.jpg`.** USGS Astrogeology Science
  Center, Mars 2020 Terrain Relative Navigation HiRISE orthomosaic of Jezero crater, 25 cm per
  pixel, file `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif` from the same
  address. The viewer uses it at about 0.6 m per pixel. The photo is greyscale; the Mars colour in
  the viewer is a tint added for looks. Credit: NASA/JPL-Caltech/University of Arizona/USGS.
- **Distant terrain (20 m), `data/sites/jezero/grid.bin`.** USGS Astrogeology Science Center,
  "Mars 2020 Science Investigation CTX DEM Mosaic", 20 m per pixel, made from stereo images taken
  by the Context Camera (CTX) on NASA's Mars Reconnaissance Orbiter
  (<https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic>).
  Credit: NASA/JPL-Caltech/MSSS/USGS.

The `gale` walk patch in `data/walk/gale/` (USGS MSL Gale merged terrain model, 1 m) also loads
with `?site=gale`, but it was not part of this work and has no stitched photo.

## Software

- **Three.js 0.170.0**, the 3D library, loaded from the jsDelivr network
  (<https://cdn.jsdelivr.net/npm/three@0.170.0/>). MIT License, copyright 2010-2024 three.js
  authors. Licence text: <https://cdn.jsdelivr.net/npm/three@0.170.0/LICENSE>. The viewer also uses
  its `VRButton` add-on, same licence.
- **Terrain data files and the data pipeline** (`data/` and `pipeline/`)
  come from the open source **Team Protikriti** project. The pipeline (Python package `marsmap`)
  read the USGS files above and wrote the `dem.bin`, `walk.json`, `grid.bin` and photo tiles. The
  `jezero_delta` patch was made in this repository by running that pipeline's "walk" step, unchanged,
  centred on longitude 77.3903 E, latitude 18.4722 N.

  Note for the team: this repository does not contain Team Protikriti's licence file or a link to
  their repository. Add both here before publishing.

## Not real data

So nobody mistakes them for measurements: the surface colour, the sky gradient, the dust haze and
the sun direction are chosen for looks. The shape of the ground and the light/dark pattern of the
photo are real.
