import * as THREE from 'three';
import { PALETTE, css, lowPolyMaterial, mergeParts } from '../lowpoly.js';
import { FONT } from '../ui.js';
import { buildRibbonGeometry, createRibbon } from '../ribbon.js';
import { fillPlaceholders } from '../mission.js';

// S2 READ THE GROUND (brief: THE MISSION / S2).
//
// 1. Turn on the slope layer (tablet LAYERS tab; A or E here does the same).
// 2. Two signs appear, DIRECT and PLANNED, and the straight line from the
//    start to the core stop is drawn on the ground. Point at a sign and press the
//    trigger (click on desktop).
//    DIRECT:  an amber or red SLOPE CAUTION on the HUD (by how steep the
//             straight line gets) and one more slope warning in the count.
//    PLANNED: the clock is charged the extra walking time of the planned
//             route over the straight line ({extra_min}).
//    The time difference is whatever the terrain and the pace rule give
//    (mission.summary), not a made-up penalty. Either way the stop is done;
//    there is no game over.
//
// Every number shown comes from mission.values / mission.summary.

const SIGN_FROM_BEACON_M = 8;
const SIGN_BOARD_Y = 2.7; // board centre above the ground
const SIGN_W = 3.6;
const SIGN_H = 1.8;
const SIGN_HIT_RADIUS_M = 1.9;
const LINE_WIDTH_M = 0.7;

function signGeometry(accent) {
  return mergeParts([
    { geometry: new THREE.CylinderGeometry(0.5, 0.7, 0.5, 6), color: PALETTE.slate, y: 0.1 },
    { geometry: new THREE.CylinderGeometry(0.14, 0.2, 1.8, 6), color: PALETTE.offWhite, y: 1.0 },
    { geometry: new THREE.BoxGeometry(SIGN_W + 0.3, SIGN_H + 0.3, 0.22), color: accent, y: SIGN_BOARD_Y, z: -0.13 },
    { geometry: new THREE.BoxGeometry(SIGN_W + 0.08, SIGN_H + 0.08, 0.1), color: PALETTE.slate, y: SIGN_BOARD_Y, z: -0.06 },
  ]);
}

export function createStation(ctx) {
  const { mission, patch, station, camera } = ctx;
  const data = mission.data;
  const v = mission.values;
  const summary = mission.summary;
  const bands = data.terrain.slopeBandsDeg;
  const limit = mission.pace.slopeLimitDeg;

  const card = data.cards[station.card];
  const cards = [{ title: card.title, body: fillPlaceholders(card.text, v), source: card.source }];

  // Real difference between the two ways, from the terrain and the pace rule.
  const directS = summary.direct.minutes * 60;
  const plannedS = summary.planned.minutes * 60;
  const extraS = plannedS - directS; // > 0: the planned route takes longer
  const directLevel = v.direct_max_slope > bands.redAbove ? 'red' : 'amber';

  const group = new THREE.Group();
  group.name = 'station-S2';

  // ---- the straight line on the ground ---------------------------------------
  const line = createRibbon(buildRibbonGeometry(patch, [data.route.direct.line], { widthM: LINE_WIDTH_M, stepM: 2 }), {
    color: PALETTE.offWhite,
    chevrons: false,
    liftM: 0.11,
    liftPerM: 0.005,
    edge: 0,
  });
  line.name = 'S2-direct-line';
  line.visible = false;
  group.add(line);

  // ---- the two signs -----------------------------------------------------------
  function signTexture(word, sub, accent, chosen) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 384;
    const c = canvas.getContext('2d');
    c.fillStyle = css(PALETTE.slate);
    c.fillRect(0, 0, 768, 384);
    c.fillStyle = css(accent);
    c.fillRect(0, 0, 768, 22);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = css(PALETTE.offWhite);
    c.font = `bold 128px ${FONT}`;
    c.fillText(word, 384, 158);
    c.fillStyle = css(accent);
    let px = 66;
    c.font = `bold ${px}px ${FONT}`;
    const widest = Math.max(...sub.map((text) => c.measureText(text).width));
    if (widest > 720) px = Math.floor((px * 720) / widest);
    c.font = `bold ${px}px ${FONT}`;
    sub.forEach((text, i) => c.fillText(text, 384, 252 + i * 78));
    if (chosen) {
      c.strokeStyle = css(PALETTE.offWhite);
      c.lineWidth = 14;
      c.strokeRect(7, 7, 754, 370);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  function makeSign(id, word, sub, accent, x, z) {
    const sign = new THREE.Group();
    sign.name = `S2-sign-${id}`;
    sign.position.set(x, patch.groundY(x, z), z);
    const post = new THREE.Mesh(signGeometry(accent), lowPolyMaterial());
    post.name = `S2-sign-${id}-post`;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(SIGN_W, SIGN_H), new THREE.MeshBasicMaterial({ map: signTexture(word, sub, accent, false), fog: false, toneMapped: false }));
    face.name = `S2-sign-${id}-face`;
    face.position.set(0, SIGN_BOARD_Y, 0);
    sign.add(post, face);
    sign.visible = false;
    group.add(sign);
    return { id, word, sub, accent, group: sign, face, centre: new THREE.Vector3(x, sign.position.y + SIGN_BOARD_Y, z) };
  }

  // DIRECT stands toward the place where the straight line first gets too
  // steep; PLANNED stands beside the blue route just past the beacon.
  const steep = station.directSteepPoint || { x: data.route.direct.line[1][0], z: data.route.direct.line[1][1] };
  const toSteep = Math.hypot(steep.x - station.x, steep.z - station.z) || 1;
  const directAt = { x: station.x + ((steep.x - station.x) / toSteep) * SIGN_FROM_BEACON_M, z: station.z + ((steep.z - station.z) / toSteep) * SIGN_FROM_BEACON_M };
  const points = data.route.points;
  const ahead = points[Math.min((station.routeIndex ?? 0) + 4, points.length - 1)];
  const further = points[Math.min((station.routeIndex ?? 0) + 5, points.length - 1)];
  let ax = further[0] - ahead[0];
  let az = further[1] - ahead[1];
  const al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;
  // Beside the route, on the side away from the DIRECT sign.
  const side = (directAt.x - ahead[0]) * -az + (directAt.z - ahead[1]) * ax > 0 ? -1 : 1;
  const plannedAt = { x: ahead[0] + -az * 3 * side, z: ahead[1] + ax * 3 * side };

  const signs = [
    makeSign('direct', 'DIRECT', ['straight line', `up to ${v.direct_max_slope} degrees`], PALETTE.amber, directAt.x, directAt.z),
    makeSign('planned', 'PLANNED', [`under ${limit} degrees`, `+${v.extra_min} min`], PALETTE.routeBlueLight, plannedAt.x, plannedAt.z),
  ];

  // ---- state ----------------------------------------------------------------------
  const state = { entered: false, slopeSeen: false, choice: null, chargedS: 0 };
  const toStop = String(data.route.direct.to).replace(/^S/, ''); // the stop the straight line runs to (from the data)
  const PROMPT = {
    slopeVr: 'Step 1 of 2: turn on the slope layer. Tablet, LAYERS tab (or press A).',
    slopeDesk: 'Step 1 of 2: turn on the slope layer. Tablet (Tab), LAYERS (or press E).',
    chooseVr: `Step 2 of 2: which way to stop ${toStop}? Point at the DIRECT or PLANNED sign and press the trigger.`,
    chooseDesk: `Step 2 of 2: which way to stop ${toStop}? Click the DIRECT or PLANNED sign.`,
    done: '',
  };

  function showChoices() {
    const on = state.entered && state.slopeSeen;
    line.visible = on;
    for (const sign of signs) sign.group.visible = on;
  }
  function sawSlope() {
    if (state.slopeSeen) return;
    state.slopeSeen = true;
    showChoices();
  }

  // The tablet already listens to the layer switches: wrap its callback.
  const layerSet = mission.layerSet;
  const before = layerSet.onChange;
  layerSet.onChange = (id, on) => {
    if (before) before(id, on);
    if (id === 'slope' && on && state.entered) sawSlope();
  };

  function choose(sign) {
    if (state.choice) return false;
    state.choice = sign.id;
    const lines = [];
    if (sign.id === 'direct') {
      lines.push(`Chose the straight line: it reaches ${v.direct_max_slope} degrees, above the ${limit} degree limit (ASSUMPTION).`);
      mission.slopeWarnings[directLevel]++;
      ctx.flash('SLOPE', { level: directLevel });
      if (extraS < 0) state.chargedS = -extraS; // the straight line is the slower one here
    } else {
      lines.push(`Chose the planned route: it stays under ${limit} degrees (ASSUMPTION).`);
      if (extraS > 0) state.chargedS = extraS;
    }
    if (state.chargedS > 0) mission.clock.charge(state.chargedS, { reason: 'other' });
    lines.push(`The planned route takes ${v.extra_min} more minutes than the straight line.`);
    PROMPT.done =
      sign.id === 'direct'
        ? `You chose DIRECT: slope caution, up to ${v.direct_max_slope} degrees. The planned route would take ${v.extra_min} more minutes.`
        : `You chose PLANNED: under ${limit} degrees, ${v.extra_min} more minutes on the clock.`;
    // Mark the chosen sign, grey the other (once, not per frame).
    for (const other of signs) {
      if (other === sign) {
        const old = other.face.material.map;
        other.face.material.map = signTexture(other.word, other.sub, other.accent, true);
        old.dispose();
      } else other.face.material.color.setScalar(0.45);
    }
    ctx.log({ title: `Stop ${station.id.replace(/^S/, '')}: ${station.title}`, lines });
    ctx.done();
    return true;
  }

  const eye = new THREE.Vector3();
  const toCentre = new THREE.Vector3();

  return {
    id: 'S2',
    title: station.title,
    group,
    state,
    signs,
    line,
    cards: () => cards,
    prompt() {
      if (state.choice) return PROMPT.done;
      const vr = ctx.renderer && ctx.renderer.xr.isPresenting;
      if (!state.slopeSeen) return vr ? PROMPT.slopeVr : PROMPT.slopeDesk;
      return vr ? PROMPT.chooseVr : PROMPT.chooseDesk;
    },
    onEnter() {
      state.entered = true;
      if (layerSet.get('slope')) state.slopeSeen = true; // already on: straight to the choice
      showChoices();
    },
    onLeave() {
      // Away from the stop the signs and the straight line are put away (the line runs all the way to the core stop).
      state.entered = false;
      showChoices();
    },
    update() {
      if (!signs[0].group.visible) return;
      // The signs turn to face the explorer (about the vertical axis only).
      camera.getWorldPosition(eye);
      for (let i = 0; i < signs.length; i++) {
        const sign = signs[i].group;
        sign.rotation.y = Math.atan2(eye.x - sign.position.x, eye.z - sign.position.z);
      }
    },
    onInput(kind, info) {
      if (state.choice) return false;
      if (kind === 'scan') {
        layerSet.toggle('slope');
        return true;
      }
      if (kind !== 'select' || !state.slopeSeen) return false;
      // Nearest sign the ray passes through.
      let best = null;
      let bestD = Infinity;
      for (const sign of signs) {
        toCentre.copy(sign.centre).sub(info.ray.origin);
        const along = toCentre.dot(info.ray.direction);
        if (along <= 0) continue;
        if (info.ray.distanceSqToPoint(sign.centre) > SIGN_HIT_RADIUS_M * SIGN_HIT_RADIUS_M) continue;
        if (along < bestD) {
          best = sign;
          bestD = along;
        }
      }
      return best ? choose(best) : false;
    },
    isDone: () => state.choice !== null,
  };
}
