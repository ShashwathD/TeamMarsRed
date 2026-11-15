import * as THREE from 'three';
import { PALETTE, css, lowPolyMaterial, mergeParts } from './lowpoly.js';

// Station beacons: a chunky low-poly pillar on the ground at each station and
// a text label above it that turns to face the viewer.
//
// Readable from 200 m: the label grows with distance (between LABEL_NEAR_M and
// LABEL_FAR_M) so it keeps the same apparent size; closer or farther than that
// it behaves like an ordinary sign. It is a real object in the scene (not
// locked to the head): it only turns about the vertical axis.

const PILLAR_TOP_M = 6.6;
const LABEL_ASPECT = 4; // canvas 1024 x 256
const LABEL_HEIGHT_PER_M = 0.085; // label height = this x distance (about 5 degrees tall)
const LABEL_NEAR_M = 12;
const LABEL_FAR_M = 260;
// Every second label sits one label-height higher, so two stations seen in
// line (one behind the other) do not hide each other's label.
// Close up, where labels cannot hide each other, every label sits on its pillar.
const LABEL_TIER_STEP = 1.15; // in label heights
const LABEL_TIER_FROM_M = 60; // no raise closer than this
const LABEL_TIER_FULL_M = 160; // full raise from here on
const CANVAS_W = 1024;
const CANVAS_H = 256;
const CHAMFER = 0.22; // corner cut, as a share of the label height
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function pillarGeometry(kind) {
  const accent = kind === 'airlock' ? PALETTE.marsOrange : PALETTE.teal;
  const parts = [
    // Base, sunk a little so it also sits right on sloping ground.
    { geometry: new THREE.CylinderGeometry(0.85, 1.15, 0.9, 6), color: PALETTE.slate, y: 0.15 },
    { geometry: new THREE.CylinderGeometry(0.17, 0.3, 5.0, 6), color: PALETTE.offWhite, y: 3.1 },
    { geometry: new THREE.CylinderGeometry(0.42, 0.42, 0.35, 6), color: accent, y: 2.2 },
  ];
  if (kind === 'airlock') {
    // Start / airlock: a wide pad and a four-sided roof shape on top.
    parts.push({ geometry: new THREE.CylinderGeometry(2.2, 2.4, 0.5, 6), color: PALETTE.marsDeep, y: 0.0 });
    parts.push({ geometry: new THREE.ConeGeometry(1.0, 1.1, 4), color: accent, y: 6.05, rotY: Math.PI / 4 });
  } else {
    parts.push({ geometry: new THREE.OctahedronGeometry(0.8, 0), color: accent, y: 5.9 });
  }
  return mergeParts(parts);
}

// Label outline with cut corners, in a w x h rectangle centred on the origin.
function chamferedOutline(w, h, cut) {
  const x = w / 2;
  const y = h / 2;
  return [
    [-x + cut, -y], [x - cut, -y], [x, -y + cut], [x, y - cut],
    [x - cut, y], [-x + cut, y], [-x, y - cut], [-x, -y + cut],
  ];
}

let labelGeometry = null;
function sharedLabelGeometry() {
  if (labelGeometry) return labelGeometry;
  // Unit height, LABEL_ASPECT wide, bottom edge on y = 0; uv from position.
  const outline = chamferedOutline(LABEL_ASPECT, 1, CHAMFER);
  const positions = [0, 0.5, 0];
  const uvs = [0.5, 0.5];
  for (const [x, y] of outline) {
    positions.push(x, y + 0.5, 0);
    uvs.push(x / LABEL_ASPECT + 0.5, y + 0.5);
  }
  const indices = [];
  for (let i = 0; i < outline.length; i++) indices.push(0, 1 + i, 1 + ((i + 1) % outline.length));
  labelGeometry = new THREE.BufferGeometry();
  labelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  labelGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  labelGeometry.setIndex(indices);
  labelGeometry.computeBoundingSphere();
  return labelGeometry;
}

function tracePath(ctx, outline) {
  ctx.beginPath();
  outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// Largest bold font size (px) at which every name fits the space beside the badge.
function commonFontPx(names, room) {
  const ctx = document.createElement('canvas').getContext('2d');
  let px = 112;
  ctx.font = `bold ${px}px ${FONT}`;
  const widest = Math.max(...names.map((name) => ctx.measureText(name).width));
  if (widest > room) px = Math.floor((px * room) / widest);
  return px;
}

const BADGE_W = 232;
const TEXT_LEFT = BADGE_W + 34;
const TEXT_ROOM = CANVAS_W - TEXT_LEFT - 44;

function labelTexture({ badge, name, kind, fontPx, anisotropy }) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  const accent = kind === 'airlock' ? PALETTE.marsOrange : PALETTE.teal;
  const outline = chamferedOutline(CANVAS_W, CANVAS_H, CHAMFER * CANVAS_H).map(([x, y]) => [x + CANVAS_W / 2, y + CANVAS_H / 2]);

  ctx.fillStyle = css(accent); // the cut corners lie outside the mesh; fill so no edge bleeds
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.save();
  tracePath(ctx, outline);
  ctx.clip();
  ctx.fillStyle = css(PALETTE.slate);
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = css(accent);
  ctx.fillRect(0, 0, BADGE_W, CANVAS_H);
  ctx.restore();
  tracePath(ctx, outline);
  ctx.lineWidth = 20;
  ctx.strokeStyle = css(accent);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  if (kind === 'airlock') {
    // A door shape instead of a number.
    ctx.fillStyle = css(PALETTE.slate);
    ctx.beginPath();
    ctx.moveTo(82, 208);
    ctx.lineTo(82, 96);
    ctx.lineTo(104, 60);
    ctx.lineTo(148, 60);
    ctx.lineTo(170, 96);
    ctx.lineTo(170, 208);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(accent);
    ctx.fillRect(140, 132, 14, 26);
  } else {
    ctx.fillStyle = css(PALETTE.slate);
    ctx.textAlign = 'center';
    ctx.font = `bold 190px ${FONT}`;
    ctx.fillText(badge, BADGE_W / 2 + 6, CANVAS_H / 2 + 10);
  }
  ctx.fillStyle = css(PALETTE.offWhite);
  ctx.textAlign = 'left';
  ctx.font = `bold ${fontPx}px ${FONT}`;
  ctx.fillText(name, TEXT_LEFT, CANVAS_H / 2 + 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

// items = [{ id, kind ('station' | 'airlock'), badge, name, x, z }]
export function createBeacons(patch, items, { anisotropy = 4 } = {}) {
  const group = new THREE.Group();
  group.name = 'mission-beacons';
  const material = lowPolyMaterial();
  const geometries = { station: pillarGeometry('station'), airlock: pillarGeometry('airlock') };
  const fontPx = commonFontPx(items.map((item) => item.name), TEXT_ROOM);

  const beacons = items.map((item, index) => {
    const y = patch.groundY(item.x, item.z);
    const beacon = new THREE.Group();
    beacon.name = `beacon-${item.id}`;
    beacon.position.set(item.x, y, item.z);

    const pillar = new THREE.Mesh(geometries[item.kind], material);
    pillar.name = `beacon-${item.id}-pillar`;
    beacon.add(pillar);

    const label = new THREE.Mesh(
      sharedLabelGeometry(),
      new THREE.MeshBasicMaterial({ map: labelTexture({ ...item, fontPx, anisotropy }), fog: false }),
    );
    label.name = `beacon-${item.id}-label`;
    label.position.y = PILLAR_TOP_M + 0.4;
    beacon.add(label);

    group.add(beacon);
    return { ...item, y, group: beacon, pillar, label, labelTier: index % 2, labelHeightM: 0, distanceM: 0 };
  });

  // Turn each label to the viewer and size it for the distance. No allocations.
  function update(viewer) {
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      const dx = viewer.x - b.x;
      const dz = viewer.z - b.z;
      const distance = Math.hypot(dx, dz);
      const h = Math.min(Math.max(distance, LABEL_NEAR_M), LABEL_FAR_M) * LABEL_HEIGHT_PER_M;
      b.label.rotation.y = Math.atan2(dx, dz);
      b.label.scale.set(h, h, 1);
      const raise = Math.min(Math.max((distance - LABEL_TIER_FROM_M) / (LABEL_TIER_FULL_M - LABEL_TIER_FROM_M), 0), 1);
      b.label.position.y = PILLAR_TOP_M + 0.4 + h * b.labelTier * LABEL_TIER_STEP * raise;
      b.labelHeightM = h;
      b.distanceM = distance;
    }
  }

  return { group, beacons, update, fontPx, pillarTopM: PILLAR_TOP_M };
}
