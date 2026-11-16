import * as THREE from 'three';
import { PALETTE, lowPolyMaterial, mergeParts } from '../lowpoly.js';
import { THEME, createPanel, fillChamfer, fitText, setFont } from '../ui.js';
import { sampleGrid } from '../route.js';
import { createFieldCheck } from '../fieldcheck.js';

// S5 RIDGE LOOKOUT (brief: S5, FIELD CHECK, LAYER BEHAVIOUR 5).
// One station for Skinner Ridge + Wildcat Ridge. Written to the stations
// contract: createStation(ctx) -> { id, title, cards(), onEnter(), onLeave(),
// update(dt), onInput(kind, info), isDone(), group }.
//
// WHAT IS HERE (all procedural, low-poly; the panoramas are real data and are
// not stylised):
//   - A pad a few metres from the station beacon with a faceted see-through
//     dome over it: the "panorama bubble". Stepping onto the pad opens the
//     360 view: the stitched Mars 2020 Navcam panorama of Skinner Ridge
//     (26_1004, sol 477) or Wildcat Ridge (26_1222, sol 502) on a low-segment
//     sphere around the head. While it is open the terrain, route and beacons
//     are hidden (a photo of the ground and the drawn ground do not line up);
//     stepping or teleporting off the pad brings them back.
//   - A stand on the pad: a screen (which ridge is shown, the four cores, the
//     Field Check button) and a rack with four sample tubes.
//
// COMPASS. The stitcher (pipeline/src/marsmap/pano.py, render()) writes the
// equirectangular image with "row 0 at the zenith, column 0 at north" and the
// azimuth growing eastward (x east = sin(azimuth)). The per-panorama .json
// and index.json carry no heading field, so none is applied on top: the
// sphere is built so that image column 0 faces north (-z) and columns run
// clockwise seen from above. The rover yaw in the mission file is NOT used
// (the frames were already turned to compass by the stitcher). Checked
// against the terrain: the high ground in both images (columns 0-22% and
// 78-100%) is where the terrain model rises north and north-west of the stop.
//
// COST. Sphere 1,600 triangles; dome, pad, stand, rack and tubes about 400
// together. One 4096 x 2048 texture is loaded when the explorer comes within
// LOAD_M of the pad (the other one on the first switch) and both are disposed
// beyond DISPOSE_M, when the layer is switched off or when the station is
// left. The screen is redrawn only when what it shows changes.
//
// INPUT. 'grip' (right grip / G): take the next tube that is not logged yet
//   (a second press puts it back and takes the next). 'select' (trigger /
//   click) on a tube: take that tube. 'scan' (A / E): switch ridge.
//   The screen's buttons are ui.js regions, so the trigger / mouse works on them.

const PAD_OFFSET_M = 4.5; // pad centre from the station beacon
const PAD_RADIUS_M = 2.4;
const ENTER_M = 2.2; // head this close to the pad centre: the 360 view opens
const EXIT_M = 2.7;
const LOAD_M = 30; // load the panorama texture within this distance of the pad
const DISPOSE_M = 60; // and free it beyond this
const REACH_M = 3.5; // grip works this close to the rack
const SPHERE_RADIUS_M = 30;
const SPHERE_COLS = 40;
const SPHERE_ROWS = 20;
const SCREEN_W = 1280;
const SCREEN_H = 1220;
const SCREEN_W_M = 1.4;
const SCREEN_Y_M = 1.86; // screen centre above the pad

// Suggested activation radius for the framework: the pad lies PAD_OFFSET_M from the beacon.
export const ACTIVATION_RADIUS_M = 14;

// mission.stats per the stations contract. Before the stations, mission.stats
// was already a function (triangle count); if it still is, the counters are
// kept as properties on it, so both mission.stats() and mission.stats.coresLogged work.
function ensureStats(mission) {
  const fresh = { stationsDone: 0, stationCount: 0, coresLogged: 0, coreCount: 5, slopeWarnings: 0, fieldCheck: null, distanceM: 0, path: [] };
  if (!mission.stats) mission.stats = fresh;
  else for (const key of Object.keys(fresh)) if (!(key in mission.stats)) mission.stats[key] = fresh[key];
  return mission.stats;
}

// MERGE: dedupe tube helper
// A chunky sample tube standing along +y, about 0.24 m tall (oversized on purpose).
function tubeGeometry() {
  return mergeParts([
    { geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6), color: PALETTE.offWhite },
    { geometry: new THREE.CylinderGeometry(0.038, 0.038, 0.045, 6), color: PALETTE.teal, y: 0.11 },
    { geometry: new THREE.CylinderGeometry(0.034, 0.034, 0.02, 6), color: PALETTE.marsOrange, y: 0.03 },
    { geometry: new THREE.ConeGeometry(0.03, 0.04, 6).rotateX(Math.PI), color: PALETTE.slate, y: -0.11 },
  ]);
}

// Equirectangular sphere seen from inside: image column 0 at north (-z),
// azimuth growing eastward (+x), row 0 at the zenith.
function panoramaGeometry(radius, cols, rows) {
  const positions = [];
  const uvs = [];
  const index = [];
  for (let j = 0; j <= rows; j++) {
    const el = (0.5 - j / rows) * Math.PI;
    for (let i = 0; i <= cols; i++) {
      const az = (i / cols) * Math.PI * 2;
      positions.push(radius * Math.cos(el) * Math.sin(az), radius * Math.sin(el), -radius * Math.cos(el) * Math.cos(az));
      uvs.push(i / cols, 1 - j / rows);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const c = a + cols + 1;
      index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

export function createStation(ctx) {
  const { mission, patch, station, camera } = ctx;
  const data = mission.data;
  ensureStats(mission);
  const cores = data.cores.filter((core) => (station.samples || []).includes(core.number));
  const panoramas = (station.panoramas || []).map((id) => data.panoramas.find((p) => p.id === id)).filter(Boolean);
  const cardA = data.cards.S5A;
  const cardB = data.cards.S5B;
  // "on rover" / "sample depot", from the mission file's labels ("Swift Run: on rover").
  const placeOf = (core) => {
    const entry = (cardA.coreLocations || []).find((item) => item.number === core.number);
    return entry ? entry.label.split(': ').slice(1).join(': ') : core.location;
  };
  const retrieved = cores.length ? cores[0].locationRetrieved : data.dataRetrieved;

  // ---- where the pad goes: the flattest spot PAD_OFFSET_M from the beacon, not on the way in
  const rg = mission.routeGrid;
  const back = data.route.points[Math.max(0, (station.routeIndex || 0) - 3)];
  let inX = back[0] - station.x;
  let inZ = back[1] - station.z;
  const inLength = Math.hypot(inX, inZ) || 1;
  inX /= inLength;
  inZ /= inLength;
  const pad = { x: station.x, z: station.z, y: 0, slopeDeg: 0, dirX: 0, dirZ: -1 };
  let bestScore = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    const x = station.x + dx * PAD_OFFSET_M;
    const z = station.z + dz * PAD_OFFSET_M;
    let worst = 0;
    for (let s = 0; s < 9; s++) {
      const slope = sampleGrid(rg, rg.slopeDeg, x + ((s % 3) - 1) * 1.5, z + (Math.floor(s / 3) - 1) * 1.5);
      worst = Math.max(worst, Number.isFinite(slope) ? slope : 90);
    }
    const score = worst + (dx * inX + dz * inZ > 0.3 ? 8 : 0);
    if (score < bestScore) {
      bestScore = score;
      Object.assign(pad, { x, z, slopeDeg: worst, dirX: dx, dirZ: dz });
    }
  }
  pad.y = patch.groundY(pad.x, pad.z);
  // The pad lies in the plane of the ground under it (from the heights at its
  // rim), so its uphill side is not buried and its downhill side does not float.
  const rimXp = patch.groundY(pad.x + PAD_RADIUS_M, pad.z);
  const rimXm = patch.groundY(pad.x - PAD_RADIUS_M, pad.z);
  const rimZp = patch.groundY(pad.x, pad.z + PAD_RADIUS_M);
  const rimZm = patch.groundY(pad.x, pad.z - PAD_RADIUS_M);
  const tiltX = (rimXp - rimXm) / (2 * PAD_RADIUS_M);
  const tiltZ = (rimZp - rimZm) / (2 * PAD_RADIUS_M);
  const planeY = (2 * pad.y + rimXp + rimXm + rimZp + rimZm) / 6;
  const padPlaneY = (x, z) => planeY + (x - pad.x) * tiltX + (z - pad.z) * tiltZ;

  // ---- objects ---------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'station-S5';

  const padMesh = new THREE.Mesh(
    mergeParts([
      { geometry: new THREE.CylinderGeometry(PAD_RADIUS_M, PAD_RADIUS_M + 0.25, 0.5, 8), color: PALETTE.slate, y: -0.19 },
      { geometry: new THREE.CylinderGeometry(PAD_RADIUS_M - 0.35, PAD_RADIUS_M - 0.35, 0.04, 8), color: PALETTE.marsDeep, y: 0.07 },
    ]),
    lowPolyMaterial(),
  );
  padMesh.name = 's5-pad';
  padMesh.position.set(pad.x, planeY, pad.z);
  padMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-tiltX, 1, -tiltZ).normalize());
  group.add(padMesh);

  // Faceted dome over the pad: what the bubble looks like from outside.
  const domeGeometry = new THREE.IcosahedronGeometry(PAD_RADIUS_M + 0.15, 1);
  const dome = new THREE.Mesh(
    domeGeometry,
    new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  );
  dome.name = 's5-dome';
  dome.position.set(pad.x, pad.y + 1.0, pad.z);
  const domeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(domeGeometry), new THREE.LineBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.7 }));
  domeEdges.name = 's5-dome-edges';
  dome.add(domeEdges);
  group.add(dome);

  // Stand: rack with the tubes, screen above it. Local +z looks at the pad centre.
  const stand = new THREE.Group();
  stand.name = 's5-stand';
  stand.position.set(pad.x + pad.dirX * 1.15, 0, pad.z + pad.dirZ * 1.15);
  stand.position.y = padPlaneY(stand.position.x, stand.position.z) + 0.04; // its foot sits a little into the pad's top
  stand.rotation.y = Math.atan2(-pad.dirX, -pad.dirZ);
  group.add(stand);
  const rackY = 0.92;
  const rack = new THREE.Mesh(
    mergeParts([
      { geometry: new THREE.CylinderGeometry(0.3, 0.36, 0.1, 6), color: PALETTE.slate, y: 0.05 },
      { geometry: new THREE.CylinderGeometry(0.07, 0.09, rackY, 6), color: PALETTE.marsDeep, y: rackY / 2 },
      { geometry: new THREE.BoxGeometry(0.86, 0.09, 0.2), color: PALETTE.slate, y: rackY },
      { geometry: new THREE.BoxGeometry(0.9, 0.03, 0.24), color: PALETTE.marsOrange, y: rackY - 0.06 },
      // Two posts that carry the screen.
      { geometry: new THREE.BoxGeometry(0.06, 1.3, 0.06), color: PALETTE.slate, x: -0.6, y: 0.65, z: -0.42 },
      { geometry: new THREE.BoxGeometry(0.06, 1.3, 0.06), color: PALETTE.slate, x: 0.6, y: 0.65, z: -0.42 },
      // Screen housing.
      { geometry: new THREE.BoxGeometry(SCREEN_W_M + 0.1, (SCREEN_W_M * SCREEN_H) / SCREEN_W + 0.1, 0.06), color: PALETTE.offWhite, y: SCREEN_Y_M, z: -0.42 },
    ]),
    lowPolyMaterial(),
  );
  rack.name = 's5-rack';
  stand.add(rack);

  const anisotropy = 4;
  const screen = createPanel({ name: 's5-screen', widthPx: SCREEN_W, heightPx: SCREEN_H, widthM: SCREEN_W_M, anisotropy });
  screen.mesh.position.set(0, SCREEN_Y_M, -0.385);
  stand.add(screen.mesh);
  if (mission.ui) mission.ui.add(screen);

  const tubeShape = tubeGeometry();
  const tubes = cores.map((core, k) => {
    const mesh = new THREE.Mesh(tubeShape, lowPolyMaterial());
    mesh.name = `s5-tube-${core.number}`;
    const home = new THREE.Vector3((k - (cores.length - 1) / 2) * 0.2, rackY + 0.16, 0);
    mesh.position.copy(home);
    stand.add(mesh);
    return { core, mesh, home, logged: false };
  });

  // The panorama itself: a low-segment sphere kept around the head while the view is open.
  const sphere = new THREE.Mesh(
    panoramaGeometry(SPHERE_RADIUS_M, SPHERE_COLS, SPHERE_ROWS),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false, toneMapped: false }),
  );
  sphere.name = 's5-panorama';
  sphere.frustumCulled = false;
  sphere.visible = false;
  group.add(sphere);

  // ---- state -----------------------------------------------------------------
  const state = {
    view: panoramas.length ? panoramas[0].id : null, // the ridge wanted
    shown: null, // the one on the sphere
    immersive: false,
    layerOn: true,
    status: '',
    held: null, // core number in the hand
    distanceM: Infinity,
    loads: 0,
    disposals: 0,
    done: false,
    padSlopeDeg: pad.slopeDeg,
  };
  const textures = new Map(); // id -> { texture, bitmap, loading }
  let loadToken = 0;
  let screenDirty = true;
  let held = null;
  const head = new THREE.Vector3();
  const point = new THREE.Vector3();

  const fieldCheck = mission.fieldCheck || createFieldCheck({ mission });
  mission.fieldCheck = fieldCheck;
  const earlierOnDone = fieldCheck.onDone;
  fieldCheck.onDone = (score) => {
    if (earlierOnDone) earlierOnDone(score);
    screenDirty = true;
    checkDone();
  };

  function checkDone() {
    if (state.done || !tubes.every((t) => t.logged) || !fieldCheck.state.done) return;
    state.done = true;
    if (ctx.done) ctx.done();
  }

  // ---- panorama textures: loaded near, freed far --------------------------------
  function ensureTexture(id) {
    if (textures.has(id)) return;
    const pano = panoramas.find((p) => p.id === id);
    if (!pano) return;
    const entry = { texture: null, bitmap: null, loading: true, token: loadToken };
    textures.set(id, entry);
    state.loads++;
    const loader = new THREE.ImageBitmapLoader();
    loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' }); // decoded off the main thread
    loader.load(
      `./${pano.file}`,
      (bitmap) => {
        if (entry.token !== loadToken || textures.get(id) !== entry) {
          bitmap.close?.(); // freed while it was loading
          return;
        }
        const texture = new THREE.Texture(bitmap);
        texture.flipY = false; // already flipped while decoding
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping; // filters cleanly across north
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
        entry.texture = texture;
        entry.bitmap = bitmap;
        entry.loading = false;
      },
      undefined,
      () => {
        entry.loading = false;
        entry.failed = true;
      },
    );
  }
  function disposeTextures() {
    if (!textures.size) return;
    loadToken++;
    for (const entry of textures.values()) {
      if (entry.texture) entry.texture.dispose();
      if (entry.bitmap && entry.bitmap.close) entry.bitmap.close();
      state.disposals++;
    }
    textures.clear();
    sphere.material.map = null;
    sphere.material.needsUpdate = true;
    state.shown = null;
  }
  const ready = (id) => !!(textures.get(id) && textures.get(id).texture);

  // ---- the 360 view: hides the drawn world while it is open ----------------------
  const hidden = []; // [object, wasVisible]
  function setImmersive(on) {
    if (on === state.immersive) return;
    state.immersive = on;
    sphere.visible = on;
    if (on) {
      const world = mission.world || {};
      const targets = [world.terrain && world.terrain.group, world.surround && world.surround.mesh, mission.group, mission.layerSet && mission.layerSet.group];
      for (const object of targets) {
        if (!object) continue;
        hidden.push([object, object.visible]);
        object.visible = false;
      }
    } else {
      for (const [object, was] of hidden) object.visible = was;
      hidden.length = 0;
    }
    screenDirty = true;
  }

  function setView(id) {
    if (!panoramas.some((p) => p.id === id) || id === state.view) return false;
    state.view = id;
    screenDirty = true;
    return true;
  }
  function toggleView() {
    if (panoramas.length < 2) return false;
    const k = panoramas.findIndex((p) => p.id === state.view);
    return setView(panoramas[(k + 1) % panoramas.length].id);
  }

  // ---- tubes ---------------------------------------------------------------------
  function putBack() {
    if (!held) return;
    if (ctx.hand) ctx.hand.release();
    stand.add(held.mesh);
    held.mesh.position.copy(held.home);
    held.mesh.quaternion.identity();
    held.mesh.scale.setScalar(1);
    held = null;
    state.held = null;
    screenDirty = true;
  }
  function logCore(tube) {
    if (tube.logged) return;
    tube.logged = true;
    ensureStats(mission).coresLogged++;
    const core = tube.core;
    const entry = {
      title: `Core logged: ${core.name}`,
      lines: [`Sol ${core.sol} · ${core.lengthCm} cm · ${core.rockType} · ${core.feature}`, `Now: ${placeOf(core)} (NASA list, retrieved ${core.locationRetrieved}). Position approximate.`],
      station: station.id,
    };
    if (ctx.log) ctx.log(entry);
    if (ctx.flash) ctx.flash('SCAN');
    if (tubes.every((t) => t.logged)) {
      fieldCheck.open(); // all four logged: the Field Check comes up on the tablet
      checkDone();
    }
  }
  function take(tube) {
    if (held === tube) {
      putBack();
      return;
    }
    putBack();
    held = tube;
    state.held = tube.core.number;
    if (ctx.hand) ctx.hand.hold(tube.mesh);
    logCore(tube);
    screenDirty = true;
  }
  function tubeOnRay(ray) {
    let best = null;
    let bestAlong = Infinity;
    for (const tube of tubes) {
      if (tube === held) continue; // it rides on the pointing hand, in the ray's way
      tube.mesh.getWorldPosition(point);
      const along = point.sub(ray.origin).dot(ray.direction);
      if (along < 0 || along > 6) continue;
      tube.mesh.getWorldPosition(point);
      if (ray.distanceSqToPoint(point) > 0.11 * 0.11) continue;
      if (along < bestAlong) {
        bestAlong = along;
        best = tube;
      }
    }
    return best;
  }
  function nearRack() {
    camera.getWorldPosition(head);
    return Math.hypot(head.x - stand.position.x, head.z - stand.position.z) < REACH_M;
  }

  // ---- screen ---------------------------------------------------------------------
  function statusText() {
    if (!state.layerOn) return 'Surface panoramas are switched off (tablet, LAYERS).';
    const entry = textures.get(state.view);
    if (entry && entry.failed) return 'The panorama could not be loaded.';
    if (state.immersive) return state.shown === state.view ? 'Shown in its true compass direction.' : 'Loading the other ridge...';
    if (entry && entry.loading) return 'Loading the panorama...';
    return 'Stand on the pad to open the 360 view.';
  }

  function drawScreen() {
    screenDirty = false;
    const W = SCREEN_W;
    const g = screen.begin();
    g.fillStyle = THEME.bg;
    g.fillRect(0, 0, W, SCREEN_H);
    g.fillStyle = THEME.text;
    setFont(g, 56, 'bold');
    g.fillText(`${station.title}: 360 view`, 32, 76);

    // Which ridge.
    const half = (W - 64 - 16) / 2;
    panoramas.forEach((pano, k) => {
      const x = 32 + k * (half + 16);
      const on = pano.id === state.view;
      fillChamfer(g, x, 104, half, 100, { fill: on ? THEME.accent : THEME.card, stroke: on ? null : THEME.cardLine });
      g.fillStyle = on ? THEME.dark : THEME.text;
      g.textAlign = 'center';
      fitText(g, `${pano.feature} · sol ${pano.sol}`, x + half / 2, 170, 44, half - 30, { weight: 'bold', minPx: 34 });
      g.textAlign = 'left';
      screen.region(`view-${pano.id}`, x, 104, half, 100, () => setView(pano.id));
    });
    g.fillStyle = THEME.text;
    fitText(g, state.status, 32, 262, 42, W - 64, { minPx: 34 });
    const pano = panoramas.find((p) => p.id === state.view);
    g.fillStyle = THEME.dim;
    if (pano) fitText(g, `Photo: ${pano.credit}`, 32, 314, 38, W - 64, { minPx: 30 });

    // The four cores.
    g.fillStyle = THEME.accent;
    fitText(g, 'Cores sealed here: take a tube to log it (grip, G or click)', 32, 388, 42, W - 64, { weight: 'bold', minPx: 34 });
    tubes.forEach((tube, k) => {
      const core = tube.core;
      const y = 412 + k * 122;
      const inHand = held === tube;
      fillChamfer(g, 32, y, W - 64, 112, { fill: THEME.card, stroke: inHand ? THEME.amber : tube.logged ? THEME.accent : THEME.cardLine });
      g.fillStyle = tube.logged ? THEME.text : THEME.dim;
      fitText(g, `${k + 1}  ${core.name}`, 56, y + 50, 46, 380, { weight: 'bold', minPx: 34 });
      if (tube.logged) {
        g.fillStyle = THEME.text;
        fitText(g, `sol ${core.sol} · ${core.lengthCm} cm · ${core.rockType}`, 460, y + 50, 42, W - 64 - 460, { minPx: 34 });
        g.fillStyle = THEME.dim;
        fitText(g, `${core.feature} · now: ${placeOf(core)}${inHand ? ' · in your hand' : ''}`, 56, y + 96, 38, W - 130, { minPx: 30 });
      } else {
        g.fillStyle = THEME.dim;
        fitText(g, 'not logged yet', 460, y + 50, 42, W - 64 - 460, { minPx: 34 });
      }
    });
    const y = 412 + tubes.length * 122;
    g.fillStyle = THEME.dim;
    fitText(g, `${cardA.coreLocationsNote || `Locations retrieved ${retrieved}`}.`, 32, y + 40, 38, W - 64, { minPx: 30 });
    fitText(g, "Positions are approximate (the rover's waypoint at that sol).", 32, y + 86, 38, W - 64, { minPx: 30 });

    // Field Check.
    const all = tubes.every((t) => t.logged);
    const score = ensureStats(mission).fieldCheck;
    const by = y + 112;
    if (all) {
      fillChamfer(g, 32, by, W - 64, 116, { fill: score ? THEME.card : THEME.accent, stroke: score ? THEME.accent : null });
      g.fillStyle = score ? THEME.text : THEME.dark;
      g.textAlign = 'center';
      fitText(g, score ? `Field Check done: ${score.right} / ${score.total}` : 'FIELD CHECK (opens on the tablet)', W / 2, by + 76, 50, W - 120, { weight: 'bold', minPx: 34 });
      g.textAlign = 'left';
      screen.region('field-check', 32, by, W - 64, 116, () => fieldCheck.open());
    } else {
      fillChamfer(g, 32, by, W - 64, 116, { fill: THEME.bg, stroke: THEME.cardLine });
      g.fillStyle = THEME.dim;
      g.textAlign = 'center';
      fitText(g, `Log all ${tubes.length} cores to unlock the Field Check`, W / 2, by + 74, 44, W - 120, { minPx: 34 });
      g.textAlign = 'left';
    }
    g.fillStyle = THEME.dim;
    fitText(g, cardA.source, 32, SCREEN_H - 30, 34, W - 64, { minPx: 22 });
    screen.end();
  }

  // ---- cards (texts and sources from the mission file) -----------------------------
  function cards() {
    const places = new Map();
    for (const core of cores) {
      const place = placeOf(core);
      if (!places.has(place)) places.set(place, []);
      places.get(place).push(core.name);
    }
    const where = [...places].map(([place, names]) => `${place[0].toUpperCase()}${place.slice(1)}: ${names.join(', ')}`).join('. ');
    const columns = mission.cardText('S5B');
    return [
      {
        title: cardA.title,
        body: `${mission.cardText('S5A')}\nNow (NASA's list, retrieved ${retrieved}): ${where}. Positions are approximate (the rover's waypoint at that sol).`,
        source: cardA.source,
      },
      {
        title: cardB.title,
        body: '',
        columns: cardB.columns.map((column, k) => ({ heading: column.heading, text: columns[k] })),
        source: cardB.source,
      },
      {
        title: 'What to do here',
        body: `Stand on the pad for the 360 view; A (or E) switches between ${panoramas.map((p) => `${p.feature} (sol ${p.sol})`).join(' and ')}. Take each tube with the grip (G or click) to log it. Then take the Field Check on the tablet.`,
        source: `Panoramas: ${panoramas.length ? panoramas[0].credit : ''}`,
      },
    ];
  }

  // One "what to do now" line for the card. The same string object until something changes.
  let promptKey = 0;
  let promptText = '';
  function prompt() {
    const logged = tubes.reduce((n, t) => n + (t.logged ? 1 : 0), 0);
    const key = 1 + logged * 16 + (state.done ? 1 : 0) + (fieldCheck.state.done ? 2 : 0) + (state.immersive ? 4 : 0) + (state.layerOn ? 8 : 0); // a number: no garbage per frame
    if (key === promptKey) return promptText;
    promptKey = key;
    if (state.done) promptText = 'Stop complete.';
    else if (logged === tubes.length) promptText = 'Take the Field Check on the tablet.';
    else if (!state.immersive && state.layerOn) promptText = `Stand on the pad for the 360 view. Cores logged: ${logged} of ${tubes.length}.`;
    else promptText = `Take a tube to log it (grip, G or click). Cores logged: ${logged} of ${tubes.length}.`;
    return promptText;
  }

  const api = {
    id: station.id,
    title: station.title,
    group,
    activationRadiusM: ACTIVATION_RADIUS_M,
    radiusM: ACTIVATION_RADIUS_M, // the name the station framework reads
    prompt,
    cards,
    state,
    pad,
    stand,
    screen,
    tubes,
    sphere,
    dome,
    fieldCheck,
    setView,
    toggleView,
    take: (number) => {
      const tube = tubes.find((t) => t.core.number === number);
      if (tube) take(tube);
      return !!tube;
    },

    onEnter() {
      screenDirty = true;
    },
    // The framework may stop calling update() after this: leave nothing hidden or loaded.
    onLeave() {
      putBack();
      setImmersive(false);
      disposeTextures();
      dome.visible = state.layerOn;
    },

    // Once per frame. No allocations.
    update() {
      camera.getWorldPosition(head);
      const d = Math.hypot(head.x - pad.x, head.z - pad.z);
      state.distanceM = d;
      const layerOn = mission.layerVisible ? mission.layerVisible('panoramas') : true;
      if (layerOn !== state.layerOn) {
        state.layerOn = layerOn;
        screenDirty = true;
      }
      if (!layerOn || d > DISPOSE_M) disposeTextures();
      else if (d < LOAD_M && state.view) ensureTexture(state.view);

      // Put the wanted ridge on the sphere as soon as it is there.
      if (state.view && state.shown !== state.view && ready(state.view)) {
        sphere.material.map = textures.get(state.view).texture;
        sphere.material.needsUpdate = true;
        state.shown = state.view;
        screenDirty = true;
      }
      const inside = layerOn && d < (state.immersive ? EXIT_M : ENTER_M) && Math.abs(head.y - pad.y) < 4 && state.shown !== null;
      setImmersive(inside);
      if (state.immersive) sphere.position.copy(head);
      dome.visible = layerOn && !state.immersive;

      const status = statusText();
      if (status !== state.status) {
        state.status = status;
        screenDirty = true;
      }
      if (screenDirty) drawScreen();
    },

    onInput(kind, info) {
      if (kind === 'select') {
        const tube = info && info.ray ? tubeOnRay(info.ray) : null;
        if (!tube) return false;
        take(tube);
        return true;
      }
      if (kind === 'grip') {
        if (!nearRack()) return false;
        const next = tubes.find((t) => !t.logged);
        if (next) take(next);
        else putBack();
        return true;
      }
      if (kind === 'scan') {
        camera.getWorldPosition(head);
        if (!state.layerOn || Math.hypot(head.x - pad.x, head.z - pad.z) > ACTIVATION_RADIUS_M) return false;
        if (!toggleView()) return false;
        if (ctx.flash) ctx.flash('SCAN');
        return true;
      }
      return false;
    },

    isDone: () => state.done,

    stats() {
      let triangles = 0;
      let drawCalls = 0;
      group.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        const geometry = object.geometry;
        triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
        drawCalls++;
      });
      return { triangles, drawCalls, textures: textures.size };
    },

    dispose() {
      api.onLeave();
      if (mission.ui) mission.ui.remove(screen);
      screen.dispose();
    },
  };
  return api;
}
