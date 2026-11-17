# TeamMarsRed — Marswalk

Marswalk is a browser-based 3D Mars terrain explorer and Jezero surface mission. It uses static
files and ES modules, so there is no install or build step. Three.js 0.170.0 loads from jsDelivr,
so an internet connection is needed.

## Run locally on a computer

1. Open Terminal in the project folder and start a local web server:

   ```sh
   cd /path/to/TeamMarsRed
   python3 -m http.server 8000
   ```

   If you are already in the project folder, just run `python3 -m http.server 8000`.

2. Open <http://localhost:8000> in a desktop browser. The Jezero delta Marswalk mission loads by
   default. Keep the Terminal window open while using it; press Ctrl+C there to stop the server.

### Desktop controls

- Click the view to look around and select items; press `Esc` to free the mouse.
- Move with `W`, `A`, `S`, `D`; hold `Shift` to sprint.
- Hold `T` or the right mouse button to aim a teleport; release to jump.
- `Tab` opens or closes the tablet. `E` scans, `B` operates the airlock, and `G` takes or stows a
  sample tube. `F` toggles the frame-time readout.

## Open in VR

WebXR needs a secure HTTPS page when opened from a headset. The simplest option is to publish the
project with GitHub Pages, then open its HTTPS address in the headset's browser.

1. On GitHub, open [ShashwathD/TeamMarsRed](https://github.com/ShashwathD/TeamMarsRed).
2. Push the project branch after committing your changes. The current publishing branch is `main`:

   ```sh
   git push origin main
   ```

3. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy
   from a branch**, select `main` and `/(root)`, then save.
4. Wait for the Pages deployment to finish. The site address is
   <https://shashwathd.github.io/TeamMarsRed/>.
5. On the headset, connect to Wi-Fi, open its browser, and visit that HTTPS address. Select
   **ENTER VR** and allow immersive mode if prompted.

For local VR development, `localhost` in the headset refers to the headset itself. A computer's
local server needs to be made available to the headset over HTTPS; using the published Pages URL is
the easiest route for a headset session.

### VR controls

- Point and hold the right trigger to aim a teleport; release to jump.
- Walk and strafe with the left stick; press and hold it to sprint. Turn with the right stick.
- Point the right controller and press the trigger to select. Use `Y` on the left controller for
  the tablet, `A` to scan, `B` for the airlock, and the right grip to take or stow sample tubes.
- Press `X` on the left controller to toggle the frame-time readout.

## Other terrain views

Add a query string to the address:

- `?mission=0` — plain terrain viewer without the Marswalk mission.
- `?skipcabin=1` — start outdoors on the Jezero delta.
- `?site=jezero` — Perseverance landing-area terrain.
- `?site=gale` — Gale terrain (no stitched surface photo).
- `?debug=1` — show the north marker.
- `?frametime=1` — show the frame-time readout at startup.
- `?tablet=0` — run the Jezero mission without the tablet.

Examples: <http://localhost:8000/?mission=0> and
<https://shashwathd.github.io/TeamMarsRed/?skipcabin=1>.

## Project notes and credits

- [CREDITS.md](CREDITS.md) — project data, software, and image credits.
- [docs/data-sources.md](docs/data-sources.md) — focused source list for the Marswalk mission.
- [docs/mission-brief.md](docs/mission-brief.md) — mission scope and design assumptions.
- [docs/screenshots/](docs/screenshots/) — project screenshots.

The project has been tried on a physical headset. Its mission clock and slope threshold are
planning assumptions; sample collection is simulated.
