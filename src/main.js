import * as THREE from 'three';
import { siteFromUrl, loadWalkPatch } from './data.js';
import { createTerrain } from './terrain.js';
import { loadRegionGrid, createSurround } from './surround.js';
import { createWalkMaterial, createSurroundMaterial } from './materials.js';
import { createSky } from './sky.js';
import { createPlayer, EYE_HEIGHT_M } from './controls.js';
import { createNorthMarker } from './northMarker.js';

const DEFAULT_SITE = 'jezero';

// Which coarse regional grid (data/sites/<name>) surrounds a walk patch, when
// the folder names differ.
const REGION_FOR_SITE = { jezero_delta: 'jezero' };

const PHOTO_LEVEL = 16;

// Loads the pre-stitched photo of the patch (one request). Returns null if the
// patch has none, in which case the terrain is drawn in the plain surface colour.
async function loadPhoto(patch, renderer) {
  const url = `${patch.folder}mosaic_${PHOTO_LEVEL}.jpg`;
  let texture;
  try {
    texture = await new THREE.TextureLoader().loadAsync(url);
  } catch {
    return null;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // Small copy of the image in linear light: gives the average brightness
  // (for the tint) and the brightness along the patch edge (for the surround).
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(texture.image, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const linear = new Float32Array(size * size);
  let sum = 0;
  for (let i = 0; i < linear.length; i++) {
    const s = pixels[i * 4] / 255;
    linear[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    sum += linear[i];
  }
  const meanLinear = sum / linear.length;
  // Brightness relative to the average at local (x, z); row 0 of the image is north.
  const relativeBrightness = (x, z) => {
    const col = Math.min(Math.max(Math.floor((x / patch.sizeX + 0.5) * size), 0), size - 1);
    const row = Math.min(Math.max(Math.floor((z / patch.sizeZ + 0.5) * size), 0), size - 1);
    return linear[row * size + col] / meanLinear;
  };
  return {
    texture,
    url,
    width: texture.image.width,
    height: texture.image.height,
    meanLinear,
    relativeBrightness,
  };
}

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

  // Walk patch: real photo draped over level-of-detail terrain.
  const photo = await loadPhoto(patch, renderer);
  const terrain = createTerrain(patch, { material: createWalkMaterial(photo) });
  scene.add(terrain.group);

  // Distant terrain from the coarse regional grid, if there is one for this patch.
  let surround = null;
  let surroundNote = '';
  try {
    const grid = await loadRegionGrid(REGION_FOR_SITE[site] || site);
    surround = createSurround(patch, grid, {
      material: createSurroundMaterial(),
      edgeBrightness: photo && photo.meanLinear > 0 ? photo.relativeBrightness : null,
    });
    if (surround) scene.add(surround.mesh);
    else surroundNote = ' (the regional grid does not cover this patch)';
  } catch (error) {
    surroundNote = ` (no distant terrain: ${error.message})`;
  }

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
  const viewer = new THREE.Vector3();
  let frames = 0;
  terrain.update(player.position.x, player.position.z);
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    player.update(dt);
    // Level of detail follows the head (in VR the head can be away from the rig origin).
    camera.getWorldPosition(viewer);
    terrain.update(viewer.x, viewer.z);
    renderer.render(scene, camera);
    frames++;
  });

  setStatus(
    `${site}: click to look around, WASD to walk, Shift to run, Esc to release the mouse` +
      (photo ? '' : ' (no photo for this patch)') +
      surroundNote,
  );

  const sceneTriangles = () => terrain.triangles + (surround ? surround.triangles : 0);

  // Debug handle for automated tests.
  window.__mars = {
    ready: true,
    site,
    patch,
    scene,
    camera,
    renderer,
    terrain,
    surround,
    photo: photo ? { url: photo.url, width: photo.width, height: photo.height, meanLinear: photo.meanLinear } : null,
    northMarker,
    eyeHeightM: EYE_HEIGHT_M,
    get frames() {
      return frames;
    },
    // Terrain triangles in the scene right now (walk patch at its current
    // levels of detail + distant terrain), whether or not they are in view.
    get triangles() {
      return sceneTriangles();
    },
    // Triangles the renderer drew in the last frame (only what was in view).
    get renderedTriangles() {
      return renderer.info.render.triangles;
    },
    // Draws one frame with view culling off, so renderer.info counts every
    // triangle in the scene, then restores culling.
    measureTriangles() {
      const meshes = [];
      scene.traverse((object) => {
        if (object.isMesh && object.frustumCulled) meshes.push(object);
      });
      meshes.forEach((mesh) => (mesh.frustumCulled = false));
      renderer.render(scene, camera);
      const all = { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
      meshes.forEach((mesh) => (mesh.frustumCulled = true));
      renderer.render(scene, camera);
      return {
        allTriangles: all.triangles,
        allDrawCalls: all.calls,
        inViewTriangles: renderer.info.render.triangles,
        inViewDrawCalls: renderer.info.render.calls,
        terrain: terrain.stats(),
        surroundTriangles: surround ? surround.triangles : 0,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
      };
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
      terrain.update(player.position.x, player.position.z);
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
