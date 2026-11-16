import * as THREE from 'three';
import { PALETTE, css } from './lowpoly.js';

// Small UI kit for everything the mission shows as text and buttons in the
// 3D scene (forearm tablet now; station cards, Field Check, cabin console and
// debrief later).
//
// PANEL: a flat mesh with a canvas texture. Whoever owns the panel draws on
// the canvas between begin() and end() and, while drawing, names the
// rectangles that can be tapped ("regions", in canvas pixels) and what each
// one does. The canvas is uploaded to the GPU only in end(), so a panel that
// does not change costs nothing per frame.
//
// POINTERS: a ray (from a VR controller, or from the desktop camera through
// the mouse) is tested against every visible panel with plain plane maths: no
// scene raycast and no allocations. The nearest panel hit wins.
//   - hover: the region under the ray is lit by a separate see-through quad on
//     top of the panel, so hovering never redraws or re-uploads the canvas;
//   - press: runs the region's onTap. A press that lands anywhere on a panel
//     counts as used (returns true) so the caller can keep it from also
//     starting a teleport.
//
// Text sizes are the owner's business; see tablet.js for the legibility sums.

export const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export const THEME = {
  bg: '#10151c',
  card: '#1e2733',
  cardLine: '#3a4757',
  text: css(PALETTE.offWhite),
  dim: '#b6c0cb',
  dark: '#0b0f14',
  accent: css(PALETTE.teal),
  warm: css(PALETTE.marsOrange),
  amber: css(PALETTE.amber),
  red: css(PALETTE.red),
};

// ---- canvas drawing helpers ---------------------------------------------------

export function setFont(ctx, px, weight = 'normal') {
  ctx.font = `${weight} ${px}px ${FONT}`;
}

// Rectangle with cut corners (the low-poly look, instead of rounded corners).
export function chamferPath(ctx, x, y, w, h, cut) {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

export function fillChamfer(ctx, x, y, w, h, { cut = 14, fill = THEME.card, stroke = null, lineWidth = 4 } = {}) {
  chamferPath(ctx, x, y, w, h, cut);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// Draws one line. If it is wider than `room` the font shrinks, but never
// below minPx; past that the end of the text is cut and marked with "...".
// Returns the font size used.
export function fitText(ctx, text, x, y, px, room, { weight = 'normal', minPx = px } = {}) {
  setFont(ctx, px, weight);
  let width = ctx.measureText(text).width;
  let used = px;
  if (width > room) {
    used = Math.max(minPx, Math.floor((px * room) / width));
    setFont(ctx, used, weight);
    width = ctx.measureText(text).width;
    if (width > room) {
      let cut = text;
      while (cut.length > 1 && ctx.measureText(`${cut}...`).width > room) cut = cut.slice(0, -1);
      text = `${cut.trimEnd()}...`;
    }
  }
  ctx.fillText(text, x, y);
  return used;
}

// Splits text into lines no wider than maxWidth, with the font already set.
export function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const trial = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(trial).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Wrapped text from baseline y downward. Returns { y: baseline after the last
// line, lines: lines drawn, clipped: true if maxLines cut it short }.
export function drawParagraph(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const lines = wrapLines(ctx, text, maxWidth);
  const count = Math.min(lines.length, maxLines);
  for (let i = 0; i < count; i++) ctx.fillText(lines[i], x, y + i * lineHeight);
  return { y: y + count * lineHeight, lines: count, clipped: lines.length > count };
}

// ---- panel ----------------------------------------------------------------------

const inverse = new THREE.Matrix4();
const localOrigin = new THREE.Vector3();
const localDirection = new THREE.Vector3();

// widthPx x heightPx canvas shown on a plane widthM metres wide.
export function createPanel({ name = 'ui-panel', widthPx, heightPx, widthM, anisotropy = 4, renderOrder = 0 }) {
  const heightM = (widthM * heightPx) / widthPx;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, heightM),
    new THREE.MeshBasicMaterial({ map: texture, fog: false, toneMapped: false }),
  );
  mesh.name = name;
  mesh.renderOrder = renderOrder;

  // Hover light: one quad moved over whichever region is pointed at.
  const highlight = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: PALETTE.routeBlueLight, transparent: true, opacity: 0.26, depthWrite: false, fog: false, toneMapped: false }),
  );
  highlight.name = `${name}-hover`;
  highlight.renderOrder = renderOrder + 1;
  highlight.position.z = widthM * 0.0015;
  highlight.visible = false;
  mesh.add(highlight);

  const panel = {
    name,
    canvas,
    ctx,
    texture,
    mesh,
    highlight,
    widthPx,
    heightPx,
    widthM,
    heightM,
    pxPerM: widthPx / widthM,
    regions: [],
    hovered: null, // region lit now
    pendingHover: null, // scratch for the manager
    redraws: 0, // canvas uploads so far
    taps: 0,
    enabled: true,

    // Start drawing: forgets the old regions and hands back the 2D context.
    begin() {
      panel.regions.length = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      return ctx;
    },

    // A tappable rectangle in canvas pixels. Later regions lie on top of earlier ones.
    region(id, x, y, w, h, onTap, { hover = true } = {}) {
      const region = { id, x, y, w, h, onTap, hover };
      panel.regions.push(region);
      return region;
    },

    // Done drawing: upload the canvas.
    end() {
      texture.needsUpdate = true;
      panel.redraws++;
      panel.setHighlight(null);
    },

    findRegion: (id) => panel.regions.find((region) => region.id === id) || null,

    regionAt(px, py) {
      for (let i = panel.regions.length - 1; i >= 0; i--) {
        const r = panel.regions[i];
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
      }
      return null;
    },

    // Runs a region as if it had been tapped (keyboard shortcuts, tests).
    tap(id) {
      const region = panel.findRegion(id);
      if (!region || !region.onTap) return false;
      panel.taps++;
      region.onTap(region);
      return true;
    },

    setHighlight(region) {
      if (region === panel.hovered) return;
      panel.hovered = region;
      highlight.visible = !!region;
      if (!region) return;
      highlight.position.x = ((region.x + region.w / 2) / widthPx - 0.5) * widthM;
      highlight.position.y = (0.5 - (region.y + region.h / 2) / heightPx) * heightM;
      highlight.scale.set((region.w / widthPx) * widthM, (region.h / heightPx) * heightM, 1);
    },

    // Shown only if the mesh and everything above it in the scene is visible.
    isShown() {
      if (!panel.enabled) return false;
      for (let object = mesh; object; object = object.parent) {
        if (!object.visible) return false;
        if (object.isScene) return true;
      }
      return false; // not in a scene
    },

    // Where the ray meets the front of the panel. Returns the distance in
    // metres, or -1 for a miss. Fills out.px / out.py (canvas pixels) and
    // out.point (world). No allocations.
    intersect(origin, direction, out) {
      mesh.updateWorldMatrix(true, false);
      inverse.copy(mesh.matrixWorld).invert();
      localOrigin.copy(origin).applyMatrix4(inverse);
      localDirection.copy(direction).transformDirection(inverse);
      if (!(localOrigin.z > 0) || !(localDirection.z < -1e-6)) return -1; // behind it, or pointing away
      const t = -localOrigin.z / localDirection.z;
      const x = localOrigin.x + localDirection.x * t;
      const y = localOrigin.y + localDirection.y * t;
      if (Math.abs(x) > widthM / 2 || Math.abs(y) > heightM / 2) return -1;
      out.px = (x / widthM + 0.5) * widthPx;
      out.py = (0.5 - y / heightM) * heightPx;
      out.point.set(x, y, 0).applyMatrix4(mesh.matrixWorld);
      return out.point.distanceTo(origin);
    },

    // World position of a canvas pixel / of the middle of a region (for tests and pointers).
    pixelWorld(px, py, target = new THREE.Vector3()) {
      mesh.updateWorldMatrix(true, false);
      return target.set((px / widthPx - 0.5) * widthM, (0.5 - py / heightPx) * heightM, 0).applyMatrix4(mesh.matrixWorld);
    },
    regionWorld(id, target = new THREE.Vector3()) {
      const region = panel.findRegion(id);
      return region ? panel.pixelWorld(region.x + region.w / 2, region.y + region.h / 2, target) : null;
    },

    dispose() {
      texture.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
      highlight.geometry.dispose();
      highlight.material.dispose();
    },
  };
  return panel;
}

// ---- pointers and picking ---------------------------------------------------------

const CURSOR_RADIUS_M = 0.006;

// One manager per scene. Pointer 0 is the desktop mouse; 1 and 2 are the VR
// controllers (their long rays are drawn by xr.js; mission.js ends them at the panel hit).
export function createUi({ scene, pointerCount = 3 }) {
  const group = new THREE.Group();
  group.name = 'mission-ui-pointers';
  scene.add(group);

  const cursorGeometry = new THREE.CircleGeometry(CURSOR_RADIUS_M, 8);
  const cursorMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.offWhite, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false });

  const pointers = [];
  for (let i = 0; i < pointerCount; i++) {
    const cursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
    cursor.name = `ui-cursor-${i}`;
    cursor.renderOrder = 980;
    cursor.visible = false;
    group.add(cursor);
    pointers.push({
      index: i,
      active: false,
      showCursor: i > 0, // the desktop mouse already has the system cursor
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, -1),
      hit: { panel: null, region: null, px: 0, py: 0, distance: Infinity, point: new THREE.Vector3() },
      cursor,
    });
  }

  const trial = { px: 0, py: 0, point: new THREE.Vector3() };
  const quaternion = new THREE.Quaternion();

  // Nearest visible panel on the pointer's ray; fills pointer.hit.
  function pick(pointer) {
    const hit = pointer.hit;
    hit.panel = null;
    hit.region = null;
    hit.distance = Infinity;
    for (let i = 0; i < ui.panels.length; i++) {
      const panel = ui.panels[i];
      if (!panel.isShown()) continue;
      const distance = panel.intersect(pointer.origin, pointer.direction, trial);
      if (distance < 0 || distance >= hit.distance) continue;
      hit.panel = panel;
      hit.distance = distance;
      hit.px = trial.px;
      hit.py = trial.py;
      hit.point.copy(trial.point);
    }
    if (hit.panel) hit.region = hit.panel.regionAt(hit.px, hit.py);
    return hit.panel !== null;
  }

  const ui = {
    group,
    panels: [],
    pointers,
    presses: 0, // presses that landed on a panel
    taps: 0, // ... and on a region

    add(panel) {
      if (!ui.panels.includes(panel)) ui.panels.push(panel);
      return panel;
    },
    remove(panel) {
      const at = ui.panels.indexOf(panel);
      if (at >= 0) ui.panels.splice(at, 1);
    },

    setPointer(index, origin, direction) {
      const pointer = pointers[index];
      pointer.origin.copy(origin);
      pointer.direction.copy(direction).normalize();
      pointer.active = true;
    },
    // The ray of an object that points along its own -z (a controller, a camera).
    setPointerFromObject(index, object) {
      const pointer = pointers[index];
      object.updateWorldMatrix(true, false);
      pointer.origin.setFromMatrixPosition(object.matrixWorld);
      pointer.direction.set(0, 0, -1).transformDirection(object.matrixWorld);
      pointer.active = true;
    },
    clearPointer(index) {
      pointers[index].active = false;
    },

    // The pointer's trigger / mouse button went down. True if it landed on a
    // panel (whether or not on a button): the press is then used up.
    press(index) {
      const pointer = pointers[index];
      if (!pointer.active || !pick(pointer)) return false;
      ui.presses++;
      const { panel, region } = pointer.hit;
      if (region && region.onTap) {
        ui.taps++;
        panel.taps++;
        region.onTap(region);
      }
      return true;
    },

    // What a pointer is on right now, without pressing: { panel, region, px, py, distance } or null.
    hitOf(index) {
      const pointer = pointers[index];
      return pointer.active && pick(pointer) ? pointer.hit : null;
    },

    // Once per frame: hover light and cursor dots. No allocations.
    update() {
      for (let i = 0; i < ui.panels.length; i++) ui.panels[i].pendingHover = null;
      for (let i = 0; i < pointers.length; i++) {
        const pointer = pointers[i];
        const on = pointer.active && pick(pointer);
        const hit = pointer.hit;
        pointer.cursor.visible = on && pointer.showCursor;
        if (!on) continue;
        if (hit.region && hit.region.hover) hit.panel.pendingHover = hit.region;
        if (pointer.showCursor) {
          hit.panel.mesh.getWorldQuaternion(quaternion);
          pointer.cursor.quaternion.copy(quaternion);
          pointer.cursor.position.copy(hit.point);
        }
      }
      for (let i = 0; i < ui.panels.length; i++) ui.panels[i].setHighlight(ui.panels[i].pendingHover);
    },
  };
  return ui;
}

// Desktop: the mouse is pointer 0. With the mouse captured (pointer lock) the
// ray goes through the middle of the view; otherwise through the mouse
// position. A left click that lands on a panel is used up there and does not
// capture the mouse. Returns { update() } to call once per frame.
export function attachDesktopPointer(ui, { camera, renderer }) {
  const domElement = renderer.domElement;
  const mouse = { x: 0, y: 0, inside: false };
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let swallowClick = false;

  function aim() {
    if (renderer.xr.isPresenting) {
      ui.clearPointer(0);
      return false;
    }
    const locked = document.pointerLockElement === domElement;
    if (!locked && !mouse.inside) {
      ui.clearPointer(0);
      return false;
    }
    camera.updateWorldMatrix(true, false);
    origin.setFromMatrixPosition(camera.matrixWorld);
    direction.set(locked ? 0 : mouse.x, locked ? 0 : mouse.y, 0.5).unproject(camera).sub(origin);
    ui.setPointer(0, origin, direction);
    return true;
  }

  function place(event) {
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    mouse.inside = true;
  }

  domElement.addEventListener('mousemove', place);
  domElement.addEventListener('mouseleave', () => (mouse.inside = false));
  domElement.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    place(event);
    swallowClick = aim() && ui.press(0);
  });
  // Runs before the viewer's own click handler (which captures the mouse).
  window.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopImmediatePropagation();
    },
    true,
  );

  return { mouse, update: aim };
}
