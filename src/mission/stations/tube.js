import * as THREE from 'three';
import { PALETTE, lowPolyMaterial, mergeParts } from '../lowpoly.js';

// A generic sample tube for the core stations (S4, S5): chunky, six-sided,
// slightly oversized so it reads in the hand. Simulated prop, not a model of
// the real Mars 2020 sample tube. Its long axis is local +y; the origin is the
// middle of the tube, so it sits in a fist when given to ctx.hand.hold().
//
//   const tube = createSampleTube();           // one mesh, one draw call, 96 triangles
//   ctx.hand.hold(tube);  ...  ctx.hand.release();
//
// All tubes share one geometry per accent colour and the shared low-poly material.

export const TUBE_LENGTH_M = 0.2;
export const TUBE_RADIUS_M = 0.024;

const geometries = new Map();

function tubeGeometry(accent) {
  if (geometries.has(accent)) return geometries.get(accent);
  const r = TUBE_RADIUS_M;
  const l = TUBE_LENGTH_M;
  const geometry = mergeParts([
    { geometry: new THREE.CylinderGeometry(r, r, l * 0.72, 6), color: PALETTE.offWhite, y: -l * 0.06 },
    { geometry: new THREE.CylinderGeometry(r * 0.55, r, l * 0.1, 6), color: PALETTE.offWhite, y: -l * 0.47 }, // blunt tip
    { geometry: new THREE.CylinderGeometry(r * 1.22, r * 1.22, l * 0.07, 6), color: accent, y: l * 0.2 }, // band
    { geometry: new THREE.CylinderGeometry(r * 1.3, r * 1.3, l * 0.16, 6), color: PALETTE.slate, y: l * 0.38 }, // cap
  ]);
  geometries.set(accent, geometry);
  return geometry;
}

// options: { accent (palette colour of the band; teal by default), name }
export function createSampleTube({ accent = PALETTE.teal, name = 'sample-tube' } = {}) {
  const mesh = new THREE.Mesh(tubeGeometry(accent), lowPolyMaterial());
  mesh.name = name;
  return mesh;
}
