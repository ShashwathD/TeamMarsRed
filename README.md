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

- <http://localhost:8000/?site=jezero> (default)
- <http://localhost:8000/?site=gale>

Controls: click the page to capture the mouse and look around, `W` `A` `S` `D`
to walk, hold `Shift` to run, arrow keys also turn and walk, `Esc` releases the
mouse. The red pole with the "N" sign is a temporary marker standing 60 m due
north of the start point.

## Code layout

- `index.html` - page, import map (pins Three.js)
- `src/main.js` - wires everything together, exposes `window.__mars` for tests
- `src/data.js` - loads `walk.json` + `dem.bin`, height sampling, lon/lat <-> local metres
- `src/terrain.js` - builds the terrain mesh
- `src/sky.js` - sky gradient, dust haze, lights
- `src/controls.js` - player rig, keyboard + mouse walking
- `src/northMarker.js` - temporary north marker

Local frame: x = east, z = south, y = up, in metres, origin at the patch centre
(y = 0 is the ground height at the centre).

`window.__mars` (debug handle): `player` (x, y, z, headingDeg, elevationM),
`setPose({ x, z, headingDeg, pitchDeg })`, `triangles`, `groundY(x, z)`.
