import { PALETTE } from '../lowpoly.js';
import { buildRibbonGeometry } from '../ribbon.js';
import { nearestOnLine } from '../route.js';

// Station S3, FOLLOW THE ROVER (brief: S3).
//
// On arrival the rover's real path (the orange line) is switched on in the
// world. The action is a scan (A on the right controller, E on desktop): the
// HUD flashes "SCAN" and a pulse of bright arrows runs along the rover's path from this
// station toward the next one.
//
// The pulse is one small ribbon laid on the stretch of the rover path between
// the two stations, drawn only while it runs. Its shape is built once; a scan
// only moves three uniforms, so nothing is allocated per frame.
//
// {sol_min} and {sol_max} on the card are worked out here from the sols on
// the traverse lines in the mission file (the part of the path inside the patch).

const PULSE_WIDTH_M = 1.5; // three times the 0.5 m rover path, so it reads from standing height
const FRONT_RUN_S = 2.6; // time for the front of the pulse to reach the next station
const FRONT_MIN_SPEED = 20; // metres per second
const FRONT_MAX_SPEED = 160;
const HOLD_S = 1.6; // the arrows keep running this long after the front has arrived
const FADE_S = 0.6; // and fade out over the last part of that
const ARROW_PERIOD_M = 7; // one bright arrow every so many metres
const ARROW_SPEED = 14; // metres per second, toward the next station

const VERTEX = /* glsl */ `
  uniform float uLiftM;
  uniform float uLiftPerM;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += uLiftM + uLiftPerM * distance(world.xyz, cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

// vUv.y is metres from this station along the rover path toward the next one.
// Bright arrows run along the ribbon toward the next station, behind a front
// that sweeps out from this station.
const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform float uFrontM;    // how far the front of the pulse has got
  uniform float uTravelM;   // how far the arrows have moved
  uniform float uPeriodM;
  uniform float uSkewM;     // arrow shape: the middle of the ribbon leads
  uniform float uLengthM;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    float across = abs(vUv.x - 0.5) * 2.0;
    float s = vUv.y + across * uSkewM;
    float phase = (s - uTravelM) / uPeriodM;
    float width = fwidth(phase);
    float f = fract(phase);
    float band = smoothstep(0.0, width, f) * (1.0 - smoothstep(0.5, 0.5 + width, f));
    // Far away the arrows are finer than a pixel: show their average, no shimmer.
    band = mix(0.5, band, 1.0 - smoothstep(0.35, 0.9, width));
    float behind = uFrontM - s;                         // metres behind the front
    float reached = smoothstep(0.0, 1.0, behind);
    float flare = reached * exp(-max(behind, 0.0) / 12.0); // the front itself is brightest
    float ends = smoothstep(0.0, 1.5, vUv.y) * (1.0 - smoothstep(uLengthM - 3.0, uLengthM, vUv.y));
    float glow = max(band, flare);
    float alpha = glow * reached * ends * uFade * (1.0 - smoothstep(0.8, 1.0, across));
    gl_FragColor = vec4(mix(uColor, uHot, max(flare, 0.55)), alpha);
    #include <colorspace_fragment>
  }`;

// The stretch of the rover path from the point nearest `from` to the point
// nearest `to`, as [[x, z], ...] in that order; null if there is none.
function pathBetween(lines, preferred, from, to) {
  let line = lines[preferred] ? lines[preferred].points : null;
  let a = line ? nearestOnLine(line, from.x, from.z) : null;
  for (const candidate of lines) {
    const hit = nearestOnLine(candidate.points, from.x, from.z);
    if (!a || hit.distanceM < a.distanceM - 0.01) {
      a = hit;
      line = candidate.points;
    }
  }
  if (!line) return null;
  const b = nearestOnLine(line, to.x, to.z);
  const points = [[a.x, a.z]];
  const forward = b.segment + b.t >= a.segment + a.t; // the way the line is stored
  if (forward) for (let i = a.segment + 1; i <= b.segment; i++) points.push([line[i][0], line[i][1]]);
  else for (let i = a.segment; i > b.segment; i--) points.push([line[i][0], line[i][1]]);
  points.push([b.x, b.z]);
  // Drop points that repeat the one before (a station exactly on a vertex).
  const clean = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-6);
  if (clean.length < 2) return null;
  return { points: clean, forward, startOffM: a.distanceM, endOffM: b.distanceM };
}

export function createStation(ctx) {
  const { THREE, mission, patch, station } = ctx;
  const data = mission.data;
  const card = data.cards[station.card] || data.cards.S3;

  // Sols of the part of the traverse inside the patch, from the data.
  let solMin = Infinity;
  let solMax = -Infinity;
  for (const line of data.traverse.lines) {
    solMin = Math.min(solMin, line.solFirst);
    solMax = Math.max(solMax, line.solLast);
  }
  const values = { ...mission.values, sol_min: solMin, sol_max: solMax };
  const fill = (text) => text.replace(/\{(\w+)\}/g, (whole, name) => (values[name] === undefined || values[name] === null ? whole : String(values[name])));
  const cards = [
    {
      title: card.title,
      body: fill(card.text),
      source: card.source,
      action: 'Press A to scan (E on desktop).', // extra to the contract: the framework may show it
    },
  ];

  // The station after this one on the route (the pulse runs toward it).
  const order = data.route.order;
  const nextId = order[order.indexOf(station.id) + 1] || null;
  const next = nextId === 'START' ? data.start : nextId ? mission.stations.get(nextId) : null;

  const group = new THREE.Group();
  group.name = 'station-S3';

  const path = next ? pathBetween(data.traverse.lines, station.traverseLine, station, next) : null;
  let pulseMesh = null;
  const pulse = {
    active: false,
    t: 0, // seconds since the scan
    headM: 0, // how far the front has got along the rover path, toward the next station
    lengthM: 0,
    speed: 0, // of the front, metres per second
    durationS: 0,
    scans: 0,
    nextId,
    from: path ? { x: path.points[0][0], z: path.points[0][1] } : null,
    to: path ? { x: path.points[path.points.length - 1][0], z: path.points[path.points.length - 1][1] } : null,
    startOffM: path ? path.startOffM : NaN,
    endOffM: path ? path.endOffM : NaN,
  };
  if (path) {
    const geometry = buildRibbonGeometry(patch, [path.points], { widthM: PULSE_WIDTH_M });
    pulse.lengthM = geometry.userData.lengthM;
    pulse.speed = Math.min(Math.max(pulse.lengthM / FRONT_RUN_S, FRONT_MIN_SPEED), FRONT_MAX_SPEED);
    pulse.durationS = pulse.lengthM / pulse.speed + HOLD_S;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(PALETTE.amber) },
        uHot: { value: new THREE.Color(PALETTE.offWhite) },
        uFrontM: { value: 0 },
        uTravelM: { value: 0 },
        uPeriodM: { value: ARROW_PERIOD_M },
        uSkewM: { value: 1.6 },
        uFade: { value: 1 },
        uLengthM: { value: pulse.lengthM },
        uLiftM: { value: 0.2 }, // above the rover path (0.14) and the route (0.08)
        uLiftPerM: { value: 0.007 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    pulseMesh = new THREE.Mesh(geometry, material);
    pulseMesh.name = 'station-S3-pulse';
    pulseMesh.frustumCulled = false; // lifted in the shader; drawn only while a pulse runs
    pulseMesh.renderOrder = 5;
    pulseMesh.visible = false;
    group.add(pulseMesh);
  }

  let done = false;
  let entered = false;

  function setUniforms() {
    const uniforms = pulseMesh.material.uniforms;
    uniforms.uFrontM.value = pulse.t * pulse.speed;
    uniforms.uTravelM.value = pulse.t * ARROW_SPEED;
    uniforms.uFade.value = Math.min((pulse.durationS - pulse.t) / FADE_S, 1);
  }

  function scan() {
    // The pulse runs on the rover path: make sure it is on the ground to see.
    mission.layerSet.reveal('traverse');
    if (!mission.layerVisible('traverse')) mission.setLayer('traverse', true);
    ctx.flash('SCAN');
    pulse.scans++;
    if (pulseMesh) {
      pulse.t = 0;
      pulse.headM = 0;
      pulse.active = true;
      setUniforms();
      pulseMesh.visible = true;
    }
    if (!done) {
      done = true;
      ctx.log({
        title: 'Rover path scanned',
        lines: [`Rover drove in this patch, sols ${solMin} to ${solMax}.`, 'Source: NASA/JPL MMGIS traverse.'],
        station: station.id,
      });
      ctx.done();
    }
    return true;
  }

  return {
    id: station.id,
    title: station.title,
    group,
    pulse,
    values: { sol_min: solMin, sol_max: solMax },
    cards: () => cards,

    onEnter() {
      entered = true;
      // Brief, LAYER BEHAVIOUR 3: the rover path is off in the world until S3.
      mission.layerSet.reveal('traverse');
    },
    onLeave() {
      entered = false;
    },

    // No allocations: three uniforms move while a pulse runs.
    update(dt) {
      if (!pulse.active) return;
      pulse.t += dt;
      if (pulse.t >= pulse.durationS) {
        pulse.active = false;
        pulseMesh.visible = false;
        return;
      }
      pulse.headM = Math.min(pulse.t * pulse.speed, pulse.lengthM);
      setUniforms();
    },

    onInput(kind) {
      if (kind === 'scan') return scan();
      return false;
    },

    isDone: () => done,
    isEntered: () => entered,
  };
}
