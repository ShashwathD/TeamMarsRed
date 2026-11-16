import * as THREE from 'three';
import { PALETTE, css, lowPolyMaterial, mergeParts } from './lowpoly.js';
import { THEME, createPanel, drawParagraph, fillChamfer, fitText, setFont, wrapLines } from './ui.js';
import { straightWalkSeconds } from './clock.js';
import { buildCredits, drawCredits as drawCreditsPage, layoutCredits } from './credits.js';

// Forearm tablet (brief: SYSTEMS / TABLET).
//
// One chunky low-poly slate with a canvas screen.
//   VR:      worn on the left forearm (a child of the left controller's
//            pointing-ray space). The slate is always there; the screen lights when Y on
//            the left controller is pressed, or when the explorer looks down
//            at it for a moment, and goes dark again when they look away.
//            With no left controller it floats where it was opened instead.
//   Desktop: slides up in front of the camera with Tab or Y and frees the
//            mouse so its buttons can be clicked.
// Tabs: MAP (photo map of the whole patch, planned route, rover path, sample
//   sites, a pin per stop, you-are-here; tap a pin or a stop in the list, then
//   confirm, to teleport there for the walking time of the route distance),
//   LOG (field notebook, filled by later steps through mission.log.add),
//   LAYERS (one chip per data layer: an eye for on / off, the mission,
//   instrument and source from the mission file, and an "i" that swaps the
//   credits for a one-line explanation; the last page is the full credits,
//   where the always-on backdrop terrain is credited too), HELP (controls for
//   Quest and desktop).
// The rover path, its stops, the sample sites and the panorama camera icon are
// on the MAP whenever their chip is on, also while the rover path is still
// hidden in the world (it appears there at stop 3).
//
// LEGIBILITY. The screen is 0.34 m wide and 1280 px across: 1 px = 0.266 mm.
// No text is smaller than MIN_PX = 42 px, which is 11.2 mm of font size; held
// 0.45 m from the eyes that is 1.4 degrees (capital letters about 1.0 degree,
// 8 mm). Titles and buttons are 48 px and up.
//
// COST. The canvas is drawn again only when what it shows changes (a tap, a
// layer switch, a new log entry), never per frame. The you-are-here arrow and
// the hover light are small meshes on top of the screen, so moving, turning
// and pointing cost no canvas upload.

const W = 1280;
const H = 896;
const SCREEN_W_M = 0.34;
const SCREEN_H_M = (SCREEN_W_M * H) / W;
const MIN_PX = 42;
const READ_DISTANCE_M = 0.45; // for the legibility figure in stats()

const TABS = ['MAP', 'LOG', 'LAYERS', 'HELP'];
const TAB_H = 104;
const CONTENT_Y = 132;

const MAP_X = 16;
const MAP_Y = 136;
const MAP_S = 736; // px for the whole patch
const SIDE_X = MAP_X + MAP_S + 20;
const SIDE_W = W - 16 - SIDE_X;
const PIN_R = 30;
const PIN_GAP = 70; // pins are pushed apart to at least this many px between centres

const APPROACH_M = 5; // a map teleport lands this far short of the stop, on the route
const NEAR_TIE_M = 3; // route points this close to the nearest one are also tried as the start

const SLIDE_S = 0.22; // desktop slide-up time
const GAZE_OPEN_DEG = 20; // VR: looking this close to the tablet ...
const GAZE_OPEN_S = 0.3; // ... for this long lights the screen
const GAZE_CLOSE_DEG = 38;
const GAZE_CLOSE_S = 0.6;
const GAZE_MAX_M = 0.8;
const GAZE_FACING = 0.45; // cosine: the screen has to face the eyes this squarely

// Pose on the left controller's pointing-ray space: -z is where the controller
// points, which with a straight wrist is along the forearm, so +z runs back
// from the hand toward the elbow; y is up along the thumb, x toward the palm
// side. (The grip space is no use for this: on Touch controllers it is pitched
// 45 degrees from the pointing ray.) The screen lies along the forearm, lifted
// clear of the arm, text reading from the elbow toward the hand, and tilted 30
// degrees toward the body so it faces the eyes when the forearm is raised
// across the chest.
const ARM_TILT = THREE.MathUtils.degToRad(30);
const ARM_NORMAL = new THREE.Vector3(Math.sin(ARM_TILT), Math.cos(ARM_TILT), 0);
const ARM_QUATERNION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-Math.cos(ARM_TILT), Math.sin(ARM_TILT), 0), ARM_NORMAL),
);
const ARM_POSITION = new THREE.Vector3(0, 0, 0.25).addScaledVector(ARM_NORMAL, 0.075);

const HELP = {
  quest: [
    ['Right trigger', 'Point and press to select or confirm. On open ground: hold to aim a teleport, release to jump.'],
    ['Right stick', 'Flick left or right for a snap turn.'],
    ['Y (left)', 'Tablet on or off. Looking down at your left forearm also lights it.'],
    ['A', 'Scan (at a station).'],
    ['B', 'Airlock door (at the rover).'],
    ['Right grip', 'Hold a sample tube (at a core site).'],
    ['X (left)', 'Frame time readout.'],
  ],
  desktop: [
    ['Mouse', 'Click the view to look around; Esc frees the mouse. Click buttons to select.'],
    ['W A S D', 'Walk. Hold Shift to run.'],
    ['T / right mouse', 'Hold to aim a teleport, release to jump.'],
    ['Tab or Y', 'Tablet on or off.'],
    ['E', 'Scan (at a station).'],
    ['B', 'Airlock door (at the rover).'],
    ['G', 'Hold a sample tube (at a core site).'],
    ['F', 'Frame time readout.'],
  ],
};

function bodyGeometry() {
  const hex = (radius, depth) => new THREE.CylinderGeometry(radius, radius, depth, 6).rotateX(Math.PI / 2);
  const w = SCREEN_W_M;
  const h = SCREEN_H_M;
  return mergeParts([
    // Off-white back plate showing as a rim, slate slab, dark glass under the screen.
    { geometry: new THREE.BoxGeometry(w + 0.056, h + 0.056, 0.012), color: PALETTE.offWhite, z: -0.02 },
    { geometry: new THREE.BoxGeometry(w + 0.034, h + 0.034, 0.026), color: PALETTE.slate, z: -0.014 },
    { geometry: new THREE.BoxGeometry(w + 0.004, h + 0.004, 0.002), color: 0x0b0f14, z: -0.0015 },
    // Chunky side lugs and a nub on top.
    { geometry: hex(0.034, 0.03), color: PALETTE.marsOrange, x: -(w / 2 + 0.03), z: -0.016 },
    { geometry: hex(0.034, 0.03), color: PALETTE.marsOrange, x: w / 2 + 0.03, z: -0.016 },
    { geometry: new THREE.BoxGeometry(0.07, 0.022, 0.02), color: PALETTE.teal, y: h / 2 + 0.03, z: -0.016 },
    // Two arm bands underneath (they reach down to the forearm in VR).
    { geometry: new THREE.BoxGeometry(0.05, 0.11, 0.07), color: PALETTE.marsDeep, x: -0.085, z: -0.06 },
    { geometry: new THREE.BoxGeometry(0.05, 0.11, 0.07), color: PALETTE.marsDeep, x: 0.085, z: -0.06 },
  ]);
}

// Flat arrow pointing along +y, with a dark outline, about 2 units long.
function arrowGeometry() {
  const shape = [[0, 1.1], [0.72, -0.85], [0, -0.42], [-0.72, -0.85]];
  const positions = [];
  const colors = [];
  const add = (scale, z, color) => {
    const c = new THREE.Color(color);
    for (const [a, b, d] of [[0, 3, 2], [0, 2, 1]]) {
      for (const k of [a, b, d]) {
        positions.push(shape[k][0] * scale, shape[k][1] * scale, z);
        colors.push(c.r, c.g, c.b);
      }
    }
  };
  add(1.5, 0, PALETTE.slate);
  add(1, 0.02, 0xffffff);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

// The one-line explanation behind each chip's "i" (brief: LAYER BEHAVIOUR).
// Numbers and stop names are filled in from the mission file.
const LAYER_INFO = {
  photo: () => 'The ground texture. Off shows plain shaded relief.',
  slope: ({ amberFrom, redAbove }) => `Amber ${amberFrom}-${redAbove}°, red above ${redAbove}°, clear below ${amberFrom}°.`,
  traverse: ({ waitingStop }) => (waitingStop ? `Perseverance's real path. On the ground from stop ${waitingStop}.` : "Perseverance's real path, with dots at rover stops."),
  samples: () => 'Where cores were sealed. Positions are approximate.',
  panoramas: ({ panoramaStop }) => `Camera icon at stop ${panoramaStop}. The 360 view opens only there.`,
};

// A chunky eye: open, or shut with a stroke through it.
function drawEye(ctx, cx, cy, open, colour) {
  ctx.beginPath();
  ctx.moveTo(cx - 38, cy);
  ctx.lineTo(cx - 16, cy - 18);
  ctx.lineTo(cx + 16, cy - 18);
  ctx.lineTo(cx + 38, cy);
  ctx.lineTo(cx + 16, cy + 18);
  ctx.lineTo(cx - 16, cy + 18);
  ctx.closePath();
  ctx.lineWidth = 6;
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = colour;
  ctx.stroke();
  if (open) {
    hexPath(ctx, cx, cy, 10);
    ctx.fillStyle = colour;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy + 24);
    ctx.lineTo(cx + 30, cy - 24);
    ctx.stroke();
  }
}

// A small camera, about 44 x 32 px, centred on (cx, cy).
function drawCamera(ctx, cx, cy) {
  ctx.fillStyle = THEME.dark;
  ctx.fillRect(cx - 26, cy - 20, 52, 40);
  ctx.fillStyle = THEME.text;
  ctx.fillRect(cx - 22, cy - 10, 44, 26);
  ctx.fillRect(cx - 10, cy - 16, 20, 8);
  hexPath(ctx, cx, cy + 3, 9);
  ctx.fillStyle = THEME.dark;
  ctx.fill();
}

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    if (k) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

// Whole minutes, never shown shorter than the time is.
const wholeMinutes = (seconds) => Math.ceil(seconds / 60 - 1e-9);
const clockText = (seconds) => {
  const minutes = Math.floor(Math.max(seconds, 0) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

export function createTablet({ mission, ui, scene, camera, renderer, player, xr, patch, photo }) {
  const { data, clock, routeGrid, pace } = mission;
  const layers = mission.layerSet;
  const points = data.route.points;
  const last = points.length - 1;
  const anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;

  // ---- objects ------------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'mission-tablet';
  const body = new THREE.Mesh(bodyGeometry(), lowPolyMaterial());
  body.name = 'tablet-body';
  group.add(body);
  const panel = createPanel({ name: 'tablet-screen', widthPx: W, heightPx: H, widthM: SCREEN_W_M, anisotropy });
  group.add(panel.mesh);
  ui.add(panel);

  const marker = new THREE.Mesh(arrowGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }));
  marker.name = 'tablet-you-are-here';
  marker.scale.setScalar(0.0075);
  marker.position.z = 0.0009;
  marker.visible = false;
  panel.mesh.add(marker);

  // ---- stops that can be teleported to -----------------------------------------
  const cumulativeM = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) cumulativeM[i] = cumulativeM[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const loopM = cumulativeM[last];

  const mapX = (x) => MAP_X + (x / patch.sizeX + 0.5) * MAP_S;
  const mapY = (z) => MAP_Y + (z / patch.sizeZ + 0.5) * MAP_S;

  function makeTarget(id, name, badge, x, z, routeIndex) {
    // Land on the route a few metres short of the stop (not inside its beacon), facing it.
    const far = (i) => Math.hypot(points[i][0] - x, points[i][1] - z) >= APPROACH_M;
    let land = routeIndex;
    while (land > 0 && !far(land)) land--;
    if (!far(land)) {
      land = routeIndex;
      while (land < last && !far(land)) land++;
    }
    const [landX, landZ] = points[land];
    return {
      id,
      name,
      badge,
      x,
      z,
      routeIndex,
      landIndex: land,
      landX,
      landZ,
      headingDeg: (THREE.MathUtils.radToDeg(Math.atan2(x - landX, -(z - landZ))) + 360) % 360,
      pinX: mapX(x),
      pinY: mapY(z),
      trueX: mapX(x),
      trueY: mapY(z),
    };
  }
  const targets = [makeTarget('START', 'Airlock', '', data.start.x, data.start.z, 0)];
  for (const id of data.route.order) {
    if (id === 'START' || targets.some((t) => t.id === id)) continue;
    const station = mission.stations.get(id);
    const target = makeTarget(id, station.title, id.replace(/^S/, ''), station.x, station.z, station.routeIndex);
    // Sample sites within 30 m of the stop are drawn as a ring on its pin (they lie under it on the map).
    target.hasSamples = layers.sites.some((site) => Math.hypot(site.x - station.x, site.z - station.z) < 30);
    // The same for panoramas: a camera icon beside the pin.
    target.hasPanorama = (data.panoramas || []).some((pano) => Math.hypot(pano.position.x - station.x, pano.position.z - station.z) < 30);
    targets.push(target);
  }
  const targetById = (id) => targets.find((t) => t.id === id) || null;
  // Pins closer than PIN_GAP on the map are pushed apart; a line then leads to the true place.
  for (let pass = 0; pass < 24; pass++) {
    for (let a = 0; a < targets.length; a++) {
      for (let b = a + 1; b < targets.length; b++) {
        const A = targets[a];
        const B = targets[b];
        let dx = B.pinX - A.pinX;
        let dy = B.pinY - A.pinY;
        let d = Math.hypot(dx, dy);
        if (d >= PIN_GAP) continue;
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (PIN_GAP - d) / 2 + 0.5;
        A.pinX -= (dx / d) * push;
        A.pinY -= (dy / d) * push;
        B.pinX += (dx / d) * push;
        B.pinY += (dy / d) * push;
      }
    }
    for (const t of targets) {
      t.pinX = Math.min(Math.max(t.pinX, MAP_X + PIN_R + 4), MAP_X + MAP_S - PIN_R - 4);
      t.pinY = Math.min(Math.max(t.pinY, MAP_Y + PIN_R + 4), MAP_Y + MAP_S - PIN_R - 4);
    }
  }

  // Walking seconds and metres along the planned route from point i to point
  // j: straight through the points between them, or the other way round the
  // loop past the airlock, whichever is quicker.
  function alongRoute(i, j) {
    const directS = clock.routeSeconds(i, j);
    const directM = Math.abs(cumulativeM[j] - cumulativeM[i]);
    const aroundS = j >= i ? clock.routeSeconds(i, 0) + clock.routeSeconds(last, j) : clock.routeSeconds(i, last) + clock.routeSeconds(0, j);
    const aroundM = loopM - directM;
    return aroundS < directS ? { seconds: aroundS, metres: aroundM, way: 'around' } : { seconds: directS, metres: directM, way: 'direct' };
  }

  // What a teleport from (x, z) to a stop costs: the walk to the nearest
  // point of the route, then the route to the landing point.
  function costFrom(x, z, target) {
    let nearest = Infinity;
    for (let i = 0; i <= last; i++) {
      const d = Math.hypot(points[i][0] - x, points[i][1] - z);
      if (d < nearest) nearest = d;
    }
    let best = null;
    for (let i = 0; i <= last; i++) {
      const d = Math.hypot(points[i][0] - x, points[i][1] - z);
      if (d > nearest + NEAR_TIE_M) continue;
      const route = alongRoute(i, target.landIndex);
      const seconds = straightWalkSeconds(routeGrid, pace, x, z, points[i][0], points[i][1]) + route.seconds;
      if (!best || seconds < best.seconds) best = { seconds, metres: d + route.metres, fromIndex: i, toIndex: target.landIndex, offRouteM: d, way: route.way };
    }
    return best;
  }

  // ---- state --------------------------------------------------------------------
  const state = {
    open: false,
    tab: 'MAP',
    layersPage: 0,
    layerInfo: null, // id of the chip that shows its one-line explanation
    logPage: 0,
    helpDevice: 'desktop',
    dialog: null, // { id, seconds, metres, x, z } while the confirm box is up
    modal: null, // { draw(ctx, kit) }: a full-screen page drawn over the tabs (the Field Check)
    mount: null, // 'desktop' | 'arm' | 'float'
    pinned: false, // VR: lit with Y (stays lit when looking away)
    gaze: false, // VR: lit by looking at it
    slide: 0, // desktop: 0 hidden .. 1 up
    jumps: 0,
    lastJump: null,
  };
  let dirty = true;
  let gazeTimerS = 0;
  let gazeBlocked = false; // after Y turned it off: not lit by gaze again until looked away

  const head = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const toTablet = new THREE.Vector3();
  const tabletPos = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  function headPlace(target) {
    return player ? player.headPosition(target) : camera.getWorldPosition(target);
  }

  // ---- map picture (made again only when a layer that shows on it changes) ------
  const base = document.createElement('canvas');
  base.width = MAP_S;
  base.height = MAP_S;
  let baseKey = '';
  let photoPicture = null; // tinted photo, made once
  let slopePicture = null; // slope bands, made once

  function tintedPhoto() {
    if (photoPicture) return photoPicture;
    const canvas = document.createElement('canvas');
    canvas.width = MAP_S;
    canvas.height = MAP_S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const image = photo && photo.texture ? photo.texture.image : null;
    const picture = ctx.createImageData(MAP_S, MAP_S);
    const out = picture.data;
    const tint = [0x96, 0x70, 0x4f]; // the viewer's Mars surface colour (cosmetic, as on the ground)
    if (image) {
      // The real photo, brightness kept, average brought to the surface colour.
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, MAP_S, MAP_S);
      const grey = ctx.getImageData(0, 0, MAP_S, MAP_S).data;
      let sum = 0;
      for (let i = 0; i < grey.length; i += 4) sum += grey[i];
      const mean = sum / (grey.length / 4) || 1;
      for (let i = 0; i < grey.length; i += 4) {
        const f = Math.min(grey[i] / mean, 1.7);
        out[i] = Math.min(255, tint[0] * f);
        out[i + 1] = Math.min(255, tint[1] * f);
        out[i + 2] = Math.min(255, tint[2] * f);
        out[i + 3] = 255;
      }
    } else {
      // No photo: shaded relief from the terrain heights (light from the north-west).
      const { cols, rows, heights, spacing } = patch;
      for (let py = 0; py < MAP_S; py++) {
        const r = Math.min(rows - 2, Math.max(1, Math.floor((py / MAP_S) * rows)));
        for (let px = 0; px < MAP_S; px++) {
          const c = Math.min(cols - 2, Math.max(1, Math.floor((px / MAP_S) * cols)));
          const dx = (heights[r * cols + c + 1] - heights[r * cols + c - 1]) / (2 * spacing);
          const dz = (heights[(r + 1) * cols + c] - heights[(r - 1) * cols + c]) / (2 * spacing);
          const shade = Number.isFinite(dx + dz) ? Math.min(1.7, Math.max(0.3, 1 + 1.6 * (dx + dz))) : 1;
          const i = (py * MAP_S + px) * 4;
          out[i] = Math.min(255, tint[0] * shade);
          out[i + 1] = Math.min(255, tint[1] * shade);
          out[i + 2] = Math.min(255, tint[2] * shade);
          out[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(picture, 0, 0);
    photoPicture = canvas;
    return canvas;
  }

  function slopeBands() {
    if (slopePicture) return slopePicture;
    const { cols, rows } = patch;
    const step = 2; // one map pixel per 2 x 2 terrain samples, coloured by the steepest of them
    const w = Math.floor(cols / step);
    const h = Math.floor(rows / step);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const picture = ctx.createImageData(w, h);
    const out = picture.data;
    const slope = routeGrid.slopeDeg;
    const bytes = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    const amber = bytes(PALETTE.amber);
    const red = bytes(PALETTE.red);
    const { amberFrom, redAbove } = layers.bands;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let worst = 0;
        for (let k = 0; k < step * step; k++) {
          const s = slope[(y * step + Math.floor(k / step)) * cols + x * step + (k % step)];
          if (s > worst) worst = s;
        }
        if (worst < amberFrom) continue;
        const colour = worst > redAbove ? red : amber;
        const i = (y * w + x) * 4;
        out[i] = colour[0];
        out[i + 1] = colour[1];
        out[i + 2] = colour[2];
        out[i + 3] = 165;
      }
    }
    ctx.putImageData(picture, 0, 0);
    slopePicture = canvas;
    return canvas;
  }

  function strokeLine(ctx, line, width, colour) {
    ctx.beginPath();
    for (let i = 0; i < line.length; i++) {
      const x = mapX(line[i][0]) - MAP_X;
      const y = mapY(line[i][1]) - MAP_Y;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.stroke();
  }

  function drawBase() {
    const key = `${layers.get('slope')}|${layers.get('traverse')}|${layers.get('samples')}`;
    if (key === baseKey) return;
    baseKey = key;
    const ctx = base.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(tintedPhoto(), 0, 0);
    if (layers.get('slope')) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(slopeBands(), 0, 0, MAP_S, MAP_S);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (layers.get('traverse')) {
      for (const line of data.traverse.lines) strokeLine(ctx, line.points, 8, 'rgba(11, 15, 20, 0.75)');
      for (const line of data.traverse.lines) strokeLine(ctx, line.points, 4, css(PALETTE.roverOrange));
      // Small dots at the rover's stops (waypoints) inside the patch.
      for (const [x, z] of data.traverse.waypoints || []) {
        ctx.beginPath();
        ctx.arc(mapX(x) - MAP_X, mapY(z) - MAP_Y, 5, 0, Math.PI * 2);
        ctx.fillStyle = css(PALETTE.roverOrange);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = THEME.dark;
        ctx.stroke();
      }
    }
    strokeLine(ctx, points, 11, 'rgba(11, 15, 20, 0.8)');
    strokeLine(ctx, points, 6, css(PALETTE.routeBlue));
    // Small arrowheads along the route, in walking order.
    ctx.fillStyle = css(PALETTE.routeBlueLight);
    const every = 150; // metres
    let next = every / 2;
    for (let i = 1; i <= last; i++) {
      if (cumulativeM[i] < next) continue;
      next += every;
      const x = mapX(points[i][0]) - MAP_X;
      const y = mapY(points[i][1]) - MAP_Y;
      const back = points[Math.max(i - 3, 0)];
      const a = Math.atan2(points[i][1] - back[1], points[i][0] - back[0]);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, 7);
      ctx.lineTo(-6, -7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (layers.get('samples')) {
      for (const site of layers.sites) {
        const x = mapX(site.x) - MAP_X;
        const y = mapY(site.z) - MAP_Y;
        ctx.beginPath();
        ctx.moveTo(x, y - 12);
        ctx.lineTo(x + 12, y);
        ctx.lineTo(x, y + 12);
        ctx.lineTo(x - 12, y);
        ctx.closePath();
        ctx.fillStyle = css(PALETTE.amber);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = THEME.dark;
        ctx.stroke();
      }
    }
    // North arrow and a scale bar (500 m of the patch's real width).
    const barM = 500;
    const barPx = (barM / patch.sizeX) * MAP_S;
    ctx.fillStyle = 'rgba(11, 15, 20, 0.72)';
    ctx.fillRect(10, MAP_S - 74, barPx + 28, 64);
    ctx.fillStyle = THEME.text;
    ctx.fillRect(24, MAP_S - 26, barPx, 6);
    ctx.fillRect(24, MAP_S - 34, 4, 14);
    ctx.fillRect(24 + barPx - 4, MAP_S - 34, 4, 14);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    setFont(ctx, MIN_PX, 'bold');
    ctx.fillText(`${barM} m`, 24 + barPx / 2, MAP_S - 36);
    ctx.fillStyle = 'rgba(11, 15, 20, 0.72)';
    ctx.fillRect(10, 10, 64, 96);
    ctx.fillStyle = THEME.text;
    ctx.fillText('N', 42, 98);
    ctx.beginPath();
    ctx.moveTo(42, 16);
    ctx.lineTo(58, 52);
    ctx.lineTo(42, 44);
    ctx.lineTo(26, 52);
    ctx.closePath();
    ctx.fill();
  }

  // ---- drawing --------------------------------------------------------------------
  function button(ctx, id, x, y, w, h, label, onTap, { on = false, px = 48, tone = THEME.accent } = {}) {
    fillChamfer(ctx, x, y, w, h, { fill: on ? tone : THEME.card, stroke: on ? null : THEME.cardLine });
    ctx.fillStyle = on ? THEME.dark : THEME.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, label, x + w / 2, y + h / 2 + 3, px, w - 28, { weight: 'bold', minPx: MIN_PX });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    panel.region(id, x, y, w, h, onTap);
  }

  function badge(ctx, target, x, y, r) {
    const colour = target.id === 'START' ? THEME.warm : THEME.accent;
    hexPath(ctx, x, y, r);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = THEME.dark;
    ctx.stroke();
    ctx.fillStyle = THEME.dark;
    if (target.id === 'START') {
      // The door shape of the airlock beacon instead of a number.
      const s = r / 30;
      ctx.beginPath();
      ctx.moveTo(x - 11 * s, y + 16 * s);
      ctx.lineTo(x - 11 * s, y - 8 * s);
      ctx.lineTo(x - 5 * s, y - 16 * s);
      ctx.lineTo(x + 5 * s, y - 16 * s);
      ctx.lineTo(x + 11 * s, y - 8 * s);
      ctx.lineTo(x + 11 * s, y + 16 * s);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      setFont(ctx, Math.max(MIN_PX, Math.round(r * 1.45)), 'bold');
      ctx.fillText(target.badge, x, y + 3);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  function drawTabs(ctx) {
    const w = 280;
    TABS.forEach((tab, index) => {
      button(ctx, `tab-${tab}`, 16 + index * (w + 8), 12, w, TAB_H, tab, () => tablet.setTab(tab), { on: state.tab === tab, px: 50 });
    });
    // Close: a cross.
    const x = 16 + 4 * (w + 8);
    const cw = W - 16 - x;
    fillChamfer(ctx, x, 12, cw, TAB_H, { fill: THEME.card, stroke: THEME.cardLine });
    ctx.lineWidth = 9;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = THEME.text;
    ctx.beginPath();
    ctx.moveTo(x + cw / 2 - 20, 12 + TAB_H / 2 - 20);
    ctx.lineTo(x + cw / 2 + 20, 12 + TAB_H / 2 + 20);
    ctx.moveTo(x + cw / 2 + 20, 12 + TAB_H / 2 - 20);
    ctx.lineTo(x + cw / 2 - 20, 12 + TAB_H / 2 + 20);
    ctx.stroke();
    panel.region('close', x, 12, cw, TAB_H, () => tablet.setOpen(false));
  }

  function drawMap(ctx) {
    drawBase();
    ctx.drawImage(base, MAP_X, MAP_Y);
    ctx.lineWidth = 4;
    ctx.strokeStyle = THEME.cardLine;
    ctx.strokeRect(MAP_X, MAP_Y, MAP_S, MAP_S);

    // Pins: a line from the true place to the badge where the badge was moved.
    for (const t of targets) {
      if (Math.hypot(t.pinX - t.trueX, t.pinY - t.trueY) > 2) {
        ctx.beginPath();
        ctx.moveTo(t.trueX, t.trueY);
        ctx.lineTo(t.pinX, t.pinY);
        ctx.lineWidth = 5;
        ctx.strokeStyle = THEME.dark;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(t.trueX, t.trueY, 6, 0, Math.PI * 2);
        ctx.fillStyle = THEME.text;
        ctx.fill();
      }
    }
    for (const t of targets) {
      if (t.hasSamples && layers.get('samples')) {
        // A stop where cores were taken: amber ring (the site itself lies under the pin at this scale).
        hexPath(ctx, t.pinX, t.pinY, PIN_R + 7);
        ctx.fillStyle = THEME.amber;
        ctx.fill();
      }
      badge(ctx, t, t.pinX, t.pinY, PIN_R);
      if (t.hasPanorama && layers.get('panoramas')) {
        // A 360 panorama can be opened at this stop: camera icon on the side toward the middle of the map.
        const side = t.pinX > MAP_X + MAP_S / 2 ? -1 : 1;
        t.cameraX = t.pinX + side * (PIN_R + 24);
        t.cameraY = t.pinY - PIN_R - 8;
        drawCamera(ctx, t.cameraX, t.cameraY);
      }
      panel.region(`pin-${t.id}`, t.pinX - PIN_GAP / 2, t.pinY - PIN_GAP / 2, PIN_GAP, PIN_GAP, () => tablet.askJump(t.id));
    }

    // Side list: the same stops as big buttons.
    ctx.fillStyle = THEME.text;
    fitText(ctx, 'Tap a stop to go there', SIDE_X, CONTENT_Y + 46, MIN_PX, SIDE_W, { minPx: MIN_PX });
    const rowH = 88;
    targets.forEach((t, index) => {
      const y = CONTENT_Y + 68 + index * (rowH + 6);
      fillChamfer(ctx, SIDE_X, y, SIDE_W, rowH, { fill: THEME.card, stroke: THEME.cardLine });
      badge(ctx, t, SIDE_X + 50, y + rowH / 2, 32);
      ctx.fillStyle = THEME.text;
      ctx.textBaseline = 'middle';
      fitText(ctx, t.name, SIDE_X + 96, y + rowH / 2 + 3, 44, SIDE_W - 108, { weight: 'bold', minPx: MIN_PX });
      ctx.textBaseline = 'alphabetic';
      panel.region(`go-${t.id}`, SIDE_X, y, SIDE_W, rowH, () => tablet.askJump(t.id));
    });

    // Key.
    let y = CONTENT_Y + 68 + targets.length * (rowH + 6) + 34;
    const key = (colour, text, ring) => {
      if (y > H - 10) {
        state.clippedText = `map key: ${text}`; // for the layout check
        return;
      }
      if (ring === 'camera') {
        ctx.save();
        ctx.translate(SIDE_X + 22, y - 15);
        ctx.scale(0.8, 0.8);
        drawCamera(ctx, 0, 0);
        ctx.restore();
      } else if (ring) {
        hexPath(ctx, SIDE_X + 22, y - 15, 17);
        ctx.lineWidth = 7;
        ctx.strokeStyle = colour;
        ctx.stroke();
      } else {
        ctx.fillStyle = colour;
        ctx.fillRect(SIDE_X, y - 20, 44, 10);
      }
      ctx.fillStyle = THEME.dim;
      fitText(ctx, text, SIDE_X + 58, y, MIN_PX, SIDE_W - 58, { minPx: MIN_PX });
      y += 46;
    };
    key(css(PALETTE.routeBlue), 'Planned route');
    if (layers.get('traverse')) key(css(PALETTE.roverOrange), 'Rover path and stops');
    if (layers.get('samples')) key(css(PALETTE.amber), 'Sample site (approx.)', true);
    if (layers.get('panoramas') && targets.some((t) => t.hasPanorama)) key(null, '360 panorama', 'camera');
  }

  function drawPager(ctx, idPrefix, page, pages, setPage, note) {
    const y = H - 96;
    if (note) {
      ctx.fillStyle = THEME.dim;
      const room = pages > 1 ? W - 28 - 350 : W - 56;
      setFont(ctx, MIN_PX);
      if (ctx.measureText(note).width > room) state.clippedText = `footer: ${note}`; // for the layout check
      fitText(ctx, note, 28, y + 54, MIN_PX, room, { minPx: MIN_PX });
    }
    if (pages <= 1) return;
    setFont(ctx, 46, 'bold');
    const count = `${page + 1} / ${pages}`;
    const countW = Math.max(122, ctx.measureText(count).width + 28); // wider for two-digit page numbers
    button(ctx, `${idPrefix}-prev`, W - 208 - countW, y, 96, 80, '<', () => setPage((page + pages - 1) % pages));
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    setFont(ctx, 46, 'bold');
    ctx.fillText(count, W - 112 - countW / 2, y + 56);
    ctx.textAlign = 'left';
    button(ctx, `${idPrefix}-next`, W - 112, y, 96, 80, '>', () => setPage((page + 1) % pages));
  }

  function drawLog(ctx) {
    const entries = mission.log.entries;
    ctx.fillStyle = THEME.text;
    setFont(ctx, 52, 'bold');
    ctx.fillText('Field notebook', 28, CONTENT_Y + 60);
    if (!entries.length) {
      fillChamfer(ctx, 16, CONTENT_Y + 96, W - 32, 260, { fill: THEME.card, stroke: THEME.cardLine });
      ctx.fillStyle = THEME.text;
      setFont(ctx, 48, 'bold');
      ctx.fillText('No notes yet.', 48, CONTENT_Y + 186);
      ctx.fillStyle = THEME.dim;
      setFont(ctx, MIN_PX);
      drawParagraph(ctx, 'What you find at each stop is written down here as you go.', 48, CONTENT_Y + 252, W - 96, 54, 2);
      return;
    }
    const perPage = 3;
    const pages = Math.ceil(entries.length / perPage);
    state.logPage = Math.min(state.logPage, pages - 1);
    const rowH = 196;
    for (let k = 0; k < perPage; k++) {
      const entry = entries[entries.length - 1 - (state.logPage * perPage + k)]; // newest first
      if (!entry) break;
      const y = CONTENT_Y + 84 + k * (rowH + 10);
      fillChamfer(ctx, 16, y, W - 32, rowH, { fill: THEME.card, stroke: THEME.cardLine });
      ctx.fillStyle = THEME.accent;
      ctx.textAlign = 'right';
      setFont(ctx, MIN_PX, 'bold');
      const stamp = `EVA ${clockText(entry.atS)}`;
      ctx.fillText(stamp, W - 40, y + 58);
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.text;
      fitText(ctx, entry.title, 40, y + 58, 46, W - 80 - ctx.measureText(stamp).width - 30, { weight: 'bold', minPx: MIN_PX });
      ctx.fillStyle = THEME.dim;
      setFont(ctx, MIN_PX);
      drawParagraph(ctx, entry.lines.join('\n'), 40, y + 114, W - 80, 52, 2);
    }
    drawPager(ctx, 'log', state.logPage, pages, (page) => {
      state.logPage = page;
      dirty = true;
    });
  }

  // The numbers and stop names the one-line explanations use, from the mission file.
  function infoValues() {
    const waiting = layers.waitingFor('traverse');
    const panoramaTarget = targets.find((t) => t.hasPanorama);
    return {
      amberFrom: layers.bands.amberFrom,
      redAbove: layers.bands.redAbove,
      waitingStop: waiting ? waiting.replace(/^S/, '') : '',
      panoramaStop: panoramaTarget ? panoramaTarget.badge : '',
    };
  }

  // The full credits (missions covered, every layer with the always-on
  // backdrop, fact sources, assumptions, software, AI disclosure).
  const credits = buildCredits(data);
  const CREDITS_BOX = { x: 28, y: CONTENT_Y, width: W - 56, height: H - 100 - CONTENT_Y, px: MIN_PX };

  function drawLayers(ctx) {
    const perPage = 3;
    const list = layers.list;
    const chipPages = Math.ceil(list.length / perPage);
    // After the chips: the CREDITS pages (credits.js).
    const pages = chipPages + layoutCredits(ctx, credits, CREDITS_BOX).length;
    state.creditsFirstPage = chipPages;
    state.layersPage = Math.min(state.layersPage, pages - 1);
    const setPage = (page) => {
      state.layersPage = page;
      dirty = true;
    };
    const missions = data.missionsCovered.join(', ');
    if (state.layersPage >= chipPages) {
      const drawn = drawCreditsPage(ctx, credits, state.layersPage - chipPages, CREDITS_BOX);
      drawPager(ctx, 'layers', state.layersPage, pages, setPage, `CREDITS · ${drawn.section}`);
      return;
    }
    const rowH = 212;
    const eyeW = 124;
    const infoW = 76;
    const eyeX = W - 16 - 24 - eyeW;
    const infoX = eyeX - 14 - infoW;
    for (let k = 0; k < perPage; k++) {
      const layer = list[state.layersPage * perPage + k];
      if (!layer) break;
      const y = CONTENT_Y + 4 + k * (rowH + 10);
      const on = layers.get(layer.id);
      const can = layers.can(layer.id);
      const info = state.layerInfo === layer.id;
      fillChamfer(ctx, 16, y, W - 32, rowH, { fill: THEME.card, stroke: on ? THEME.accent : THEME.cardLine });
      panel.region(`layer-${layer.id}`, 16, y, W - 32, rowH, () => layers.toggle(layer.id));
      // Eye: open = on, shut = off.
      fillChamfer(ctx, eyeX, y + 14, eyeW, 68, { cut: 12, fill: on ? THEME.accent : THEME.bg, stroke: on ? null : THEME.dim });
      drawEye(ctx, eyeX + eyeW / 2, y + 48, on, on ? THEME.dark : can ? THEME.dim : THEME.cardLine);
      // "i": swaps the credits below for a one-line explanation.
      fillChamfer(ctx, infoX, y + 14, infoW, 68, { cut: 12, fill: info ? THEME.text : THEME.bg, stroke: info ? null : THEME.dim });
      ctx.fillStyle = info ? THEME.dark : THEME.text;
      ctx.textAlign = 'center';
      setFont(ctx, 50, 'bold');
      ctx.fillText('i', infoX + infoW / 2, y + 66);
      ctx.textAlign = 'left';
      panel.region(`info-${layer.id}`, infoX, y + 14, infoW, 68, () => {
        state.layerInfo = info ? null : layer.id;
        dirty = true;
      });
      // Beside the name: for the slope layer its legend; for a layer still
      // hidden in the world, where it shows now.
      const extras = [];
      if (layer.id === 'slope') {
        const { amberFrom, redAbove } = layers.bands;
        extras.push([THEME.amber, `${amberFrom}-${redAbove}°`], [THEME.red, `over ${redAbove}°`]);
      }
      const waiting = on ? layers.waitingFor(layer.id) : null;
      if (waiting) extras.push([null, `map only until stop ${waiting.replace(/^S/, '')}`]);
      setFont(ctx, MIN_PX);
      let extrasW = 0;
      for (const [colour, text] of extras) extrasW += 26 + (colour ? 44 : 0) + ctx.measureText(text).width;
      // Name.
      ctx.fillStyle = THEME.text;
      const nameRoom = infoX - 16 - 40 - extrasW;
      setFont(ctx, 48, 'bold');
      if (ctx.measureText(layer.name).width * (MIN_PX / 48) > nameRoom) state.clippedText = `layer name ${layer.id}`; // for the layout check
      const namePx = fitText(ctx, layer.name, 40, y + 62, 48, nameRoom, { weight: 'bold', minPx: MIN_PX });
      setFont(ctx, namePx, 'bold');
      let x = 40 + Math.min(ctx.measureText(layer.name).width, nameRoom);
      setFont(ctx, MIN_PX);
      for (const [colour, text] of extras) {
        x += 26;
        if (colour) {
          ctx.fillStyle = colour;
          ctx.fillRect(x, y + 30, 34, 34);
          x += 44;
        }
        ctx.fillStyle = colour ? THEME.text : THEME.dim;
        ctx.fillText(text, x, y + 62);
        x += ctx.measureText(text).width;
      }
      if (info) {
        // The one-line explanation, in place of the credits.
        ctx.fillStyle = THEME.text;
        setFont(ctx, MIN_PX);
        const text = LAYER_INFO[layer.id] ? LAYER_INFO[layer.id](infoValues()) : layer.note || layer.source;
        const drawn = drawParagraph(ctx, text, 40, y + 136, W - 80, 48, 2);
        if (drawn.clipped) state.clippedText = `layer info ${layer.id}`;
        continue;
      }
      // Credits: mission and instrument, then the source (and its note), on one or two lines.
      ctx.fillStyle = THEME.accent;
      fitText(ctx, `${layer.mission} · ${layer.instrument}`, 40, y + 112, MIN_PX, W - 80, { minPx: MIN_PX });
      ctx.fillStyle = THEME.dim;
      setFont(ctx, MIN_PX);
      const source = `Source: ${layer.source}${layer.note ? `. ${layer.note}` : ''}`;
      const lines = wrapLines(ctx, source, W - 80);
      const drawn = drawParagraph(ctx, source, 40, lines.length > 1 ? y + 157 : y + 166, W - 80, 44, 2);
      if (drawn.clipped) state.clippedText = `layer ${layer.id}`; // for the layout check
    }
    drawPager(ctx, 'layers', state.layersPage, pages, setPage, `Missions: ${missions}`);
  }

  function drawHelp(ctx) {
    button(ctx, 'help-quest', 16, CONTENT_Y + 4, 300, 84, 'QUEST', () => tablet.setHelpDevice('quest'), { on: state.helpDevice === 'quest' });
    button(ctx, 'help-desktop', 326, CONTENT_Y + 4, 300, 84, 'DESKTOP', () => tablet.setHelpDevice('desktop'), { on: state.helpDevice === 'desktop' });
    ctx.fillStyle = THEME.dim;
    fitText(ctx, state.helpDevice === 'quest' ? 'Teleport and snap turn only.' : 'Keyboard and mouse.', 650, CONTENT_Y + 60, MIN_PX, W - 670, { minPx: MIN_PX });
    const rows = HELP[state.helpDevice];
    const keyW = 330;
    let y = CONTENT_Y + 142;
    for (const [key, text] of rows) {
      ctx.fillStyle = THEME.accent;
      fitText(ctx, key, 28, y, MIN_PX, keyW - 20, { weight: 'bold', minPx: MIN_PX });
      ctx.fillStyle = THEME.text;
      setFont(ctx, MIN_PX);
      y = drawParagraph(ctx, text, 28 + keyW, y, W - 56 - keyW, 46).y + 22;
    }
    state.helpBottom = y - 22 - 46; // baseline of the last line, for the layout check
  }

  function drawDialog(ctx) {
    const d = state.dialog;
    const target = targetById(d.id);
    panel.regions.length = 0; // modal: nothing under the box can be tapped
    ctx.fillStyle = 'rgba(6, 9, 13, 0.78)';
    ctx.fillRect(0, 0, W, H);
    const x = 150;
    const y = 150;
    const w = W - 300;
    const h = 600;
    fillChamfer(ctx, x, y, w, h, { cut: 26, fill: THEME.card, stroke: THEME.accent, lineWidth: 6 });
    ctx.textAlign = 'center';
    ctx.fillStyle = THEME.text;
    fitText(ctx, target.id === 'START' ? 'Teleport to the airlock?' : `Teleport to stop ${target.badge}?`, W / 2, y + 92, 60, w - 80, { weight: 'bold', minPx: MIN_PX });
    ctx.fillStyle = THEME.accent;
    fitText(ctx, target.name, W / 2, y + 162, 50, w - 80, { weight: 'bold', minPx: MIN_PX });
    ctx.fillStyle = THEME.amber;
    fitText(ctx, `Costs ${wholeMinutes(d.seconds)} min of EVA time`, W / 2, y + 262, 62, w - 80, { weight: 'bold', minPx: MIN_PX });
    ctx.fillStyle = THEME.dim;
    setFont(ctx, MIN_PX);
    ctx.fillText(`The walking time for ${Math.round(d.metres)} m along the route,`, W / 2, y + 336);
    ctx.fillText('at our assumed pace (ASSUMPTION).', W / 2, y + 386);
    ctx.textAlign = 'left';
    button(ctx, 'jump-cancel', x + 50, y + h - 162, 400, 116, 'CANCEL', () => tablet.cancelJump(), { px: 52 });
    button(ctx, 'jump-go', x + w - 450, y + h - 162, 400, 116, 'GO', () => tablet.confirmJump(), { on: true, px: 52 });
  }

  function draw() {
    state.clippedText = null;
    const ctx = panel.begin();
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, H);
    if (state.modal) {
      // Full-screen page owned by another module (the Field Check), in place of the tabs.
      state.modal.draw(ctx, { panel, W, H, MIN_PX, button, state });
      panel.end();
      dirty = false;
      return;
    }
    drawTabs(ctx);
    if (state.tab === 'MAP') drawMap(ctx);
    else if (state.tab === 'LOG') drawLog(ctx);
    else if (state.tab === 'LAYERS') drawLayers(ctx);
    else drawHelp(ctx);
    if (state.dialog) drawDialog(ctx);
    panel.end();
    dirty = false;
  }

  // ---- where it is ----------------------------------------------------------------
  function wantedMount() {
    if (!renderer.xr.isPresenting) return 'desktop';
    return xr && xr.controllerFor('left') ? 'arm' : 'float';
  }

  function mount(kind) {
    state.mount = kind;
    state.open = false;
    state.pinned = false;
    state.gaze = false;
    state.dialog = null;
    state.slide = 0;
    gazeTimerS = 0;
    gazeBlocked = false;
    dirty = true;
    group.scale.setScalar(1);
    if (kind === 'desktop') {
      camera.add(group);
      group.quaternion.identity();
      group.visible = false;
    } else if (kind === 'arm') {
      xr.controllerFor('left').add(group);
      group.position.copy(ARM_POSITION);
      group.quaternion.copy(ARM_QUATERNION);
      group.visible = true; // the slate is worn all the time; only the screen goes dark
    } else {
      scene.add(group);
      group.visible = false;
    }
    panel.mesh.visible = false;
  }

  // No left controller in VR: stand the tablet in the world in front of the explorer.
  function placeFloating() {
    headPlace(head);
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    group.position.copy(head).addScaledVector(forward, 0.5);
    group.position.y -= 0.28;
    group.lookAt(head);
  }

  const tablet = {
    group,
    body,
    panel,
    marker,
    state,
    targets,
    targetById,
    screenWidthM: SCREEN_W_M,
    screenHeightM: SCREEN_H_M,
    minFontPx: MIN_PX,
    costFrom,
    alongRoute,

    get open() {
      return state.open;
    },
    get dirty() {
      return dirty;
    },

    setOpen(open) {
      open = !!open;
      if (state.mount === null) mount(wantedMount());
      if (state.mount === 'arm') {
        state.pinned = open;
        state.gaze = false;
        gazeTimerS = 0;
        gazeBlocked = !open; // turned off by hand: stays off until looked away from
      }
      if (open === state.open) return state.open;
      state.open = open;
      if (open) {
        state.helpDevice = renderer.xr.isPresenting ? 'quest' : 'desktop';
        dirty = true;
        if (state.mount === 'desktop') document.exitPointerLock?.(); // free the mouse for the buttons
        if (state.mount === 'float') placeFloating();
      } else if (state.dialog) {
        state.dialog = null;
        dirty = true;
      }
      return state.open;
    },
    toggle: () => tablet.setOpen(!state.open),

    setTab(tab) {
      if (!TABS.includes(tab) || tab === state.tab) return;
      state.tab = tab;
      dirty = true;
    },
    // A full-screen page over the tabs, or null to take it away. modal = { draw(ctx, kit) }.
    setModal(modal) {
      state.modal = modal || null;
      if (state.modal) state.dialog = null;
      dirty = true;
    },
    // Ask for the screen to be drawn again (for whoever owns the modal).
    redraw() {
      dirty = true;
    },
    setHelpDevice(device) {
      if (!HELP[device] || device === state.helpDevice) return;
      state.helpDevice = device;
      dirty = true;
    },
    setLayersPage(page) {
      state.layersPage = page;
      dirty = true;
    },
    // Opens the first CREDITS page of the LAYERS tab (for a "credits" button elsewhere).
    credits,
    showCredits() {
      tablet.setTab('LAYERS');
      tablet.setLayersPage(Math.ceil(layers.list.length / 3));
    },

    // What teleporting to a stop would cost from where the explorer is now:
    // { seconds, metres, fromIndex, toIndex, offRouteM, way }.
    cost(id) {
      const target = targetById(id);
      if (!target) return null;
      headPlace(head);
      return costFrom(head.x, head.z, target);
    },

    // A pin or list entry was tapped: put up the confirm box with the cost.
    askJump(id) {
      const cost = tablet.cost(id);
      if (!cost) return false;
      state.dialog = { id, seconds: cost.seconds, metres: cost.metres, x: head.x, z: head.z };
      dirty = true;
      return true;
    },
    cancelJump() {
      if (!state.dialog) return;
      state.dialog = null;
      dirty = true;
    },
    // GO: charge the clock the walking time of the route distance, then move.
    confirmJump() {
      if (!state.dialog) return false;
      const target = targetById(state.dialog.id);
      const cost = tablet.cost(target.id);
      const from = { x: head.x, z: head.z };
      state.dialog = null;
      dirty = true;
      const before = clock.elapsedS;
      clock.charge(cost.seconds, { metres: cost.metres, reason: 'teleport' });
      const moved = mission.travelTo(target.landX, target.landZ, target.headingDeg);
      if (!moved) {
        // Could not move (should not happen on the route): give the time back.
        clock.elapsedS = before;
        clock.charge(0);
        return false;
      }
      headPlace(head);
      clock.moveCharged(head.x, head.z); // the trip is paid: do not also charge the straight line
      state.jumps++;
      state.lastJump = { id: target.id, seconds: cost.seconds, metres: cost.metres, way: cost.way, from, to: { x: head.x, z: head.z }, headingDeg: target.headingDeg };
      if (state.mount === 'desktop') tablet.setOpen(false); // show where we are
      return true;
    },

    // Once per frame. viewer = world position of the head. No allocations.
    update(dt, viewer) {
      const wanted = wantedMount();
      if (wanted !== state.mount || (wanted === 'arm' && group.parent !== xr.controllerFor('left'))) mount(wanted);

      if (state.mount === 'desktop') {
        // Slide up from below the view; sized to fit the window.
        const target = state.open ? 1 : 0;
        if (state.slide !== target) {
          const step = dt / SLIDE_S;
          state.slide = target > state.slide ? Math.min(1, state.slide + step) : Math.max(0, state.slide - step);
        }
        group.visible = state.slide > 0;
        panel.mesh.visible = group.visible;
        if (group.visible) {
          const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
          const fullW = SCREEN_W_M + 0.13;
          const fullH = SCREEN_H_M + 0.075;
          const distance = Math.max(fullH / (2 * tan * 0.9), fullW / (2 * tan * camera.aspect * 0.94), camera.near * 1.6);
          const ease = state.slide * state.slide * (3 - 2 * state.slide);
          group.position.set(0, -(1 - ease) * 2.1 * tan * distance, -distance);
        }
      } else if (state.mount === 'arm') {
        // Lit while pinned with Y, or while looked at.
        group.getWorldPosition(tabletPos);
        camera.getWorldDirection(forward);
        toTablet.copy(tabletPos).sub(viewer);
        const distance = toTablet.length();
        toTablet.multiplyScalar(1 / Math.max(distance, 1e-6));
        const offDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(Math.max(forward.dot(toTablet), -1), 1)));
        group.getWorldQuaternion(quaternion);
        normal.set(0, 0, 1).applyQuaternion(quaternion);
        const facing = -normal.dot(toTablet);
        const looking = distance < GAZE_MAX_M && offDeg < GAZE_OPEN_DEG && facing > GAZE_FACING;
        const away = distance > GAZE_MAX_M * 1.25 || offDeg > GAZE_CLOSE_DEG || facing < GAZE_FACING * 0.4;
        state.gazeOffDeg = offDeg;
        state.gazeFacing = facing;
        if (away) gazeBlocked = false;
        if (!state.pinned) {
          if (!state.gaze && looking && !gazeBlocked) {
            gazeTimerS += dt;
            if (gazeTimerS >= GAZE_OPEN_S) {
              state.gaze = true;
              gazeTimerS = 0;
              state.open = true;
              state.helpDevice = 'quest';
              dirty = true;
            }
          } else if (state.gaze && away) {
            gazeTimerS += dt;
            if (gazeTimerS >= GAZE_CLOSE_S) {
              state.gaze = false;
              gazeTimerS = 0;
              state.open = false;
              if (state.dialog) {
                state.dialog = null;
                dirty = true;
              }
            }
          } else {
            gazeTimerS = 0;
          }
        }
        group.visible = true;
        panel.mesh.visible = state.open;
      } else {
        group.visible = state.open;
        panel.mesh.visible = state.open;
      }

      if (!panel.mesh.visible) return;

      // The cost in the confirm box is for where the explorer stands: keep it true.
      if (state.dialog && Math.hypot(viewer.x - state.dialog.x, viewer.z - state.dialog.z) > 1) tablet.askJump(state.dialog.id);

      if (dirty) draw();

      // You-are-here: a mesh over the map, so walking and turning redraw nothing.
      const showMarker = state.tab === 'MAP' && !state.dialog && !state.modal;
      marker.visible = showMarker;
      if (showMarker) {
        const px = Math.min(Math.max(mapX(viewer.x), MAP_X), MAP_X + MAP_S);
        const py = Math.min(Math.max(mapY(viewer.z), MAP_Y), MAP_Y + MAP_S);
        marker.position.x = (px / W - 0.5) * SCREEN_W_M;
        marker.position.y = (0.5 - py / H) * SCREEN_H_M;
        camera.getWorldDirection(forward);
        if (Math.hypot(forward.x, forward.z) > 0.2) marker.rotation.z = -Math.atan2(forward.x, -forward.z); // heading, clockwise from north (up on the map)
      }
    },

    stats() {
      const count = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
      const mmPerPx = (SCREEN_W_M * 1000) / W;
      return {
        triangles: count(body) + count(panel.mesh) + count(marker) + count(panel.highlight),
        drawCalls: 2 + (marker.visible ? 1 : 0) + (panel.highlight.visible ? 1 : 0),
        canvas: [W, H],
        redraws: panel.redraws,
        minFontPx: MIN_PX,
        minFontMm: MIN_PX * mmPerPx,
        minFontDegAtReadDistance: THREE.MathUtils.radToDeg(2 * Math.atan((MIN_PX * mmPerPx) / 2000 / READ_DISTANCE_M)),
        readDistanceM: READ_DISTANCE_M,
      };
    },
  };

  layers.onChange = () => {
    dirty = true;
  };
  mission.log.onChange = () => {
    dirty = true;
  };

  // Desktop: Tab or Y.
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Tab' && event.code !== 'KeyY') return;
    if (event.code === 'Tab') event.preventDefault(); // keep the keyboard on the page
    if (event.repeat || renderer.xr.isPresenting) return;
    tablet.toggle();
  });

  mount(wantedMount());
  return tablet;
}

