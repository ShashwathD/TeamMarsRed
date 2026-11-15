import * as THREE from 'three';

// Level-of-detail terrain for one walk patch, in the local frame
// (x east, z south, y up, metres, origin at the patch centre).
//
// The patch is cut into square chunks of `chunkCells` x `chunkCells` 2 m cells.
// Each chunk is drawn at one of five levels: every sample (2 m), every 2nd,
// 4th, 8th or 16th sample, chosen from the horizontal distance between the
// viewer and the nearest point of the chunk. Chunk geometry is built on demand
// from the full-resolution heights and cached, so it keeps working wherever
// the player walks or teleports.
//
// Neighbouring chunks at different levels do not share edge vertices, so every
// chunk carries a "skirt": a strip hanging straight down from its border that
// hides any hairline crack. Skirts face outward and are never walked on.
//
// Ground following does NOT use these meshes: it samples the full-resolution
// heights (patch.groundY), so it is exact at every level.
//
// UVs run 0..1 across the full patch rectangle (u west->east, v south->north,
// v = 1 at the north edge), matching a north-up photo loaded with flipY on.

export const LOD_STEPS = [1, 2, 4, 8, 16];

// A chunk closer than LOD_DISTANCES_M[i] uses LOD_STEPS[i]; beyond the last
// distance it uses the coarsest step.
export const LOD_DISTANCES_M = [90, 280, 640, 1300];

const MAX_CACHED_GEOMETRIES = 420;

// Every step-th index from first to last, always including the last one.
function sampleIndices(first, last, step) {
  const out = [];
  for (let i = first; i < last; i += step) out.push(i);
  out.push(last);
  return out;
}

// Grid vertex ids around the border, clockwise seen from above with north up:
// north edge west->east, east edge north->south, south edge east->west,
// west edge south->north. Closed loop, no repeated vertex.
function perimeter(nc, nr) {
  const loop = [];
  for (let i = 0; i < nc - 1; i++) loop.push(i);
  for (let j = 0; j < nr - 1; j++) loop.push(j * nc + nc - 1);
  for (let i = nc - 1; i > 0; i--) loop.push((nr - 1) * nc + i);
  for (let j = nr - 1; j > 0; j--) loop.push(j * nc);
  return loop;
}

// Triangle list for an nc x nr vertex grid plus its skirt (skirt vertices
// follow the grid vertices, in perimeter order). `valid` (optional) marks
// usable grid vertices; cells or skirt segments touching a no-data vertex
// are left out rather than filled with made-up ground.
function buildIndices(nc, nr, valid) {
  const indices = [];
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i; // north-west
      const b = a + 1; // north-east
      const c = a + nc; // south-west
      const d = c + 1; // south-east
      if (valid && !(valid[a] && valid[b] && valid[c] && valid[d])) continue;
      indices.push(a, c, b, b, c, d); // counter-clockwise seen from above
    }
  }
  const loop = perimeter(nc, nr);
  const base = nc * nr;
  for (let k = 0; k < loop.length; k++) {
    const k2 = (k + 1) % loop.length;
    const v0 = loop[k];
    const v1 = loop[k2];
    if (valid && !(valid[v0] && valid[v1])) continue;
    indices.push(v0, v1, base + k, v1, base + k2, base + k); // faces outward
  }
  return new THREE.BufferAttribute(new Uint16Array(indices), 1);
}

export function createTerrain(patch, { material, chunkCells = 64, lodDistancesM = LOD_DISTANCES_M } = {}) {
  const { cols, rows, heights, spacing } = patch;
  const fallbackY = patch.minHeightM - patch.originHeightM;

  const group = new THREE.Group();
  group.name = 'walk-terrain';

  const terrainMaterial =
    material || new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 1, metalness: 0 });

  const sharedIndices = new Map(); // "nc x nr" -> index attribute (chunks without no-data)
  const cache = new Map(); // chunk id * 8 + level -> geometry

  function heightAt(r, c, fallback) {
    const h = heights[r * cols + c];
    return Number.isNaN(h) ? fallback : h;
  }

  function buildGeometry(chunk, level) {
    const step = LOD_STEPS[level];
    const colIdx = sampleIndices(chunk.c0, chunk.c1, step);
    const rowIdx = sampleIndices(chunk.r0, chunk.r1, step);
    const nc = colIdx.length;
    const nr = rowIdx.length;
    const loop = perimeter(nc, nr);
    const count = nc * nr + loop.length;

    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const valid = new Uint8Array(nc * nr);
    let allValid = true;

    for (let j = 0; j < nr; j++) {
      const r = rowIdx[j];
      const z = patch.rowToZ(r);
      const rN = Math.max(r - step, 0);
      const rS = Math.min(r + step, rows - 1);
      for (let i = 0; i < nc; i++) {
        const c = colIdx[i];
        const x = patch.colToX(c);
        const h = heights[r * cols + c];
        const v = j * nc + i;
        const ok = !Number.isNaN(h);
        valid[v] = ok ? 1 : 0;
        if (!ok) allValid = false;
        positions[v * 3] = x;
        positions[v * 3 + 1] = ok ? h - patch.originHeightM : fallbackY;
        positions[v * 3 + 2] = z;
        uvs[v * 2] = x / patch.sizeX + 0.5;
        uvs[v * 2 + 1] = 0.5 - z / patch.sizeZ;

        // Surface normal from central differences at this level's spacing,
        // taken from the whole patch so it is continuous across chunk borders.
        const hc = ok ? h : 0;
        const cW = Math.max(c - step, 0);
        const cE = Math.min(c + step, cols - 1);
        const dhdx = (heightAt(r, cE, hc) - heightAt(r, cW, hc)) / ((cE - cW) * spacing);
        const dhdz = (heightAt(rS, c, hc) - heightAt(rN, c, hc)) / ((rS - rN) * spacing);
        const inv = 1 / Math.hypot(dhdx, 1, dhdz);
        normals[v * 3] = -dhdx * inv;
        normals[v * 3 + 1] = inv;
        normals[v * 3 + 2] = -dhdz * inv;
      }
    }

    // Skirt: copy of each border vertex, dropped far enough to cover the
    // largest height mismatch with a neighbour at another level or with the
    // distant terrain (measured: under 6 m between the two coarsest levels,
    // under 4 m against the distant terrain).
    const drop = 4 + 2 * step;
    for (let k = 0; k < loop.length; k++) {
      const src = loop[k];
      const dst = nc * nr + k;
      positions[dst * 3] = positions[src * 3];
      positions[dst * 3 + 1] = positions[src * 3 + 1] - drop;
      positions[dst * 3 + 2] = positions[src * 3 + 2];
      normals[dst * 3] = normals[src * 3];
      normals[dst * 3 + 1] = normals[src * 3 + 1];
      normals[dst * 3 + 2] = normals[src * 3 + 2];
      uvs[dst * 2] = uvs[src * 2];
      uvs[dst * 2 + 1] = uvs[src * 2 + 1];
    }

    let index;
    if (allValid) {
      const key = `${nc}x${nr}`;
      index = sharedIndices.get(key);
      if (!index) {
        index = buildIndices(nc, nr, null);
        sharedIndices.set(key, index);
      }
    } else {
      index = buildIndices(nc, nr, valid);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  // Chunks: sample index ranges [c0, c1] x [r0, r1], sharing their border samples.
  const chunks = [];
  for (let r0 = 0; r0 < rows - 1; r0 += chunkCells) {
    for (let c0 = 0; c0 < cols - 1; c0 += chunkCells) {
      const chunk = {
        id: chunks.length,
        c0,
        r0,
        c1: Math.min(c0 + chunkCells, cols - 1),
        r1: Math.min(r0 + chunkCells, rows - 1),
        level: -1,
        mesh: new THREE.Mesh(undefined, terrainMaterial),
      };
      chunk.minX = patch.colToX(chunk.c0);
      chunk.maxX = patch.colToX(chunk.c1);
      chunk.minZ = patch.rowToZ(chunk.r0);
      chunk.maxZ = patch.rowToZ(chunk.r1);
      chunk.mesh.name = `walk-chunk-${chunk.id}`;
      chunk.mesh.matrixAutoUpdate = false;
      chunks.push(chunk);
      group.add(chunk.mesh);
    }
  }

  function levelFor(chunk, x, z) {
    const dx = Math.max(chunk.minX - x, 0, x - chunk.maxX);
    const dz = Math.max(chunk.minZ - z, 0, z - chunk.maxZ);
    const d = Math.hypot(dx, dz);
    let level = 0;
    while (level < lodDistancesM.length && d >= lodDistancesM[level]) level++;
    return Math.min(level, LOD_STEPS.length - 1);
  }

  function trimCache() {
    if (cache.size <= MAX_CACHED_GEOMETRIES) return;
    const inUse = new Set(chunks.map((chunk) => chunk.id * 8 + chunk.level));
    for (const [key, geometry] of cache) {
      if (cache.size <= MAX_CACHED_GEOMETRIES) break;
      if (inUse.has(key)) continue;
      geometry.dispose();
      cache.delete(key);
    }
  }

  // Pick each chunk's level for a viewer standing at local (x, z).
  // Cheap when nothing changes, so it can be called every frame.
  function update(x, z) {
    let changed = 0;
    for (const chunk of chunks) {
      const level = levelFor(chunk, x, z);
      if (level === chunk.level) continue;
      const key = chunk.id * 8 + level;
      let geometry = cache.get(key);
      if (!geometry) {
        geometry = buildGeometry(chunk, level);
        cache.set(key, geometry);
      }
      chunk.level = level;
      chunk.mesh.geometry = geometry;
      changed++;
    }
    if (changed) trimCache();
    return changed;
  }

  function stats() {
    const chunksPerStep = LOD_STEPS.map(() => 0);
    let triangles = 0;
    for (const chunk of chunks) {
      if (chunk.level < 0) continue;
      chunksPerStep[chunk.level]++;
      triangles += chunk.mesh.geometry.index.count / 3;
    }
    return { triangles, chunks: chunks.length, chunksPerStep, cachedGeometries: cache.size };
  }

  return {
    group,
    material: terrainMaterial,
    chunks,
    update,
    stats,
    get triangles() {
      return stats().triangles;
    },
  };
}
