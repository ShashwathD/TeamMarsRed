# TeamMarsRed - Mars terrain walk

A static web page (plain HTML + ES modules, no build step) that renders a real
2 km x 2 km Mars terrain patch at true scale and lets you walk on it.
Three.js 0.170.0 is loaded from jsDelivr through the import map in `index.html`,
so an internet connection is needed.

## Run locally

From this folder, start any static file server:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. Pick the terrain patch with the `site` URL
parameter, which names a folder under `data/walk/`:

- <http://localhost:8000/> or <http://localhost:8000/?site=jezero_delta> (default: the Jezero delta)
- <http://localhost:8000/?site=jezero> (the Perseverance landing site)
- <http://localhost:8000/?site=gale> (terrain only: no photo has been stitched for it)

The photo on the ground is one pre-stitched image per patch, `data/walk/<site>/mosaic_16.jpg`.
To make or refresh it (needs Python 3 with numpy and Pillow):

```sh
python3 tools/stitch_mosaic.py jezero jezero_delta
```

Controls: click the page to capture the mouse and look around, `W` `A` `S` `D`
to walk, hold `Shift` to run, arrow keys also turn and walk, `Esc` releases the
mouse, `F` shows the frame time. Add `debug=1` to the address (for example
`?debug=1` or `?site=jezero&debug=1`) to show a red pole with an "N" sign 60 m
due north of the start point; it is hidden otherwise.

Publishing and headset checks: `PUBLISH.md`. Data and software credits: `CREDITS.md`.
Screenshots of the delta and where they were taken: `docs/screenshots/`.

## Code layout

- `index.html` - page, import map (pins Three.js)
- `src/main.js` - wires everything together, exposes `window.__mars` for tests
- `src/data.js` - loads `walk.json` + `dem.bin`, height sampling, lon/lat <-> local metres
- `src/terrain.js` - walk-patch terrain with level of detail (chunks, fine near the viewer)
- `src/surround.js` - distant terrain from the coarse grid in `data/sites/`, joined to the patch
- `src/materials.js` - ground materials: photo, Mars tint, highlight roll-off
- `tools/stitch_mosaic.py` - stitches the photo tiles of a patch into `mosaic_16.jpg`
- `src/sky.js` - sky gradient, dust haze, lights
- `src/controls.js` - player rig, keyboard + mouse walking
- `src/northMarker.js` - north marker for checking orientation (only with `?debug=1`)
- `src/xr.js` - VR: teleport, snap turn
- `src/frameMeter.js` - frame-time readout drawn in the scene
- `src/mission/mission.js` - the Marswalk mission (only entry point; loads `data/mission/<site>.json`)
- `src/mission/route.js` - slope-limited route maths: A* on the 2 m grid, walking time (no Three.js; also run by the tool)
- `src/mission/ribbon.js` - ribbons draped on the terrain (planned route with moving chevrons, rover traverse)
- `src/mission/beacons.js` - station beacons with labels that face the viewer
- `src/mission/lowpoly.js` - shared low-poly palette, material and geometry merge
- `tools/build_mission.py` - builds `data/mission/<site>.json`; plans the route through `tools/route_cli.mjs` (needs Node.js)

On the delta patch the mission layer is loaded: a blue route ribbon, the rover's real path in
orange, and a beacon at each station. The walk then starts on the route, 6 m from the start marker. Add
`mission=0` to the address for the plain terrain viewer.

Local frame: x = east, z = south, y = up, in metres, origin at the patch centre
(y = 0 is the ground height at the centre).

`window.__mars` (debug handle): `player` (x, y, z, headingDeg, elevationM),
`setPose({ x, z, headingDeg, pitchDeg })`, `triangles`, `measureTriangles()`, `groundY(x, z)`.
`window.__mars.mission` (null without a mission): `data`, `values` (card placeholders), `summary`
(route length, times, slopes), `cardText(id)`, `setLayer('route' | 'traverse' | 'beacons', on)`,
`beacons`, `spawn`, `planAgain()`, `stats()`.

Design choices and the measurements behind them are in `DECISIONS.md`.
