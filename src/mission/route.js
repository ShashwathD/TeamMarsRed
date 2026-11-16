// Route maths for the Marswalk mission. Pure JavaScript: no Three.js and no
// DOM, so the same file runs in the page and in Node (tools/route_cli.mjs,
// which tools/build_mission.py calls to store the planned route).
//
// Terrain grid ("grid" below): { cols, rows, spacing, heights } as in
// src/data.js. heights is row-major, row 0 = north, cell-centred, metres,
// NaN = no data. Local frame: x east, z south, origin at the patch centre.
//
// RULES (mission brief, SYSTEMS / ROUTE; the numbers are ASSUMPTIONS and are
// read from the mission file, never typed here):
// - Slope of a cell: central differences on the grid (one-sided on the patch
//   edge), slope = atan(|gradient|). Same method as tools/build_mission.py.
// - A cell is walkable when its slope is not above the limit (15 degrees).
// - Moves: to the 8 neighbours, between walkable cells only. A diagonal move
//   also needs both cells it passes between to be walkable. With that rule
//   the bilinear slope at every point of every move is a weighted average of
//   walkable cells, so it can never exceed the limit.
// - Cost of a move: its walking time. Pace = Tobler's hiking function x
//   factor, capped: km/h = min(cap, factor * 6 * exp(-3.5 * |tan(s) + 0.05|)),
//   where tan(s) is height change / horizontal distance in the walking
//   direction. Distances are horizontal (map) distances.
// - Search: A* with the straight 8-neighbour distance at the pace cap as the
//   lower bound, so the result is the fastest path on the grid.

const RAD_TO_DEG = 180 / Math.PI;

// Pace settings from the mission file's "assumptions" list.
export function paceFromAssumptions(assumptions) {
  const value = (id) => {
    const found = assumptions.find((a) => a.id === id);
    if (!found || !Number.isFinite(found.value)) throw new Error(`mission file has no assumption "${id}"`);
    return found.value;
  };
  return {
    capKmh: value('paceCapKmh'),
    factor: value('toblerFactor'),
    slopeLimitDeg: value('slopeLimitDeg'),
    stopMinutes: value('stopMinutes'),
  };
}

// Walking speed in km/h for a path that rises `tanSlope` (height / distance).
export function speedKmh(tanSlope, pace) {
  const tobler = pace.factor * 6 * Math.exp(-3.5 * Math.abs(tanSlope + 0.05));
  return tobler < pace.capKmh ? tobler : pace.capKmh;
}

// Seconds to walk `distM` horizontally while the ground rises `riseM`.
export function walkSeconds(distM, riseM, pace) {
  return distM > 0 ? (distM * 3.6) / speedKmh(riseM / distM, pace) : 0;
}

// Slope grid and walkable mask for a terrain grid.
export function createRouteGrid(grid, slopeLimitDeg) {
  const { cols, rows, spacing, heights } = grid;
  const count = cols * rows;
  const slopeDeg = new Float32Array(count);
  const walkable = new Uint8Array(count);
  let steep = 0;
  for (let r = 0; r < rows; r++) {
    const rN = r > 0 ? r - 1 : r;
    const rS = r < rows - 1 ? r + 1 : r;
    for (let c = 0; c < cols; c++) {
      const cW = c > 0 ? c - 1 : c;
      const cE = c < cols - 1 ? c + 1 : c;
      const i = r * cols + c;
      const dhdx = (heights[r * cols + cE] - heights[r * cols + cW]) / ((cE - cW) * spacing);
      const dhdz = (heights[rS * cols + c] - heights[rN * cols + c]) / ((rS - rN) * spacing);
      const slope = Math.atan(Math.hypot(dhdx, dhdz)) * RAD_TO_DEG; // NaN next to missing data
      slopeDeg[i] = slope;
      if (slope <= slopeLimitDeg) walkable[i] = 1;
      else steep++;
    }
  }
  return {
    grid,
    cols,
    rows,
    spacing,
    count,
    slopeLimitDeg,
    slopeDeg,
    walkable,
    steepShare: steep / count,
    scratch: null, // search buffers, made on first use and reused
  };
}

export function cellOf(rg, x, z) {
  const c = Math.min(Math.max(Math.round((x + (rg.cols * rg.spacing) / 2) / rg.spacing - 0.5), 0), rg.cols - 1);
  const r = Math.min(Math.max(Math.round((z + (rg.rows * rg.spacing) / 2) / rg.spacing - 0.5), 0), rg.rows - 1);
  return r * rg.cols + c;
}
export const cellX = (rg, i) => ((i % rg.cols) + 0.5) * rg.spacing - (rg.cols * rg.spacing) / 2;
export const cellZ = (rg, i) => (Math.floor(i / rg.cols) + 0.5) * rg.spacing - (rg.rows * rg.spacing) / 2;

// Bilinear sample of a per-cell array at local (x, z), clamped to the patch
// (the same sampling as patch.elevationAt, without the no-data handling).
export function sampleGrid(rg, values, x, z) {
  const { cols, rows, spacing } = rg;
  let fc = (x + (cols * spacing) / 2) / spacing - 0.5;
  let fr = (z + (rows * spacing) / 2) / spacing - 0.5;
  fc = Math.min(Math.max(fc, 0), cols - 1);
  fr = Math.min(Math.max(fr, 0), rows - 1);
  const c0 = Math.min(Math.floor(fc), cols - 2);
  const r0 = Math.min(Math.floor(fr), rows - 2);
  const tx = fc - c0;
  const tz = fr - r0;
  const i = r0 * cols + c0;
  return (
    values[i] * (1 - tx) * (1 - tz) +
    values[i + 1] * tx * (1 - tz) +
    values[i + cols] * (1 - tx) * tz +
    values[i + cols + 1] * tx * tz
  );
}

// Neighbour offsets: W, E, N, S, then the four diagonals.
const DC = [-1, 1, 0, 0, -1, 1, -1, 1];
const DR = [0, 0, -1, 1, -1, -1, 1, 1];

// Can a walker step from cell (r, c) to neighbour k? (see RULES above)
function canStep(rg, r, c, k) {
  const nr = r + DR[k];
  const nc = c + DC[k];
  if (nr < 0 || nc < 0 || nr >= rg.rows || nc >= rg.cols) return false;
  const w = rg.walkable;
  if (!w[nr * rg.cols + nc]) return false;
  if (k >= 4 && !(w[r * rg.cols + nc] && w[nr * rg.cols + c])) return false;
  return true;
}

// Every cell that can be walked to from cell `from` (1 = reachable).
export function reachableFrom(rg, from) {
  const mask = new Uint8Array(rg.count);
  if (!rg.walkable[from]) return mask;
  const queue = new Int32Array(rg.count);
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  mask[from] = 1;
  while (head < tail) {
    const i = queue[head++];
    const r = Math.floor(i / rg.cols);
    const c = i - r * rg.cols;
    for (let k = 0; k < 8; k++) {
      if (!canStep(rg, r, c, k)) continue;
      const n = (r + DR[k]) * rg.cols + c + DC[k];
      if (mask[n]) continue;
      mask[n] = 1;
      queue[tail++] = n;
    }
  }
  return mask;
}

// The cell of `mask` nearest to local (x, z), looking no farther than maxM.
// Returns { cell, x, z, movedM } or null. Ties go to the lower cell index.
export function nearestInMask(rg, mask, x, z, maxM) {
  const centre = cellOf(rg, x, z);
  const cr = Math.floor(centre / rg.cols);
  const cc = centre - cr * rg.cols;
  const reach = Math.ceil(maxM / rg.spacing) + 1;
  let best = -1;
  let bestD = Infinity;
  for (let r = Math.max(cr - reach, 0); r <= Math.min(cr + reach, rg.rows - 1); r++) {
    for (let c = Math.max(cc - reach, 0); c <= Math.min(cc + reach, rg.cols - 1); c++) {
      const i = r * rg.cols + c;
      if (!mask[i]) continue;
      const d = Math.hypot(cellX(rg, i) - x, cellZ(rg, i) - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  if (best < 0 || bestD > maxM) return null;
  return { cell: best, x: cellX(rg, best), z: cellZ(rg, best), movedM: bestD };
}

function searchBuffers(rg) {
  if (!rg.scratch) {
    rg.scratch = {
      g: new Float64Array(rg.count),
      parent: new Int32Array(rg.count),
      closed: new Uint8Array(rg.count),
      heapF: new Float64Array(1 << 16),
      heapN: new Int32Array(1 << 16),
    };
  }
  return rg.scratch;
}

// Fastest walk from cell `from` to cell `to`. Returns
// { cells (Int32Array, from..to), seconds, expanded } or null if there is none.
export function findPath(rg, from, to, pace) {
  if (!rg.walkable[from] || !rg.walkable[to]) return null;
  const s = searchBuffers(rg);
  const { g, parent, closed } = s;
  const { cols, spacing } = rg;
  const heights = rg.grid.heights;
  g.fill(Infinity);
  closed.fill(0);

  const toR = Math.floor(to / cols);
  const toC = to - toR * cols;
  const secondsPerMetre = 3.6 / pace.capKmh; // nothing is faster than the cap
  const DIAG = Math.SQRT2 - 1;
  const lowerBound = (r, c) => {
    const dr = Math.abs(r - toR);
    const dc = Math.abs(c - toC);
    return (dr > dc ? dr + DIAG * dc : dc + DIAG * dr) * spacing * secondsPerMetre;
  };
  const straight = spacing;
  const diagonal = spacing * Math.SQRT2;

  // Binary min-heap of (f, cell).
  let size = 0;
  const push = (f, n) => {
    if (size === s.heapF.length) {
      const bigF = new Float64Array(size * 2);
      const bigN = new Int32Array(size * 2);
      bigF.set(s.heapF);
      bigN.set(s.heapN);
      s.heapF = bigF;
      s.heapN = bigN;
    }
    const hf = s.heapF;
    const hn = s.heapN;
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hf[i] = hf[p];
      hn[i] = hn[p];
      i = p;
    }
    hf[i] = f;
    hn[i] = n;
  };
  const pop = () => {
    const hf = s.heapF;
    const hn = s.heapN;
    const top = hn[0];
    size--;
    if (size > 0) {
      const f = hf[size];
      const n = hn[size];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (child + 1 < size && hf[child + 1] < hf[child]) child++;
        if (hf[child] >= f) break;
        hf[i] = hf[child];
        hn[i] = hn[child];
        i = child;
      }
      hf[i] = f;
      hn[i] = n;
    }
    return top;
  };

  g[from] = 0;
  parent[from] = -1;
  push(lowerBound(Math.floor(from / cols), from % cols), from);
  let expanded = 0;
  while (size > 0) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    expanded++;
    if (i === to) break;
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    const gi = g[i];
    const hi = heights[i];
    for (let k = 0; k < 8; k++) {
      if (!canStep(rg, r, c, k)) continue;
      const n = (r + DR[k]) * cols + c + DC[k];
      if (closed[n]) continue;
      const d = k < 4 ? straight : diagonal;
      const cost = gi + walkSeconds(d, heights[n] - hi, pace);
      if (cost < g[n]) {
        g[n] = cost;
        parent[n] = i;
        push(cost + lowerBound(r + DR[k], c + DC[k]), n);
      }
    }
  }
  if (!closed[to]) return null;

  let length = 0;
  for (let i = to; i !== -1; i = parent[i]) length++;
  const cells = new Int32Array(length);
  for (let i = to, k = length - 1; i !== -1; i = parent[i], k--) cells[k] = i;
  return { cells, seconds: g[to], expanded };
}

// Plans the walk through `anchors` ([{ id, x, z }, ...], in order; repeat the
// first one at the end for a round trip). Each anchor is moved to the nearest
// cell that can be reached on foot from the first anchor (at most maxSnapM
// away) and the distance moved is recorded.
//
// Returns { ok: true, points, legs, snaps } with points = [[x, z], ...] (cell
// centres, one continuous line) and legs = [{ from, to, first, last }]
// (indices into points), or { ok: false, reason } when it cannot be done.
// Nothing is relaxed to make a route exist.
export function planRoute(rg, anchors, pace, { maxSnapM = 30 } = {}) {
  const first = nearestInMask(rg, rg.walkable, anchors[0].x, anchors[0].z, maxSnapM);
  if (!first) {
    return { ok: false, reason: `no ground at or below ${rg.slopeLimitDeg} degrees within ${maxSnapM} m of ${anchors[0].id}` };
  }
  const mask = reachableFrom(rg, first.cell);
  const snaps = [];
  for (const anchor of anchors) {
    const snap = nearestInMask(rg, mask, anchor.x, anchor.z, maxSnapM);
    if (!snap) {
      return {
        ok: false,
        reason: `${anchor.id} cannot be reached from ${anchors[0].id} without crossing ground steeper than ${rg.slopeLimitDeg} degrees (nothing reachable within ${maxSnapM} m of it)`,
      };
    }
    snaps.push({
      id: anchor.id,
      cell: snap.cell,
      x: snap.x,
      z: snap.z,
      movedM: snap.movedM,
      ownCellWalkable: rg.walkable[cellOf(rg, anchor.x, anchor.z)] === 1,
    });
  }
  const points = [[snaps[0].x, snaps[0].z]];
  const legs = [];
  let expanded = 0;
  for (let k = 0; k + 1 < snaps.length; k++) {
    const path = findPath(rg, snaps[k].cell, snaps[k + 1].cell, pace);
    if (!path) return { ok: false, reason: `no route from ${snaps[k].id} to ${snaps[k + 1].id}` };
    expanded += path.expanded;
    const firstIndex = points.length - 1;
    for (let j = 1; j < path.cells.length; j++) points.push([cellX(rg, path.cells[j]), cellZ(rg, path.cells[j])]);
    legs.push({ from: snaps[k].id, to: snaps[k + 1].id, first: firstIndex, last: points.length - 1, searchSeconds: path.seconds });
  }
  return { ok: true, points, legs, snaps, expanded };
}

// Measures a line of [x, z] points from index `first` to `last` (default: all
// of it). Heights are sampled from the terrain; pieces longer than maxStepM
// are cut into equal parts first (leave it out to measure point to point,
// which for a planned route reproduces the search's own cost exactly).
// Returns { lengthM, seconds, maxSlopeDeg, maxSlopeAt, maxGradeDeg, climbM }:
// maxSlopeDeg is the steepest ground under the line (terrain slope, sampled
// every slopeStepM), maxGradeDeg the steepest rise or fall in the walking
// direction.
export function measureLine(rg, points, pace, { first = 0, last = points.length - 1, maxStepM = Infinity, slopeStepM = 0.5 } = {}) {
  const heights = rg.grid.heights;
  let lengthM = 0;
  let seconds = 0;
  let maxSlopeDeg = -Infinity;
  let maxSlopeAt = null;
  let maxGrade = 0;
  let climbM = 0;
  const slopeAt = (x, z, along) => {
    const s = sampleGrid(rg, rg.slopeDeg, x, z);
    if (s > maxSlopeDeg) {
      maxSlopeDeg = s;
      maxSlopeAt = { x, z, alongM: along };
    }
  };
  slopeAt(points[first][0], points[first][1], 0);
  for (let i = first; i < last; i++) {
    const ax = points[i][0];
    const az = points[i][1];
    const bx = points[i + 1][0];
    const bz = points[i + 1][1];
    const d = Math.hypot(bx - ax, bz - az);
    if (d === 0) continue;
    const parts = Number.isFinite(maxStepM) ? Math.max(1, Math.ceil(d / maxStepM - 1e-9)) : 1;
    let h0 = sampleGrid(rg, heights, ax, az);
    for (let p = 1; p <= parts; p++) {
      const t = p / parts;
      const h1 = sampleGrid(rg, heights, ax + (bx - ax) * t, az + (bz - az) * t);
      const part = d / parts;
      seconds += walkSeconds(part, h1 - h0, pace);
      const grade = Math.abs(h1 - h0) / part;
      if (grade > maxGrade) maxGrade = grade;
      if (h1 > h0) climbM += h1 - h0;
      h0 = h1;
    }
    const slopeParts = Math.max(1, Math.ceil(d / slopeStepM - 1e-9));
    for (let p = 1; p <= slopeParts; p++) {
      const t = p / slopeParts;
      slopeAt(ax + (bx - ax) * t, az + (bz - az) * t, lengthM + d * t);
    }
    lengthM += d;
  }
  return { lengthM, seconds, maxSlopeDeg, maxSlopeAt, maxGradeDeg: Math.atan(maxGrade) * RAD_TO_DEG, climbM };
}

// The point of line `points` ([[x, z, ...], ...]) nearest to (x, z).
// Returns { x, z, distanceM, segment, t } (the point is points[segment] + t * the piece after it).
export function nearestOnLine(points, x, z) {
  let best = { x: points[0][0], z: points[0][1], distanceM: Math.hypot(points[0][0] - x, points[0][1] - z), segment: 0, t: 0 };
  for (let i = 0; i + 1 < points.length; i++) {
    const ax = points[i][0];
    const az = points[i][1];
    const dx = points[i + 1][0] - ax;
    const dz = points[i + 1][1] - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < best.distanceM) best = { x: px, z: pz, distanceM: d, segment: i, t };
  }
  return best;
}

const round1 = (v) => Math.round(v * 10) / 10;

// Every route-dependent number the mission shows, from a stored or freshly
// planned route. Used by the page (so the {braced} card values are computed
// from the data it loaded) and by tools/route_cli.mjs (so the stored copies
// are the same numbers).
//
// route = {
//   points: [[x, z], ...], legs: [{ from, to, first, last }],
//   order: ['START', 'S2', ...],
//   direct: { from: [x, z], to: [x, z], first, last }  // the S2 comparison:
//     straight line between two stations, and the route indices of the same walk
// }
export function routeSummary(rg, route, pace) {
  const whole = measureLine(rg, route.points, pace);
  const legs = route.legs.map((leg) => {
    const m = measureLine(rg, route.points, pace, { first: leg.first, last: leg.last });
    return {
      from: leg.from,
      to: leg.to,
      first: leg.first,
      last: leg.last,
      lengthM: m.lengthM,
      minutes: m.seconds / 60,
      maxSlopeDeg: m.maxSlopeDeg,
      maxGradeDeg: m.maxGradeDeg,
      climbM: m.climbM,
    };
  });
  // Straight line: heights every grid spacing for the time, terrain slope every 1 m
  // (the sampling tools/build_mission.py uses for the same line).
  const line = measureLine(rg, [route.direct.from, route.direct.to], pace, { maxStepM: rg.spacing, slopeStepM: 1 });
  const planned = measureLine(rg, route.points, pace, { first: route.direct.first, last: route.direct.last });
  const extraMinutes = (planned.seconds - line.seconds) / 60;
  // Stops are the stations walked to: everything in the order except the start/airlock.
  const stationCount = route.order.filter((id) => id !== 'START').length;
  const walkMinutes = whole.seconds / 60;
  const stopMinutes = stationCount * pace.stopMinutes;
  return {
    lengthM: whole.lengthM,
    walkMinutes,
    stopMinutes,
    totalMinutes: walkMinutes + stopMinutes,
    maxSlopeDeg: whole.maxSlopeDeg,
    maxSlopeAt: whole.maxSlopeAt,
    maxGradeDeg: whole.maxGradeDeg,
    climbM: whole.climbM,
    withinLimit: whole.maxSlopeDeg <= rg.slopeLimitDeg,
    legs,
    direct: {
      lengthM: line.lengthM,
      minutes: line.seconds / 60,
      maxSlopeDeg: line.maxSlopeDeg,
      maxSlopeAt: line.maxSlopeAt,
      maxGradeDeg: line.maxGradeDeg,
    },
    planned: { lengthM: planned.lengthM, minutes: planned.seconds / 60, maxSlopeDeg: planned.maxSlopeDeg },
    // Values for the card {placeholders}, as shown.
    values: {
      route_km: round1(whole.lengthM / 1000),
      station_count: stationCount,
      direct_max_slope: round1(line.maxSlopeDeg),
      // Whole minutes from 10 up; one decimal below, so a small difference is not shown as 0.
      extra_min: Math.abs(extraMinutes) >= 10 ? Math.round(extraMinutes) : round1(extraMinutes),
    },
  };
}
