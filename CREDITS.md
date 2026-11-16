# Credits

Everything the terrain viewer and the Jezero Marswalk mission show or load, and where it comes
from. Only sources that are actually used are listed here; the wider list for the original map
project is in `docs/data-sources.md`.

The same credits are shown inside the app: forearm tablet, LAYERS tab, the CREDITS pages after the
layer chips (`src/mission/credits.js`). The lines that module types itself (image credits, the
software lines, the AI line, "not real data") are copied from this file word for word; change both
together.

Rule followed here: no licence and no address is given unless this repository's own files state
it (`docs/data-sources.md`, `DATA_NOTES.md`, `DECISIONS.md`, the `source` fields of the data
files, or `docs/mission-brief.md`).

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

## Mission data (Jezero Marswalk)

Missions covered: **MRO** (Mars Reconnaissance Orbiter) and **Mars 2020 Perseverance**.

The tablet names each layer as in this table (text from `data/mission/jezero_delta.json`, built by
`tools/build_mission.py`):

| Layer | Mission, instrument | Source as shown | Note as shown |
|---|---|---|---|
| Photo | Mars Reconnaissance Orbiter (MRO), HiRISE | MRO HiRISE orthomosaic, 25 cm per pixel | |
| Terrain and slope hazard | Mars Reconnaissance Orbiter (MRO), HiRISE stereo | USGS HiRISE terrain model, 1 m (shown at 2 m) | Slope derived by us; the 15 degree limit is an ASSUMPTION |
| Rover traverse | Mars 2020 Perseverance, Rover localization | NASA/JPL MMGIS | |
| Sample sites | Mars 2020 Perseverance, Sampling and caching system | NASA Mars Rock Samples (retrieved 2026-09-29) | Positions approximate (rover waypoint at that sol) |
| Surface panoramas | Mars 2020 Perseverance, Navcam | Mars 2020 Navcam | |
| Backdrop terrain (always on) | Mars Reconnaissance Orbiter (MRO), CTX | MRO CTX, 20 m | |

The photo, the terrain and the backdrop are the three USGS products described under "Mars data"
above. The other three:

- **Rover traverse and rover stops, `data/layers/traverses.geojson` and `data/stops/m20.json`.**
  NASA/JPL MMGIS traverse and waypoint files for Perseverance (`M20_traverse.json`,
  `M20_waypoints.json`), <https://mars.nasa.gov/mmgis-maps/>, as fetched and simplified by Team
  Protikriti's pipeline (`docs/data-sources.md`). The mission clips the line to the patch. The
  traverse file carries no sols; the sols shown come from the waypoint file.
- **Sample sites and core facts, `data/activities.json`.** NASA Science, "Mars Rock Samples"
  (Perseverance), <https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/>,
  retrieved 2026-09-29 by Team Protikriti's pipeline; the five cores used were re-checked against
  the page on 2026-11-15 (`DECISIONS.md`). Name, number, sol and date sealed, core length, rock
  type and current location are NASA's. **Positions are not NASA's**: each core is placed at the
  rover's MMGIS waypoint for a nearby sol, so every sample position is approximate. Coring in the
  app is simulated.
- **Surface panoramas, `data/pano/m20/26_1004.jpg` and `26_1222.jpg`.** Stitched from Mars 2020
  Navcam raw images (NASA raw-image API; each source frame and its NASA link is listed in
  `data/pano/m20/index.json`). Credit: NASA/JPL-Caltech, Mars 2020 Navcam raw images, stitched with
  Team Protikriti's pipeline (docs/data-sources.md). The panoramas cover about half of the full
  sphere; the rest is filled in by the stitcher and is not a photograph.

## Fact sources (F1 to F9)

The info cards and the Field Check use only these facts. "As cited in the brief" is the wording of
`docs/mission-brief.md`; "as shown in the app" is the source line the cards print.

| | As cited in the brief | As shown in the app |
|---|---|---|
| F1 | Team Protikriti data-sources.md | Team Protikriti data-sources.md |
| F2 | JPL news, 19 Apr 2022 | JPL news, 19 Apr 2022 |
| F3 | JPL 2022 | JPL news, 19 Apr 2022 |
| F4 | Farley et al. 2022, Science 377, eabo2196 | Farley et al. 2022, Science 377, eabo2196 |
| F5 | Williams et al., LPSC 2023 abstract (NTRS 20230000588) | Williams et al., LPSC 2023 abstract (NTRS 20230000588) |
| F6 | NASA GISS Mars24 / NASA Science | NASA GISS Mars24 / NASA Science |
| F7 | NASA's Artemis EVA concept of operations (EVA-EXP-0075, 2020), as quoted in Team Protikriti docs | NASA EVA-EXP-0075 (Artemis EVA concept of operations summary, Feb 2020) |
| F8 | Space Apps challenge text | Space Apps challenge text |
| F9 | Photo: MRO HiRISE, 25 cm per pixel. Terrain: USGS HiRISE stereo model, 1 m (shown at 2 m) | MRO HiRISE; USGS HiRISE terrain model |

Notes:

- F3: the app treats the brief's "JPL 2022" as the same JPL news item as F2. The brief does not
  give its address and none is given here.
- F7: the brief said "Original not opened". It was opened on 2026-11-15
  (<https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf>,
  see `DECISIONS.md`) and the quoted figures (up to 8 h, up to 2 km from the lander, terrain up to
  20 degrees, for the Moon) were confirmed, so the app cites the document itself.
- Other card sources: "NASA/JPL MMGIS traverse" and "NASA Science, Mars Rock Samples", both
  described above.
- Addresses for F2 to F6 are not in this repository, so none are given. Add them before
  publishing if the team has them.

## Assumptions and simulated values

These are ours, not NASA's, and are labelled ASSUMPTION or SIM wherever the app shows them:

- ASSUMPTION: One EVA lasts 8 hours in total. 1 hour of the EVA is kept as reserve. Suited
  explorers avoid ground steeper than 15 degrees. Walking pace is capped at 3.3 km/h. Each station
  takes 20 minutes. Pace on slopes follows Tobler's hiking function times 0.8.
- SIM: Suit oxygen, battery and temperature are cosmetic and tagged SIM.
- The planned route, the walking times and the slope overlay are computed by us from the USGS
  HiRISE terrain model.

## Software

- **Three.js 0.170.0**. The 3D library. MIT License, copyright 2010-2024 three.js authors. Loaded from the jsDelivr network
  (<https://cdn.jsdelivr.net/npm/three@0.170.0/>). Licence text: <https://cdn.jsdelivr.net/npm/three@0.170.0/LICENSE>. The viewer also uses
  its `VRButton` add-on, same licence.
- **Mission code** (`src/mission/`, `tools/build_mission.py`). As the app's credits say: Written for this project. The cabin, tablet, HUD, beacons, sample tubes and every other object are built in code; no 3D model, texture, font or sound file from anyone else is loaded.
- **Terrain data files and the data pipeline** (`data/` and `pipeline/`)
  come from the open source **Team Protikriti** project. The pipeline (Python package `marsmap`)
  read the USGS files above and wrote the `dem.bin`, `walk.json`, `grid.bin` and photo tiles. The
  `jezero_delta` patch was made in this repository by running that pipeline's "walk" step, unchanged,
  centred on longitude 77.3903 E, latitude 18.4722 N. In short, as the app's credits say: The
  terrain, photo, rover path, sample list and panorama files were made with the Team Protikriti
  project's pipeline. Its licence has not been verified.

  Note for the team: this repository does not contain Team Protikriti's licence file or a link to
  their repository. Add both here before publishing.

## AI assistance

The code, tests and documents of this project were written with an AI coding assistant (Claude, by Anthropic), directed by the team. The Mars data shown is not AI-generated: it comes from the sources listed here.

The assistant also wrote the tool that builds the mission file and ran the automated checks
(headless browser and a headset emulator). Nothing was tested by the assistant on a real headset.

## Not real data

So nobody mistakes them for measurements: the surface colour, the sky gradient, the dust haze and
the sun direction are chosen for looks. The shape of the ground and the light/dark pattern of the
photo are real.

For the mission, as the app's credits say:

- Chosen for looks: Surface colour, sky, dust haze and sun direction. The rover cabin, tablet, beacons, tubes and other objects are simple made-up models.
- Simulated: Coring and the Marswalk itself.
- EVA clock: The EVA clock is charged for ground covered and for stops; it is not a real-time clock.
