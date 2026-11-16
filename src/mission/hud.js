import * as THREE from 'three';
import { PALETTE, css } from './lowpoly.js';

// Suit HUD (team controls note: a helmet display, spread around the view).
//
// Everything here is a child of the camera, HUD_DISTANCE_M in front of the
// eyes, so it moves with the helmet:
//   TOP LEFT      EVA time left, margin
//   TOP RIGHT     heading, next stop and its distance
//   BOTTOM LEFT   slope underfoot, walk-home time
//   BOTTOM RIGHT  suit oxygen, battery, temperature (tagged SIM: cosmetic)
//   TOP CENTRE    flashes ("SLOPE CAUTION", "SCAN", "SAMPLE SEALED",
//                 "RETURN", ...) for about 2.5 s
//   CORNERS       thin visor brackets
// In a headset the panels sit inside the central 70 degrees of the view; on
// the desktop the same layout is fitted to the window.
//
// Each panel has its own small canvas texture, drawn again only when a value
// ON THAT PANEL has changed, and at most once every REDRAW_MIN_S; the flash
// canvas only when a flash starts. Nothing is drawn or allocated on an
// ordinary frame.
//
// Values tagged SIM (suit oxygen, battery, temperature) are cosmetic: they are
// not data and not measured (brief, content rule 4).

const HUD_DISTANCE_M = 1.3;
const PANEL_W_M = 0.4;
const PANEL_H_M = 0.12;
const PANEL_CANVAS_W = 640;
const PANEL_CANVAS_H = 192;
// Headset layout (metres at HUD_DISTANCE_M): the outer edges are 28 degrees
// to the side, 18 up and 20 down.
const VR_X_M = 0.5;
const VR_TOP_M = 0.36;
const VR_BOTTOM_M = -0.41;
const BRACKET_GAP_M = 0.03; // from the panels out to the visor brackets
const BRACKET_ARM_M = 0.1;
const BRACKET_THICK_M = 0.006;
const REDRAW_MIN_S = 0.2;

const FLASH_W_M = 0.5;
const FLASH_H_M = 0.102;
const FLASH_CANVAS_W = 1024;
const FLASH_CANVAS_H = 208;
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

// The four panels: where each sits (sx, sy = side of the view) and its cells
// [label, keys of `values` it shows]. `sim` marks the cosmetic panel.
const PANELS = [
  { id: 'top-left', sx: -1, sy: 1, cells: ['left', 'margin'], keys: ['leftMin', 'marginMin', 'status'] },
  { id: 'top-right', sx: 1, sy: 1, cells: ['heading', 'next'], keys: ['headingDeg', 'nextId', 'nextM'] },
  { id: 'bottom-left', sx: -1, sy: -1, cells: ['slope', 'home'], keys: ['slopeDeg', 'slopeLevel', 'homeMin'] },
  { id: 'bottom-right', sx: 1, sy: -1, cells: ['o2', 'battery', 'temp'], keys: ['o2', 'battery', 'tempC'], sim: true },
];
const LABELS = { left: 'EVA LEFT', margin: 'MARGIN', heading: 'HEADING', next: 'NEXT', slope: 'SLOPE', home: 'WALK HOME', o2: 'SIM O2', battery: 'SIM BATT', temp: 'SIM TEMP' };

// renderer is optional: with it the HUD knows when a headset is presenting.
export function createHud({ scene, camera, renderer = null, anisotropy = 4 }) {
  void scene;
  const group = new THREE.Group();
  group.name = 'mission-hud';
  group.position.z = -HUD_DISTANCE_M;
  camera.add(group);
  const content = new THREE.Group(); // panels and brackets (not the flash)
  content.name = 'hud-content';
  group.add(content);

  // ---- panels ----------------------------------------------------------------
  const panelGeometry = new THREE.PlaneGeometry(PANEL_W_M, PANEL_H_M);
  const panels = PANELS.map((spec) => {
    const canvas = document.createElement('canvas');
    canvas.width = PANEL_CANVAS_W;
    canvas.height = PANEL_CANVAS_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    const mesh = new THREE.Mesh(
      panelGeometry,
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
    );
    mesh.name = `hud-${spec.id}`;
    mesh.renderOrder = 950;
    content.add(mesh);
    return { spec, canvas, ctx: canvas.getContext('2d'), texture, mesh, sinceRedrawS: Infinity, redraws: 0 };
  });

  // ---- visor brackets: four thin corner marks, one mesh ------------------------
  const bracketPositions = new Float32Array(8 * 6 * 3);
  const bracketGeometry = new THREE.BufferGeometry();
  bracketGeometry.setAttribute('position', new THREE.BufferAttribute(bracketPositions, 3));
  const brackets = new THREE.Mesh(
    bracketGeometry,
    new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
  );
  brackets.name = 'hud-visor-brackets';
  brackets.renderOrder = 949;
  brackets.frustumCulled = false;
  content.add(brackets);

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
  flashMesh.visible = false;
  group.add(flashMesh);

  // Values on the HUD, already rounded to what is shown. The mission writes
  // these every frame; a panel's canvas is drawn again only when one of ITS
  // values differs from what is on it.
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
  const shown = { ...values, leftMin: NaN, headingDeg: NaN, slopeDeg: NaN, o2: NaN }; // NaN: nothing drawn yet

  function fitText(ctx, text, x, y, px, room, weight = 'bold') {
    ctx.font = `${weight} ${px}px ${FONT}`;
    const width = ctx.measureText(text).width;
    if (width > room) ctx.font = `${weight} ${Math.floor((px * room) / width)}px ${FONT}`;
    ctx.fillText(text, x, y);
  }

  // Text and colour of one cell, from `values`.
  function cellText(id) {
    const v = values;
    switch (id) {
      case 'left': return [clockText(v.leftMin * 60), v.leftMin < 0 ? LEVEL_COLOR.red : LEVEL_COLOR.ok];
      case 'margin': return [clockText(v.marginMin * 60), LEVEL_COLOR[v.status]];
      case 'home': return [clockText(v.homeMin * 60), LEVEL_COLOR.ok];
      case 'heading': {
        const heading = ((v.headingDeg % 360) + 360) % 360;
        return [`${COMPASS[Math.round(heading / 45) % 8]} ${heading}°`, LEVEL_COLOR.ok];
      }
      case 'slope': return [`${v.slopeDeg}°`, LEVEL_COLOR[v.slopeLevel]];
      case 'next': return [v.nextId ? `${v.nextM} m` : '--', LEVEL_COLOR.ok];
      case 'o2': return [`${v.o2}%`, LEVEL_COLOR.ok];
      case 'battery': return [`${v.battery}%`, LEVEL_COLOR.ok];
      default: return [`${v.tempC}°C`, LEVEL_COLOR.ok];
    }
  }

  function drawPanel(panel) {
    const { ctx, spec } = panel;
    const w = PANEL_CANVAS_W;
    const h = PANEL_CANVAS_H;
    const cut = 44; // the corner toward the middle of the view is cut off
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // Drawn for the top-left panel, mirrored for the others.
    ctx.translate(spec.sx > 0 ? w : 0, spec.sy < 0 ? h : 0);
    ctx.scale(spec.sx > 0 ? -1 : 1, spec.sy < 0 ? -1 : 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h - cut);
    ctx.lineTo(w - cut, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16, 21, 28, 0.6)';
    ctx.fill();
    // Edge light along the two outer sides: teal, or the worst level on this panel.
    let edge = spec.sim ? PALETTE.marsOrange : PALETTE.teal;
    const texts = spec.cells.map(cellText);
    for (const [, color] of texts) {
      if (color === PALETTE.red) edge = PALETTE.red;
      else if (color === PALETTE.amber && edge !== PALETTE.red) edge = PALETTE.amber;
    }
    ctx.fillStyle = css(edge);
    ctx.fillRect(0, 0, w, 8);
    ctx.fillRect(0, 0, 8, h);
    ctx.restore();

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    const pad = 18;
    const cellW = (w - pad * 2) / spec.cells.length;
    spec.cells.forEach((id, index) => {
      const centre = pad + cellW * (index + 0.5);
      if (index > 0) {
        ctx.fillStyle = 'rgba(239, 230, 216, 0.25)';
        ctx.fillRect(pad + cellW * index - 2, 36, 4, h - 72);
      }
      ctx.fillStyle = css(spec.sim ? PALETTE.marsOrange : PALETTE.teal);
      const label = id === 'next' && values.nextId ? `NEXT ${values.nextId}` : LABELS[id];
      fitText(ctx, label, centre, 62, 36, cellW - 24);
      ctx.fillStyle = css(texts[index][1]);
      fitText(ctx, texts[index][0], centre, 156, spec.sim ? 74 : 92, cellW - 26);
    });
    panel.texture.needsUpdate = true;
  }

  // ---- layout ------------------------------------------------------------------
  // Headset: fixed angles. Desktop: the same corners, fitted to the window.
  const layout = { vr: null, aspect: 0, fov: 0, scale: 1, x: 0, top: 0, bottom: 0 };

  function writeQuad(offset, x0, y0, x1, y1) {
    const p = bracketPositions;
    p[offset] = x0; p[offset + 1] = y0; p[offset + 2] = 0;
    p[offset + 3] = x1; p[offset + 4] = y0; p[offset + 5] = 0;
    p[offset + 6] = x1; p[offset + 7] = y1; p[offset + 8] = 0;
    p[offset + 9] = x0; p[offset + 10] = y0; p[offset + 11] = 0;
    p[offset + 12] = x1; p[offset + 13] = y1; p[offset + 14] = 0;
    p[offset + 15] = x0; p[offset + 16] = y1; p[offset + 17] = 0;
  }

  function applyLayout(vr) {
    let scale = 1;
    let x = VR_X_M;
    let top = VR_TOP_M;
    let bottom = VR_BOTTOM_M;
    let halfW = Infinity;
    if (!vr) {
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * HUD_DISTANCE_M;
      halfW = halfH * camera.aspect;
      scale = Math.min(1.4, Math.max(0.45, (halfW * 0.8) / PANEL_W_M), (halfH * 0.36) / PANEL_H_M);
      const marginX = halfW * 0.035 + BRACKET_GAP_M * scale;
      const marginY = halfH * 0.045 + BRACKET_GAP_M * scale;
      x = Math.max(halfW - marginX - (PANEL_W_M * scale) / 2, (PANEL_W_M * scale) / 2);
      top = halfH - marginY - (PANEL_H_M * scale) / 2 - halfH * 0.08; // clear of the status line (top left of the page)
      bottom = -(halfH - marginY - (PANEL_H_M * scale) / 2);
    }
    layout.vr = vr;
    layout.aspect = camera.aspect;
    layout.fov = camera.fov;
    layout.scale = scale;
    layout.x = x;
    layout.top = top;
    layout.bottom = bottom;
    for (const panel of panels) {
      const { sx, sy } = panel.spec;
      panel.mesh.position.set(sx * x, sy > 0 ? top : bottom, 0);
      panel.mesh.scale.setScalar(scale);
      // Headset: each panel is turned to face the eyes, like a curved visor.
      panel.mesh.rotation.set(0, vr ? -Math.atan2(sx * x, HUD_DISTANCE_M) : 0, 0);
      // Headset: drawn over everything. Desktop: the station card and the tablet
      // (camera children, nearer than the HUD) cover it where they overlap.
      panel.mesh.material.depthTest = !vr;
    }
    brackets.material.depthTest = !vr;
    // Flash: between the two top panels when there is room, else just under them.
    const flashH = FLASH_H_M * scale;
    const room = x - (PANEL_W_M * scale) / 2 - 0.03 * scale;
    flashMesh.scale.setScalar(flashH);
    flashMesh.position.set(0, room >= (FLASH_W_M * scale) / 2 ? top : top - (PANEL_H_M * scale) / 2 - flashH / 2 - 0.03 * scale, 0);
    // Brackets at the four outer corners.
    const bx = x + (PANEL_W_M / 2 + BRACKET_GAP_M) * scale;
    const arm = BRACKET_ARM_M * scale;
    const thick = BRACKET_THICK_M * scale;
    let offset = 0;
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 ? 1 : -1;
      const sy = i < 2 ? 1 : -1;
      const cx = sx * bx;
      const cy = (sy > 0 ? top : bottom) + sy * (PANEL_H_M / 2 + BRACKET_GAP_M) * scale;
      writeQuad(offset, cx, cy, cx - sx * arm, cy - sy * thick);
      writeQuad(offset + 18, cx, cy, cx - sx * thick, cy - sy * arm);
      offset += 36;
    }
    bracketGeometry.attributes.position.needsUpdate = true;
  }
  applyLayout(false);

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

  const forward = new THREE.Vector3();
  // headYawDeg: where the head looks, as a compass heading (the mission reads it).
  const follow = { yawDeg: 0, headYawDeg: 0, lagDeg: 0, following: false, placed: true };

  const hud = {
    group,
    content,
    panels,
    brackets,
    strip: panels[0].mesh, // older name, kept for callers that look for it
    frame: brackets,
    flashMesh,
    values,
    shown,
    follow,
    layout,
    covered: false, // set true while something fills the view (the desktop tablet): panels step aside
    redraws: 0, // times any panel canvas was drawn
    flashRedraws: 0,
    distanceM: HUD_DISTANCE_M,
    flashSeconds: FLASH_IN_S + FLASH_HOLD_S + FLASH_OUT_S,

    get flashState() {
      return { active: flashMesh.visible, kind: flash.kind, text: flash.text, level: flash.level, count: flash.count, opacity: flashMesh.material.opacity };
    },
    flashHistory: flash.history, // latest 20: { kind, text, level }

    // Shows a word at the top centre of the view for about 2.5 s.
    // kind: 'SLOPE' | 'SCAN' | 'SAMPLE' | 'COLLECT' | 'RETURN' (see FLASHES);
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

    // Once per frame. (head, the world position of the head, is no longer needed.)
    update(dt) {
      camera.getWorldDirection(forward);
      if (Math.hypot(forward.x, forward.z) > 0.2) {
        follow.headYawDeg = THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z));
      }
      follow.yawDeg = follow.headYawDeg;

      const vr = !!(renderer && renderer.xr.isPresenting);
      if (vr !== layout.vr || (!vr && (camera.aspect !== layout.aspect || camera.fov !== layout.fov))) applyLayout(vr);
      content.visible = !hud.covered;

      // -- panel text, only where something shown has changed
      for (let p = 0; p < panels.length; p++) {
        const panel = panels[p];
        panel.sinceRedrawS += dt;
        if (panel.sinceRedrawS < REDRAW_MIN_S) continue;
        const keys = panel.spec.keys;
        let changed = false;
        for (let i = 0; i < keys.length; i++) {
          if (shown[keys[i]] !== values[keys[i]]) {
            changed = true;
            break;
          }
        }
        if (!changed) continue;
        for (let i = 0; i < keys.length; i++) shown[keys[i]] = values[keys[i]];
        drawPanel(panel);
        panel.redraws++;
        panel.sinceRedrawS = 0;
        hud.redraws++;
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
      return {
        triangles: panels.length * count(panels[0].mesh) + count(brackets) + count(flashMesh),
        drawCalls: (content.visible ? panels.length + 1 : 0) + (flashMesh.visible ? 1 : 0),
      };
    },
  };
  return hud;
}
