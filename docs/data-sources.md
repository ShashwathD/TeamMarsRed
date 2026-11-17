# Marswalk data sources

This file covers only the data used by the Jezero Marswalk experience. For detailed file-level
credits and notes, see [CREDITS.md](../CREDITS.md).

## Terrain and orbital imagery

- **Surface image and walk terrain:** USGS Astrogeology's Mars 2020 Terrain Relative Navigation
  HiRISE orthomosaic and digital terrain model for Jezero crater. The source image is from the
  HiRISE camera aboard NASA's Mars Reconnaissance Orbiter. The terrain is used on a 2 m grid.
  [USGS HiRISE products](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/)
- **Distant terrain:** USGS Mars 2020 Science Investigation CTX DEM Mosaic, made from images from
  the Context Camera aboard NASA's Mars Reconnaissance Orbiter.
  [USGS CTX terrain mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic)
- **Minerals:** Parente, Saranathan and Itoh (2021), *Map of the dominant mineralogy over and
  around the Mars 2020 landing ellipse with correspondent spectral signatures*, derived from MRO
  CRISM data. The project uses closest spectral matches at 36 m pixels; these are possible mineral
  identifications, not hazard measurements.
  [Dataset (Zenodo)](https://doi.org/10.5281/zenodo.5575824)

## Perseverance surface data

- **Rover traverse and waypoints:** NASA/JPL MMGIS Mars 2020 Perseverance map data, simplified and
  clipped to the Jezero walk patch.
  [NASA Mars Trek / MMGIS](https://mars.nasa.gov/mmgis-maps/)
- **Sample facts:** NASA Science's Perseverance Mars Rock Samples page. Sample positions in the
  walk are approximate rover waypoints near the recorded sample sols; sample collection in the
  experience is simulated.
  [Mars Rock Samples](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/)
- **Surface panoramas:** NASA/JPL Mars 2020 Perseverance Navcam raw images, stitched by the project
  pipeline. Individual source images and links are listed in `data/pano/m20/index.json`.

## Mission facts

Mission cards cite the source names directly: NASA/JPL Mars 2020 mission information; JPL Jezero
delta findings (19 April 2022); Farley et al. (2022), *Science* 377, eabo2196; Williams et al.
(2023), LPSC abstract NTRS 20230000588; NASA GISS Mars24 / NASA Science; NASA EVA-EXP-0075; and the
NASA Space Apps challenge text. Full notes and any project assumptions are listed in
[CREDITS.md](../CREDITS.md).
