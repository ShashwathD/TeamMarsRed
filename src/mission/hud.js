import * as THREE from 'three';
import { PALETTE, css, lowPolyMaterial, mergeParts } from './lowpoly.js';

// Suit HUD (brief: SYSTEMS / HUD).
//
// 1. THE STRIP: one wide, low panel floating about 1.15 m in front of the
//    explorer and below eye level. It is an object in the scene, not a child
//    of the camera. It stays where it is while the head turns a little; when
//    the head has turned away by more than START_FOLLOW_DEG it glides back in
//    front (it "trails" the turn) and it is never left more than MAX_LAG_DEG
//    behind. It does not follow looking up or down.
// 2. FLASHES: a short word ("SLOPE CAUTION", "SCAN", "SAMPLE SEALED",
//    "RETURN") near the top of the view for about 2.5 s. This is the only
//    thing fixed to the head, and only while it shows.
//
// Both are canvas textures. The strip's canvas is drawn again only when a
// value it shows has changed, and at most once every REDRAW_MIN_S; the flash
// canvas only when a flash starts. Nothing is drawn or allocated on an
// ordinary frame.
//
// Values tagged SIM on the strip (suit oxygen, battery, temperature) are
// cosmetic: they are not data and not measured (brief, content rule 4).

const STRIP_DISTANCE_M = 1.15;
const STRIP_BELOW_DEG = 24; // below eye level
const STRIP_W_M = 1.24;
const STRIP_H_M = 0.13;
const STRIP_CANVAS_W = 2400; // same shape as the strip: 1 px is about 0.5 mm
const STRIP_CANVAS_H = 252;
const START_FOLLOW_DEG = 28; // the strip starts to re-centre when the head has turned this far from it
const STOP_FOLLOW_DEG = 1.5; // ... and stops when it is this close again
const MAX_LAG_DEG = 55; // it is never left farther behind than this
const FOLLOW_RATE = 4; // per second (exponential approach)
const POSITION_RATE = 10; // per second: how fast it follows the head's position
const MAX_POSITION_LAG_M = 0.1; // the strip's anchor is never farther than this from the head (walking, running, teleport)
const REDRAW_MIN_S = 0.2;

const FLASH_W_M = 0.46;
const FLASH_H_M = 0.094;
const FLASH_CANVAS_W = 1024;
const FLASH_CANVAS_H = 208;
const FLASH_POSITION = [0, 0.3, -0.95]; // in the camera's frame: about 17 degrees above the view centre
const FLASH_IN_S = 0.15;
const FLASH_HOLD_S = 1.9;
const FLASH_OUT_S = 0.5;
const FLASH_CHAMFER = 0.3; // corner cut, as a share of the panel height

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const LEVEL_COLOR = { ok: PALETTE.offWhite, amber: PALETTE.amber, red: PALETTE.red };

// What each flash says and its colour. 'amber' / 'red' can be asked for with { level }.
export const FLASHES = {
  SLOPE: { text: 'SLOPE CAUTION', level: 'amber' },
  SCAN: { text: 'SCAN', level: 'info' },
  SAMPLE: { text: 'SAMPLE SEALED', level: 'info' },
  COLLECT: { text: 'SAMPLE COLLECTED', level: 'info' }, // minerals: a container picked up at a deposit, nothing is cored
  RETURN: { text: 'RETURN', level: 'amber' },
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// h:mm from seconds, rounded down to the minute; a minus sign below zero.
function clockText(seconds) {
  const minutes = Math.floor(Math.abs(seconds) / 60);
  const text = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  return seconds < 0 && minutes > 0 ? `-${text}` : text;
}

function stripFrameGeometry() {
  const hex = (radius, depth) => new THREE.CylinderGeometry(radius, radius, depth, 6).rotateX(Math.PI / 2);
  const railW = STRIP_W_M + 0.06;
  const capX = STRIP_W_M / 2 + 0.075;
  return mergeParts([
    { geometry: new THREE.BoxGeometry(railW, 0.016, 0.03), color: PALETTE.slate, y: STRIP_H_M / 2 + 0.008, z: -0.012 },
    { geometry: new THREE.BoxGeometry(railW, 0.016, 0.03), color: PALETTE.slate, y: -STRIP_H_M / 2 - 0.008, z: -0.012 },
    { geometry: hex(0.092, 0.036), color: PALETTE.slate, x: -capX, z: -0.012 },
    { geometry: hex(0.092, 0.036), color: PALETTE.slate, x: capX, z: -0.012 },
    { geometry: hex(0.05, 0.02), color: PALETTE.teal, x: -capX, z: 0.012 },
    { geometry: hex(0.05, 0.02), color: PALETTE.marsOrange, x: capX, z: 0.012 },
  ]);
}

// Panel with cut corners: unit height, `aspect` wide, centred; uv from position.
function chamferedPanelGeometry(aspect, cut) {
  const x = aspect / 2;
  const y = 0.5;
  const outline = [
    [-x + cut, -y], [x - cut, -y], [x, -y + cut], [x, y - cut],
    [x - cut, y], [-x + cut, y], [-x, y - cut], [-x, -y + cut],
  ];
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  for (const [px, py] of outline) {
    positions.push(px, py, 0);
    uvs.push(px / aspect + 0.5, py + 0.5);
  }
  const indices = [];
  for (let i = 0; i < outline.length; i++) indices.push(0, 1 + i, 1 + ((i + 1) % outline.length));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// Strip layout: [id, label, width in canvas px]. The three on the right are cosmetic.
const CELLS = [
  ['left', 'EVA LEFT', 250],
  ['home', 'WALK HOME', 290],
  ['margin', 'MARGIN', 250],
  ['heading', 'HEADING', 320],
  ['slope', 'SLOPE', 180],
  ['next', 'NEXT', 300],
  ['o2', 'SIM O2', 250],
  ['battery', 'SIM BATT', 250],
  ['temp', 'SIM TEMP', 250],
];
const SIM_FROM = 6; // index of the first cosmetic cell
const STRIP_PAD = (STRIP_CANVAS_W - CELLS.reduce((sum, cell) => sum + cell[2], 0)) / 2;

export function createHud({ scene, camera, anisotropy = 4 }) {
  const group = new THREE.Group();
  group.name = 'mission-hud';
  group.rotation.order = 'YXZ';
  scene.add(group);

  // ---- strip ---------------------------------------------------------------
  const stripCanvas = document.createElement('canvas');
  stripCanvas.width = STRIP_CANVAS_W;
  stripCanvas.height = STRIP_CANVAS_H;
  const stripCtx = stripCanvas.getContext('2d');
  const stripTexture = new THREE.CanvasTexture(stripCanvas);
  stripTexture.colorSpace = THREE.SRGBColorSpace;
  stripTexture.anisotropy = anisotropy;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(STRIP_W_M, STRIP_H_M),
    new THREE.MeshBasicMaterial({ map: stripTexture, transparent: true, depthWrite: false, fog: false, toneMapped: false }),
  );
  strip.name = 'hud-strip';
  strip.renderOrder = 950;
  group.add(strip);
  const frame = new THREE.Mesh(stripFrameGeometry(), lowPolyMaterial());
  frame.name = 'hud-strip-frame';
  group.add(frame);

  // ---- flash ---------------------------------------------------------------
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = FLASH_CANVAS_W;
  flashCanvas.height = FLASH_CANVAS_H;
  const flashCtx = flashCanvas.getContext('2d');
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  flashTexture.colorSpace = THREE.SRGBColorSpace;
  flashTexture.anisotropy = anisotropy;
  const flashMesh = new THREE.Mesh(
    chamferedPanelGeometry(FLASH_W_M / FLASH_H_M, FLASH_CHAMFER),
    new THREE.MeshBasicMaterial({ map: flashTexture, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
  );
  flashMesh.name = 'hud-flash';
  flashMesh.renderOrder = 960;
  flashMesh.scale.setScalar(FLASH_H_M);
  flashMesh.position.fromArray(FLASH_POSITION);
  flashMesh.visible = false;
  camera.add(flashMesh);

  // Values on the strip, already rounded to what is shown. The mission writes
  // these every frame; the canvas is drawn again only when one differs from
  // what is on it.
  const values = {
    leftMin: 0, // minutes, whole (may be negative)
    homeMin: 0,
    marginMin: 0,
    status: 'ok', // clock status: colours MARGIN
    headingDeg: 0, // whole degrees, in steps of 5
    slopeDeg: 0, // whole degrees
    slopeLevel: 'ok', // 'ok' | 'amber' | 'red'
    nextId: '', // station id, or '' for none
    nextM: 0, // metres, already rounded
    o2: 0, // SIM
    battery: 0, // SIM
    tempC: 0, // SIM
  };
  const shown = { ...values, leftMin: NaN }; // NaN: nothing drawn yet
  const keys = Object.keys(values);

  function fitText(ctx, text, x, y, px, room, weight = 'bold') {
    ctx.font = `${weight} ${px}px ${FONT}`;
    const width = ctx.measureText(text).width;
    if (width > room) ctx.font = `${weight} ${Math.floor((px * room) / width)}px ${FONT}`;
    ctx.fillText(text, x, y);
  }

  function drawStrip() {
    const ctx = stripCtx;
    const v = values;
    ctx.clearRect(0, 0, STRIP_CANVAS_W, STRIP_CANVAS_H);
    ctx.fillStyle = 'rgba(16, 21, 28, 0.78)';
    ctx.fillRect(0, 0, STRIP_CANVAS_W, STRIP_CANVAS_H);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';

    const marginColor = LEVEL_COLOR[v.status];
    const heading = ((v.headingDeg % 360) + 360) % 360;
    const text = {
      left: [clockText(v.leftMin * 60), v.leftMin < 0 ? LEVEL_COLOR.red : LEVEL_COLOR.ok],
      home: [clockText(v.homeMin * 60), LEVEL_COLOR.ok],
      margin: [clockText(v.marginMin * 60), marginColor],
      heading: [`${COMPASS[Math.round(heading / 45) % 8]} ${heading}°`, LEVEL_COLOR.ok],
      slope: [`${v.slopeDeg}°`, LEVEL_COLOR[v.slopeLevel]],
      next: [v.nextId ? `${v.nextM} m` : '--', LEVEL_COLOR.ok],
      o2: [`${v.o2}%`, LEVEL_COLOR.ok],
      battery: [`${v.battery}%`, LEVEL_COLOR.ok],
      temp: [`${v.tempC}°C`, LEVEL_COLOR.ok],
    };

    let x = STRIP_PAD;
    CELLS.forEach(([id, label, width], index) => {
      const sim = index >= SIM_FROM;
      const centre = x + width / 2;
      if (index > 0) {
        // Divider; a stronger one before the cosmetic block.
        ctx.fillStyle = index === SIM_FROM ? css(PALETTE.marsOrange) : 'rgba(239, 230, 216, 0.25)';
        ctx.fillRect(x - 2, 34, index === SIM_FROM ? 6 : 4, STRIP_CANVAS_H - 68);
      }
      ctx.globalAlpha = sim ? 0.8 : 1;
      ctx.fillStyle = css(sim ? PALETTE.marsOrange : PALETTE.teal);
      const labelText = id === 'next' && v.nextId ? `NEXT ${v.nextId}` : label;
      fitText(ctx, labelText, centre, 74, 44, width - 26);
      ctx.fillStyle = css(text[id][1]);
      fitText(ctx, text[id][0], centre, 204, sim ? 92 : 116, width - 30);
      ctx.globalAlpha = 1;
      x += width;
    });
    stripTexture.needsUpdate = true;
  }

  // ---- flash drawing ---------------------------------------------------------
  const flash = { kind: null, text: '', level: '', ageS: Infinity, count: 0, history: [] };

  function drawFlash(text, level) {
    const ctx = flashCtx;
    const color = level === 'red' ? PALETTE.red : level === 'amber' ? PALETTE.amber : PALETTE.teal;
    const cut = FLASH_CHAMFER * FLASH_CANVAS_H;
    const w = FLASH_CANVAS_W;
    const h = FLASH_CANVAS_H;
    const outline = [[cut, 0], [w - cut, 0], [w, cut], [w, h - cut], [w - cut, h], [cut, h], [0, h - cut], [0, cut]];
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = css(color); // the cut corners lie outside the mesh; filled so no edge bleeds
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    outline.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = 'rgb(16, 21, 28)';
    ctx.fill();
    ctx.lineWidth = 22;
    ctx.strokeStyle = css(color);
    ctx.stroke();
    ctx.fillStyle = css(color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, text, w / 2, h / 2 + 8, 124, w - 120);
    flashTexture.needsUpdate = true;
  }

  // ---- lazy follow -----------------------------------------------------------
  const forward = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const below = THREE.MathUtils.degToRad(STRIP_BELOW_DEG);
  const follow = { yawDeg: 0, headYawDeg: 0, lagDeg: 0, following: false, placed: false };
  let sinceRedrawS = Infinity;

  const hud = {
    group,
    strip,
    frame,
    flashMesh,
    values,
    shown,
    follow,
    redraws: 0, // times the strip canvas was drawn
    flashRedraws: 0,
    stripDistanceM: STRIP_DISTANCE_M,
    stripBelowDeg: STRIP_BELOW_DEG,
    startFollowDeg: START_FOLLOW_DEG,
    maxLagDeg: MAX_LAG_DEG,
    flashSeconds: FLASH_IN_S + FLASH_HOLD_S + FLASH_OUT_S,

    get flashState() {
      return { active: flashMesh.visible, kind: flash.kind, text: flash.text, level: flash.level, count: flash.count, opacity: flashMesh.material.opacity };
    },
    flashHistory: flash.history, // latest 20: { kind, text, level }

    // Shows a word near the top of the view for about 2.5 s.
    // kind: 'SLOPE' | 'SCAN' | 'SAMPLE' | 'RETURN' (see FLASHES);
    // level: 'amber' | 'red' for the two cautions; detail: short text added after the word.
    flash(kind, { level, detail } = {}) {
      const spec = FLASHES[kind];
      if (!spec || !group.visible) return false; // nothing shows while the HUD is hidden (the cabin)
      flash.kind = kind;
      flash.text = detail ? `${spec.text} ${detail}` : spec.text;
      flash.level = level || spec.level;
      flash.ageS = 0;
      flash.count++;
      flash.history.push({ kind, text: flash.text, level: flash.level });
      if (flash.history.length > 20) flash.history.shift();
      drawFlash(flash.text, flash.level);
      hud.flashRedraws++;
      flashMesh.material.opacity = 0;
      flashMesh.visible = true;
      return true;
    },

    setVisible(visible) {
      group.visible = !!visible;
      if (!visible) flashMesh.visible = false;
    },

    // Once per frame. head = world position of the head.
    update(dt, head) {
      // -- where the head looks, as a compass heading (0 = north = -z, 90 = east = +x)
      camera.getWorldDirection(forward);
      if (Math.hypot(forward.x, forward.z) > 0.2) {
        follow.headYawDeg = THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z));
      }
      if (!follow.placed) {
        follow.yawDeg = follow.headYawDeg;
        anchor.copy(head);
        follow.placed = true;
      }
      let lag = ((follow.headYawDeg - follow.yawDeg + 540) % 360) - 180;
      if (!follow.following && Math.abs(lag) > START_FOLLOW_DEG) follow.following = true;
      if (follow.following) {
        lag *= Math.exp(-FOLLOW_RATE * dt);
        if (Math.abs(lag) < STOP_FOLLOW_DEG) follow.following = false;
      }
      if (lag > MAX_LAG_DEG) lag = MAX_LAG_DEG;
      else if (lag < -MAX_LAG_DEG) lag = -MAX_LAG_DEG;
      follow.yawDeg = follow.headYawDeg - lag;
      follow.lagDeg = lag;

      // -- position: follows the head softly, never more than MAX_POSITION_LAG_M behind
      anchor.lerp(head, 1 - Math.exp(-POSITION_RATE * dt));
      const behind = anchor.distanceTo(head);
      if (behind > MAX_POSITION_LAG_M) anchor.lerp(head, 1 - MAX_POSITION_LAG_M / behind);
      const yaw = THREE.MathUtils.degToRad(follow.yawDeg);
      const out = Math.cos(below) * STRIP_DISTANCE_M;
      group.position.set(anchor.x + Math.sin(yaw) * out, anchor.y - Math.sin(below) * STRIP_DISTANCE_M, anchor.z - Math.cos(yaw) * out);
      group.rotation.set(-below, -yaw, 0); // faces back toward the eyes, tilted up

      // -- strip text, only when something shown has changed
      sinceRedrawS += dt;
      if (sinceRedrawS >= REDRAW_MIN_S) {
        let changed = false;
        for (let i = 0; i < keys.length; i++) {
          if (shown[keys[i]] !== values[keys[i]]) {
            changed = true;
            break;
          }
        }
        if (changed) {
          for (let i = 0; i < keys.length; i++) shown[keys[i]] = values[keys[i]];
          drawStrip();
          hud.redraws++;
          sinceRedrawS = 0;
        }
      }

      // -- flash fade
      if (flashMesh.visible) {
        flash.ageS += dt;
        const t = flash.ageS;
        let opacity = 1;
        if (t < FLASH_IN_S) opacity = t / FLASH_IN_S;
        else if (t > FLASH_IN_S + FLASH_HOLD_S) opacity = 1 - (t - FLASH_IN_S - FLASH_HOLD_S) / FLASH_OUT_S;
        if (opacity <= 0) {
          flashMesh.visible = false;
          opacity = 0;
        }
        flashMesh.material.opacity = opacity;
      }
    },

    stats() {
      const count = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
      return { triangles: count(strip) + count(frame) + count(flashMesh), drawCalls: 2 + (flashMesh.visible ? 1 : 0) };
    },
  };
  return hud;
}
