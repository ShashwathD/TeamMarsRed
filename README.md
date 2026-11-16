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
- `src/materials.js` - ground materials: photo, Mars tint, highlight roll-off; switches for the photo and the slope-hazard overlay
- `tools/stitch_mosaic.py` - stitches the photo tiles of a patch into `mosaic_16.jpg`
- `src/sky.js` - sky gradient, dust haze, lights
- `src/controls.js` - player rig, keyboard + mouse walking
- `src/northMarker.js` - north marker for checking orientation (only with `?debug=1`)
- `src/xr.js` - VR: teleport, snap turn; hooks that let a UI panel take a trigger press or a button
- `src/frameMeter.js` - frame-time readout drawn in the scene
- `src/mission/mission.js` - the Marswalk mission (only entry point; loads `data/mission/<site>.json`)
- `src/mission/route.js` - slope-limited route maths: A* on the 2 m grid, walking time (no Three.js; also run by the tool)
- `src/mission/ribbon.js` - ribbons draped on the terrain (planned route with moving chevrons, rover traverse)
- `src/mission/beacons.js` - station beacons with labels that face the viewer
- `src/mission/lowpoly.js` - shared low-poly palette, material and geometry merge
- `src/mission/clock.js` - EVA clock: mission time charged for ground covered and station stops, time to walk home, margin
- `src/mission/hud.js` - suit HUD: a strip in the scene that trails behind head turns, and short flashes
- `src/mission/ui.js` - UI kit: canvas panels with tappable regions, ray picking for controllers and the mouse
- `src/mission/tablet.js` - forearm tablet: MAP (with teleport to a stop), LOG, LAYERS, HELP
- `src/mission/layers.js` - data layers the tablet switches: photo, slope hazard, rover path and stops, sample sites, panoramas (the backdrop is always on)
- `tools/build_mission.py` - builds `data/mission/<site>.json`; plans the route through `tools/route_cli.mjs` (needs Node.js)

On the delta patch the mission layer is loaded: a blue route ribbon, the rover's real path in
orange, and a beacon at each station. The walk then starts on the route, 6 m from the start marker. Add
`mission=0` to the address for the plain terrain viewer.

The tablet: `Tab` or `Y` on desktop (it slides up and frees the mouse; click its buttons); in VR
it is worn on the left forearm and lights with `Y` on the left controller or by looking down at
it, and the right controller's ray and trigger tap its buttons. MAP shows the whole route on the
photo, where you are, and a pin per stop: tap a pin, confirm, and you are taken there for the
walking time of the route distance. LAYERS has one chip per layer (photo, slope hazard in amber
10 to 15 degrees and red above 15, rover path, sample sites, panoramas): the eye switches it, the
"i" gives a one-line explanation, and the last page lists the missions and all credits (the
distant terrain is always on and is credited there). The rover path is on the map from the start
but appears on the ground only when stop 3 turns it on. HELP lists the controls. `E`, `B` and `G` (scan, airlock door, hold a tube) are
listed there but belong to later steps. Add `tablet=0` to the address to leave the tablet out
(the controller buttons then all toggle the frame time, as in the plain viewer).

Local frame: x = east, z = south, y = up, in metres, origin at the patch centre
(y = 0 is the ground height at the centre).

`window.__mars` (debug handle): `player` (x, y, z, headingDeg, elevationM),
`setPose({ x, z, headingDeg, pitchDeg })`, `triangles`, `measureTriangles()`, `groundY(x, z)`.
With the mission loaded a HUD strip floats in front of and below the view (desktop and VR): EVA
time left, time to walk home, margin, heading, slope underfoot and distance to the next station
are real; suit oxygen, battery and temperature are cosmetic and tagged SIM. The clock does not
count real seconds: it is charged the walking time of the ground covered (walking, running and
teleporting cost the same per metre) and 20 minutes per station. See DECISIONS.md, "Mission B3".
For later steps: `mission.clock` (`charge`, `chargeStop`, `moveCharged`, `routeSeconds`,
`homeFrom`, `running`, `status`), `mission.hud.flash('SLOPE' | 'SCAN' | 'SAMPLE' | 'RETURN',
{ level })`, `mission.hud.setVisible`, `mission.setNextStation(id)`, `mission.telemetry`.

`window.__mars.mission` (null without a mission): `data`, `values` (card placeholders), `summary`
(route length, times, slopes), `cardText(id)`, `setLayer('route' | 'traverse' | 'beacons', on)`,
`beacons`, `spawn`, `planAgain()`, `stats()`.
Since B4: `setLayer` also takes `'photo' | 'slope' | 'samples' | 'panoramas' | 'backdrop'`;
`layerSet` (`list`, `credits`, `get`, `set`, `toggle`, `state()`, `sites`, `inWorld(id)`,
`waitingFor(id)`, `reveal('traverse')` for stop 3), `log` (`add({ title, lines,
station })`, `entries`), `travelTo(x, z, headingDeg)`, `actions` (`scan`, `door`: set by later
steps), `ui` (the panel manager) and `tablet` (`setOpen`, `toggle`, `setTab`, `askJump(id)`,
`confirmJump()`, `cancelJump()`, `cost(id)`, `targets`, `state`, `panel`, `stats()`).

Design choices and the measurements behind them are in `DECISIONS.md`.
