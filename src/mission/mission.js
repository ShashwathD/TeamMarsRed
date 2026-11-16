import * as THREE from 'three';
import { createRouteGrid, paceFromAssumptions, planRoute, routeSummary, sampleGrid } from './route.js';
import { createClock } from './clock.js';
import { createHud } from './hud.js';
import { buildRibbonGeometry, createRibbon } from './ribbon.js';
import { createBeacons } from './beacons.js';
import { PALETTE } from './lowpoly.js';
import { createLayers } from './layers.js';
import { attachDesktopPointer, createUi } from './ui.js';
import { createTablet } from './tablet.js';
import { createStations } from './stations/index.js';
import { ensureMineralState } from './mineralState.js';
import { installMinerals } from './minerals.js';
import { installMineralRoute } from './mineralRoute.js';
import { installCabinMinerals } from './cabinMinerals.js';
import { installSampling } from './sampling.js';

// The Jezero Marswalk mission: single entry point, loaded from main.js.
// Later build steps (clock, tablet, stations, cabin) extend this module.
//
// Data comes from data/mission/<site>.json (made by tools/build_mission.py).
// The planned route is stored there, so nothing is searched at load; the
// numbers shown from it ({route_km}, {extra_min}, {station_count},
// {direct_max_slope}, leg times) are computed here from the stored line and
// the terrain, with the same code that planned it (route.js).

// Patches that have a mission file.
export const MISSION_SITES = ['jezero_delta'];

const ROUTE_WIDTH_M = 1.2;
const TRAVERSE_WIDTH_M = 0.5;
// Where the route walks back over ground it already used (out and back along
// the same terrain samples) each direction is drawn this far to its own right,
// so the two ribbons lie side by side and each one's chevrons can be read.
const ROUTE_LANE_SHIFT_M = 0.65;
const ROUTE_LANE_RAMP_POINTS = 3; // the shift fades in and out over this many route points
const ROUTE_STACK_M = 0.03; // later parts of the route sit this much higher where it crosses itself
const SPAWN_FROM_MARKER_M = 6; // the player starts this far along the route from the airlock marker
const SLOPE_CLEAR_DEG = 1; // a slope caution is over once the ground is this much under its threshold
const SLOPE_FLASH_GAP_S = 5; // at least this long between two amber slope flashes
const LEVELS = ['ok', 'amber', 'red'];

// Replaces {name} in a card text with values[name]; unknown names are left as they are.
export function fillPlaceholders(text, values) {
  return text.replace(/\{(\w+)\}/g, (whole, name) => (values[name] === undefined || values[name] === null ? whole : String(values[name])));
}

// Sideways shift for each route point: full where the point's terrain sample
// is used again by another part of the route, fading to 0 next to such a stretch.
function laneShifts(points, shiftM) {
  const uses = new Map();
  for (const [x, z] of points) {
    const key = `${x},${z}`;
    uses.set(key, (uses.get(key) || 0) + 1);
  }
  const shared = points.map(([x, z]) => uses.get(`${x},${z}`) > 1);
  // The loop's first and last point are the same place by design: not a doubled stretch.
  shared[0] = false;
  shared[points.length - 1] = false;
  const shifts = new Array(points.length).fill(0);
  for (let i = 0; i < points.length; i++) {
    let nearest = ROUTE_LANE_RAMP_POINTS;
    for (let k = 0; k < ROUTE_LANE_RAMP_POINTS; k++) {
      if ((i - k >= 0 && shared[i - k]) || (i + k < points.length && shared[i + k])) {
        nearest = k;
        break;
      }
    }
    shifts[i] = shiftM * (1 - nearest / ROUTE_LANE_RAMP_POINTS);
  }
  return shifts;
}

// Needed: site, patch, scene. renderer + camera add the HUD; player (the rig
// from controls.js) and xr (xr.js) add the tablet and its input; terrain,
// surround and photo let the LAYERS tab switch the ground layers.
// tablet: false leaves the tablet and the controller-button mapping out.
export async function createMission({ site, patch, scene, renderer, camera, player = null, xr = null, terrain = null, surround = null, photo = null, tablet: wantTablet = true }) {
  const url = `./data/mission/${site}.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.route || !Array.isArray(data.route.points)) throw new Error(`${url} has no planned route`);

  // ---- numbers from the route -------------------------------------------
  const pace = paceFromAssumptions(data.assumptions);
  const routeGrid = createRouteGrid(patch, pace.slopeLimitDeg);
  const routeInput = {
    points: data.route.points,
    legs: data.route.legs,
    order: data.route.order,
    direct: {
      from: data.route.direct.line[0],
      to: data.route.direct.line[1],
      first: data.route.direct.routeFirst,
      last: data.route.direct.routeLast,
    },
  };
  const summary = routeSummary(routeGrid, routeInput, pace);
  if (!summary.withinLimit) {
    // Never shown as fine when it is not: say so where a developer will see it.
    console.error(`Mission route crosses ${summary.maxSlopeDeg.toFixed(2)} degree ground (limit ${pace.slopeLimitDeg}).`);
  }
  // Card {placeholders}: route-independent ones from the file, the rest computed above.
  const values = { ...data.computed, ...summary.values };

  const stations = new Map(data.stations.map((station) => [station.id, station]));

  // Where the walk begins: on the route a few metres past the airlock marker
  // (not inside its pillar), looking along the route.
  const routePoints = data.route.points;
  let spawnIndex = 0;
  while (
    spawnIndex + 1 < routePoints.length &&
    Math.hypot(routePoints[spawnIndex][0] - data.start.x, routePoints[spawnIndex][1] - data.start.z) < SPAWN_FROM_MARKER_M
  ) {
    spawnIndex++;
  }
  const spawnAhead = routePoints[Math.min(spawnIndex + 10, routePoints.length - 1)];
  const spawn = {
    x: routePoints[spawnIndex][0],
    z: routePoints[spawnIndex][1],
    routeIndex: spawnIndex,
    // degrees clockwise from north (x east, z south)
    headingDeg: THREE.MathUtils.radToDeg(Math.atan2(spawnAhead[0] - routePoints[spawnIndex][0], -(spawnAhead[1] - routePoints[spawnIndex][1]))),
  };

  // ---- scene objects ------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'mission';

  const route = createRibbon(
    buildRibbonGeometry(patch, [routePoints], {
      widthM: ROUTE_WIDTH_M,
      shiftRightM: [laneShifts(routePoints, ROUTE_LANE_SHIFT_M)],
      stackM: ROUTE_STACK_M,
    }),
    {
      color: PALETTE.routeBlue,
      chevronColor: PALETTE.routeBlueLight,
      chevrons: true,
      liftM: 0.08,
      liftPerM: 0.004,
    },
  );
  route.name = 'mission-route';
  group.add(route);

  // The rover's real path: narrower and a little higher, so it stays on top
  // where the planned route runs along it.
  const traverse = createRibbon(
    buildRibbonGeometry(patch, data.traverse.lines.map((line) => line.points), { widthM: TRAVERSE_WIDTH_M }),
    { color: PALETTE.roverOrange, chevrons: false, liftM: 0.14, liftPerM: 0.006, edge: 0 },
  );
  traverse.name = 'mission-traverse';
  group.add(traverse);

  // One beacon per station walked to, plus the start / airlock marker.
  // (S1, the briefing, happens in the cabin at the start spot.)
  const beaconItems = [{ id: 'START', kind: 'airlock', badge: '', name: 'Airlock', x: data.start.x, z: data.start.z }];
  for (const id of data.route.order) {
    if (id === 'START') continue;
    const station = stations.get(id);
    beaconItems.push({ id, kind: 'station', badge: id.replace(/^S/, ''), name: station.title, x: station.x, z: station.z });
  }
  const beacons = createBeacons(patch, beaconItems, {
    anisotropy: renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1,
  });
  group.add(beacons.group);
  scene.add(group);

  // Data layers the tablet switches (photo, slope hazard, rover path, sample
  // sites, panoramas, backdrop), and the scene objects behind them.
  const layerSet = createLayers({
    data,
    patch,
    routeGrid,
    terrain,
    surround,
    traverse,
    scene,
    anisotropy: renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1,
  });
  const layers = { route, traverse, beacons: beacons.group, samples: layerSet.samples };

  // ---- EVA clock and HUD (brief: SYSTEMS) --------------------------------
  const clock = createClock({ rg: routeGrid, pace, assumptions: data.assumptions, routePoints, airlock: data.start });
  // The HUD is worn on the camera; without one (no viewer) the clock still runs.
  const hud = camera ? createHud({ scene, camera, renderer, anisotropy: renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1 }) : null;
  clock.onStatus = (status, previous) => {
    // "RETURN" when the margin gets worse (ok -> amber -> red), not when it recovers.
    if (hud && LEVELS.indexOf(status) > LEVELS.indexOf(previous)) hud.flash('RETURN', { level: status });
  };
  const bands = data.terrain.slopeBandsDeg; // amber from 10, red above 15 (from the mission file)
  // Real values the HUD shows, unrounded, for later steps and tests.
  const telemetry = { headingDeg: 0, slopeDeg: 0, slopeLevel: 'ok', nextId: null, nextDistanceM: NaN };
  const walkOrder = data.route.order.filter((id) => id !== 'START');
  const progress = { nextId: walkOrder[0] || null };
  const slopeWarnings = { amber: 0, red: 0 };
  // Field notebook (the tablet's LOG tab). Later steps add entries as the walk goes.
  const log = {
    entries: [], // { title, lines[], station, atS (EVA seconds when written) }
    onChange: null,
    add({ title, lines = [], station = null }) {
      const entry = { title: String(title), lines: lines.map(String), station, atS: clock.elapsedS };
      log.entries.push(entry);
      if (log.onChange) log.onChange(entry);
      return entry;
    },
    clear() {
      log.entries.length = 0;
      if (log.onChange) log.onChange(null);
    },
  };
  // Things the action buttons do (A / E: scan, B: airlock door). Later steps fill these in.
  const actions = { scan: null, door: null };
  const lookDirection = new THREE.Vector3();
  let cautionLevel = 0; // 0 ok, 1 amber, 2 red; falls back only once clearly off the steep ground
  let sinceSlopeFlashS = Infinity;
  let lastTimeS = null;

  const mission = {
    site,
    data,
    pace,
    routeGrid,
    summary,
    values,
    stations,
    spawn,
    group,
    layers,
    beacons: beacons.beacons,
    route: { mesh: route, points: data.route.points, lengthM: summary.lengthM },
    traverse: { mesh: traverse },
    clock,
    hud,
    telemetry,
    progress,
    slopeWarnings,
    layerSet,
    world: { terrain, surround }, // the ground meshes, for steps that hide them (panorama view, cabin)
    log,
    actions,
    ui: null,
    tablet: null,
    stationSet: null, // station framework (stations/index.js): cards, actions, completion

    // Puts the explorer at (x, z), looking along headingDeg (clockwise from
    // north) if given. Does not touch the clock: the caller charges the trip
    // (clock.charge) and then calls clock.moveCharged. False if it cannot move there.
    travelTo(x, z, headingDeg) {
      if (!player) return false;
      if (renderer && renderer.xr.isPresenting) {
        if (!player.moveHeadTo(x, z)) return false;
        if (headingDeg !== undefined) {
          camera.getWorldDirection(lookDirection);
          if (Math.hypot(lookDirection.x, lookDirection.z) > 0.2) {
            const yaw = THREE.MathUtils.radToDeg(Math.atan2(lookDirection.x, -lookDirection.z));
            player.turnAboutHead(headingDeg - yaw); // turn the room, about the head, so the view faces that way
          }
        }
        return true;
      }
      if (!player.setPosition(x, z)) return false;
      if (headingDeg !== undefined) player.setHeading(headingDeg);
      return true;
    },

    // Which station the HUD's "NEXT" points at: a station id, 'START' (the
    // airlock) or null for none. Later steps call this as stations are done.
    setNextStation(id) {
      progress.nextId = id === 'START' || stations.has(id) ? id : null;
      return progress.nextId;
    },

    // MINERALS W3 HOOK (start): swaps the walked route for `points` (a closed
    // loop from and to the airlock, [[x, z], ...]). The ribbon is rebuilt once;
    // the clock's walk-home time, the tablet MAP and the spawn spot follow it.
    // stopIndex = { stationId: index into points }. Stations are not touched.
    nextOverride: null, // { id, x, z }: the HUD's NEXT points here instead of at the next station
    setRoute(points, { stopIndex = null } = {}) {
      const geometry = buildRibbonGeometry(patch, [points], {
        widthM: ROUTE_WIDTH_M,
        shiftRightM: [laneShifts(points, ROUTE_LANE_SHIFT_M)],
        stackM: ROUTE_STACK_M,
      });
      route.geometry.dispose();
      route.geometry = geometry;
      mission.route.points = points;
      mission.route.lengthM = geometry.userData.lengthM;
      clock.setRoute(points);
      let index = 0;
      while (index + 1 < points.length && Math.hypot(points[index][0] - data.start.x, points[index][1] - data.start.z) < SPAWN_FROM_MARKER_M) index++;
      const ahead = points[Math.min(index + 10, points.length - 1)];
      spawn.x = points[index][0];
      spawn.z = points[index][1];
      spawn.routeIndex = index;
      spawn.headingDeg = THREE.MathUtils.radToDeg(Math.atan2(ahead[0] - spawn.x, -(ahead[1] - spawn.z)));
      if (tablet && tablet.setRoute) tablet.setRoute(points, stopIndex);
    },
    // MINERALS W3 HOOK (end)

    // Card text with its {placeholders} filled in. S5B has two columns.
    cardText(id) {
      const card = data.cards[id];
      if (!card) return null;
      if (card.columns) return card.columns.map((column) => fillPlaceholders(column.text, values));
      return fillPlaceholders(card.text, values);
    },

    // 'photo' | 'slope' | 'traverse' | 'samples' | 'panoramas' | 'backdrop'
    // (the tablet's LAYERS tab), and 'route' | 'beacons'.
    setLayer(id, visible) {
      if (layerSet.has(id)) return layerSet.set(id, visible);
      if (!layers[id]) return false;
      layers[id].visible = !!visible;
      return true;
    },
    layerVisible: (id) => (layerSet.has(id) ? layerSet.get(id) : !!(layers[id] && layers[id].visible)),

    // Plans the route again in the page (A* over the terrain) instead of
    // using the stored line. For checks and for later steps that need routes
    // between arbitrary points; not run at load.
    planAgain() {
      const station = (id) => (id === 'START' ? { id, x: data.start.x, z: data.start.z } : { id, x: stations.get(id).x, z: stations.get(id).z });
      const fixed = data.route.ends.map((end) => station(end.id));
      return planRoute(routeGrid, fixed, pace);
    },

    // Triangles and draw calls this module adds to the scene.
    stats() {
      let triangles = 0;
      let drawCalls = 0;
      group.traverse((object) => {
        if (!object.isMesh) return;
        const geometry = object.geometry;
        triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
        drawCalls++;
      });
      return { triangles, drawCalls };
    },

    // Once per frame. viewer = world position of the head; dt = seconds since
    // the last frame (worked out from timeS if left out). No allocations.
    update(timeS, viewer, dt) {
      route.material.uniforms.uTime.value = timeS % 3600;
      beacons.update(viewer);

      if (dt === undefined) dt = lastTimeS === null ? 0 : Math.min(Math.max(timeS - lastTimeS, 0), 0.1);
      lastTimeS = timeS;

      // Mission time: the walking time of the ground covered since last frame.
      clock.track(viewer.x, viewer.z);

      // Slope underfoot (bilinear sample of the terrain slope) and its caution.
      const slope = sampleGrid(routeGrid, routeGrid.slopeDeg, viewer.x, viewer.z);
      const slopeDeg = Number.isFinite(slope) ? slope : 0;
      const band = slopeDeg > bands.redAbove ? 2 : slopeDeg >= bands.amberFrom ? 1 : 0;
      sinceSlopeFlashS += dt;
      if (band > cautionLevel) {
        const wasLevel = cautionLevel;
        cautionLevel = band;
        if (band === 2) slopeWarnings.red++;
        else slopeWarnings.amber++;
        // Red always shows; amber not more often than every few seconds.
        if (hud && (band === 2 || wasLevel === 0) && (band === 2 || sinceSlopeFlashS >= SLOPE_FLASH_GAP_S)) {
          hud.flash('SLOPE', { level: LEVELS[band] });
          sinceSlopeFlashS = 0;
        }
      } else if (band < cautionLevel) {
        const threshold = cautionLevel === 2 ? bands.redAbove : bands.amberFrom;
        if (slopeDeg < threshold - SLOPE_CLEAR_DEG) cautionLevel = band;
      }
      telemetry.slopeDeg = slopeDeg;
      telemetry.slopeLevel = LEVELS[band];

      // Straight-line distance to the next station.
      // MINERALS W3 HOOK: a deposit that comes before the next station is the target.
      const override = mission.nextOverride;
      const nextId = override ? override.id : progress.nextId;
      const target = override || (nextId === 'START' ? data.start : nextId ? stations.get(nextId) : null);
      telemetry.nextId = nextId;
      telemetry.nextDistanceM = target ? Math.hypot(target.x - viewer.x, target.z - viewer.z) : NaN;

      // Tablet and pointers: the desktop mouse, or each VR controller's ray.
      if (ui) {
        if (tablet) tablet.update(dt, viewer);
        if (stationSet) stationSet.update(dt, viewer);
        desktopPointer.update();
        const presenting = renderer.xr.isPresenting && xr;
        for (let i = 0; i < 2; i++) {
          if (presenting && xr.controllers[i].userData.handedness) ui.setPointerFromObject(1 + i, xr.controllers[i]);
          else ui.clearPointer(1 + i);
        }
        ui.update();
        // CONTROLS C1 HOOK: the long controller rays (xr.js) end on the panel they point at.
        if (presenting && xr.setRayLength) {
          for (let i = 0; i < 2; i++) {
            const pointer = ui.pointers[1 + i];
            if (pointer.active && pointer.hit.panel) xr.setRayLength(i, pointer.hit.distance);
          }
        }
      }

      if (!hud) return;
      telemetry.headingDeg = (hud.follow.headYawDeg + 360) % 360;
      const v = hud.values;
      v.leftMin = Math.floor(clock.timeLeftS / 60);
      v.homeMin = Math.ceil(clock.homeS / 60 - 1e-9); // never shown shorter than it is
      v.marginMin = Math.floor(clock.marginS / 60);
      v.status = clock.status;
      v.headingDeg = (Math.round(telemetry.headingDeg / 5) * 5) % 360;
      v.slopeDeg = Math.round(slopeDeg);
      v.slopeLevel = telemetry.slopeLevel;
      v.nextId = nextId || '';
      const d = telemetry.nextDistanceM;
      v.nextM = target ? (d < 100 ? Math.round(d) : Math.round(d / 10) * 10) : 0;
      // Cosmetic suit values (tagged SIM on the HUD): not data, not measured.
      // They only drift with the share of the EVA used so the panel is not static.
      const used = Math.min(Math.max(clock.elapsedS / clock.totalS, 0), 1);
      v.o2 = Math.round(100 - 85 * used);
      v.battery = Math.round(100 - 75 * used);
      v.tempC = Math.round(20 + 4 * used);
      // The HUD panels step aside while the tablet is being read: on desktop it fills the view,
      // in the headset the lit forearm screen would sit behind the head-fixed panels.
      hud.covered = !!tablet && (tablet.state.mount === 'desktop' ? tablet.state.slide > 0 : tablet.state.open);
      hud.update(dt, viewer);
    },
  };

  // ---- tablet, pointers and buttons (brief: TABLET, CONTROLS) --------------
  let ui = null;
  let tablet = null;
  let desktopPointer = null;
  let stationSet = null;
  if (camera && renderer) {
    ui = createUi({ scene });
    desktopPointer = attachDesktopPointer(ui, { camera, renderer });
    mission.ui = ui;
    if (player && wantTablet) {
      tablet = createTablet({ mission, ui, scene, camera, renderer, player, xr, patch, photo });
      mission.tablet = tablet;
    }
    if (xr) {
      // A trigger press that lands on a panel is used there and starts no teleport.
      xr.hooks.select = (controller, phase) => {
        if (phase !== 'start') return false;
        const index = 1 + xr.controllers.indexOf(controller);
        ui.setPointerFromObject(index, controller);
        return ui.press(index);
      };
      // Desktop: with the tablet up in front of the view, T / right mouse aims no teleport through it.
      if (tablet) xr.hooks.desktopAim = () => tablet.open;
      if (tablet) {
        // Left Y: tablet. Right A: scan. Right B: airlock door. (Left X stays the frame-time readout.)
        xr.hooks.button = (handedness, index) => {
          if (handedness === 'left' && index === 5) {
            tablet.toggle();
            return true;
          }
          if (handedness === 'right') {
            const action = index === 4 ? actions.scan : actions.door;
            if (action) action();
            return true;
          }
          return false;
        };
      }
    }
    if (tablet) {
      // Desktop: E scans, B is the airlock door (Tab / Y for the tablet are in tablet.js).
      window.addEventListener('keydown', (event) => {
        if (event.repeat || renderer.xr.isPresenting) return;
        if (event.code === 'KeyE' && actions.scan) actions.scan();
        else if (event.code === 'KeyB' && actions.door) actions.door();
      });
    }
    // Stations (B5 on): registry, cards, input after the panels, completion.
    if (player) {
      stationSet = await createStations({ mission, scene, camera, renderer, player, xr, patch, ui });
      mission.stationSet = stationSet;
    }
  }

  return mission;
}

// The mineral-sampling objective: the CRISM layer, the cabin wall map and shelf,
// the route through the picked deposits, and collecting / shelving / debrief.
// Called from main.js after createCabin (the wall map and the shelf live in the
// cabin). Each part is installed on its own, so one that fails leaves the rest
// and the station walk usable. Without minerals.json nothing is added.
export async function installMineralObjective(mission, deps) {
  const state = ensureMineralState(mission);
  const full = { THREE, ui: mission.ui, stations: mission.stationSet, ...deps };
  const out = { state, minerals: null, route: null, cabinMinerals: null, sampling: null };
  try {
    out.minerals = await installMinerals(mission, full);
  } catch (error) {
    console.error(error);
  }
  if (!state.data) return out;
  try {
    out.route = installMineralRoute(mission, full);
  } catch (error) {
    console.error(error);
  }
  if (full.cabin) {
    try {
      out.cabinMinerals = installCabinMinerals(mission, full);
    } catch (error) {
      console.error(error);
    }
    try {
      out.sampling = installSampling(mission, { ...full, cabinMinerals: out.cabinMinerals });
    } catch (error) {
      console.error(error);
    }
  }
  // The cabin hologram's blue dots follow the route when it is re-planned.
  if (full.cabin && typeof full.cabin.setHologramRoute === 'function' && typeof mission.setRoute === 'function') {
    const setRoute = mission.setRoute.bind(mission);
    mission.setRoute = (points, options) => {
      const result = setRoute(points, options);
      full.cabin.setHologramRoute(points);
      return result;
    };
  }
  mission.mineralObjective = out;
  return out;
}
