import * as THREE from 'three';

// Distant terrain: the coarse regional grid (data/sites/<site>/grid.bin, e.g.
// 20 m for Jezero) drawn around the 2 m walk patch, in the same local frame.
//
// Alignment is by longitude/latitude: a local (x, z) is turned into lon/lat
// with the walk patch's own linear mapping, then looked up in the grid.
//
// Heights: the two terrains come from different source models, so the coarse
// grid sits a roughly constant amount above or below the fine patch. That
// constant (mean of fine minus coarse over the overlap) is measured here at
// load time and added to the coarse heights.
//
// Shape: square rings that start exactly on the edge of the walk patch and
// grow geometrically outward, so triangles are small next to the patch and
// large far away (a fixed level of detail that never has to change, because
// the player cannot leave the patch).
//
// Join: ring 0 takes its heights from the FINE terrain along the patch edge
// (sampled `edgeSubdivisions` times more densely than the other rings, so it
// follows the 2 m edge closely), and the leftover local disagreement between
// the two terrains is smoothed along the edge and faded out over `blendM`
// metres, so it does not leave streaks in the distant terrain. The
// surround has no geometry inside the patch footprint, so it can never poke
// through the walk terrain. A short inward-facing skirt under ring 0, plus the
// walk terrain's own skirts, covers any hairline mismatch along the join.
//
// Colour: there is no photo outside the patch, so the surround is one plain
// colour. To avoid a hard bright/dark line where the photo stops, the
// surround is tinted with the photo's own brightness along the patch edge and
// fades to the plain colour over `colorBlendM` metres (cosmetic).

const CULL_SECTORS = 8; // compass sectors the surround is drawn in
const CULL_BANDS = 3; // distance bands per sector (equal steps of log distance)

function fetchOk(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  });
}

export async function loadRegionGrid(site, baseUrl = './data/sites/') {
  const folder = `${baseUrl}${site}/`;
  const meta = await (await fetchOk(`${folder}grid.json`)).json();
  const buffer = await (await fetchOk(`${folder}grid.bin`)).arrayBuffer();
  const cols = meta.width;
  const rows = meta.height;
  if (buffer.byteLength !== cols * rows * 2) {
    throw new Error(`${folder}grid.bin is ${buffer.byteLength} bytes, expected ${cols * rows * 2}`);
  }
  const view = new DataView(buffer);
  const heights = new Float32Array(cols * rows); // true elevation in metres, NaN = no data
  for (let i = 0; i < heights.length; i++) {
    const raw = view.getInt16(i * 2, true); // little-endian
    heights[i] = raw === meta.nodata ? NaN : meta.height_offset_m + raw * meta.height_step_m;
  }

  const grid = {
    site,
    meta,
    cols,
    rows,
    heights,
    // True elevation by bilinear interpolation between the cell-centred
    // samples (row 0 north, col 0 west). NaN outside the grid or next to no-data.
    elevationAtLonLat(lon, lat) {
      const fc = ((lon - meta.west) / (meta.east - meta.west)) * cols - 0.5;
      const fr = ((meta.north - lat) / (meta.north - meta.south)) * rows - 0.5;
      if (!(fc >= 0 && fr >= 0 && fc <= cols - 1 && fr <= rows - 1)) return NaN;
      const c0 = Math.min(Math.floor(fc), cols - 2);
      const r0 = Math.min(Math.floor(fr), rows - 2);
      const tx = fc - c0;
      const tz = fr - r0;
      const i = r0 * cols + c0;
      return (
        heights[i] * (1 - tx) * (1 - tz) +
        heights[i + 1] * tx * (1 - tz) +
        heights[i + cols] * (1 - tx) * tz +
        heights[i + cols + 1] * tx * tz
      );
    },
  };
  return grid;
}

// Fine minus coarse, in metres, over every `stride`-th sample of the walk patch.
export function measureHeightAgreement(patch, grid, stride = 2) {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < patch.rows; r += stride) {
    const z = patch.rowToZ(r);
    for (let c = 0; c < patch.cols; c += stride) {
      const fine = patch.heights[r * patch.cols + c];
      if (Number.isNaN(fine)) continue;
      const { lon, lat } = patch.localToLonLat(patch.colToX(c), z);
      const coarse = grid.elevationAtLonLat(lon, lat);
      if (Number.isNaN(coarse)) continue;
      const d = fine - coarse;
      n++;
      sum += d;
      sumSq += d * d;
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  if (!n) return { samples: 0, meanM: NaN, stdM: NaN, minM: NaN, maxM: NaN };
  const mean = sum / n;
  return { samples: n, meanM: mean, stdM: Math.sqrt(Math.max(sumSq / n - mean * mean, 0)), minM: min, maxM: max };
}

export function createSurround(
  patch,
  grid,
  {
    material,
    segmentsPerSide = 96,
    edgeSubdivisions = 8,
    growth = 1.03,
    blendM = 400,
    colorBlendM = 300,
    skirtM = 30,
    // Optional (x, z) -> photo brightness relative to its average (1 = average).
    edgeBrightness = null,
  } = {},
) {
  const agreement = measureHeightAgreement(patch, grid);
  if (!agreement.samples) return null; // the grid does not cover this patch
  const offsetM = agreement.meanM; // added to the coarse heights

  // Coarse ground in local y (same zero as the walk patch), offset applied.
  function coarseY(x, z) {
    const { lon, lat } = patch.localToLonLat(x, z);
    return grid.elevationAtLonLat(lon, lat) + offsetM - patch.originHeightM;
  }

  // How far the grid reaches from the patch centre, as a multiple of the patch half-size.
  const b = patch.bounds;
  const nw = patch.lonLatToLocal(grid.meta.west, grid.meta.north);
  const se = patch.lonLatToLocal(grid.meta.east, grid.meta.south);
  const reach = Math.max(nw.x / b.minX, se.x / b.maxX, nw.z / b.minZ, se.z / b.maxZ);
  if (!(reach > 1)) return null;

  const scales = [1];
  while (scales[scales.length - 1] < reach) scales.push(scales[scales.length - 1] * growth);
  const ringCount = scales.length;

  // Points on the patch edge, clockwise seen from above with north up (north
  // edge west->east, east edge north->south, south edge east->west, west edge
  // south->north). `count` points per side.
  function edgePoints(count) {
    const points = [];
    for (let i = 0; i < count; i++) points.push([b.minX + ((b.maxX - b.minX) * i) / count, b.minZ]);
    for (let i = 0; i < count; i++) points.push([b.maxX, b.minZ + ((b.maxZ - b.minZ) * i) / count]);
    for (let i = 0; i < count; i++) points.push([b.maxX - ((b.maxX - b.minX) * i) / count, b.maxZ]);
    for (let i = 0; i < count; i++) points.push([b.minX, b.maxZ - ((b.maxZ - b.minZ) * i) / count]);
    return points;
  }

  const n = segmentsPerSide;
  const m = edgeSubdivisions;
  const perRing = 4 * n; // rings 1 and outward
  const perEdge = perRing * m; // ring 0, on the patch edge
  const edge = edgePoints(n);
  const fineEdge = edgePoints(n * m); // fineEdge[i * m] is edge[i]

  // At each coarse edge point: how far the (offset) coarse grid is from the fine terrain.
  const edgeDelta = new Float32Array(perRing);
  let joinSum = 0;
  let joinSumSq = 0;
  let joinMax = 0;
  for (let i = 0; i < perRing; i++) {
    const [x, z] = edge[i];
    edgeDelta[i] = patch.groundY(x, z) - coarseY(x, z); // NaN if either is missing
    if (!Number.isNaN(edgeDelta[i])) {
      joinSum += edgeDelta[i];
      joinSumSq += edgeDelta[i] ** 2;
      joinMax = Math.max(joinMax, Math.abs(edgeDelta[i]));
    }
  }

  // Smooth the disagreement along the edge (running mean over about +/-80 m).
  // The rings beyond the edge use this smooth version; only the collar next
  // to the patch absorbs the fine detail.
  const smoothDelta = new Float32Array(perRing);
  const reachPoints = 4;
  for (let i = 0; i < perRing; i++) {
    let sum = 0;
    let count = 0;
    for (let d = -reachPoints; d <= reachPoints; d++) {
      const value = edgeDelta[(i + d + perRing) % perRing];
      if (Number.isNaN(value)) continue;
      sum += value;
      count++;
    }
    smoothDelta[i] = count ? sum / count : NaN;
  }

  // Photo brightness along the edge, relative to the photo's average,
  // smoothed over about +/-40 m. 1 everywhere if there is no photo.
  const edgeShade = new Float32Array(perRing).fill(1);
  if (edgeBrightness) {
    const raw = edge.map(([x, z]) => Math.min(Math.max(edgeBrightness(x, z), 0.4), 2.5));
    for (let i = 0; i < perRing; i++) {
      let sum = 0;
      for (let d = -2; d <= 2; d++) sum += raw[(i + d + perRing) % perRing];
      edgeShade[i] = sum / 5;
    }
  }

  // Vertex layout: ring 0 (perEdge), its skirt (perEdge), then rings 1..ringCount-1 (perRing each).
  const skirtBase = perEdge;
  const ringBase = (k) => 2 * perEdge + (k - 1) * perRing;
  const vertexCount = 2 * perEdge + (ringCount - 1) * perRing;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3).fill(1);
  const valid = new Uint8Array(vertexCount);
  const halfSize = Math.max(b.maxX, b.maxZ);

  function setVertex(v, x, y, z) {
    valid[v] = Number.isNaN(y) ? 0 : 1;
    positions[v * 3] = x;
    positions[v * 3 + 1] = valid[v] ? y : 0;
    positions[v * 3 + 2] = z;
  }

  const edgeFineY = new Float32Array(perEdge); // exactly the walk terrain
  const edgeSmoothY = new Float32Array(perEdge); // offset coarse grid + smooth disagreement
  for (let i = 0; i < perEdge; i++) {
    const [x, z] = fineEdge[i];
    const y = patch.groundY(x, z);
    const i0 = Math.floor(i / m);
    const u = (i - i0 * m) / m;
    const delta = smoothDelta[i0] * (1 - u) + smoothDelta[(i0 + 1) % perRing] * u;
    edgeFineY[i] = y;
    edgeSmoothY[i] = coarseY(x, z) + delta;
    setVertex(i, x, y, z);
    setVertex(skirtBase + i, x, y - skirtM, z);
    const shade = edgeShade[i0] * (1 - u) + edgeShade[(i0 + 1) % perRing] * u;
    colors.fill(shade, i * 3, i * 3 + 3);
    colors.fill(shade, (skirtBase + i) * 3, (skirtBase + i) * 3 + 3);
  }
  for (let k = 1; k < ringCount; k++) {
    const f = scales[k];
    const t = Math.min(((f - 1) * halfSize) / blendM, 1);
    const weight = 1 - t * t * (3 - 2 * t); // 1 at the patch edge, 0 beyond blendM
    const tc = Math.min(((f - 1) * halfSize) / colorBlendM, 1);
    const colorWeight = 1 - tc * tc * (3 - 2 * tc);
    for (let i = 0; i < perRing; i++) {
      const x = edge[i][0] * f;
      const z = edge[i][1] * f;
      let y = coarseY(x, z);
      if (weight > 0) y += weight * smoothDelta[i];
      setVertex(ringBase(k) + i, x, y, z);
      if (colorWeight > 0) {
        const v = ringBase(k) + i;
        colors.fill(1 + colorWeight * (edgeShade[i] - 1), v * 3, v * 3 + 3);
      }
    }
  }

  const indices = [];
  const ok = (...vs) => vs.every((v) => valid[v]);

  // Collar between the dense ring 0 and ring 1: two fans and a middle triangle
  // per ring-1 segment. All triangles are counter-clockwise seen from above.
  const half = Math.floor(m / 2);
  for (let i = 0; i < perRing; i++) {
    const A = ringBase(1) + i;
    const C = ringBase(1) + ((i + 1) % perRing);
    for (let t = 0; t < m; t++) {
      const f0 = (i * m + t) % perEdge;
      const f1 = (i * m + t + 1) % perEdge;
      const outer = t < half ? A : C;
      if (ok(f0, f1, outer)) indices.push(f0, f1, outer);
    }
    const mid = (i * m + half) % perEdge;
    if (ok(mid, C, A)) indices.push(mid, C, A);
  }
  // Regular rings.
  for (let k = 1; k < ringCount - 1; k++) {
    for (let i = 0; i < perRing; i++) {
      const i2 = (i + 1) % perRing;
      const a = ringBase(k) + i; // inner ring
      const c = ringBase(k) + i2;
      const A = ringBase(k + 1) + i; // outer ring
      const C = ringBase(k + 1) + i2;
      // Cells that reach past the edge of the coarse grid are left out.
      if (!ok(a, c, A, C)) continue;
      indices.push(a, c, A, c, C, A);
    }
  }
  const surfaceTriangles = indices.length / 3;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices); // surface only, for now
  // Normals come from the smooth version of the surface (ring 0 at its
  // smooth height), so the collar is shaded like the terrain beyond it rather
  // than showing every 2 m wiggle of the patch edge as a facet. Ring 0 is then
  // put back at the exact walk-terrain height.
  const position = geometry.attributes.position;
  for (let i = 0; i < perEdge; i++) if (valid[i]) position.array[i * 3 + 1] = edgeSmoothY[i];
  geometry.computeVertexNormals();
  for (let i = 0; i < perEdge; i++) if (valid[i]) position.array[i * 3 + 1] = edgeFineY[i];

  // Inner skirt: hangs down from ring 0 and faces the patch.
  for (let i = 0; i < perEdge; i++) {
    const i2 = (i + 1) % perEdge;
    if (!ok(i, i2)) continue;
    indices.push(i, skirtBase + i, i2, i2, skirtBase + i, skirtBase + i2);
  }
  geometry.setIndex(indices);

  // The skirt shares no vertices with the surface; give it the edge normals
  // so it is lit like the ground above it.
  const normals = geometry.attributes.normal.array;
  for (let i = 0; i < perEdge; i++) {
    for (let a = 0; a < 3; a++) normals[(skirtBase + i) * 3 + a] = normals[i * 3 + a];
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  // Drawn as CULL_SECTORS x CULL_BANDS pieces (compass sectors, each cut into
  // distance bands) that share the vertex buffers, so the pieces behind the
  // viewer are not drawn: one mesh this size would always be drawn whole.
  const surroundMaterial = material || new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 1, metalness: 0 });
  const mesh = new THREE.Group();
  mesh.name = 'surround-terrain';
  mesh.matrixAutoUpdate = false;
  const pieces = Array.from({ length: CULL_SECTORS * CULL_BANDS }, () => []);
  for (let t = 0; t < indices.length; t += 3) {
    let cx = 0;
    let cz = 0;
    for (let c = 0; c < 3; c++) {
      cx += positions[indices[t + c] * 3] / 3;
      cz += positions[indices[t + c] * 3 + 2] / 3;
    }
    const scale = Math.max(Math.abs(cx), Math.abs(cz), halfSize) / halfSize; // 1 at the patch edge
    const band = Math.min(CULL_BANDS - 1, Math.floor((Math.log(scale) / Math.log(reach)) * CULL_BANDS));
    const sector = Math.min(CULL_SECTORS - 1, Math.floor(((Math.atan2(cz, cx) + Math.PI) / (2 * Math.PI)) * CULL_SECTORS));
    pieces[band * CULL_SECTORS + sector].push(indices[t], indices[t + 1], indices[t + 2]);
  }
  const corner = new THREE.Vector3();
  for (const pieceIndices of pieces) {
    if (!pieceIndices.length) continue;
    const piece = new THREE.BufferGeometry();
    for (const name of ['position', 'color', 'normal']) piece.setAttribute(name, geometry.attributes[name]);
    piece.setIndex(pieceIndices);
    const box = new THREE.Box3();
    for (const v of pieceIndices) box.expandByPoint(corner.fromArray(positions, v * 3));
    piece.boundingBox = box;
    piece.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const part = new THREE.Mesh(piece, surroundMaterial);
    part.name = 'surround-piece';
    part.matrixAutoUpdate = false;
    mesh.add(part);
  }

  const joinCount = perRing;
  const joinMean = joinSum / joinCount;
  return {
    mesh, // a Group of pieces (see above); show or hide the whole surround with mesh.visible
    grid,
    offsetM,
    agreement,
    // Fine minus (coarse + offset) along the patch edge, i.e. what the blend absorbs.
    join: {
      meanM: joinMean,
      stdM: Math.sqrt(Math.max(joinSumSq / joinCount - joinMean * joinMean, 0)),
      maxAbsM: joinMax,
    },
    rings: ringCount,
    segmentsPerSide,
    edgeVertices: perEdge,
    reachM: reach * halfSize,
    surfaceTriangles,
    triangles: indices.length / 3,
    coarseY,
  };
}
