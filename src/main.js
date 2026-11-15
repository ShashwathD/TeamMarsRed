import * as THREE from 'three';
import { siteFromUrl, loadWalkPatch } from './data.js';
import { buildTerrain } from './terrain.js';
import { createSky } from './sky.js';
import { createPlayer, EYE_HEIGHT_M } from './controls.js';
import { createNorthMarker } from './northMarker.js';

const DEFAULT_SITE = 'jezero';
const MAX_TRIANGLES = 250000; // whole scene must stay under about 300k

const statusEl = document.getElementById('status');
const setStatus = (text) => {
  if (statusEl) statusEl.textContent = text;
};

async function start() {
  const site = siteFromUrl(DEFAULT_SITE);
  setStatus(`Loading ${site}...`);
  const patch = await loadWalkPatch(site);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 20000);

  createSky(scene);

  const terrain = buildTerrain(patch, { maxTriangles: MAX_TRIANGLES });
  scene.add(terrain);

  const player = createPlayer({ camera, scene, domElement: renderer.domElement, patch });
  const startLocal = patch.meta.start
    ? patch.lonLatToLocal(patch.meta.start.lon, patch.meta.start.lat)
    : { x: 0, z: 0 };
  player.setPosition(startLocal.x, startLocal.z);
  player.setHeading(0); // face north, toward the marker

  const northMarker = createNorthMarker(patch, player.position.x, player.position.z);
  scene.add(northMarker);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    player.update(dt);
    renderer.render(scene, camera);
    frames++;
  });

  setStatus(`${site}: click to look around, WASD to walk, Shift to run, Esc to release the mouse`);

  // Debug handle for automated tests.
  window.__mars = {
    ready: true,
    site,
    patch,
    scene,
    camera,
    renderer,
    terrain,
    northMarker,
    eyeHeightM: EYE_HEIGHT_M,
    get frames() {
      return frames;
    },
    get triangles() {
      return terrain.userData.triangles;
    },
    get renderedTriangles() {
      return renderer.info.render.triangles;
    },
    // x east, z south (metres from the patch centre); y is the feet,
    // eyeY the camera; heading in degrees clockwise from north.
    get player() {
      const p = player.position;
      return {
        x: p.x,
        y: p.y,
        z: p.z,
        eyeY: p.y + EYE_HEIGHT_M,
        headingDeg: player.state.headingDeg,
        pitchDeg: player.state.pitchDeg,
        elevationM: p.y + patch.originHeightM,
      };
    },
    setPose({ x, z, headingDeg, pitchDeg } = {}) {
      if (x !== undefined || z !== undefined) {
        player.setPosition(x ?? player.position.x, z ?? player.position.z);
      }
      if (headingDeg !== undefined) player.setHeading(headingDeg);
      if (pitchDeg !== undefined) player.setPitch(pitchDeg);
      return window.__mars.player;
    },
    groundY: (x, z) => patch.groundY(x, z),
  };
}

start().catch((error) => {
  console.error(error);
  setStatus(`Could not load the terrain: ${error.message}`);
  window.__mars = { ready: false, error: error.message };
});
