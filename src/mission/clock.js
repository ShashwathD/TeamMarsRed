import { cellOf, findPath, nearestInMask, reachableFrom, sampleGrid, walkSeconds } from './route.js';

// EVA clock for the Marswalk mission (brief: SYSTEMS / EVA CLOCK).
//
// MISSION TIME IS A BUDGET, NOT A STOPWATCH. Real seconds are not counted.
// The clock advances only by:
//   1. the WALKING TIME of the ground the explorer covers, at the assumed pace
//      (Tobler's hiking function x factor, capped; the numbers are ASSUMPTIONS
//      read from the mission file). It makes no difference how the ground was
//      covered: a desktop walk, a run, real steps in the room and a teleport
//      of N metres all cost the walking time of those N metres over the real
//      terrain heights (straight line between the two places, heights every
//      2 m at most, uphill and downhill priced by the pace rule);
//   2. charges made by other parts of the mission: 20 minutes per station
//      (chargeStop) and, for a map teleport, the walking time of the route
//      distance (charge + moveCharged, so the jump is not charged twice).
// Standing still costs nothing: a visit lasts minutes, the EVA 8 hours.
//
// TIME TO WALK HOME (to the airlock):
//   - on or near the planned route (within OFF_ROUTE_M): the walking time
//     along the route from the nearest route point to the airlock, in the
//     quicker of the two directions (the route is a loop), plus the short
//     straight walk to that route point. Method 'route'.
//   - farther from the route: the fastest slope-limited walk found by A*
//     from the nearest ground that can be walked to, plus the straight walk
//     to that ground. Method 'astar'. Searched again only after moving a
//     good way, never every frame.
//
// MARGIN = time left - reserve - time to walk home.
//   'amber' when margin < 1 hour, 'red' when margin < 0 (walk-home time is
//   more than time left minus reserve). There is no fail state: the clock
//   keeps counting below zero and everything keeps working.

const MOVE_STEP_M = 0.25; // ground closer than this to the last charged spot is not charged yet (ignores head sway)
const HEIGHT_STEP_M = 2; // heights along a straight move are read at most this far apart (the terrain spacing)
const HOME_STEP_M = 1; // the walk-home time is worked out again after moving this far
const OFF_ROUTE_M = 30; // farther than this from the route: search instead of following the route
const SNAP_M = 60; // how far to look for ground that can be walked home from
const AMBER_MARGIN_S = 3600; // brief: amber when margin < 1 h

// Walking seconds for the straight line (x0, z0) -> (x1, z1) over the terrain. No allocations.
export function straightWalkSeconds(rg, pace, x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  if (!(d > 0)) return 0;
  const heights = rg.grid.heights;
  const parts = Math.max(1, Math.ceil(d / HEIGHT_STEP_M - 1e-9));
  const part = d / parts;
  let seconds = 0;
  let h0 = sampleGrid(rg, heights, x0, z0);
  for (let p = 1; p <= parts; p++) {
    const t = p / parts;
    const h1 = sampleGrid(rg, heights, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    // Next to missing data the height is unknown: price that piece as level ground.
    const rise = Number.isFinite(h1) && Number.isFinite(h0) ? h1 - h0 : 0;
    seconds += walkSeconds(part, rise, pace);
    h0 = h1;
  }
  return seconds;
}

// rg: route grid (route.js); pace: paceFromAssumptions; assumptions: the
// mission file's list; routePoints: [[x, z], ...] closed loop from and to the
// airlock; airlock: { x, z }.
export function createClock({ rg, pace, assumptions, routePoints, airlock }) {
  const hours = (id) => {
    const found = assumptions.find((a) => a.id === id);
    if (!found || !Number.isFinite(found.value)) throw new Error(`mission file has no assumption "${id}"`);
    return found.value;
  };
  const totalS = hours('evaHours') * 3600;
  const reserveS = hours('reserveHours') * 3600;
  const stopS = pace.stopMinutes * 60;

  // Walking seconds along the route: forward[i] from point 0 to point i,
  // backward[i] from point i back to point 0 (not the same: uphill and
  // downhill are priced differently).
  const count = routePoints.length;
  const forward = new Float64Array(count);
  const backward = new Float64Array(count);
  for (let i = 0; i + 1 < count; i++) {
    const [ax, az] = routePoints[i];
    const [bx, bz] = routePoints[i + 1];
    const d = Math.hypot(bx - ax, bz - az);
    const rise = sampleGrid(rg, rg.grid.heights, bx, bz) - sampleGrid(rg, rg.grid.heights, ax, az);
    forward[i + 1] = forward[i] + walkSeconds(d, rise, pace);
    backward[i + 1] = backward[i] + walkSeconds(d, -rise, pace);
  }
  const loopS = forward[count - 1];

  const airlockSnap = nearestInMask(rg, rg.walkable, airlock.x, airlock.z, SNAP_M);
  let reachable = null; // cells that can be walked to from the airlock; made on first use

  const clock = {
    totalS,
    reserveS,
    stopS,
    amberMarginS: AMBER_MARGIN_S,
    running: true, // false: ground covered is not charged (for the cabin)
    elapsedS: 0,
    walkS: 0, // part of elapsedS charged for ground covered
    stopsS: 0, // part of elapsedS charged for station stops
    distanceM: 0, // ground covered and charged, horizontal metres
    stops: [], // station ids charged with chargeStop
    timeLeftS: totalS,
    homeS: 0,
    homeMethod: 'route',
    homeSearches: 0,
    homeRouteIndex: 0,
    offRouteM: 0,
    marginS: totalS - reserveS,
    status: 'ok', // 'ok' | 'amber' | 'red'
    onStatus: null, // (status, previous) => {} when the status changes
    lastCharge: null, // { seconds, metres, reason } of the latest charge

    // Adds mission time directly. metres counts toward distanceM.
    charge(seconds, { metres = 0, reason = 'other' } = {}) {
      if (!(seconds >= 0)) return clock.elapsedS;
      clock.elapsedS += seconds;
      if (reason === 'stop') clock.stopsS += seconds;
      else if (reason === 'walk' || reason === 'teleport') clock.walkS += seconds;
      clock.distanceM += metres;
      clock.lastCharge = { seconds, metres, reason };
      refresh();
      return clock.elapsedS;
    },

    // 20 minutes (the mission file's value) for a station, once per station.
    chargeStop(id) {
      if (clock.stops.includes(id)) return false;
      clock.stops.push(id);
      clock.charge(stopS, { reason: 'stop' });
      return true;
    },

    // The explorer is now at (x, z) and the way there is already paid for
    // (or free): the next move is measured from here.
    moveCharged(x, z) {
      lastX = x;
      lastZ = z;
      located = true;
      updateHome(x, z, true);
      refresh();
    },

    // Once per frame with the explorer's ground position. Charges the walking
    // time of the ground covered since the last charged spot. No allocations
    // unless the walk-home time is worked out again.
    track(x, z) {
      if (!located) {
        clock.moveCharged(x, z);
        return 0;
      }
      if (!clock.running) {
        lastX = x;
        lastZ = z;
        return 0;
      }
      const d = Math.hypot(x - lastX, z - lastZ);
      if (d < MOVE_STEP_M) return 0;
      const seconds = straightWalkSeconds(rg, pace, lastX, lastZ, x, z);
      clock.elapsedS += seconds;
      clock.walkS += seconds;
      clock.distanceM += d;
      lastMove.seconds = seconds;
      lastMove.metres = d;
      clock.lastCharge = lastMove;
      lastX = x;
      lastZ = z;
      updateHome(x, z, false);
      refresh();
      return seconds;
    },

    // Walking seconds along the stored route between two of its points,
    // in the direction first -> last (either order).
    routeSeconds(first, last) {
      return last >= first ? forward[last] - forward[first] : backward[first] - backward[last];
    },

    // Walk-home time from any place, without moving the clock: { seconds, method }.
    homeFrom(x, z) {
      const keep = [clock.homeS, clock.homeMethod, clock.homeRouteIndex, clock.offRouteM, homeX, homeZ, searchX, searchZ, searchS];
      updateHome(x, z, true);
      const result = { seconds: clock.homeS, method: clock.homeMethod, offRouteM: clock.offRouteM };
      [clock.homeS, clock.homeMethod, clock.homeRouteIndex, clock.offRouteM, homeX, homeZ, searchX, searchZ, searchS] = keep;
      return result;
    },

    // For tests and for a new walk.
    reset() {
      clock.elapsedS = 0;
      clock.walkS = 0;
      clock.stopsS = 0;
      clock.distanceM = 0;
      clock.stops.length = 0;
      clock.lastCharge = null;
      clock.running = true;
      clock.status = 'ok';
      refresh();
    },
  };

  let located = false;
  let lastX = 0;
  let lastZ = 0;
  let homeX = NaN;
  let homeZ = NaN;
  let searchX = NaN;
  let searchZ = NaN;
  let searchS = 0;
  const lastMove = { seconds: 0, metres: 0, reason: 'walk' };

  // Nearest point of the route to (x, z): sets nearIndex/nearT/nearX/nearZ/nearD. No allocations.
  let nearIndex = 0;
  let nearT = 0;
  let nearX = 0;
  let nearZ = 0;
  let nearD = 0;
  function nearestRoutePoint(x, z) {
    nearD = Infinity;
    for (let i = 0; i + 1 < count; i++) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + dx * t;
      const pz = a[1] + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < nearD) {
        nearD = d;
        nearIndex = i;
        nearT = t;
        nearX = px;
        nearZ = pz;
      }
    }
  }

  function updateHome(x, z, force) {
    if (!force && Math.hypot(x - homeX, z - homeZ) < HOME_STEP_M) return;
    homeX = x;
    homeZ = z;
    nearestRoutePoint(x, z);
    clock.offRouteM = nearD;
    clock.homeRouteIndex = nearIndex;

    if (nearD > OFF_ROUTE_M && airlockSnap) {
      // Away from the route: search, but not again until the explorer has
      // moved a good way from where the last search started.
      const toAirlock = Math.hypot(x - airlock.x, z - airlock.z);
      const again = Math.max(10, 0.05 * toAirlock);
      if (force || !(Math.hypot(x - searchX, z - searchZ) < again)) {
        if (!reachable) reachable = reachableFrom(rg, airlockSnap.cell);
        const from = nearestInMask(rg, reachable, x, z, SNAP_M);
        const path = from ? findPath(rg, from.cell, airlockSnap.cell, pace) : null;
        clock.homeSearches++;
        searchX = x;
        searchZ = z;
        searchS = path ? straightWalkSeconds(rg, pace, x, z, from.x, from.z) + path.seconds : NaN;
      }
      if (Number.isFinite(searchS)) {
        clock.homeS = searchS;
        clock.homeMethod = 'astar';
        return;
      }
    }
    // Along the route, the quicker way round, plus the walk to the route.
    const i = nearIndex;
    const f = forward[i] + (forward[i + 1] - forward[i]) * nearT;
    const b = backward[i] + (backward[i + 1] - backward[i]) * nearT;
    clock.homeS = straightWalkSeconds(rg, pace, x, z, nearX, nearZ) + Math.min(loopS - f, b);
    clock.homeMethod = 'route';
  }

  function refresh() {
    clock.timeLeftS = totalS - clock.elapsedS;
    clock.marginS = clock.timeLeftS - reserveS - clock.homeS;
    const status = clock.marginS < 0 ? 'red' : clock.marginS < AMBER_MARGIN_S ? 'amber' : 'ok';
    if (status !== clock.status) {
      const previous = clock.status;
      clock.status = status;
      if (clock.onStatus) clock.onStatus(status, previous);
    }
  }

  return clock;
}
