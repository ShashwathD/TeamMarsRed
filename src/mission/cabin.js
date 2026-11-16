import * as THREE from 'three';
import { PALETTE, css, lowPolyMaterial, mergeParts } from './lowpoly.js';
import { THEME, createPanel, drawParagraph, fillChamfer, fitText, setFont } from './ui.js';

// Mission B8: the rover cabin (brief: CABIN, S1 BRIEFING, DEBRIEF).
//
// The experience starts here. The cabin is a static low-poly room standing at
// the mission's start spot; while the player is inside, the terrain, the
// backdrop and every mission world object are hidden, and while outside the
// cabin is hidden. Nothing in the cabin moves: DEPART only plays a starfield
// outside the window for about 6 seconds, then the airlock light turns green.
//
//   phases   'briefing' -> (DEPART) 'transit' -> 'arrived' -> (door) 'eva'
//            -> (return marker) 'debrief' -> (door again, if wanted) 'eva' ...
//   inside   true in every phase except 'eva'
//
// ---------------------------------------------------------------------------
// MERGE NOTES (for whoever joins this with the station framework, B5 to B7)
//
// 1. mission.stats is the ONE object the debrief reads. Fields and defaults:
//      stationsDone 0      stations finished            (stations / framework fill this)
//      stationCount 0      stations in the walk         (0 = cabin uses the route's {station_count})
//      coresLogged  0      cores logged                 (S4, S5 fill this)
//      coreCount    5      cores in the mission         (cabin sets it from data.cores.length)
//      slopeWarnings 0     slope cautions               (cabin copies mission.slopeWarnings amber + red)
//      fieldCheck   null   { right, total } once taken  (Field Check fills this)
//      distanceM    0      ground covered, metres       (cabin: mirrors mission.clock.distanceM)
//      path         []     flat [x0, z0, x1, z1, ...]   (cabin: head position about every PATH_STEP_M metres)
//    CAREFUL: mission.stats already exists since B2 as a FUNCTION (triangle and
//    draw-call counts), so "if (!mission.stats) mission.stats = {...}" never
//    runs. ensureStats() below therefore puts any missing field on whatever
//    mission.stats is (the function too) and repairs NaN counters, and the
//    cabin always reads mission.stats afresh, with safe fallbacks. If the
//    merge renames the old function and makes stats a plain object, nothing
//    here needs to change.
// 2. Hiding the world: on entering, every direct child of the scene is hidden
//    except the cabin, the player rig, lights, the sky, the UI pointers and
//    the tablet; objects added to the scene later (station groups from a
//    dynamic import) are caught on the next frame. Their own visibility is
//    restored on leaving. Add an object to cabin.keepVisible to exempt it.
// 3. Input: the cabin WRAPS xr.hooks.select, xr.hooks.desktopAim and
//    mission.travelTo (no teleport, no tablet map jump inside the cabin) and
//    sets mission.actions.door. Code that sets these hooks later must call the
//    previous hook, or the cabin's door and return marker stop working in VR.
//    Outside, a trigger / click whose ray hits the return marker is used up.
// 4. cabin.onChange(inside, phase) is called on every phase change.
// 5. EVA time is mission.clock.elapsedS; the clock is stopped (running = false)
//    while inside.
// ---------------------------------------------------------------------------

const GREEN = 0x3fd07a; // "green on arrival": the one colour outside the shared palette

// Room, in cabin metres: x right, y up from the floor, -z toward the window, +z toward the airlock.
const HALF_W = 2.1;
const FRONT_Z = -2.7;
const BACK_Z = 2.3;
const HEIGHT = 2.6;
const WALL = 0.15;
const WINDOW = { halfW: 1.6, y0: 1.15, y1: 2.25 };
const DOOR = { halfW: 0.6, height: 2.15 };
const STAND = { x: 0, z: 0.45 }; // where the player stands on entering
const TABLE = { x: 0.15, z: -1.2, radius: 0.74, top: 0.85 };
const CARD = { x: -0.88, y: 1.38, z: -1.3, yaw: 0.48, widthM: 0.96 };
const SCREEN = { x: 0.75, y: 1.2, z: -2.42, tilt: THREE.MathUtils.degToRad(30) };
// Desktop walking stays inside this box and off the hologram table.
const WALK = { minX: -1.75, maxX: 1.75, minZ: -1.7, maxZ: 1.95, tableClear: 0.3 };

const HOLO_SIZE_M = 0.9; // the relief model is this wide
const HOLO_GRID = 33; // the terrain is thinned to 33 x 33 heights (2,048 triangles)
const HOLO_HEIGHT_M = 0.2; // tallest point of the model, before rounding the exaggeration
const ROUTE_DOT_EVERY_M = 25; // one dot of the route preview per this many metres of route

const TRANSIT_S = 6;
const STAR_COUNT = 360;
const STAR_SPEED = 70; // m/s at the peak
const WINDOW_VIEW = true; // after arrival, show the thinned real terrain through the window

const PATH_STEP_M = 3; // the path taken is recorded about this often
const PATH_MAX_POINTS = 3000;
const REPLAY_S = 8;
const REPLAY_HOLD_S = 2;

const ROVER_AT = { x: 3.4, z: -3.2 }; // the return marker (a small rover), in cabin metres: beside and behind the airlock pillar
const RETURN_NEAR_M = 12; // B works within this distance of the marker: that includes the walk's start spot (9.8 m away), where a map jump to the airlock lands
const RETURN_POINT_M = 40; // pointing works up to this far away
const MARKER_HIT = { y: 1.6 }; // height of the marker's centre, for distances
const MARKER_BOX = { halfW: 1.7, halfL: 2.75, height: 3.6 }; // the rover, padded, in its own metres

const STAT_DEFAULTS = { stationsDone: 0, stationCount: 0, coresLogged: 0, coreCount: 5, slopeWarnings: 0, fieldCheck: null, distanceM: 0 };

// See merge note 1. Returns mission.stats with every field present.
export function ensureStats(mission) {
  if (!mission.stats) mission.stats = {};
  const stats = mission.stats;
  for (const key of Object.keys(STAT_DEFAULTS)) {
    const value = stats[key];
    if (key === 'fieldCheck') {
      if (value === undefined) stats[key] = null;
    } else if (!Number.isFinite(value)) stats[key] = STAT_DEFAULTS[key];
  }
  if (!Array.isArray(stats.path)) stats.path = [];
  return stats;
}

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

function formatDuration(seconds) {
  const minutes = Math.round(Math.max(seconds, 0) / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const formatDistance = (metres) => (metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`);

// Small repeatable random numbers (the starfield looks the same every time).
function randomSource(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const box = (w, h, d, color, x, y, z, { rotX = 0, rotY = 0 } = {}) => {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (rotX) geometry.rotateX(rotX);
  return { geometry, color, x, y, z, rotY };
};
const cylinder = (rTop, rBottom, h, sides, color, x, y, z, { rotX = 0, rotZ = 0 } = {}) => {
  const geometry = new THREE.CylinderGeometry(rTop, rBottom, h, sides);
  if (rotX) geometry.rotateX(rotX);
  if (rotZ) geometry.rotateZ(rotZ);
  return { geometry, color, x, y, z };
};
const gem = (radius, color, x, y, z) => ({ geometry: new THREE.IcosahedronGeometry(radius, 0), color, x, y, z });

// The terrain thinned to n x n heights (each the mean of a 5 x 5 block of
// samples around its place), over the walkable square of the patch.
function thinTerrain(patch, n) {
  const b = patch.bounds;
  const stepX = (b.maxX - b.minX) / (n - 1);
  const stepZ = (b.maxZ - b.minZ) / (n - 1);
  const h = new Float32Array(n * n);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let sum = 0;
      let got = 0;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const y = patch.groundY(b.minX + (c + i / 5) * stepX, b.minZ + (r + j / 5) * stepZ);
          if (!Number.isNaN(y)) {
            sum += y;
            got++;
          }
        }
      }
      const y = got ? sum / got : 0;
      h[r * n + c] = y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  return {
    n,
    h,
    min,
    max,
    stepX,
    stepZ,
    minX: b.minX,
    minZ: b.minZ,
    // Bilinear height at local (x, z). No allocations.
    sample(x, z) {
      const fc = Math.min(Math.max((x - b.minX) / stepX, 0), n - 1);
      const fr = Math.min(Math.max((z - b.minZ) / stepZ, 0), n - 1);
      const c0 = Math.min(Math.floor(fc), n - 2);
      const r0 = Math.min(Math.floor(fr), n - 2);
      const tx = fc - c0;
      const tz = fr - r0;
      const i = r0 * n + c0;
      return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - tz) + (h[i + n] * (1 - tx) + h[i + n + 1] * tx) * tz;
    },
  };
}

// Flat-shaded mesh geometry of the thinned terrain in real metres, coloured by height.
function terrainGeometry(grid) {
  const { n, h } = grid;
  const triangles = (n - 1) * (n - 1) * 2;
  const positions = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 9);
  const low = new THREE.Color(PALETTE.marsDeep);
  const high = new THREE.Color(PALETTE.marsOrange).lerp(new THREE.Color(PALETTE.offWhite), 0.45);
  const tint = new THREE.Color();
  const range = Math.max(grid.max - grid.min, 1e-6);
  let o = 0;
  const corner = (r, c) => [grid.minX + c * grid.stepX, h[r * n + c], grid.minZ + r * grid.stepZ];
  const triangle = (a, b, c) => {
    tint.lerpColors(low, high, ((a[1] + b[1] + c[1]) / 3 - grid.min) / range);
    for (const p of [a, b, c]) {
      positions.set(p, o);
      colors[o] = tint.r;
      colors[o + 1] = tint.g;
      colors[o + 2] = tint.b;
      o += 3;
    }
  };
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const nw = corner(r, c);
      const ne = corner(r, c + 1);
      const sw = corner(r + 1, c);
      const se = corner(r + 1, c + 1);
      triangle(nw, sw, ne); // counter-clockwise seen from above (z points south)
      triangle(ne, sw, se);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// The room and its furniture, as one mesh geometry (the door and the lamps are separate).
function roomParts() {
  const P = PALETTE;
  const depth = BACK_Z - FRONT_Z;
  const midZ = (BACK_Z + FRONT_Z) / 2;
  const sideW = HALF_W - WINDOW.halfW;
  const doorSide = HALF_W - DOOR.halfW;
  const parts = [
    // shell
    box(2 * HALF_W + 2 * WALL, 0.1, depth + 2 * WALL, P.slate, 0, -0.05, midZ),
    box(2 * HALF_W + 2 * WALL, 0.1, depth + 2 * WALL, P.slate, 0, HEIGHT + 0.05, midZ),
    box(WALL, HEIGHT, depth, P.offWhite, -HALF_W - WALL / 2, HEIGHT / 2, midZ),
    box(WALL, HEIGHT, depth, P.offWhite, HALF_W + WALL / 2, HEIGHT / 2, midZ),
    // front wall around the window
    box(2 * HALF_W, WINDOW.y0, WALL, P.offWhite, 0, WINDOW.y0 / 2, FRONT_Z - WALL / 2),
    box(2 * HALF_W, HEIGHT - WINDOW.y1, WALL, P.offWhite, 0, (HEIGHT + WINDOW.y1) / 2, FRONT_Z - WALL / 2),
    box(sideW, WINDOW.y1 - WINDOW.y0, WALL, P.offWhite, -HALF_W + sideW / 2, (WINDOW.y0 + WINDOW.y1) / 2, FRONT_Z - WALL / 2),
    box(sideW, WINDOW.y1 - WINDOW.y0, WALL, P.offWhite, HALF_W - sideW / 2, (WINDOW.y0 + WINDOW.y1) / 2, FRONT_Z - WALL / 2),
    // chunky window frame and two posts
    box(2 * WINDOW.halfW + 0.24, 0.12, 0.12, P.slate, 0, WINDOW.y0 - 0.02, FRONT_Z + 0.02),
    box(2 * WINDOW.halfW + 0.24, 0.12, 0.12, P.slate, 0, WINDOW.y1 + 0.02, FRONT_Z + 0.02),
    box(0.12, WINDOW.y1 - WINDOW.y0, 0.12, P.slate, -WINDOW.halfW - 0.06, (WINDOW.y0 + WINDOW.y1) / 2, FRONT_Z + 0.02),
    box(0.12, WINDOW.y1 - WINDOW.y0, 0.12, P.slate, WINDOW.halfW + 0.06, (WINDOW.y0 + WINDOW.y1) / 2, FRONT_Z + 0.02),
    box(0.08, WINDOW.y1 - WINDOW.y0, 0.08, P.slate, -0.55, (WINDOW.y0 + WINDOW.y1) / 2, FRONT_Z + 0.02),
    box(0.08, WINDOW.y1 - WINDOW.y0, 0.08, P.slate, 0.55, (WINDOW.y0 + WINDOW.y1) / 2, FRONT_Z + 0.02),
    // back wall around the airlock door, and the door frame
    box(doorSide, HEIGHT, WALL, P.offWhite, -HALF_W + doorSide / 2, HEIGHT / 2, BACK_Z + WALL / 2),
    box(doorSide, HEIGHT, WALL, P.offWhite, HALF_W - doorSide / 2, HEIGHT / 2, BACK_Z + WALL / 2),
    box(2 * DOOR.halfW, HEIGHT - DOOR.height, WALL, P.offWhite, 0, (HEIGHT + DOOR.height) / 2, BACK_Z + WALL / 2),
    box(0.14, DOOR.height + 0.14, 0.14, P.slate, -DOOR.halfW - 0.07, (DOOR.height + 0.14) / 2, BACK_Z - 0.03),
    box(0.14, DOOR.height + 0.14, 0.14, P.slate, DOOR.halfW + 0.07, (DOOR.height + 0.14) / 2, BACK_Z - 0.03),
    box(2 * DOOR.halfW + 0.28, 0.14, 0.14, P.slate, 0, DOOR.height + 0.07, BACK_Z - 0.03),
    box(0.34, 0.2, 0.1, P.slate, 0, DOOR.height + 0.26, BACK_Z - 0.04), // lamp housing
    // orange stripe along both side walls, two ceiling light slabs
    box(0.03, 0.14, depth, P.marsOrange, -HALF_W + 0.015, 1.0, midZ),
    box(0.03, 0.14, depth, P.marsOrange, HALF_W - 0.015, 1.0, midZ),
    box(1.2, 0.05, 0.5, P.offWhite, 0, HEIGHT - 0.025, -0.9),
    box(1.2, 0.05, 0.5, P.offWhite, 0, HEIGHT - 0.025, 1.1),
    // control console under the window
    box(3.9, 0.85, 0.7, P.slate, 0, 0.425, -2.35),
    box(4.0, 0.06, 0.78, P.offWhite, 0, 0.88, -2.33),
    box(4.0, 0.08, 0.03, P.marsOrange, 0, 0.6, -1.99),
    box(1.52, 0.8, 0.08, P.slate, SCREEN.x, SCREEN.y, SCREEN.z, { rotX: -SCREEN.tilt }), // screen housing
    // joystick
    cylinder(0.13, 0.15, 0.05, 6, P.slate, -0.35, 0.935, -2.28),
    cylinder(0.028, 0.028, 0.26, 6, P.offWhite, -0.35, 1.07, -2.25, { rotX: 0.22 }),
    gem(0.07, P.marsOrange, -0.35, 1.21, -2.22),
    // two dials
    cylinder(0.08, 0.1, 0.05, 6, P.teal, -0.72, 0.935, -2.42),
    cylinder(0.08, 0.1, 0.05, 6, P.amber, -0.72, 0.935, -2.18),
    // hologram table
    cylinder(0.34, 0.46, 0.75, 8, P.slate, TABLE.x, 0.375, TABLE.z),
    cylinder(TABLE.radius, 0.64, 0.1, 8, P.offWhite, TABLE.x, TABLE.top - 0.05, TABLE.z),
    cylinder(0.62, 0.62, 0.02, 8, P.teal, TABLE.x, TABLE.top + 0.01, TABLE.z),
    // stand of the briefing card
    box(0.07, 0.26, 0.07, P.slate, CARD.x + 0.34, TABLE.top + 0.1, CARD.z + 0.12),
    box(CARD.widthM + 0.06, 0.05, 0.06, P.teal, CARD.x, CARD.y - CARD.widthM * 0.375 - 0.03, CARD.z, { rotY: CARD.yaw }),
    // frame of the mission-log panel on the left wall
    box(0.04, 1.55, 1.2, P.slate, -HALF_W + 0.02, 1.45, 0.3),
  ];
  // decorative buttons: two rows of five
  const buttonColors = [P.teal, P.amber, P.red, P.slate, P.marsOrange];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 5; i++) {
      parts.push(box(0.09, 0.04, 0.09, buttonColors[(i + row * 2) % 5], -1.7 + i * 0.17, 0.93, -2.42 + row * 0.2));
    }
  }
  return parts;
}

function doorParts() {
  const P = PALETTE;
  return [
    box(2 * DOOR.halfW, DOOR.height, 0.1, P.offWhite, 0, DOOR.height / 2, BACK_Z + 0.05),
    box(2 * DOOR.halfW, 0.2, 0.03, P.marsOrange, 0, 1.05, BACK_Z - 0.01),
    cylinder(0.22, 0.22, 0.04, 6, P.teal, 0, 1.6, BACK_Z - 0.015, { rotX: Math.PI / 2 }),
    box(0.08, 0.3, 0.07, P.slate, DOOR.halfW - 0.14, 1.05, BACK_Z - 0.04),
  ];
}

// The "return to rover" marker: a small chunky rover, nose toward -z, airlock hatch at the back (+z).
function roverParts() {
  const P = PALETTE;
  const parts = [
    box(2.2, 0.3, 4.0, P.slate, 0, 0.85, 0),
    box(2.2, 1.3, 3.2, P.offWhite, 0, 1.65, 0.2),
    box(2.0, 0.9, 0.9, P.offWhite, 0, 1.45, -1.75),
    box(1.7, 0.5, 0.06, P.teal, 0, 1.6, -2.22),
    box(2.24, 0.2, 3.24, P.marsOrange, 0, 1.25, 0.2),
    box(1.1, 1.5, 0.08, P.slate, 0, 1.65, 1.82),
    box(0.9, 1.3, 0.06, P.teal, 0, 1.65, 1.86),
    box(1.0, 0.25, 0.6, P.slate, 0, 0.5, 2.1),
    box(1.0, 0.25, 0.3, P.slate, 0, 0.25, 2.45),
    box(0.12, 1.0, 0.12, P.slate, 0.7, 2.8, -1.2),
    box(0.5, 0.25, 0.3, P.offWhite, 0.7, 3.35, -1.25),
    gem(0.16, GREEN, 0, 2.55, 1.86),
  ];
  for (const side of [-1, 1]) {
    for (const z of [-1.4, 0, 1.4]) parts.push(cylinder(0.55, 0.55, 0.4, 7, P.slate, side * 1.25, 0.55, z, { rotZ: Math.PI / 2 }));
  }
  return parts;
}

const triangleCount = (geometry) => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

// Needs the mission (mission.js), the scene, camera, renderer, the player rig
// (controls.js) and the patch; xr (xr.js), terrain and surround are optional.
// The caller then calls cabin.enter() to start inside, or cabin.startOutside().
export function createCabin({ mission, scene, camera, renderer, player, xr = null, patch, terrain = null, surround = null }) {
  const data = mission.data;
  const clock = mission.clock;
  const ui = mission.ui;
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  ensureStats(mission);

  const state = {
    inside: false,
    phase: 'eva', // 'briefing' | 'transit' | 'arrived' | 'eva' | 'debrief'
    transitS: 0,
    flash: 0,
    evaCount: 0,
    returns: 0,
    doorRefused: 0,
    replayS: 0,
    replayPoints: 0,
    pathStepM: PATH_STEP_M,
    lastAction: null,
  };

  // ---- where the cabin stands ------------------------------------------------
  // On the start spot, floor at the ground height there, window away from the
  // place the walk begins (so the airlock, behind the player, leads to it).
  const headingDeg = (mission.spawn.headingDeg + 180) % 360;
  const floorY = patch.groundY(data.start.x, data.start.z);
  const group = new THREE.Group();
  group.name = 'cabin';
  group.position.set(data.start.x, floorY, data.start.z);
  group.rotation.y = -THREE.MathUtils.degToRad(headingDeg);
  group.visible = false;
  scene.add(group);

  const material = lowPolyMaterial();
  const room = new THREE.Mesh(mergeParts(roomParts()), material);
  room.name = 'cabin-room';
  const door = new THREE.Mesh(mergeParts(doorParts()), material);
  door.name = 'cabin-door';
  group.add(room, door);

  // Airlock lamp above the door (red in transit, green on arrival) and a repeater on the console.
  const lampMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.red, fog: false, toneMapped: false });
  const lampGeometry = new THREE.IcosahedronGeometry(0.11, 0);
  const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
  lamp.name = 'cabin-airlock-lamp';
  lamp.position.set(0, DOOR.height + 0.26, BACK_Z - 0.14);
  const lampRepeat = new THREE.Mesh(lampGeometry, lampMaterial);
  lampRepeat.name = 'cabin-console-lamp';
  lampRepeat.scale.setScalar(0.6);
  lampRepeat.position.set(-0.05, 0.96, -2.2);
  group.add(lamp, lampRepeat);

  // Glass: a faint pane, also used for the short white-out when the transit ends.
  const glassColor = new THREE.Color(PALETTE.teal);
  const flashColor = new THREE.Color(PALETTE.offWhite);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * WINDOW.halfW, WINDOW.y1 - WINDOW.y0),
    new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.1, depthWrite: false, fog: false, toneMapped: false }),
  );
  glass.name = 'cabin-glass';
  glass.position.set(0, (WINDOW.y0 + WINDOW.y1) / 2, FRONT_Z - 0.02);
  glass.renderOrder = 5;
  group.add(glass);

  // ---- outside the window: space (before arrival) -----------------------------
  const space = new THREE.Group();
  space.name = 'cabin-space';
  group.add(space);
  const dark = new THREE.Mesh(
    new THREE.BoxGeometry(240, 160, 140),
    new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide, fog: false, toneMapped: false }),
  );
  dark.name = 'cabin-space-dark';
  dark.position.set(0, 1.7, FRONT_Z - 0.4 - 70);
  space.add(dark);

  // Stars: short lines that stretch toward the viewer with speed. One uniform
  // write per frame; the motion is in the vertex shader.
  const starPositions = new Float32Array(STAR_COUNT * 6);
  const starEnds = new Float32Array(STAR_COUNT * 2);
  const random = randomSource(20261115);
  for (let i = 0; i < STAR_COUNT; i++) {
    let x = 0;
    let y = 0;
    while (Math.hypot(x, y) < 2.5) {
      x = (random() - 0.5) * 90;
      y = (random() - 0.5) * 60;
    }
    const z = random() * 100;
    starPositions.set([x, y, z, x, y, z], i * 6);
    starEnds[i * 2 + 1] = 1;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('aEnd', new THREE.BufferAttribute(starEnds, 1));
  const starUniforms = { uShift: { value: 0 }, uStretch: { value: 0 }, uColor: { value: new THREE.Color(PALETTE.routeBlueLight) } };
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    vertexShader: /* glsl */ `
      attribute float aEnd;
      uniform float uShift;
      uniform float uStretch;
      varying float vTail;
      void main() {
        float z = mod(position.z + uShift, 100.0) - 100.0; // -100 (far) .. 0 (at the window)
        z -= aEnd * uStretch;
        vTail = aEnd;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, position.y, z, 1.0);
        gl_PointSize = 2.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vTail;
      void main() {
        gl_FragColor = vec4(mix(vec3(1.0), uColor, vTail), 1.0);
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  const starLines = new THREE.LineSegments(starGeometry, starMaterial);
  starLines.name = 'cabin-stars';
  const starDots = new THREE.Points(starGeometry, starMaterial);
  starDots.name = 'cabin-star-dots';
  for (const stars of [starLines, starDots]) {
    stars.position.set(0, 1.7, FRONT_Z - 1.5);
    stars.frustumCulled = false;
    space.add(stars);
  }

  // ---- the terrain thinned to 33 x 33: hologram relief, and the view after arrival ---
  const grid = thinTerrain(patch, HOLO_GRID);
  const reliefGeometry = terrainGeometry(grid);
  const holoScale = HOLO_SIZE_M / (patch.bounds.maxX - patch.bounds.minX);
  // Heights are stretched by a whole number so the relief can be read on a 0.9 m model.
  const exaggeration = Math.max(1, Math.round(HOLO_HEIGHT_M / Math.max((grid.max - grid.min) * holoScale, 1e-6)));
  const holoY = holoScale * exaggeration;

  // The hologram's axes are the world's (north on the model is north outside).
  const holo = new THREE.Group();
  holo.name = 'cabin-hologram';
  holo.position.set(TABLE.x, TABLE.top + 0.06, TABLE.z);
  holo.rotation.y = -group.rotation.y;
  group.add(holo);
  const relief = new THREE.Mesh(reliefGeometry, material);
  relief.name = 'cabin-hologram-relief';
  relief.scale.set(holoScale, holoY, holoScale);
  relief.position.y = -grid.min * holoY;
  holo.add(relief);
  // A world place on the model, liftM above its surface.
  const holoPoint = (x, z, liftM, target) => target.set(x * holoScale, (grid.sample(x, z) - grid.min) * holoY + liftM, z * holoScale);

  const scratch = new THREE.Vector3();
  // MINERALS HOOK: the dots are built by a function so they can follow a route
  // that was re-planned through mineral deposits (cabin.setHologramRoute).
  const routeDotPositions = (routePoints) => {
    const dots = [];
    let along = ROUTE_DOT_EVERY_M;
    for (let i = 0; i < routePoints.length; i++) {
      if (i > 0) along += Math.hypot(routePoints[i][0] - routePoints[i - 1][0], routePoints[i][1] - routePoints[i - 1][1]);
      if (along < ROUTE_DOT_EVERY_M) continue;
      along = 0;
      holoPoint(routePoints[i][0], routePoints[i][1], 0.012, scratch);
      dots.push(scratch.x, scratch.y, scratch.z);
    }
    return new THREE.Float32BufferAttribute(dots, 3);
  };
  const routeDots = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', routeDotPositions(data.route.points)),
    new THREE.PointsMaterial({ color: PALETTE.routeBlueLight, size: 0.011, sizeAttenuation: true, fog: false, toneMapped: false }),
  );
  routeDots.name = 'cabin-hologram-route';
  holo.add(routeDots);

  // Pins: the start (orange) and each stop (teal).
  const pinParts = mission.beacons.map((beacon) => {
    holoPoint(beacon.x, beacon.z, 0.034, scratch);
    const geometry = new THREE.ConeGeometry(0.017, 0.05, 4);
    geometry.rotateX(Math.PI); // tip down
    return { geometry, color: beacon.id === 'START' ? PALETTE.roverOrange : PALETTE.teal, x: scratch.x, y: scratch.y, z: scratch.z };
  });
  const pins = new THREE.Mesh(mergeParts(pinParts), material);
  pins.name = 'cabin-hologram-pins';
  holo.add(pins);

  // Route replay (debrief): the path actually taken, drawn a little further each frame.
  const replayPositions = new Float32Array(PATH_MAX_POINTS * 3);
  const replayGeometry = new THREE.BufferGeometry();
  replayGeometry.setAttribute('position', new THREE.BufferAttribute(replayPositions, 3));
  replayGeometry.setDrawRange(0, 0);
  const replayLine = new THREE.Line(replayGeometry, new THREE.LineBasicMaterial({ color: PALETTE.amber, fog: false, toneMapped: false }));
  replayLine.name = 'cabin-hologram-replay';
  replayLine.frustumCulled = false;
  replayLine.visible = false;
  const replayDot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.014, 0), new THREE.MeshBasicMaterial({ color: PALETTE.amber, fog: false, toneMapped: false }));
  replayDot.name = 'cabin-hologram-replay-dot';
  replayDot.visible = false;
  holo.add(replayLine, replayDot);

  // After arrival the window looks onto the same thinned terrain at full size,
  // in its real place, set low enough to stay under the cabin floor. (The
  // real terrain and photo stay hidden while inside.)
  const outside = new THREE.Mesh(reliefGeometry, material);
  outside.name = 'cabin-window-view';
  let highest = -Infinity;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) highest = Math.max(highest, grid.sample(data.start.x + i * 8, data.start.z + j * 8));
  outside.position.y = floorY - 1.1 - highest;
  outside.visible = false;
  scene.add(outside);

  // ---- panels (ui.js) ----------------------------------------------------------
  const card = createPanel({ name: 'cabin-card', widthPx: 1024, heightPx: 768, widthM: CARD.widthM, anisotropy });
  card.mesh.position.set(CARD.x, CARD.y, CARD.z);
  card.mesh.rotation.y = CARD.yaw;
  const consolePanel = createPanel({ name: 'cabin-console', widthPx: 1024, heightPx: 512, widthM: 1.4, anisotropy });
  consolePanel.mesh.rotation.x = -SCREEN.tilt;
  consolePanel.mesh.position.set(SCREEN.x, SCREEN.y + 0.045 * Math.sin(SCREEN.tilt), SCREEN.z + 0.045 * Math.cos(SCREEN.tilt));
  const logPanel = createPanel({ name: 'cabin-log', widthPx: 768, heightPx: 1024, widthM: 1.1, anisotropy });
  logPanel.mesh.position.set(-HALF_W + 0.045, 1.45, 0.3);
  logPanel.mesh.rotation.y = Math.PI / 2;
  const doorSign = createPanel({ name: 'cabin-door-sign', widthPx: 512, heightPx: 256, widthM: 0.8, anisotropy });
  doorSign.mesh.position.set(1.3, 1.5, BACK_Z - 0.01);
  doorSign.mesh.rotation.y = Math.PI;
  for (const panel of [card, consolePanel, logPanel, doorSign]) {
    group.add(panel.mesh);
    if (ui) ui.add(panel);
  }

  // ---- the return marker, outside ------------------------------------------------
  const marker = new THREE.Group();
  marker.name = 'return-marker';
  const roverAt = new THREE.Vector3(ROVER_AT.x, 0, ROVER_AT.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), group.rotation.y);
  roverAt.x += data.start.x;
  roverAt.z += data.start.z;
  roverAt.y = patch.groundY(roverAt.x, roverAt.z);
  if (Number.isNaN(roverAt.y)) roverAt.y = floorY;
  marker.position.copy(roverAt);
  const rover = new THREE.Mesh(mergeParts(roverParts()), material);
  rover.name = 'return-marker-rover';
  rover.rotation.y = group.rotation.y;
  marker.add(rover);
  const markerSign = createPanel({ name: 'return-marker-sign', widthPx: 512, heightPx: 192, widthM: 2.6, anisotropy });
  markerSign.mesh.position.y = 4.4;
  marker.add(markerSign.mesh);
  if (ui) ui.add(markerSign);
  marker.visible = false;
  scene.add(marker);
  const markerCentre = new THREE.Vector3(roverAt.x, roverAt.y + MARKER_HIT.y, roverAt.z);

  // ---- numbers shown -----------------------------------------------------------
  const assumption = (id) => data.assumptions.find((a) => a.id === id);
  const evaHours = assumption('evaHours');
  const reserveHours = assumption('reserveHours');
  const clockNote =
    evaHours && reserveHours
      ? `EVA clock: ${evaHours.value} h in total, ${reserveHours.value} h kept as reserve (${evaHours.label}).`
      : '';
  const terrainLayer = (data.layers || []).find((layer) => layer.id === 'slope');
  const patchKm = (patch.bounds.maxX - patch.bounds.minX) / 1000;
  const reliefNote =
    `Hologram: this ${patchKm.toFixed(1)} km square of ground (${terrainLayer ? terrainLayer.source : 'terrain model'}), ` +
    `thinned to ${HOLO_GRID} x ${HOLO_GRID} heights, heights stretched x${exaggeration}. Blue dots: the planned route. Pins: the start and the stops.`;

  // What the debrief shows, read afresh from mission.stats (see merge note 1).
  function debriefNumbers() {
    const stats = ensureStats(mission);
    const warnings = mission.slopeWarnings;
    if (warnings) stats.slopeWarnings = count(warnings.amber) + count(warnings.red);
    if (Array.isArray(data.cores)) stats.coreCount = data.cores.length;
    const stationCount = count(stats.stationCount) || count(mission.values.station_count);
    const check = stats.fieldCheck && Number.isFinite(stats.fieldCheck.right) && Number.isFinite(stats.fieldCheck.total) ? stats.fieldCheck : null;
    return {
      evaS: clock.elapsedS,
      totalS: clock.totalS,
      distanceM: Number.isFinite(stats.distanceM) ? stats.distanceM : 0,
      stationsDone: count(stats.stationsDone),
      stationCount,
      coresLogged: count(stats.coresLogged),
      coreCount: count(stats.coreCount),
      slopeWarnings: count(stats.slopeWarnings),
      slopeAmber: warnings ? count(warnings.amber) : null,
      slopeRed: warnings ? count(warnings.red) : null,
      fieldCheck: check ? { right: check.right, total: check.total } : null,
      pathPoints: stats.path.length / 2,
    };
  }

  // ---- drawing -------------------------------------------------------------------
  const shownText = { card: '', console: '', log: '', door: '' }; // for tests: what each panel says

  function frame(ctx, panel, stroke) {
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, panel.widthPx, panel.heightPx);
    fillChamfer(ctx, 8, 8, panel.widthPx - 16, panel.heightPx - 16, { cut: 26, fill: THEME.card, stroke, lineWidth: 5 });
  }

  function button(ctx, panel, id, x, y, w, h, label, onTap) {
    fillChamfer(ctx, x, y, w, h, { cut: 20, fill: THEME.accent, stroke: THEME.text, lineWidth: 4 });
    ctx.fillStyle = THEME.dark;
    ctx.textAlign = 'center';
    fitText(ctx, label, x + w / 2, y + h / 2 + 20, 58, w - 40, { weight: 'bold' });
    ctx.textAlign = 'left';
    panel.region(id, x, y, w, h, onTap);
  }

  function drawCard() {
    const W = card.widthPx;
    const H = card.heightPx;
    const ctx = card.begin();
    frame(ctx, card, THEME.accent);
    const lines = [];
    const say = (text) => lines.push(text);
    const cardData = data.cards.S1;
    if (state.phase === 'debrief') {
      const n = debriefNumbers();
      ctx.fillStyle = THEME.accent;
      fitText(ctx, 'ROUTE REPLAY', 48, 84, 40, W - 96, { weight: 'bold' });
      say('ROUTE REPLAY');
      const text =
        n.pathPoints >= 2
          ? `The amber line on the hologram is the path you actually took: ${n.pathPoints} recorded positions, about one every ${state.pathStepM} m, ${formatDistance(n.distanceM)} covered in ${formatDuration(n.evaS)} of EVA time. Blue dots show the planned ${mission.values.route_km} km route.`
          : `No walk was recorded, so there is no path to replay yet. Blue dots show the planned ${mission.values.route_km} km route.`;
      ctx.fillStyle = THEME.text;
      setFont(ctx, 38);
      const end = drawParagraph(ctx, text, 48, 150, W - 96, 50);
      say(text);
      ctx.fillStyle = THEME.dim;
      setFont(ctx, 28);
      const more = 'A straight jump in the line is a teleport. You can go back out through the airlock behind you.';
      drawParagraph(ctx, more, 48, end.y + 28, W - 96, 38);
      say(more);
      const source = `Source: positions recorded in this session; ${terrainLayer ? terrainLayer.source : 'terrain model'}`;
      fitText(ctx, source, 48, H - 44, 26, W - 96, { minPx: 20 });
      say(source);
    } else {
      ctx.fillStyle = THEME.accent;
      const head = `S1  ${cardData.title.toUpperCase()}`;
      fitText(ctx, head, 48, 84, 40, W - 96, { weight: 'bold' });
      say(head);
      ctx.fillStyle = THEME.text;
      setFont(ctx, 38);
      const body = mission.cardText('S1');
      const end = drawParagraph(ctx, body, 48, 150, W - 96, 50);
      say(body);
      ctx.fillStyle = THEME.dim;
      setFont(ctx, 26);
      drawParagraph(ctx, reliefNote, 48, end.y + 22, W - 96, 34);
      say(reliefNote);
      const y = H - 208;
      if (state.phase === 'briefing') {
        button(ctx, card, 'depart', W - 48 - 380, y, 380, 112, 'DEPART', () => cabin.depart());
        ctx.fillStyle = THEME.dim;
        setFont(ctx, 28);
        const hint = 'Review the route, then point at DEPART and pull the trigger (or click).';
        drawParagraph(ctx, hint, 48, y + 40, W - 96 - 420, 38);
        say('DEPART');
        say(hint);
      } else {
        const transit = state.phase === 'transit';
        const status = transit ? 'IN TRANSIT' : 'ARRIVED';
        ctx.fillStyle = transit ? THEME.amber : css(GREEN);
        fitText(ctx, status, 48, y + 52, 52, 360, { weight: 'bold' });
        say(status);
        ctx.fillStyle = THEME.dim;
        setFont(ctx, 28);
        const hint = transit ? 'The airlock stays locked until the light turns green.' : 'The airlock light is green: open the door behind you (point + trigger, or B).';
        drawParagraph(ctx, hint, 430, y + 30, W - 478, 38);
        say(hint);
      }
      ctx.fillStyle = THEME.dim;
      fitText(ctx, cardData.source, 48, H - 44, 26, W - 96, { minPx: 20 });
      say(cardData.source);
    }
    card.end();
    shownText.card = lines.join('\n');
  }

  function drawConsole() {
    const W = consolePanel.widthPx;
    const H = consolePanel.heightPx;
    const ctx = consolePanel.begin();
    const lines = [];
    const say = (text) => lines.push(text);
    const phase = state.phase;
    frame(ctx, consolePanel, phase === 'debrief' ? THEME.accent : THEME.cardLine);
    if (phase === 'debrief') {
      const n = debriefNumbers();
      ctx.fillStyle = THEME.accent;
      fitText(ctx, 'DEBRIEF', 44, 76, 44, 400, { weight: 'bold' });
      say('DEBRIEF');
      const cells = [
        ['EVA TIME USED', `${formatDuration(n.evaS)} of ${Math.round(n.totalS / 3600)} h`],
        ['DISTANCE COVERED', formatDistance(n.distanceM)],
        ['STATIONS DONE', `${n.stationsDone} of ${n.stationCount}`],
        ['CORES LOGGED', `${n.coresLogged}/${n.coreCount}`],
        ['SLOPE WARNINGS', n.slopeAmber === null ? String(n.slopeWarnings) : `${n.slopeWarnings} (amber ${n.slopeAmber}, red ${n.slopeRed})`],
        ['FIELD CHECK', n.fieldCheck ? `${n.fieldCheck.right}/${n.fieldCheck.total} right` : 'not taken'],
      ];
      cells.forEach(([label, value], i) => {
        const x = 44 + (i % 2) * 484;
        const y = 92 + Math.floor(i / 2) * 102;
        ctx.fillStyle = THEME.dim;
        fitText(ctx, label, x, y + 30, 28, 450);
        ctx.fillStyle = THEME.text;
        fitText(ctx, value, x, y + 82, 48, 450, { weight: 'bold', minPx: 30 });
        say(`${label}: ${value}`);
      });
      ctx.fillStyle = THEME.dim;
      const note = 'No fail state: these are the honest numbers so far. Distance is the ground charged to the EVA clock, walked or jumped.';
      setFont(ctx, 23);
      drawParagraph(ctx, note, 44, 428, W - 88, 28, 2);
      say(note);
      const source = "Source: this session's EVA clock and walk record; clock rules are ASSUMPTIONS";
      fitText(ctx, source, 44, 490, 23, W - 88, { minPx: 18 });
      say(source);
    } else {
      const title = phase === 'transit' ? 'IN TRANSIT' : phase === 'arrived' ? 'ARRIVED' : 'ROVER CABIN';
      ctx.fillStyle = phase === 'transit' ? THEME.amber : phase === 'arrived' ? css(GREEN) : THEME.accent;
      fitText(ctx, title, 44, 84, 52, W - 88, { weight: 'bold' });
      say(title);
      const steps =
        phase === 'briefing'
          ? ['1  Read the briefing on the hologram table.', '2  Press DEPART: point + trigger, or click.', '3  When the airlock light turns green, open the door behind you.']
          : phase === 'transit'
            ? ['The cabin does not move: watch the window.', 'Airlock locked (red light).']
            : ['Airlock light is green.', 'Open the door behind you: point + trigger at it, or press B.', 'Your walk starts just outside.'];
      ctx.fillStyle = THEME.text;
      setFont(ctx, 40);
      let y = 156;
      for (const step of steps) {
        y = drawParagraph(ctx, step, 44, y, W - 88, 48).y + 10;
        say(step);
      }
      ctx.fillStyle = THEME.dim;
      const note = `${clockNote} ${data.telemetryNote || ''}`.trim();
      setFont(ctx, 24);
      drawParagraph(ctx, note, 44, 440, W - 88, 30, 2);
      say(note);
    }
    consolePanel.end();
    shownText.console = lines.join('\n');
  }

  let logDirty = true;
  function drawLog() {
    const W = logPanel.widthPx;
    const H = logPanel.heightPx;
    const ctx = logPanel.begin();
    const lines = [];
    frame(ctx, logPanel, THEME.cardLine);
    ctx.fillStyle = THEME.accent;
    fitText(ctx, 'MISSION LOG', 40, 80, 42, W - 80, { weight: 'bold' });
    lines.push('MISSION LOG');
    const entries = mission.log ? mission.log.entries : [];
    if (!entries.length) {
      ctx.fillStyle = THEME.dim;
      setFont(ctx, 32);
      const empty = 'No entries yet. Notes from the walk appear here.';
      drawParagraph(ctx, empty, 40, 150, W - 80, 42);
      lines.push(empty);
    } else {
      // Newest entries that fit, oldest of them first.
      const heights = entries.map((entry) => 56 + Math.min(entry.lines.length, 3) * 40 + 22);
      let first = entries.length;
      let used = 0;
      while (first > 0 && used + heights[first - 1] <= H - 190) used += heights[--first];
      let y = 140;
      if (first > 0) {
        ctx.fillStyle = THEME.dim;
        const earlier = `${first} earlier ${first === 1 ? 'entry' : 'entries'} in the tablet LOG`;
        fitText(ctx, earlier, 40, y, 26, W - 80);
        lines.push(earlier);
        y += 44;
      }
      for (let i = first; i < entries.length; i++) {
        const entry = entries[i];
        ctx.fillStyle = THEME.warm;
        fitText(ctx, `${formatDuration(entry.atS)}`, W - 40 - 180, y + 6, 28, 180);
        ctx.fillStyle = THEME.text;
        fitText(ctx, entry.title, 40, y + 8, 38, W - 80 - 200, { weight: 'bold', minPx: 28 });
        lines.push(entry.title);
        y += 56;
        ctx.fillStyle = THEME.dim;
        for (const line of entry.lines.slice(0, 3)) {
          fitText(ctx, line, 40, y, 32, W - 80, { minPx: 22 });
          lines.push(line);
          y += 40;
        }
        y += 22;
      }
    }
    ctx.fillStyle = THEME.dim;
    const source = "Source: this session's field notebook (times are EVA clock time)";
    fitText(ctx, source, 40, H - 40, 24, W - 80, { minPx: 18 });
    lines.push(source);
    logPanel.end();
    logDirty = false;
    shownText.log = lines.join('\n');
  }

  function drawDoorSign() {
    const ctx = doorSign.begin();
    const open = state.phase === 'arrived' || state.phase === 'debrief';
    frame(ctx, doorSign, open ? css(GREEN) : THEME.red);
    ctx.fillStyle = THEME.text;
    fitText(ctx, 'AIRLOCK', 36, 84, 54, 440, { weight: 'bold' });
    ctx.fillStyle = open ? css(GREEN) : THEME.red;
    // MINERALS HOOK (cabinMinerals.js): cabin.doorGuard() returns null or { block, hint }.
    const gate = open && cabin.doorGuard ? cabin.doorGuard(false) : null;
    const status = open ? (gate && gate.block ? 'WAITING' : 'READY') : 'LOCKED';
    fitText(ctx, status, 36, 150, 44, 440, { weight: 'bold' });
    ctx.fillStyle = THEME.dim;
    const hint = gate && gate.hint ? gate.hint : open ? 'Point + trigger, click, or B' : 'Opens on arrival';
    if (gate && gate.hint) {
      setFont(ctx, 26);
      drawParagraph(ctx, hint, 36, 194, 440, 30, 2);
    } else fitText(ctx, hint, 36, 208, 30, 440, { minPx: 22 });
    doorSign.region('door', 0, 0, doorSign.widthPx, doorSign.heightPx, () => cabin.doorAction('sign'), { hover: open });
    doorSign.end();
    shownText.door = `AIRLOCK\n${status}\n${hint}`;
  }

  function drawMarkerSign() {
    const ctx = markerSign.begin();
    frame(ctx, markerSign, THEME.accent);
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    fitText(ctx, 'RETURN TO ROVER', 256, 88, 46, 460, { weight: 'bold', minPx: 30 });
    ctx.fillStyle = THEME.dim;
    fitText(ctx, 'Point + trigger (click), or come close and press B', 256, 144, 26, 460, { minPx: 18 });
    ctx.textAlign = 'left';
    markerSign.region('return', 0, 0, markerSign.widthPx, markerSign.heightPx, () => cabin.returnToRover('sign'));
    markerSign.end();
  }

  function redraw() {
    drawCard();
    drawConsole();
    drawDoorSign();
    logDirty = true;
    const open = state.phase === 'arrived' || state.phase === 'debrief';
    lampMaterial.color.setHex(open ? GREEN : PALETTE.red);
    space.visible = !open;
    outside.visible = WINDOW_VIEW && open && state.inside;
    replayLine.visible = replayDot.visible = state.phase === 'debrief' && state.replayPoints >= 2;
  }

  // The tablet owns log.onChange: wrap it.
  if (mission.log) {
    const previous = mission.log.onChange;
    mission.log.onChange = (entry) => {
      if (previous) previous(entry);
      logDirty = true;
    };
  }

  // ---- hiding and showing the world ---------------------------------------------
  const hidden = new Map(); // scene child -> whether it was visible
  const keepVisible = new Set([group, outside, player.rig]);
  let childCount = -1;
  function keeps(object) {
    return keepVisible.has(object) || object.isLight || object.name === 'sky' || object.name === 'mission-tablet' || (ui && object === ui.group);
  }
  function hideWorld() {
    for (const object of scene.children) {
      if (keeps(object) || hidden.has(object)) continue;
      hidden.set(object, object.visible);
      object.visible = false;
    }
    childCount = scene.children.length;
  }
  function showWorld() {
    for (const [object, visible] of hidden) object.visible = visible;
    hidden.clear();
    childCount = -1;
    // The backdrop is a scene child that the LAYERS tab can switch: follow its current state.
    if (surround && surround.mesh && mission.layerSet && mission.layerSet.has('backdrop')) surround.mesh.visible = !!mission.layerSet.get('backdrop');
    if (terrain && terrain.group) terrain.group.visible = true;
  }

  // ---- moving the player -----------------------------------------------------------
  const local = new THREE.Vector3();
  const head = new THREE.Vector3();
  let ownMove = false;
  const travelTo = mission.travelTo;
  // No tablet map jump (or any other mission move) out of the cabin: the door is the way out.
  mission.travelTo = (x, z, heading) => (state.inside && !ownMove ? false : travelTo(x, z, heading));

  // The tablet works in the cabin, but its map cannot start a jump there
  // (the tablet would charge the trip to the EVA clock before travelTo refuses).
  if (mission.tablet) {
    const tablet = mission.tablet;
    const askJump = tablet.askJump;
    const confirmJump = tablet.confirmJump;
    tablet.askJump = (id) => (state.inside ? false : askJump.call(tablet, id));
    tablet.confirmJump = () => (state.inside ? false : confirmJump.call(tablet));
  }

  function placeInside() {
    local.set(STAND.x, 0, STAND.z);
    group.updateWorldMatrix(true, false);
    group.localToWorld(local);
    ownMove = true;
    mission.travelTo(local.x, local.z, headingDeg);
    ownMove = false;
    if (!renderer.xr.isPresenting) player.setPitch(0);
    player.rig.position.y = floorY;
    player.headPosition(head);
    clock.moveCharged(head.x, head.z);
  }

  // Desktop: keep the walker inside the walls and off the hologram table.
  function keepInside() {
    const rig = player.rig;
    local.copy(rig.position);
    group.worldToLocal(local);
    let x = Math.min(Math.max(local.x, WALK.minX), WALK.maxX);
    let z = Math.min(Math.max(local.z, WALK.minZ), WALK.maxZ);
    const dx = x - TABLE.x;
    const dz = z - TABLE.z;
    const d = Math.hypot(dx, dz);
    const clear = TABLE.radius + WALK.tableClear;
    if (d < clear) {
      const k = d > 1e-4 ? clear / d : 0;
      x = d > 1e-4 ? TABLE.x + dx * k : TABLE.x;
      z = d > 1e-4 ? TABLE.z + dz * k : TABLE.z + clear;
      z = Math.min(Math.max(z, WALK.minZ), WALK.maxZ);
    }
    if (x !== local.x || z !== local.z) {
      local.set(x, 0, z);
      group.localToWorld(local);
      rig.position.x = local.x;
      rig.position.z = local.z;
    }
    rig.position.y = floorY;
  }

  // ---- path and distance (outside) ---------------------------------------------------
  let lastX = NaN;
  let lastZ = NaN;
  function record(x, z) {
    const path = ensureStats(mission).path;
    if (path.length >= PATH_MAX_POINTS * 2) {
      // Full: keep every second point and record half as often from now on.
      let w = 0;
      for (let r = 0; r < path.length; r += 4) {
        path[w++] = path[r];
        path[w++] = path[r + 1];
      }
      path.length = w;
      state.pathStepM *= 2;
    }
    path.push(x, z);
    lastX = x;
    lastZ = z;
  }
  function track(viewer) {
    const stats = mission.stats;
    if (clock && Number.isFinite(clock.distanceM)) stats.distanceM = clock.distanceM;
    if (Number.isNaN(lastX) || Math.hypot(viewer.x - lastX, viewer.z - lastZ) >= state.pathStepM) record(viewer.x, viewer.z);
  }

  function loadReplay() {
    const path = ensureStats(mission).path;
    const n = Math.min(Math.floor(path.length / 2), PATH_MAX_POINTS);
    for (let i = 0; i < n; i++) {
      holoPoint(path[i * 2], path[i * 2 + 1], 0.02, scratch);
      replayPositions[i * 3] = scratch.x;
      replayPositions[i * 3 + 1] = scratch.y;
      replayPositions[i * 3 + 2] = scratch.z;
    }
    replayGeometry.attributes.position.needsUpdate = true;
    replayGeometry.setDrawRange(0, 0);
    state.replayPoints = n;
    state.replayS = 0;
  }
  function stepReplay(dt) {
    const n = state.replayPoints;
    if (n < 2) return;
    state.replayS = (state.replayS + dt) % (REPLAY_S + REPLAY_HOLD_S);
    const shown = Math.min(n, 2 + Math.floor(Math.min(state.replayS / REPLAY_S, 1) * (n - 2)));
    replayGeometry.setDrawRange(0, shown);
    const i = (shown - 1) * 3;
    replayDot.position.set(replayPositions[i], replayPositions[i + 1], replayPositions[i + 2]);
  }

  // ---- phases ---------------------------------------------------------------------
  function setPhase(phase) {
    state.phase = phase;
    redraw();
    if (cabin.onChange) cabin.onChange(state.inside, phase);
  }

  function goInside(phase) {
    state.inside = true;
    group.visible = true;
    marker.visible = false;
    hideWorld();
    if (mission.hud) mission.hud.setVisible(false);
    clock.running = false;
    if (mission.tablet && mission.tablet.open) mission.tablet.setOpen(false);
    placeInside();
    setPhase(phase);
  }

  let transitStartMs = 0;
  function setGlass(flash) {
    state.flash = flash;
    glass.material.opacity = 0.1 + 0.9 * flash;
    glass.material.color.lerpColors(glassColor, flashColor, flash);
  }
  function stepTransit(dt) {
    state.transitS = (performance.now() - transitStartMs) / 1000;
    const u = Math.min(state.transitS / TRANSIT_S, 1);
    const speed = STAR_SPEED * Math.sin(Math.PI * u) ** 0.6;
    starUniforms.uShift.value = (starUniforms.uShift.value + speed * dt) % 100;
    starUniforms.uStretch.value = 0.05 + speed * 0.13;
    setGlass(Math.min(Math.max((u - 0.88) / 0.12, 0), 1));
    if (u >= 1) {
      starUniforms.uStretch.value = 0.05;
      setPhase('arrived'); // light green, space replaced by the view outside
    }
  }

  // ---- pointing at the door and at the marker ------------------------------------------
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const mouse = { x: 0, y: 0 };

  // Does the ray (world) hit a box given in the object's own coordinates,
  // within maxM metres? Slab test; no allocations.
  const inverse = new THREE.Matrix4();
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  const o = [0, 0, 0];
  const d = [0, 0, 0];
  function rayHitsBox(object, maxM) {
    object.updateWorldMatrix(true, false);
    inverse.copy(object.matrixWorld).invert();
    local.copy(rayOrigin).applyMatrix4(inverse);
    scratch.copy(rayDirection).transformDirection(inverse);
    local.toArray(o);
    scratch.toArray(d);
    let near = 0;
    let far = maxM;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < lo[a] || o[a] > hi[a]) return false;
        continue;
      }
      const t0 = (lo[a] - o[a]) / d[a];
      const t1 = (hi[a] - o[a]) / d[a];
      near = Math.max(near, Math.min(t0, t1));
      far = Math.min(far, Math.max(t0, t1));
      if (near > far) return false;
    }
    return true;
  }
  function rayHitsDoor() {
    lo[0] = -DOOR.halfW;
    lo[1] = 0;
    lo[2] = BACK_Z - 0.06;
    hi[0] = DOOR.halfW;
    hi[1] = DOOR.height;
    hi[2] = BACK_Z + 0.15;
    return rayHitsBox(group, Infinity);
  }
  // The rover's own box (a little padded), not the ground around it, so a
  // teleport aimed beside the rover is still a teleport.
  function rayHitsMarker() {
    lo[0] = -MARKER_BOX.halfW;
    lo[1] = 0;
    lo[2] = -MARKER_BOX.halfL;
    hi[0] = MARKER_BOX.halfW;
    hi[1] = MARKER_BOX.height;
    hi[2] = MARKER_BOX.halfL;
    return rayHitsBox(rover, RETURN_POINT_M);
  }

  // A trigger pull / click along the current ray that no panel took. True if used.
  function pick() {
    if (state.inside) {
      if (rayHitsDoor()) cabin.doorAction('point');
      return true; // inside, a press never starts a teleport
    }
    if (rayHitsMarker()) {
      cabin.returnToRover('point');
      return true;
    }
    return false;
  }

  if (xr) {
    const previousSelect = xr.hooks.select;
    xr.hooks.select = (controller, phase) => {
      if (previousSelect && previousSelect(controller, phase)) return true;
      if (phase !== 'start') return false;
      controller.updateWorldMatrix(true, false);
      rayOrigin.setFromMatrixPosition(controller.matrixWorld);
      rayDirection.set(0, 0, -1).transformDirection(controller.matrixWorld);
      return pick();
    };
    const previousAim = xr.hooks.desktopAim;
    xr.hooks.desktopAim = () => state.inside || (previousAim ? !!previousAim() : false);
    if (!mission.tablet) {
      // Without the tablet nothing maps the B button: do it here.
      const previousButton = xr.hooks.button;
      xr.hooks.button = (handedness, index) => {
        if (handedness === 'right' && index === 5) {
          cabin.doorAction('B');
          return true;
        }
        return previousButton ? previousButton(handedness, index) : false;
      };
    }
  }
  if (!mission.tablet) {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyB' && !event.repeat && !renderer.xr.isPresenting) cabin.doorAction('B');
    });
  }
  const domElement = renderer.domElement;
  domElement.addEventListener('mousemove', (event) => {
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
  });
  domElement.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || renderer.xr.isPresenting) return;
    if (ui && ui.hitOf(0)) return; // the click is on a panel: the UI has it
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const locked = document.pointerLockElement === domElement;
    camera.updateWorldMatrix(true, false);
    rayOrigin.setFromMatrixPosition(camera.matrixWorld);
    rayDirection.set(locked ? 0 : mouse.x, locked ? 0 : mouse.y, 0.5).unproject(camera).sub(rayOrigin).normalize();
    pick();
  });

  // ---- public ---------------------------------------------------------------------
  let wasPresenting = false;
  let recentreIn = 0;
  const cabin = {
    group,
    marker,
    outside,
    panels: { card, console: consolePanel, log: logPanel, door: doorSign, marker: markerSign },
    hologram: { group: holo, relief, routeDots, pins, replayLine, replayDot, grid, exaggeration, scale: holoScale },
    lamp,
    door,
    space,
    state,
    shownText,
    keepVisible,
    headingDeg,
    floorY,
    onChange: null,
    doorGuard: null, // MINERALS HOOK: set by cabinMinerals.js
    // MINERALS HOOK: the hologram's blue dots follow a re-planned route.
    setHologramRoute(points) {
      routeDots.geometry.dispose();
      routeDots.geometry = new THREE.BufferGeometry().setAttribute('position', routeDotPositions(points));
    },
    refreshDoorSign: () => drawDoorSign(), // MINERALS HOOK: redraw the door sign when the guard's answer changes
    get inside() {
      return state.inside;
    },
    get phase() {
      return state.phase;
    },
    get lampColor() {
      return lampMaterial.color.getHex() === GREEN ? 'green' : 'red';
    },
    debriefNumbers,

    // Start (or come back) inside: 'briefing' at the start of the experience.
    enter(phase = 'briefing') {
      goInside(phase);
      return true;
    },

    // ?skipcabin=1: begin outside, at the place main.js already put the player.
    startOutside() {
      state.inside = false;
      group.visible = false;
      outside.visible = false;
      marker.visible = true;
      clock.running = true;
      state.evaCount = 1;
      setPhase('eva');
    },

    // DEPART on the hologram table.
    depart() {
      if (!state.inside || state.phase !== 'briefing') return false;
      transitStartMs = performance.now();
      state.transitS = 0;
      if (mission.log) {
        mission.log.add({
          title: 'Briefing',
          lines: [`Plan: ${mission.values.route_km} km, ${mission.values.station_count} stops.`, 'Departed for the Marswalk start.'],
          station: 'S1',
        });
      }
      setPhase('transit');
      return true;
    },

    // For tests: finish the transit now.
    finishTransit() {
      if (state.phase !== 'transit') return false;
      transitStartMs = performance.now() - TRANSIT_S * 1000;
      return true;
    },

    // B, or a trigger / click on the door (inside) or near the marker (outside).
    doorAction(how = 'B') {
      state.lastAction = how;
      if (state.inside) return cabin.openDoor();
      player.headPosition(head);
      if (Math.hypot(head.x - markerCentre.x, head.z - markerCentre.z) <= RETURN_NEAR_M) return cabin.returnToRover(how);
      return false;
    },

    // Airlock door: the cabin goes, the world shows, the player stands at the start of the walk.
    openDoor() {
      if (!state.inside) return false;
      if (state.phase !== 'arrived' && state.phase !== 'debrief') {
        state.doorRefused++; // locked: red light
        return false;
      }
      // MINERALS HOOK (cabinMinerals.js): the door waits until three deposits are confirmed on the wall map.
      const gate = cabin.doorGuard ? cabin.doorGuard(true) : null;
      if (gate && gate.block) {
        state.doorRefused++;
        drawDoorSign();
        return false;
      }
      state.inside = false;
      group.visible = false;
      outside.visible = false;
      showWorld();
      marker.visible = true;
      setGlass(0);
      mission.travelTo(mission.spawn.x, mission.spawn.z, mission.spawn.headingDeg);
      player.headPosition(head);
      clock.moveCharged(head.x, head.z); // stepping out costs no EVA time
      clock.running = true;
      if (mission.hud) mission.hud.setVisible(true);
      state.evaCount++;
      record(head.x, head.z);
      if (mission.log) {
        mission.log.add({
          title: state.evaCount === 1 ? 'EVA started' : 'EVA continued',
          lines: ['Airlock opened at the start spot.'],
          station: null,
        });
      }
      setPhase('eva');
      return true;
    },

    // The return marker: back into the cabin for the debrief. Always works.
    returnToRover(how = 'call') {
      if (state.inside) return false;
      state.lastAction = how;
      player.headPosition(head);
      track(head);
      record(head.x, head.z);
      state.returns++;
      if (mission.log) {
        const n = debriefNumbers();
        mission.log.add({
          title: 'Back in the rover',
          lines: [`EVA time used: ${formatDuration(n.evaS)}.`, `Distance covered: ${formatDistance(n.distanceM)}.`],
          station: null,
        });
      }
      loadReplay();
      goInside('debrief');
      return true;
    },

    // Triangles and draw calls of the cabin itself (and of the return marker).
    stats() {
      let triangles = 0;
      let drawCalls = 0;
      let lines = 0;
      group.traverse((object) => {
        if (object.isMesh) {
          triangles += triangleCount(object.geometry);
          drawCalls++;
        } else if (object.isLine || object.isPoints) lines++;
      });
      return {
        triangles,
        drawCalls: drawCalls + lines,
        reliefTriangles: triangleCount(reliefGeometry),
        windowViewTriangles: WINDOW_VIEW ? triangleCount(reliefGeometry) : 0,
        markerTriangles: triangleCount(rover.geometry) + 2,
      };
    },

    // Once per frame, after mission.update and before rendering. viewer = world
    // position of the head. No allocations.
    update(dt, timeS, viewer) {
      const presenting = renderer.xr.isPresenting;
      if (presenting !== wasPresenting) {
        wasPresenting = presenting;
        // Entering VR inside the cabin: the headset may be anywhere in the
        // room, so stand the user on the cabin's spot once its pose is known.
        if (state.inside) recentreIn = presenting ? 3 : 1;
      }
      if (!state.inside) {
        track(viewer);
        // The marker's sign turns to face the viewer.
        markerSign.mesh.rotation.y = Math.atan2(viewer.x - marker.position.x, viewer.z - marker.position.z);
        return;
      }
      if (recentreIn > 0 && --recentreIn === 0) placeInside();
      if (scene.children.length !== childCount) hideWorld(); // something was added to the scene
      if (presenting) player.rig.position.y = floorY; // the cabin floor is the real floor
      else keepInside();
      if (state.phase === 'transit') stepTransit(dt);
      else if (state.flash > 0) setGlass(Math.max(0, state.flash - dt / 0.7));
      if (state.phase === 'debrief') stepReplay(dt);
      if (logDirty) drawLog();
    },
  };

  mission.actions.door = () => cabin.doorAction('B');
  mission.cabin = cabin;
  drawMarkerSign();
  redraw();
  drawLog();
  return cabin;
}
