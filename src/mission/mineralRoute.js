import { DEFAULT_MAX_SNAP_M, cellOf, cellX, cellZ, findPath, measureLine, nearestInMask, reachableFrom } from './route.js';
import { MINERAL_PICK_COUNT, ensureMineralState } from './mineralState.js';

// The combined station and deposit route (mineral objective, Interface 2).
//
// RULES
// - The stations stay in the order of the mission file (data.route.order) and
//   every one is visited. Their route anchors are the stored route's own
//   points (data.route.legs[k].first / .last).
// - Each chosen deposit is put into the gap of that order where the WHOLE walk
//   takes the least walking time. All placements are tried: every gap for every
//   deposit, and every order of the deposits that share a gap.
// - A gap with no deposit keeps its stored line untouched. A gap with deposits
//   is walked station -> deposit(s) -> station, every leg by the existing A*
//   (route.js findPath: 15 degree limit and pace from the mission file).
// - A deposit on ground that cannot be walked to is moved to the nearest cell
//   that can (at most DEFAULT_MAX_SNAP_M away, the distance planRoute uses);
//   the distance moved is returned. If there is none, the deposit is returned
//   in `skipped` and the plan is made without it. Nothing throws for that.
// - Time: walk + stopMinutes per station (mission file) + DEPOSIT_STOP_MINUTES
//   per deposit (ASSUMPTION, from the mineral brief). The reserve holds when
//   EVA length minus that total is at least the reserve (both from the file).
//
// Pure logic up to installMineralRoute: no Three.js and no DOM, so it runs in Node.

// ASSUMPTION (mineral brief): each deposit stop takes this many minutes.
export const DEPOSIT_STOP_MINUTES = 20;
export const DEPOSIT_STOP_ASSUMPTION = {
  id: 'depositStopMinutes',
  value: DEPOSIT_STOP_MINUTES,
  unit: 'min',
  label: 'ASSUMPTION',
  text: `Each mineral deposit stop takes ${DEPOSIT_STOP_MINUTES} minutes.`,
};

const contexts = new WeakMap(); // mission -> planning context (anchors, stored legs, leg cache)

function assumptionValue(assumptions, id) {
  const found = assumptions.find((a) => a.id === id);
  if (!found || !Number.isFinite(found.value)) throw new Error(`mission file has no assumption "${id}"`);
  return found.value;
}

function contextOf(mission) {
  let ctx = contexts.get(mission);
  if (ctx) return ctx;
  const { data, pace } = mission;
  const rg = mission.routeGrid;
  const points = data.route.points;
  const order = data.route.order;
  const legs = data.route.legs;
  if (legs.length !== order.length - 1) throw new Error('mission route: legs do not match the station order');
  const place = (id) => (id === 'START' ? data.start : mission.stations.get(id));
  // One anchor per entry of the order (the airlock is first and last).
  const anchors = order.map((id, k) => {
    const index = k < legs.length ? legs[k].first : legs[k - 1].last;
    const at = place(id);
    return { id, kind: id === 'START' ? 'start' : 'station', x: at.x, z: at.z, cell: cellOf(rg, points[index][0], points[index][1]) };
  });
  // The stored line of each gap, measured with the same pace rule.
  const gaps = legs.map((leg, k) => {
    if (leg.from !== order[k] || leg.to !== order[k + 1] || (k > 0 && legs[k - 1].last !== leg.first)) {
      throw new Error('mission route: legs are not in station order');
    }
    const line = points.slice(leg.first, leg.last + 1);
    return { line, seconds: measureLine(rg, line, pace).seconds };
  });
  ctx = {
    rg,
    pace,
    anchors,
    gaps,
    reachable: null, // cells that can be walked to from the airlock; made on first use
    legs: new Map(), // 'fromCell>toCell' -> { cells, seconds } | null
    searches: 0,
    evaMinutes: assumptionValue(data.assumptions, 'evaHours') * 60,
    reserveMinutes: assumptionValue(data.assumptions, 'reserveHours') * 60,
  };
  contexts.set(mission, ctx);
  return ctx;
}

// Fastest walk between two cells, searched once and kept.
function leg(ctx, from, to) {
  const key = `${from}>${to}`;
  let found = ctx.legs.get(key);
  if (found === undefined) {
    found = findPath(ctx.rg, from, to, ctx.pace);
    if (found) found = { cells: found.cells, seconds: found.seconds };
    ctx.legs.set(key, found);
    ctx.searches++;
  }
  return found;
}

// Looks the ids up and snaps them: { stops: [{ id, group, x, z, dataX, dataZ, movedM, cell }], skipped }.
function resolveDeposits(mission, ctx, depositIds) {
  const state = ensureMineralState(mission);
  const stops = [];
  const skipped = [];
  const seen = new Set();
  for (const id of depositIds || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const deposit = state.deposit(id);
    if (!deposit || !Number.isFinite(deposit.x) || !Number.isFinite(deposit.z)) {
      skipped.push({ id, reason: 'not in the deposit list' });
      continue;
    }
    if (!ctx.reachable) ctx.reachable = reachableFrom(ctx.rg, ctx.anchors[0].cell);
    const snap = nearestInMask(ctx.rg, ctx.reachable, deposit.x, deposit.z, DEFAULT_MAX_SNAP_M);
    if (!snap) {
      skipped.push({
        id,
        reason: `no ground that can be walked to within ${DEFAULT_MAX_SNAP_M} m without crossing slopes above ${ctx.rg.slopeLimitDeg} degrees`,
      });
      continue;
    }
    stops.push({ id, group: deposit.group, x: snap.x, z: snap.z, dataX: deposit.x, dataZ: deposit.z, movedM: snap.movedM, cell: snap.cell });
  }
  return { stops, skipped };
}

// Every [from, to] pair of cells a plan for these deposits may ask for.
function neededLegs(ctx, stops) {
  const pairs = [];
  const last = ctx.anchors.length - 1;
  for (const stop of stops) {
    for (let k = 0; k < last; k++) pairs.push([ctx.anchors[k].cell, stop.cell]);
    for (let k = 1; k <= last; k++) pairs.push([stop.cell, ctx.anchors[k].cell]);
    for (const other of stops) if (other !== stop) pairs.push([stop.cell, other.cell]);
  }
  return pairs.filter(([from, to]) => !ctx.legs.has(`${from}>${to}`));
}

function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

// The placement with the least walking time: gapOf[i] = gap of sequence[i].
function bestPlacement(ctx, stops) {
  const gapCount = ctx.gaps.length;
  let best = null;
  const gapOf = new Array(stops.length).fill(0);
  for (const sequence of permutations(stops)) {
    // Deposits keep the order of `sequence`, so their gaps never go backwards.
    const visit = (i, fromGap) => {
      if (i < sequence.length) {
        for (let g = fromGap; g < gapCount; g++) {
          gapOf[i] = g;
          visit(i + 1, g);
        }
        return;
      }
      let seconds = 0;
      let i2 = 0;
      for (let g = 0; g < gapCount; g++) {
        if (i2 >= sequence.length || gapOf[i2] !== g) {
          seconds += ctx.gaps[g].seconds;
          continue;
        }
        let at = ctx.anchors[g].cell;
        while (i2 < sequence.length && gapOf[i2] === g) {
          const piece = leg(ctx, at, sequence[i2].cell);
          if (!piece) return;
          seconds += piece.seconds;
          at = sequence[i2].cell;
          i2++;
        }
        const home = leg(ctx, at, ctx.anchors[g + 1].cell);
        if (!home) return;
        seconds += home.seconds;
      }
      if (!best || seconds < best.seconds - 1e-9) best = { seconds, sequence: sequence.slice(), gapOf: gapOf.slice() };
    };
    visit(0, 0);
  }
  return best;
}

function buildPlan(mission, ctx, stops, skipped) {
  const { rg, pace, anchors, gaps } = ctx;
  const best = stops.length ? bestPlacement(ctx, stops) : { sequence: [], gapOf: [] };
  if (!best) {
    // Cannot happen for snapped deposits (they can all be walked to); never throw for it.
    return buildPlan(mission, ctx, [], skipped.concat(stops.map((s) => ({ id: s.id, reason: 'no route found' }))));
  }

  const polyline = [];
  const ordered = [];
  const legsOut = [];
  const addCells = (cells) => {
    for (let j = polyline.length ? 1 : 0; j < cells.length; j++) polyline.push([cellX(rg, cells[j]), cellZ(rg, cells[j])]);
  };
  const addLine = (line) => {
    for (let j = polyline.length ? 1 : 0; j < line.length; j++) polyline.push(line[j]);
  };
  const stopOut = (kind, s, extra) => ({ kind, id: s.id, x: s.x, z: s.z, index: Math.max(polyline.length - 1, 0), ...extra });

  ordered.push(stopOut(anchors[0].kind, anchors[0]));
  let i = 0;
  for (let g = 0; g < gaps.length; g++) {
    let from = anchors[g];
    let first = Math.max(polyline.length - 1, 0);
    if (i >= best.sequence.length || best.gapOf[i] !== g) {
      addLine(gaps[g].line);
    } else {
      let at = from.cell;
      while (i < best.sequence.length && best.gapOf[i] === g) {
        const stop = best.sequence[i];
        addCells(leg(ctx, at, stop.cell).cells);
        legsOut.push({ from: from.id, to: stop.id, first, last: polyline.length - 1 });
        ordered.push(stopOut('deposit', stop, { group: stop.group, dataX: stop.dataX, dataZ: stop.dataZ, movedM: stop.movedM }));
        at = stop.cell;
        from = stop;
        first = polyline.length - 1;
        i++;
      }
      addCells(leg(ctx, at, anchors[g + 1].cell).cells);
    }
    legsOut.push({ from: from.id, to: anchors[g + 1].id, first, last: polyline.length - 1 });
    ordered.push(stopOut(anchors[g + 1].kind, anchors[g + 1]));
  }

  const whole = measureLine(rg, polyline, pace);
  for (const one of legsOut) {
    const m = measureLine(rg, polyline, pace, { first: one.first, last: one.last });
    one.lengthM = m.lengthM;
    one.minutes = m.seconds / 60;
    one.maxSlopeDeg = m.maxSlopeDeg;
  }
  const stationCount = anchors.filter((a) => a.kind === 'station').length;
  const walkMinutes = whole.seconds / 60;
  const stationStopMinutes = stationCount * pace.stopMinutes;
  const depositMinutes = stops.length * DEPOSIT_STOP_MINUTES;
  const total = walkMinutes + stationStopMinutes + depositMinutes;
  const stationsOnlyWalk = gaps.reduce((sum, gap) => sum + gap.seconds, 0) / 60;
  const stopIndex = {};
  for (const stop of ordered) if (!(stop.id in stopIndex)) stopIndex[stop.id] = stop.index;

  return {
    // ---- Interface 2 ----
    ordered_stops: ordered,
    polyline,
    walk_minutes: walkMinutes,
    total_eva_minutes: total,
    reserve_ok: ctx.evaMinutes - total >= ctx.reserveMinutes,
    distance_m: whole.lengthM,
    deposit_stop_minutes: DEPOSIT_STOP_MINUTES, // per deposit, ASSUMPTION
    reserve_minutes_left: ctx.evaMinutes - total, // EVA minutes not used by the plan; the reserve holds when >= reserve_minutes
    // ---- the parts of the sum, and what else a caller may want ----
    eva_minutes: ctx.evaMinutes,
    reserve_minutes: ctx.reserveMinutes,
    station_count: stationCount,
    station_stop_minutes: pace.stopMinutes, // per station, ASSUMPTION (mission file)
    deposit_count: stops.length,
    deposit_ids: best.sequence.map((s) => s.id), // in walking order
    added_walk_minutes: walkMinutes - stationsOnlyWalk, // against the stations-only route
    max_slope_deg: whole.maxSlopeDeg,
    within_limit: whole.maxSlopeDeg <= rg.slopeLimitDeg,
    legs: legsOut,
    stop_index: stopIndex, // stop id -> index into polyline (the airlock: 0)
    snaps: stops.map((s) => ({ id: s.id, x: s.x, z: s.z, movedM: s.movedM })),
    skipped,
    key: best.sequence.map((s) => s.id).slice().sort().join(','),
  };
}

// The plan for up to three deposit ids (see the top of the file). Needs
// mission.data, .pace, .routeGrid, .stations and the deposit list in
// mission.minerals.data. Searches whatever legs are not cached yet.
export function planMineralRoute(mission, depositIds) {
  const ctx = contextOf(mission);
  const { stops, skipped } = resolveDeposits(mission, ctx, depositIds);
  return buildPlan(mission, ctx, stops, skipped);
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

// The same plan, with a pause after every leg search so a frame can be drawn
// in between. cancelled() (optional) is asked after each pause; when it says
// true the promise resolves to null.
export async function planMineralRouteAsync(mission, depositIds, { cancelled = null } = {}) {
  const ctx = contextOf(mission);
  const { stops, skipped } = resolveDeposits(mission, ctx, depositIds);
  for (const [from, to] of neededLegs(ctx, stops)) {
    leg(ctx, from, to);
    await pause();
    if (cancelled && cancelled()) return null;
  }
  return buildPlan(mission, ctx, stops, skipped);
}

// How many A* searches have been run for this mission (for checks).
export const mineralRouteSearches = (mission) => contextOf(mission).searches;

// Wires the plan to the shared mineral state and to the world.
//   'picks' / 'data': with three picks, plan in the background (state.plan,
//       emit 'plan'); with fewer, state.plan = null and the legs of the picks
//       made so far are searched ahead of time.
//   'confirmed': the world route (ribbon, tablet MAP, walk-home time, HUD
//       NEXT) becomes plan.polyline; not confirmed any more: the stored route.
//   'collected': the HUD's NEXT moves on from a collected deposit.
// The stations, their order and their cards are not touched.
export function installMineralRoute(mission, deps = {}) {
  const state = ensureMineralState(mission);
  const data = mission.data;

  // The deposit stop joins the assumptions the app lists.
  if (!data.assumptions.some((a) => a.id === DEPOSIT_STOP_ASSUMPTION.id)) data.assumptions.push({ ...DEPOSIT_STOP_ASSUMPTION });
  const credits = mission.tablet && mission.tablet.credits;
  const section = credits && credits.sections.find((s) => s.id === 'assumptions');
  const line = section && section.lines.find((l) => l.head === DEPOSIT_STOP_ASSUMPTION.label);
  if (line && !line.text.includes(DEPOSIT_STOP_ASSUMPTION.text)) line.text = `${line.text} ${DEPOSIT_STOP_ASSUMPTION.text}`;

  const stored = {
    points: data.route.points,
    stopIndex: Object.fromEntries(data.route.legs.map((l) => [l.from, l.first])),
    routeKm: mission.values.route_km,
  };
  let appliedPlan = null; // the plan the world route shows now, or null for the stored route
  let job = 0; // background planning: a newer job cancels an older one

  const keyOf = (ids) => ids.slice().sort().join(',');
  const wantsPlan = () => !!state.data && state.picks.length === MINERAL_PICK_COUNT;

  function setPlan(plan) {
    if (state.plan === plan) return;
    state.plan = plan;
    state.emit('plan');
  }

  // HUD NEXT: the first deposit not collected yet that comes before the next station.
  function refreshNext() {
    let override = null;
    const nextId = mission.progress.nextId;
    if (appliedPlan && nextId) {
      const stops = appliedPlan.ordered_stops;
      let end = stops.length - 1; // 'START': the airlock at the end
      if (nextId !== 'START') end = stops.findIndex((s) => s.kind === 'station' && s.id === nextId);
      for (let i = 0; i < end; i++) {
        if (stops[i].kind === 'deposit' && !state.isCollected(stops[i].id)) {
          override = { id: stops[i].id, x: stops[i].x, z: stops[i].z };
          break;
        }
      }
    }
    mission.nextOverride = override;
  }

  function syncWorld() {
    const wanted = state.confirmed && state.plan ? state.plan : null;
    if (wanted !== appliedPlan) {
      appliedPlan = wanted;
      if (typeof mission.setRoute === 'function') {
        if (wanted) mission.setRoute(wanted.polyline, { stopIndex: wanted.stop_index });
        else mission.setRoute(stored.points, { stopIndex: stored.stopIndex });
      } else {
        console.warn('mineralRoute: mission.setRoute is missing, the world route was not swapped');
      }
      // {route_km} in the card texts is the route that is walked.
      mission.values.route_km = wanted ? Math.round(wanted.distance_m / 100) / 10 : stored.routeKm;
      if (mission.tablet) mission.tablet.redraw();
    }
    refreshNext();
  }

  function onPicks() {
    const mine = ++job;
    const cancelled = () => mine !== job;
    if (!wantsPlan()) {
      setPlan(null);
      syncWorld();
      // Search the legs of the picks made so far, so the third pick has less to wait for.
      if (state.data && state.picks.length) planMineralRouteAsync(mission, state.picks.slice(), { cancelled }).catch((error) => console.error(error));
      return;
    }
    if (state.plan && state.plan.key === keyOf(state.picks) && !state.plan.skipped.length) {
      syncWorld();
      return;
    }
    setPlan(null);
    syncWorld();
    planMineralRouteAsync(mission, state.picks.slice(), { cancelled })
      .then((plan) => {
        if (!plan || cancelled()) return;
        setPlan(plan);
        syncWorld();
      })
      .catch((error) => console.error(error));
  }

  function onConfirmed() {
    if (state.confirmed && wantsPlan() && !state.plan) {
      // Confirmed before the background plan was ready: finish it now.
      job++;
      setPlan(planMineralRoute(mission, state.picks.slice()));
    }
    syncWorld();
  }

  state.on((kind) => {
    if (kind === 'picks' || kind === 'data') onPicks();
    else if (kind === 'confirmed') onConfirmed();
    else if (kind === 'collected') refreshNext();
  });

  // The stations set the next station through mission.setNextStation: follow it.
  const setNextStation = mission.setNextStation;
  mission.setNextStation = (id) => {
    const result = setNextStation.call(mission, id);
    refreshNext();
    return result;
  };

  onPicks();
  if (state.confirmed) onConfirmed();

  return {
    get appliedPlan() {
      return appliedPlan;
    },
    plan: (ids) => planMineralRoute(mission, ids),
    planAsync: (ids) => planMineralRouteAsync(mission, ids),
    refreshNext,
  };
}
