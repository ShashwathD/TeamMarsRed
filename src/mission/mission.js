import * as THREE from 'three';
import { createRouteGrid, paceFromAssumptions, planRoute, routeSummary } from './route.js';
import { buildRibbonGeometry, createRibbon } from './ribbon.js';
import { createBeacons } from './beacons.js';
import { PALETTE } from './lowpoly.js';

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

export async function createMission({ site, patch, scene, renderer }) {
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

  const layers = { route, traverse, beacons: beacons.group };

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

    // Card text with its {placeholders} filled in. S5B has two columns.
    cardText(id) {
      const card = data.cards[id];
      if (!card) return null;
      if (card.columns) return card.columns.map((column) => fillPlaceholders(column.text, values));
      return fillPlaceholders(card.text, values);
    },

    setLayer(id, visible) {
      if (!layers[id]) return false;
      layers[id].visible = !!visible;
      return true;
    },
    layerVisible: (id) => !!(layers[id] && layers[id].visible),

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

    // Once per frame. viewer = world position of the head.
    update(timeS, viewer) {
      route.material.uniforms.uTime.value = timeS % 3600;
      beacons.update(viewer);
    },
  };
  return mission;
}
