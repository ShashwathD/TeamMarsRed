import * as THREE from 'three';

// Flat ribbons draped on the terrain: the planned route (blue, with chevrons
// that move in the walking direction) and the rover traverse (orange).
//
// One mesh per ribbon. The shape is built once; the only per-frame work is one
// uniform (time). The ribbon is kept clear of the ground in the vertex shader:
// a few centimetres plus a little more per metre from the eye. Far terrain is
// drawn with coarser triangles than the heights the ribbon was laid on, and
// depth precision falls with distance; the growing lift covers both, and seen
// from that far it is too small to notice. polygonOffset handles the rest.

// Height of the drawn terrain surface at full detail (src/terrain.js cuts each
// 2 m cell into two triangles along its north-east / south-west diagonal).
// Falls back to patch.groundY next to missing data.
export function terrainMeshY(patch, x, z) {
  const { cols, rows, spacing, heights } = patch;
  let fc = (x + patch.sizeX / 2) / spacing - 0.5;
  let fr = (z + patch.sizeZ / 2) / spacing - 0.5;
  fc = Math.min(Math.max(fc, 0), cols - 1);
  fr = Math.min(Math.max(fr, 0), rows - 1);
  const c0 = Math.min(Math.floor(fc), cols - 2);
  const r0 = Math.min(Math.floor(fr), rows - 2);
  const fx = fc - c0;
  const fz = fr - r0;
  const i = r0 * cols + c0;
  const a = heights[i]; // north-west
  const b = heights[i + 1]; // north-east
  const c = heights[i + cols]; // south-west
  const d = heights[i + cols + 1]; // south-east
  const h = fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  return Number.isNaN(h) ? patch.groundY(x, z) : h - patch.originHeightM;
}

// lines = [[[x, z, ...], ...], ...]. Each line is resampled every stepM or
// less and given a cross-section of widthM. uv.x runs across the ribbon (0..1),
// uv.y is metres along its line.
//
// shiftRightM (optional) = one array per line with a sideways shift in metres
// for each of its points, to the right of the walking direction. Used where a
// line runs back over itself, so the two directions lie side by side.
// stackM (optional) raises the ribbon evenly from 0 at its first point to
// stackM at its last, so where it crosses itself the later part is cleanly on
// top instead of flickering against the earlier one.
export function buildRibbonGeometry(patch, lines, { widthM, stepM = 1, shiftRightM = null, stackM = 0 }) {
  const centres = []; // x, z, along, shift, x, z, along, shift, ...
  const STRIDE = 4;
  const ranges = [];
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    const shifts = shiftRightM ? shiftRightM[l] : null;
    const first = centres.length / STRIDE;
    let along = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const ax = line[i][0];
      const az = line[i][1];
      const dx = line[i + 1][0] - ax;
      const dz = line[i + 1][1] - az;
      const d = Math.hypot(dx, dz);
      if (d === 0) continue;
      const parts = Math.max(1, Math.ceil(d / stepM - 1e-9));
      for (let p = i === 0 ? 0 : 1; p <= parts; p++) {
        const t = p / parts;
        const shift = shifts ? shifts[i] + (shifts[i + 1] - shifts[i]) * t : 0;
        centres.push(ax + dx * t, az + dz * t, along + d * t, shift);
      }
      along += d;
    }
    const count = centres.length / STRIDE - first;
    if (count >= 2) ranges.push([first, count]);
    else centres.length = first * STRIDE;
  }

  const total = centres.length / STRIDE;
  const positions = new Float32Array(total * 2 * 3);
  const uvs = new Float32Array(total * 2 * 2);
  const indices = new Uint32Array(Math.max(total - ranges.length, 0) * 6);
  let cursor = 0;
  let lengthM = 0;
  const half = widthM / 2;
  for (const [first, count] of ranges) {
    for (let k = 0; k < count; k++) {
      const i = first + k;
      const prev = first + Math.max(k - 1, 0);
      const next = first + Math.min(k + 1, count - 1);
      let tx = centres[next * STRIDE] - centres[prev * STRIDE];
      let tz = centres[next * STRIDE + 1] - centres[prev * STRIDE + 1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // Left of the walking direction, seen from above (x east, z south): (tz, -tx).
      const shift = centres[i * STRIDE + 3];
      const lineLengthM = centres[(first + count - 1) * STRIDE + 2];
      const raise = stackM && lineLengthM > 0 ? (stackM * centres[i * STRIDE + 2]) / lineLengthM : 0;
      for (let side = 0; side < 2; side++) {
        const s = (side === 0 ? 1 : -1) * half - shift;
        const x = centres[i * STRIDE] + tz * s;
        const z = centres[i * STRIDE + 1] - tx * s;
        const v = i * 2 + side;
        positions[v * 3] = x;
        positions[v * 3 + 1] = terrainMeshY(patch, x, z) + raise;
        positions[v * 3 + 2] = z;
        uvs[v * 2] = side;
        uvs[v * 2 + 1] = centres[i * STRIDE + 2];
      }
      if (k + 1 < count) {
        const a = i * 2;
        indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], cursor);
        cursor += 6;
      }
    }
    lengthM += centres[(first + count - 1) * STRIDE + 2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  geometry.userData = { lengthM, triangles: indices.length / 3, crossSections: total };
  return geometry;
}

const VERTEX = /* glsl */ `
  uniform float uLiftM;
  uniform float uLiftPerM;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += uLiftM + uLiftPerM * distance(world.xyz, cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uChevronColor;
  uniform float uChevron;   // 0 = plain ribbon, 1 = chevrons
  uniform float uPeriodM;
  uniform float uSkewM;
  uniform float uSpeed;     // metres per second, in the direction the line runs
  uniform float uTime;
  uniform float uEdge;      // share of the width that is a darker edge, each side
  varying vec2 vUv;
  void main() {
    float across = abs(vUv.x - 0.5) * 2.0;                 // 0 centre .. 1 edge
    float phase = (vUv.y + across * uSkewM - uTime * uSpeed) / uPeriodM;
    float width = fwidth(phase);
    float f = fract(phase);
    // One chevron band per period, edges smoothed by a pixel.
    float band = smoothstep(0.0, width, f) * (1.0 - smoothstep(0.45, 0.45 + width, f));
    // Far away the bands are finer than a pixel: fade to their average, no shimmer.
    float detail = 1.0 - smoothstep(0.35, 0.9, width);
    float mixAmount = uChevron * mix(0.45, band, detail);
    vec3 color = mix(uColor, uChevronColor, mixAmount);
    float edge = smoothstep(1.0 - uEdge - fwidth(across), 1.0 - uEdge, across);
    color = mix(color, uColor * 0.45, edge);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }`;

// options: { color, chevronColor, chevrons (bool), liftM, liftPerM, periodM, skewM, speed, edge }
export function createRibbon(geometry, options) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(options.color) },
      uChevronColor: { value: new THREE.Color(options.chevronColor ?? options.color) },
      uChevron: { value: options.chevrons ? 1 : 0 },
      uPeriodM: { value: options.periodM ?? 3 },
      uSkewM: { value: options.skewM ?? 0.6 },
      uSpeed: { value: options.speed ?? 1.5 },
      uTime: { value: 0 },
      uEdge: { value: options.edge ?? 0.12 },
      uLiftM: { value: options.liftM },
      uLiftPerM: { value: options.liftPerM },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
    fog: false, // a guide line: stays readable through the dust haze
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // The shader lifts the ribbon by an amount that depends on the eye, so the
  // stored bounds are only approximately right; one mesh is cheap to always draw.
  mesh.frustumCulled = false;
  return mesh;
}
