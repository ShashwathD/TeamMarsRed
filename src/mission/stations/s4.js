import { PALETTE, lowPolyMaterial, mergeParts } from '../lowpoly.js';
import { nearestOnLine } from '../route.js';

// Station S4, BEREA: FIRST CORE (brief: S4).
//
// A marked low-poly rock stands at the station with a sample tube in a holder
// beside it. Right grip (G on desktop) pulls the tube into the hand; trigger
// (click) at the marked rock with the tube held runs a short coring
// animation, then the HUD flashes "SAMPLE SEALED" and the field notebook gets
// the core's name, sol, size and type, all read from the mission file.
//
// The coring is SIMULATED and the place is APPROXIMATE (the rover's waypoint
// at that sol); the card says both. Nothing here is a measurement.
//
// A trigger press that points at the rock is always used up here (returns
// true), so it never starts a teleport.

const ROCK_FROM_SITE_M = 4.1; // outside the ring of stakes round the site (2.6 m), on the side the route arrives from
// The rock is turned off the arrival direction by the first of these angles
// that keeps it clear of both the blue route and the rover's orange path.
const ROCK_TURNS_DEG = [60, -60, 80, -80, 100, -100, 120, -120, 140, -140, 160, -160, 180];
const ROCK_CLEAR_M = 2.2; // rock, loose stones and holder reach about 1.3 m; the lines are up to 1.5 m wide
const ROCK_TOP_M = 0.58; // flat top of the rock above its base point
const ROCK_HIT_RADIUS_M = 0.95; // generous: pointing anywhere at the rock counts
const HOLDER_X_M = 1.15; // holder beside the rock (in the site group's own axes)
const HOLDER_Z_M = 0.1;
const HOLDER_TOP_M = 0.9;
const TUBE_LENGTH_M = 0.25;
const TUBE_WORLD_SCALE = 2.2; // oversized on the holder and the rock so it reads from a few metres
const HELD_TILT_RAD = 1.05; // in the hand the tube leans like a drill: bit forward, cap toward the user

const FLY_S = 0.45;
const DRILL_S = 1.5;
const RISE_S = 0.3;
const STOW_S = 0.4;
const DRILL_DEPTH_M = 0.13;

// MERGE: dedupe tube helper
// A chunky six-sided sample tube standing along +Y, centred on its middle:
// off-white body, slate cap on top, amber band, slate coring bit below.
function createTubeGeometry(THREE) {
  const r = 0.032;
  return mergeParts([
    { geometry: new THREE.CylinderGeometry(r, r, 0.17, 6), color: PALETTE.offWhite, y: 0 },
    { geometry: new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.05, 6), color: PALETTE.slate, y: 0.1 },
    { geometry: new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.022, 6), color: PALETTE.amber, y: 0.035 },
    { geometry: new THREE.CylinderGeometry(r * 0.9, r * 0.6, 0.04, 6), color: PALETTE.slate, y: -0.105 },
  ]);
}

export function createStation(ctx) {
  const { THREE, mission, patch, station } = ctx;
  const data = mission.data;
  const card = data.cards[station.card] || data.cards.S4;
  const core = data.cores.find((c) => c.number === (station.samples || [])[0]) || data.cores.find((c) => c.station === station.id);

  const cards = [
    {
      title: card.title,
      body: mission.cardText(station.card) || card.text,
      source: card.source,
      action: 'Grip (G) takes the tube. Trigger (click) at the marked rock to core.', // extra to the contract
    },
  ];

  // ---- where things stand -------------------------------------------------
  // Beside the site, turned away from the way the route arrives.
  const routePoints = data.route.points;
  const back = routePoints[Math.max((station.routeIndex ?? 0) - 6, 0)];
  let ax = back[0] - station.x;
  let az = back[1] - station.z;
  const al = Math.hypot(ax, az);
  if (al > 0.5) {
    ax /= al;
    az /= al;
  } else {
    ax = 1;
    az = 0;
  }
  const lines = [routePoints, ...data.traverse.lines.map((line) => line.points)];
  let dx = ax;
  let dz = az;
  let clearM = -1;
  for (const deg of ROCK_TURNS_DEG) {
    const turn = THREE.MathUtils.degToRad(deg);
    const tx = ax * Math.cos(turn) - az * Math.sin(turn);
    const tz = ax * Math.sin(turn) + az * Math.cos(turn);
    let clear = Infinity;
    for (const line of lines) clear = Math.min(clear, nearestOnLine(line, station.x + tx * ROCK_FROM_SITE_M, station.z + tz * ROCK_FROM_SITE_M).distanceM);
    if (clear > clearM) {
      clearM = clear;
      dx = tx;
      dz = tz;
    }
    if (clear >= ROCK_CLEAR_M) break;
  }
  const rockX = station.x + dx * ROCK_FROM_SITE_M;
  const rockZ = station.z + dz * ROCK_FROM_SITE_M;
  let rockY = patch.groundY(rockX, rockZ);
  if (Number.isNaN(rockY)) rockY = station.y;

  const group = new THREE.Group();
  group.name = 'station-S4';
  const site = new THREE.Group(); // origin: the rock's base point on the ground
  site.name = 'station-S4-site';
  site.position.set(rockX, rockY, rockZ);
  site.rotation.y = Math.atan2(-dz, dx) + Math.PI / 2; // the holder (local +X) stands to one side as seen from the site
  group.add(site);

  // ---- the marked rock, its flag and the tube holder: one mesh -------------
  const fixed = new THREE.Mesh(
    mergeParts([
      { geometry: new THREE.CylinderGeometry(0.48, 0.74, 0.66, 7), color: PALETTE.marsDeep, y: ROCK_TOP_M - 0.33, rotY: 0.4 },
      { geometry: new THREE.IcosahedronGeometry(0.34, 0), color: PALETTE.marsOrange, x: -0.25, y: 0.12, z: 0.62, rotY: 0.7 },
      { geometry: new THREE.IcosahedronGeometry(0.27, 0), color: PALETTE.marsDeep, x: -0.6, y: 0.07, z: -0.36, rotY: 0.2 },
      // marker flag behind the rock
      { geometry: new THREE.BoxGeometry(0.07, 1.6, 0.07), color: PALETTE.offWhite, x: -0.78, y: 0.65, z: 0.1 },
      { geometry: new THREE.BoxGeometry(0.44, 0.28, 0.05), color: PALETTE.teal, x: -0.52, y: 1.28, z: 0.1 },
      // tube holder: post and cup
      { geometry: new THREE.CylinderGeometry(0.07, 0.11, 1.05, 6), color: PALETTE.slate, x: HOLDER_X_M, y: HOLDER_TOP_M - 0.525 - 0.07, z: HOLDER_Z_M },
      { geometry: new THREE.CylinderGeometry(0.15, 0.1, 0.14, 6), color: PALETTE.amber, x: HOLDER_X_M, y: HOLDER_TOP_M - 0.07, z: HOLDER_Z_M },
    ]),
    lowPolyMaterial(),
  );
  fixed.name = 'station-S4-rock';
  site.add(fixed);

  // Target mark on the rock's flat top (its own mesh so it can pulse), and
  // the core hole that shows once the core is taken.
  const mark = new THREE.Mesh(
    mergeParts([{ geometry: new THREE.RingGeometry(0.2, 0.33, 6).rotateX(-Math.PI / 2), color: PALETTE.teal }]),
    lowPolyMaterial(),
  );
  mark.name = 'station-S4-mark';
  mark.position.y = ROCK_TOP_M + 0.012;
  site.add(mark);
  const hole = new THREE.Mesh(
    mergeParts([{ geometry: new THREE.CircleGeometry(0.12, 6).rotateX(-Math.PI / 2), color: PALETTE.slate }]),
    lowPolyMaterial(),
  );
  hole.name = 'station-S4-hole';
  hole.position.y = ROCK_TOP_M + 0.016;
  hole.visible = false;
  site.add(hole);

  // ---- the sample tube ------------------------------------------------------
  // `tube` is what the hand holds; the mesh inside it carries the lean.
  const tube = new THREE.Group();
  tube.name = 'station-S4-tube';
  const tubeMesh = new THREE.Mesh(createTubeGeometry(THREE), lowPolyMaterial());
  tubeMesh.name = 'station-S4-tube-body';
  tube.add(tubeMesh);
  const seal = new THREE.Mesh(
    mergeParts([{ geometry: new THREE.CylinderGeometry(0.047, 0.047, 0.03, 6), color: PALETTE.teal, y: 0.14 }]),
    lowPolyMaterial(),
  );
  seal.name = 'station-S4-tube-seal';
  seal.visible = false;
  tubeMesh.add(seal);

  const half = (TUBE_LENGTH_M / 2) * TUBE_WORLD_SCALE;
  const holderPos = new THREE.Vector3(HOLDER_X_M, HOLDER_TOP_M - 0.1 + half, HOLDER_Z_M);
  const abovePos = new THREE.Vector3(0, ROCK_TOP_M + half + 0.3, 0);
  const touchPos = new THREE.Vector3(0, ROCK_TOP_M + half + 0.02, 0);
  const startPos = new THREE.Vector3();
  const startQuat = new THREE.Quaternion();
  const upright = new THREE.Quaternion();
  const scratch = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const rockSphere = new THREE.Sphere(new THREE.Vector3(), ROCK_HIT_RADIUS_M);

  function stow() {
    site.add(tube);
    tube.position.copy(holderPos);
    tube.quaternion.copy(upright);
    tube.scale.setScalar(TUBE_WORLD_SCALE);
    tubeMesh.rotation.x = 0;
    tubeMesh.position.set(0, 0, 0);
  }
  stow();

  // 'holder' | 'held' | 'coring' | 'sealed'
  const state = { phase: 'holder', t: 0, sealedFired: false, active: false, time: 0, hintS: 0, blockedSelects: 0 };

  function take() {
    state.phase = 'held';
    tube.position.set(0, 0, 0);
    tube.quaternion.copy(upright);
    tube.scale.setScalar(1);
    tubeMesh.rotation.x = HELD_TILT_RAD;
    ctx.hand.hold(tube);
  }

  function putBack() {
    if (ctx.hand.held === tube) ctx.hand.release();
    stow();
    state.phase = 'holder';
  }

  // The moment the core is sealed: hole in the rock, seal on the tube, HUD, notebook, count.
  function sealNow() {
    if (state.sealedFired) return;
    state.sealedFired = true;
    seal.visible = true;
    hole.visible = true;
    mark.visible = false;
    ctx.flash('SAMPLE');
    if (core) {
      ctx.log({
        title: `Sample #${core.number} ${core.name} sealed`,
        lines: [
          `Sol ${core.sol}, ${core.height}, ${core.rockType.toLowerCase()} ${core.sampleType.toLowerCase()}.`,
          'Simulated coring. Approximate position.', // short: the notebook shows two lines per entry
        ],
        station: station.id,
      });
    }
    // Shared tally for the debrief (PARALLEL-WORK CONTRACT).
    if (!mission.stats) mission.stats = { stationsDone: 0, stationCount: 0, coresLogged: 0, coreCount: 5, slopeWarnings: 0, fieldCheck: null, distanceM: 0, path: [] };
    mission.stats.coresLogged = (mission.stats.coresLogged || 0) + 1;
    ctx.done();
  }

  function startCoring() {
    // Take the tube out of the hand and carry on from where it was.
    tube.updateWorldMatrix(true, false);
    tube.getWorldPosition(startPos);
    tube.getWorldQuaternion(startQuat);
    if (ctx.hand.held === tube) ctx.hand.release();
    site.updateWorldMatrix(true, false);
    site.worldToLocal(startPos);
    site.getWorldQuaternion(scratchQuat).invert();
    startQuat.premultiply(scratchQuat);
    site.add(tube);
    tube.position.copy(startPos);
    tube.quaternion.copy(startQuat);
    state.phase = 'coring';
    state.t = 0;
  }

  function finishCoring() {
    sealNow();
    stow();
    state.phase = 'sealed';
  }

  const ease = (k) => k * k * (3 - 2 * k);

  return {
    id: station.id,
    title: station.title,
    group,
    state,
    core,
    tube,
    rock: { x: rockX, y: rockY, z: rockZ, clearM, topM: ROCK_TOP_M, sphere: rockSphere, mesh: fixed, mark, hole, seal },
    cards: () => cards,

    onEnter() {
      state.active = true;
    },
    onLeave() {
      state.active = false;
      // The tube stays at Berea: back in its holder, or the coring completes.
      if (state.phase === 'held') putBack();
      else if (state.phase === 'coring') finishCoring();
      mark.scale.setScalar(1);
    },

    // No allocations.
    update(dt) {
      state.time += dt;
      if (mark.visible) mark.scale.setScalar(state.active ? 1 + 0.14 * Math.sin(state.time * 5) : 1);
      if (state.hintS > 0 && state.phase === 'holder') {
        // A press on the rock without the tube: the tube hops in its holder.
        state.hintS = Math.max(state.hintS - dt, 0);
        tube.position.y = holderPos.y + 0.18 * Math.abs(Math.sin(state.hintS * 12));
      }
      if (state.phase !== 'coring') return;
      state.t += dt;
      let t = state.t;
      if (t < FLY_S) {
        const k = ease(t / FLY_S);
        tube.position.lerpVectors(startPos, abovePos, k);
        tube.quaternion.slerpQuaternions(startQuat, upright, k);
        tube.scale.setScalar(1 + (TUBE_WORLD_SCALE - 1) * k);
        tubeMesh.rotation.x = HELD_TILT_RAD * (1 - k);
        return;
      }
      tube.scale.setScalar(TUBE_WORLD_SCALE);
      tube.quaternion.copy(upright);
      tubeMesh.rotation.x = 0;
      t -= FLY_S;
      if (t < DRILL_S) {
        // Down onto the mark, then turning into the rock.
        const k = t / DRILL_S;
        const lower = Math.min(k / 0.2, 1);
        const bite = Math.max((k - 0.2) / 0.8, 0);
        tube.position.lerpVectors(abovePos, touchPos, ease(lower));
        tube.position.y -= DRILL_DEPTH_M * bite;
        tube.position.x = 0.008 * Math.sin(t * 60) * (bite > 0 ? 1 : 0);
        tubeMesh.rotation.y = t * 16;
        return;
      }
      t -= DRILL_S;
      sealNow();
      tubeMesh.rotation.y = 0;
      if (t < RISE_S) {
        scratch.copy(touchPos);
        scratch.y -= DRILL_DEPTH_M;
        tube.position.lerpVectors(scratch, abovePos, ease(t / RISE_S));
        return;
      }
      t -= RISE_S;
      if (t < STOW_S) {
        tube.position.lerpVectors(abovePos, holderPos, ease(t / STOW_S));
        return;
      }
      finishCoring();
    },

    onInput(kind, info) {
      if (kind === 'grip') {
        if (state.phase === 'holder') take();
        else if (state.phase === 'held') putBack();
        else return false;
        return true;
      }
      if (kind === 'select') {
        if (!info || !info.ray) return false;
        site.updateWorldMatrix(true, false);
        rockSphere.center.set(0, ROCK_TOP_M * 0.6, 0).applyMatrix4(site.matrixWorld);
        if (!info.ray.intersectsSphere(rockSphere)) return false;
        // Pointing at the rock: the press is used here, never a teleport.
        if (state.phase === 'held') startCoring();
        else {
          state.blockedSelects++;
          if (state.phase === 'holder') state.hintS = 0.52;
        }
        return true;
      }
      return false;
    },

    isDone: () => state.sealedFired,
  };
}
