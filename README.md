# TeamMarsRed WebXR Starter

A tiny Three.js scene with a rotating cube, floor, and VR entry button. It has no build step or framework.

## Run locally

From this folder, start a local server:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. For headset testing, use a WebXR capable browser and serve over HTTPS (localhost is allowed). Three.js is loaded from jsDelivr, so an internet connection is needed.

Edit `src/main.js` to change the scene.
