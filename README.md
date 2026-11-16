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

## Controls

Every VR action has a desktop key. "works" means it passed the desktop and headset-emulator tests;
nothing has been tried on a real headset.

The experience starts in the rover cabin: read the briefing card on the hologram table, select
DEPART, wait about 6 seconds for the airlock light to turn green, then open the door behind you.
Outside, select the rover (from up to 40 m) or press the door key within 12 m of it (the start spot included) to go back in
for the debrief.

| Action | Quest 3S | Desktop | State |
|---|---|---|---|
| Look | turn your head | click the page to capture the mouse; `Esc` releases it | works |
| Walk | (teleport only) | `W` `A` `S` `D` or arrow keys; hold `Shift` to run | works |
| Teleport | hold the right trigger on open ground to aim, release to jump | hold `T` or the right mouse button, release to jump | works |
| Turn | right thumbstick left / right (snap turn) | mouse, or left / right arrow | works |
| Select / confirm (tablet buttons, cards, DEPART, coring at the marked rock) | point the right controller, press the trigger | mouse click | works |
| Tablet on / off | `Y` on the left controller, or look down at your left forearm | `Tab` or `Y` | works |
| Scan at a station | `A` | `E` | works: slope layer at stop 2, rover-path pulse at stop 3, switch ridge at stop 5 |
| Airlock door | `B`, or point at the door and press the trigger | `B`, or click the door | works (inside: opens the airlock once the light is green; outside: back to the rover) |
| Take / put back a sample tube (stops 4 and 5) | right grip | `G` | works |
| Frame-time readout | `X` on the left controller | `F` | works |

Without the mission (`?mission=0`, `?tablet=0`, or a site other than `jezero_delta`) the `A`, `B`,
`X` and `Y` buttons all toggle the frame-time readout. There is no smooth walking in VR: teleport
and snap turn only.

## URL flags

Add them to the address after `?`, joined with `&` (for example `?site=jezero&debug=1`).

| Flag | What it does | State |
|---|---|---|
| `site=<name>` | Terrain patch: a folder under `data/walk/` (`jezero_delta` is the default, `jezero`, `gale`). The mission exists only for `jezero_delta`. | works |
| `debug=1` | Shows a red pole with an "N" sign 60 m due north of the start point, for checking orientation. | works |
| `frametime=1` | Starts with the frame-time readout on. | works |
| `tablet=0` | Mission without the forearm tablet. | works |
| `mission=0` | Plain terrain viewer: no mission, start at the patch centre. | works |
| `skipcabin=1` | Start outside on the surface instead of in the rover cabin. | works |

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
- `src/mission/credits.js` - the credits as data (from the mission file, plus fixed lines that repeat `CREDITS.md`) and as paged canvas text; used by the tablet's LAYERS tab, and `createCreditsPanel` gives a stand-alone panel
- `src/mission/layers.js` - data layers the tablet switches: photo, slope hazard, rover path and stops, sample sites, panoramas (the backdrop is always on)
- `src/mission/stations/index.js` - station framework: the list of stations, which one is active (by distance), the station card, who gets a press (tablet and panels, then the station, then teleport), the right-hand hold, completion
- `src/mission/stations/tube.js` - the one shared low-poly sample tube
- `src/mission/stations/s2.js` - stop 2, Read the ground: slope layer, DIRECT and PLANNED signs
- `src/mission/stations/s3.js` - stop 3, Follow the rover: reveals the rover path, scan pulse toward the next stop
- `src/mission/stations/s4.js` - stop 4, Berea: take the tube, core the marked rock (simulated), notebook entry
- `src/mission/stations/s5.js` - stop 5, Ridge lookout: panorama pad (360 view of Skinner Ridge or Wildcat Ridge), four sample tubes to log, cards
- `src/mission/fieldcheck.js` - Field Check: four tap questions on the tablet, score kept for the debrief
- `src/mission/cabin.js` - rover cabin: briefing hologram, DEPART, airlock door, return marker outside, debrief with route replay
- `tools/build_mission.py` - builds `data/mission/<site>.json`; plans the route through `tools/route_cli.mjs` (needs Node.js)

On the delta patch the mission layer is loaded: a blue route ribbon, the rover's real path in
orange (on the ground from stop 3 on), and a beacon at each station. The experience starts in the
rover cabin; the walk outside then starts on the route, 6 m from the start marker (`skipcabin=1`
starts there directly). Add `mission=0` to the address for the plain terrain viewer.

The tablet: `Tab` or `Y` on desktop (it slides up and frees the mouse; click its buttons); in VR
it is worn on the left forearm and lights with `Y` on the left controller or by looking down at
it, and the right controller's ray and trigger tap its buttons. MAP shows the whole route on the
photo, where you are, and a pin per stop: tap a pin, confirm, and you are taken there for the
walking time of the route distance. LAYERS has one chip per layer (photo, slope hazard in amber
10 to 15 degrees and red above 15, rover path, sample sites, panoramas): the eye switches it, the
"i" gives a one-line explanation, and the pages after the chips are the CREDITS: missions
covered, every data layer (the always-on distant terrain too), the fact sources, what is assumed
or simulated, and the software. The rover path is on the map from the start
but appears on the ground only when stop 3 turns it on. HELP lists the controls, including `E`, `B` and `G` (scan, airlock door, take or stow a sample
tube). After the four cores at stop 5 are logged the tablet also shows the Field Check. Add `tablet=0` to the address to leave the tablet out
(the controller buttons then all toggle the frame time, as in the plain viewer; the Field Check
needs the tablet, so stop 5 cannot be finished in that mode).

Local frame: x = east, z = south, y = up, in metres, origin at the patch centre
(y = 0 is the ground height at the centre).

`window.__mars` (debug handle): `player` (x, y, z, headingDeg, elevationM),
`setPose({ x, z, headingDeg, pitchDeg })`, `triangles`, `measureTriangles()`, `groundY(x, z)`.
With the mission loaded a HUD strip floats in front of and below the view (desktop and VR): EVA
time left, time to walk home, margin, heading, slope underfoot and distance to the next station
are real; suit oxygen, battery and temperature are cosmetic and tagged SIM. The clock does not
count real seconds: it is charged the walking time of the ground covered (walking, running and
teleporting cost the same per metre) and 20 minutes per station. See DECISIONS.md, "Mission B3".
For tests: `mission.clock` (`charge`, `chargeStop`, `moveCharged`, `routeSeconds`,
`homeFrom`, `running`, `status`), `mission.hud.flash('SLOPE' | 'SCAN' | 'SAMPLE' | 'RETURN',
{ level })`, `mission.hud.setVisible`, `mission.setNextStation(id)`, `mission.telemetry`.

`window.__mars.mission` (null without a mission): `data`, `values` (card placeholders), `summary`
(route length, times, slopes), `cardText(id)`, `setLayer('route' | 'traverse' | 'beacons', on)`,
`beacons`, `spawn`, `planAgain()`, `stats()`.
Since B4: `setLayer` also takes `'photo' | 'slope' | 'samples' | 'panoramas' | 'backdrop'`;
`layerSet` (`list`, `credits`, `get`, `set`, `toggle`, `state()`, `sites`, `inWorld(id)`,
`waitingFor(id)`, `reveal('traverse')` for stop 3), `log` (`add({ title, lines,
station })`, `entries`), `travelTo(x, z, headingDeg)`, `actions` (`scan`, `door`), `ui` (the panel manager) and `tablet` (`setOpen`, `toggle`, `setTab`, `askJump(id)`,
`confirmJump()`, `cancelJump()`, `cost(id)`, `targets`, `state`, `panel`, `stats()`,
`credits`, `showCredits()`).

Design choices and the measurements behind them are in `DECISIONS.md`.
