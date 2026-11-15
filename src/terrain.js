import * as THREE from 'three';

// Smallest whole decimation step that keeps the patch under the triangle budget.
export function stepForBudget(patch, maxTriangles) {
  for (let step = 1; step < Math.min(patch.cols, patch.rows); step++) {
    const c = Math.ceil((patch.cols - 1) / step);
    const r = Math.ceil((patch.rows - 1) / step);
    if (c * r * 2 <= maxTriangles) return step;
  }
  return Math.min(patch.cols, patch.rows) - 1;
}

// Every step-th index, always including the last one so the mesh reaches the edge.
function sampleIndices(count, step) {
  const out = [];
  for (let i = 0; i < count - 1; i += step) out.push(i);
  out.push(count - 1);
  return out;
}

// Uniformly decimated terrain mesh in the local frame (x east, z south, y up).
// UVs run 0..1 across the full patch rectangle (u west->east, v south->north,
// i.e. v = 1 at the north edge) so step 4 can drape the photo with flipY on.
export function buildTerrain(patch, { maxTriangles = 250000, material } = {}) {
  const step = stepForBudget(patch, maxTriangles);
  const colIdx = sampleIndices(patch.cols, step);
  const rowIdx = sampleIndices(patch.rows, step);
  const nc = colIdx.length;
  const nr = rowIdx.length;

  const positions = new Float32Array(nc * nr * 3);
  const uvs = new Float32Array(nc * nr * 2);
  const valid = new Uint8Array(nc * nr);
  const fallbackY = patch.minHeightM - patch.originHeightM;

  for (let j = 0; j < nr; j++) {
    const r = rowIdx[j];
    const z = patch.rowToZ(r);
    for (let i = 0; i < nc; i++) {
      const c = colIdx[i];
      const x = patch.colToX(c);
      const h = patch.heights[r * patch.cols + c];
      const v = j * nc + i;
      valid[v] = Number.isNaN(h) ? 0 : 1;
      positions[v * 3] = x;
      positions[v * 3 + 1] = valid[v] ? h - patch.originHeightM : fallbackY;
      positions[v * 3 + 2] = z;
      uvs[v * 2] = x / patch.sizeX + 0.5;
      uvs[v * 2 + 1] = 0.5 - z / patch.sizeZ;
    }
  }

  // Two triangles per cell, counter-clockwise seen from above; cells touching
  // a no-data sample are left as holes rather than filled with made-up ground.
  const indices = [];
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i; // north-west
      const b = a + 1; // north-east
      const c = a + nc; // south-west
      const d = c + 1; // south-east
      if (!(valid[a] && valid[b] && valid[c] && valid[d])) continue;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const mesh = new THREE.Mesh(
    geometry,
    material ||
      new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 1, metalness: 0 }),
  );
  mesh.name = 'walk-terrain';
  mesh.userData.step = step;
  mesh.userData.triangles = indices.length / 3;
  return mesh;
}
