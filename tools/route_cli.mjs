#!/usr/bin/env node
// Plans the mission route with the page's own route maths (src/mission/route.js)
// so the stored route and the in-page numbers come from one implementation.
// Called by tools/build_mission.py:  node tools/route_cli.mjs < request.json
//
// Request (JSON on stdin):
//   { site, assumptions, anchors: [{ id, x, z }, ...],        // fixed stations in walking order, start repeated last
//     s2: { leg: [fromId, toId], target: [x, z] },             // straight line S2 is about, and its first steep point
//     traverseLines: [{ points: [[x, z, y, sol], ...] }, ...] }
// Reply (JSON on stdout): { ok: true, ... } or { ok: false, reason }.
//
// Rules for the two stations that depend on the route:
//   S2 = the route point nearest to s2.target, on the leg named by s2.leg.
//   S3 = the first place after S2, on the same leg, where the route comes within
//        one grid spacing of the rover traverse (the closest point of that
//        meeting); if it never does, the closest point of the leg after S2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The repo has no package.json, so Node would read a .js file as CommonJS.
// route.js imports nothing, so it can be loaded as an ES module from its text.
const source = fs.readFileSync(path.join(repo, 'src/mission/route.js'));
const rt = await import('data:text/javascript;base64,' + source.toString('base64'));

const reply = (object) => process.stdout.write(JSON.stringify(object) + '\n');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!/^[A-Za-z0-9_-]+$/.test(request.site)) throw new Error('bad site name');

// Heights exactly as src/data.js decodes them (32-bit floats).
const meta = JSON.parse(fs.readFileSync(path.join(repo, 'data/walk', request.site, 'walk.json'), 'utf8'));
const dem = fs.readFileSync(path.join(repo, 'data/walk', request.site, 'dem.bin'));
const heights = new Float32Array(meta.width * meta.height);
for (let i = 0; i < heights.length; i++) {
  const raw = dem.readInt16LE(i * 2);
  heights[i] = raw === meta.nodata ? NaN : meta.heightOffsetM + raw * meta.heightStepM;
}
const grid = { cols: meta.width, rows: meta.height, spacing: meta.spacingM, heights };
const pace = rt.paceFromAssumptions(request.assumptions);
const rg = rt.createRouteGrid(grid, pace.slopeLimitDeg);

const plan = rt.planRoute(rg, request.anchors, pace);
if (!plan.ok) {
  reply(plan);
  process.exit(0);
}

const legIndex = plan.legs.findIndex((leg) => leg.from === request.s2.leg[0] && leg.to === request.s2.leg[1]);
if (legIndex !== 0) {
  reply({ ok: false, reason: `the S2 leg ${request.s2.leg.join(' to ')} is not the first leg of the walk; the station order START, S2, S3, S4 assumes it is` });
  process.exit(0);
}
const leg = plan.legs[legIndex];
const points = plan.points;

// S2: route point of that leg nearest to the target.
let s2Index = leg.first;
let s2Distance = Infinity;
for (let i = leg.first; i <= leg.last; i++) {
  const d = Math.hypot(points[i][0] - request.s2.target[0], points[i][1] - request.s2.target[1]);
  if (d < s2Distance) {
    s2Distance = d;
    s2Index = i;
  }
}

// S3: distance from each later route point of the leg to the traverse.
const toTraverse = (i) => {
  let best = null;
  request.traverseLines.forEach((line, lineIndex) => {
    const near = rt.nearestOnLine(line.points, points[i][0], points[i][1]);
    if (!best || near.distanceM < best.distanceM) best = { ...near, line: lineIndex, sol: line.points[near.segment + 1][3] };
  });
  return best;
};
const meetM = rg.spacing;
let s3Index = -1;
let s3Near = null;
let meets = false;
for (let i = s2Index + 1; i < leg.last; i++) {
  const near = toTraverse(i);
  if (!meets && near.distanceM <= meetM) meets = true;
  if (meets) {
    if (near.distanceM > meetM) break; // the meeting is over
    if (!s3Near || near.distanceM < s3Near.distanceM) {
      s3Near = near;
      s3Index = i;
    }
  } else if (!s3Near || near.distanceM < s3Near.distanceM) {
    s3Near = near;
    s3Index = i;
  }
}
if (s3Index < 0 || !(s2Index > leg.first && s2Index < s3Index && s3Index < leg.last)) {
  reply({ ok: false, reason: `S2 (route point ${s2Index}) and S3 (route point ${s3Index}) do not fall in order between the ends of the leg (${leg.first}..${leg.last})` });
  process.exit(0);
}

// The walk as five legs: the first one cut at S2 and S3.
const legs = [
  { from: leg.from, to: 'S2', first: leg.first, last: s2Index },
  { from: 'S2', to: 'S3', first: s2Index, last: s3Index },
  { from: 'S3', to: leg.to, first: s3Index, last: leg.last },
  ...plan.legs.slice(1).map(({ from, to, first, last }) => ({ from, to, first, last })),
];
const order = [legs[0].from, ...legs.map((l) => l.to)];
const a = request.anchors[legIndex];
const b = request.anchors[legIndex + 1];
const direct = { from: [a.x, a.z], to: [b.x, b.z], first: leg.first, last: leg.last };
const summary = rt.routeSummary(rg, { points, legs, order, direct }, pace);
if (!summary.withinLimit) {
  reply({ ok: false, reason: `the planned route crosses ground of ${summary.maxSlopeDeg} degrees, above the limit` });
  process.exit(0);
}

reply({
  ok: true,
  points,
  order,
  direct,
  snaps: plan.snaps,
  searchSeconds: plan.legs.map((l) => l.searchSeconds),
  cellsExpanded: plan.expanded,
  steepShare: rg.steepShare,
  s2: { index: s2Index, x: points[s2Index][0], z: points[s2Index][1], distanceToTargetM: s2Distance },
  s3: {
    index: s3Index,
    x: points[s3Index][0],
    z: points[s3Index][1],
    distanceToTraverseM: s3Near.distanceM,
    meets,
    meetWithinM: meetM,
    traverseLine: s3Near.line,
    traverseSol: s3Near.sol,
  },
  summary,
});
