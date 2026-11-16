import * as THREE from 'three';
import { PALETTE, css } from '../lowpoly.js';
import { THEME, createPanel, fillChamfer, fitText, setFont, wrapLines } from '../ui.js';
import { fillPlaceholders } from '../mission.js';
import { markBeaconDone } from '../beacons.js';
import { createSampleTube } from './tube.js';

// STATION FRAMEWORK (brief: build step B5).
//
// ADDING A STATION = one new file in this folder that exports
//
//   export function createStation(ctx) {
//     return {
//       id, title,
//       cards(),            // -> [{ title, body, source, columns? }]  (columns: [{ heading, text }, { heading, text }])
//       onEnter(), onLeave(),
//       update(dt),         // every frame, also while the explorer is elsewhere: keep it cheap
//       onInput(kind, info),// -> true if the station used the press
//       isDone(),
//       group,              // THREE.Group of the station's own world objects; added to the scene here
//       prompt(),           // optional: one line saying what to do now (shown on the card); return a stored string
//       radiusM,            // optional: activation radius if the default does not suit
//     };
//   }
//
// plus ONE line in REGISTRY below. Nothing else changes.
//
// ctx = { THREE, mission, patch, station (this station's entry in the mission
//   file), camera, hand, flash(kind, options), log(entry), done() } and the
//   extras { scene, renderer, ui, refresh(), makeTube(options) }.
//   - hand = { hold(object3D), release(), held }: hold() puts the object in the
//     right hand (the right controller's grip in VR; lower right of the view
//     on desktop) at the hand's origin; release() takes it out of the hand,
//     detaches it from the scene and returns it (add it back wherever it goes).
//   - flash(kind, options) is mission.hud.flash ('SLOPE' | 'SCAN' | 'SAMPLE' | 'RETURN').
//   - log({ title, lines }) writes a field-notebook entry for this station.
//   - done() completes the station: 20 minutes of station time (once), the
//     beacon is marked, a notebook entry is written if the station wrote none
//     itself, and the HUD points at the next stop.
//   - refresh() redraws the card (after cards() or prompt() change outside an input).
//
// INPUT (who gets a press), in this order:
//   1. TABLET and every other UI panel (mission.ui): a trigger press or click
//      that lands on a panel is used there.
//   2. The ACTIVE STATION: onInput(kind, info).
//        kind 'select' - right or left trigger / left mouse click; info.ray is the pointing ray (world space)
//        kind 'grip'   - right grip / G
//        kind 'scan'   - A on the right controller / E
//      info = { ray (THREE.Ray, world space; reused, copy it to keep it), device ('vr' | 'desktop') }.
//   3. TELEPORT (trigger held on open ground, T or right mouse on desktop) if
//      the station returned false.
//   B (airlock door) stays with mission.actions.door.
//
// A station becomes ACTIVE when the explorer is within its radius of the
// beacon, however they got there (walking, teleport arc or a map teleport),
// and stops being active a few metres beyond it. Stations can be done in any
// order and none blocks another: the HUD's NEXT simply moves on to the first
// stop not yet done after the one just finished.
//
// The station card is a hologram panel: in VR it stands up from the top edge
// of the forearm tablet; on desktop it sits at the right of the view (and
// makes way while the tablet is up).

// THE SINGLE LIST. Stations whose file is not there yet (or fails to load) get
// a placeholder that shows the card text and can be logged with A / E.
const REGISTRY = [
  { id: 'S2', load: () => import('./s2.js') },
  { id: 'S3', load: () => import('./s3.js') },
  { id: 'S4', load: () => import('./s4.js') },
  { id: 'S5', load: () => import('./s5.js') },
];

const DEFAULT_RADIUS_M = 14; // a map teleport lands 5 to 8 m short of the beacon
const LEAVE_EXTRA_M = 6;
const SITE_MARGIN_M = 8; // the radius also covers the station's own sample sites and panoramas by this much
const BRIEFING_RADIUS_M = 12;
const PATH_STEP_M = 10; // a point of the walked path (for the debrief) every this many metres

const W = 1280;
const H = 896;
const CARD_W_M = 0.4;
const CARD_H_M = (CARD_W_M * H) / W;
const CARD_TILT = THREE.MathUtils.degToRad(42); // VR: how far the card stands up from the tablet's plane
const BODY_PX = [44, 42, 40, 38, 36, 34];

// The S1 briefing card as data: { id, title, body, source }. The cabin shows it on its hologram.
export function briefingCard(mission) {
  const card = mission.data.cards.S1;
  return { id: 'S1', title: card.title, body: fillPlaceholders(card.text, mission.values), source: card.source };
}

// Cards for a station straight from the mission file (used by placeholders; real stations may use it too).
export function cardsFromData(mission, station) {
  const ids = Array.isArray(station.card) ? station.card : [station.card];
  return ids
    .map((id) => mission.data.cards[id])
    .filter(Boolean)
    .map((card) => ({
      title: card.title,
      body: card.text ? fillPlaceholders(card.text, mission.values) : '',
      columns: card.columns ? card.columns.map((column) => ({ heading: column.heading, text: fillPlaceholders(column.text, mission.values) })) : undefined,
      source: card.source,
    }));
}

function placeholderStation(ctx) {
  const station = ctx.station;
  const cards = cardsFromData(ctx.mission, station);
  let done = false;
  const todo = 'The activity for this stop is not built yet. Press A (E on a keyboard) to log the visit and move on.';
  return {
    id: station.id,
    title: station.title,
    placeholder: true,
    group: new THREE.Group(),
    cards: () => cards,
    prompt: () => (done ? '' : todo),
    onEnter() {},
    onLeave() {},
    update() {},
    onInput(kind) {
      if (kind !== 'scan' || done) return false;
      done = true;
      ctx.done();
      return true;
    },
    isDone: () => done,
  };
}

export async function createStations({ mission, scene, camera, renderer, player = null, xr = null, patch, ui = null }) {
  const data = mission.data;
  const tablet = mission.tablet;
  const order = data.route.order.filter((id) => id !== 'START');

  // mission.stats: the debrief's numbers (parallel-work contract). mission.stats
  // was already a function (triangle count of the mission group, used by older
  // tests), so the fields are put on that function: mission.stats.coresLogged++
  // and mission.stats() both work.
  const stats = mission.stats || (mission.stats = {});
  const statDefaults = { stationsDone: 0, stationCount: 0, coresLogged: 0, coreCount: data.cores.length, slopeWarnings: 0, fieldCheck: null, distanceM: 0, path: [] };
  for (const key of Object.keys(statDefaults)) if (stats[key] === undefined) stats[key] = statDefaults[key];

  // ---- the hand ---------------------------------------------------------------
  const handAnchor = new THREE.Group();
  handAnchor.name = 'mission-hand';
  const grips = [];
  if (player && player.rig && renderer) {
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      grip.name = `controller-grip-${i}`;
      player.rig.add(grip);
      grips.push(grip);
    }
  }
  let handParent = null;
  function placeHand() {
    let parent = camera;
    if (renderer.xr.isPresenting && xr) {
      let index = -1;
      for (let i = 0; i < 2; i++) if (xr.controllers[i].userData.handedness === 'right') index = i;
      if (index < 0) for (let i = 0; i < 2; i++) if (index < 0 && xr.controllers[i].userData.handedness) index = i; // no right hand: any hand
      if (index >= 0) parent = grips[index] || xr.controllers[index];
    }
    if (parent === handParent) return;
    handParent = parent;
    parent.add(handAnchor);
    if (parent === camera) {
      handAnchor.position.set(0.2, -0.16, -0.45);
      handAnchor.rotation.set(0.35, 0, -0.35);
    } else {
      // Grip space: tilt a held tube forward out of the fist.
      handAnchor.position.set(0, 0, -0.02);
      handAnchor.rotation.set(-1.0, 0, 0);
    }
  }
  let held = null;
  const hand = {
    anchor: handAnchor,
    get held() {
      return held;
    },
    hold(object) {
      if (!object) return null;
      if (held && held !== object) hand.release();
      placeHand();
      held = object;
      handAnchor.add(object);
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.visible = true;
      return object;
    },
    release() {
      const object = held;
      held = null;
      if (object) handAnchor.remove(object);
      return object;
    },
  };

  // ---- the card -----------------------------------------------------------------
  const panel = createPanel({ name: 'station-card', widthPx: W, heightPx: H, widthM: CARD_W_M, anisotropy: renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1, renderOrder: 940 });
  panel.mesh.material.alphaTest = 0.5; // the cut corners are see-through
  panel.mesh.visible = false;
  if (ui) ui.add(panel);
  let cardMount = null; // 'desktop' | 'arm' | 'world'
  let cardDirty = false;
  let placeWorldNow = false;
  // What the card shows now (also for tests).
  const shown = { key: null, badge: '', title: '', cards: [], page: 0, prompt: '', done: false, bodyPx: 0, clipped: false, text: null };

  function drawCard() {
    cardDirty = false;
    const card = shown.cards[shown.page] || { title: shown.title, body: '', source: '' };
    const ctx = panel.begin();
    ctx.clearRect(0, 0, W, H);
    fillChamfer(ctx, 6, 6, W - 12, H - 12, { cut: 40, fill: THEME.bg, stroke: shown.done ? THEME.dim : THEME.accent, lineWidth: 10 });

    // Header: badge, title, pager.
    fillChamfer(ctx, 34, 32, 132, 100, { cut: 22, fill: shown.done ? THEME.dim : THEME.accent });
    ctx.fillStyle = THEME.dark;
    ctx.textAlign = 'center';
    fitText(ctx, shown.badge, 100, 106, 68, 110, { weight: 'bold', minPx: 40 });
    ctx.textAlign = 'left';
    const many = shown.cards.length > 1;
    const pagerW = many ? 300 : 0;
    ctx.fillStyle = THEME.text;
    fitText(ctx, String(card.title || shown.title).toUpperCase(), 192, 104, 60, W - 192 - 44 - pagerW, { weight: 'bold', minPx: 42 });
    if (many) {
      const x = W - 40 - 280;
      fillChamfer(ctx, x, 36, 280, 92, { cut: 18, fill: THEME.card, stroke: THEME.accent, lineWidth: 4 });
      ctx.fillStyle = THEME.text;
      ctx.textAlign = 'center';
      setFont(ctx, 44, 'bold');
      ctx.fillText(`CARD ${shown.page + 1}/${shown.cards.length} >`, x + 140, 98);
      ctx.textAlign = 'left';
      panel.region('card-next', x, 36, 280, 92, () => set.nextCard());
    }

    // Source: the last thing on the card.
    const left = 48;
    const room = W - 2 * left;
    setFont(ctx, 34);
    let sourceLines = card.source ? wrapLines(ctx, card.source, room) : [];
    let sourceLh = 42;
    if (sourceLines.length > 2) {
      // A long source list: smaller, but always whole.
      setFont(ctx, 30);
      sourceLines = wrapLines(ctx, card.source, room);
      sourceLh = 38;
    }
    let bottom = H - 36;
    ctx.fillStyle = THEME.dim;
    for (let i = 0; i < sourceLines.length; i++) ctx.fillText(sourceLines[i], left, bottom - 10 - (sourceLines.length - 1 - i) * sourceLh);
    bottom -= sourceLines.length * sourceLh + 16;

    // What to do now (or DONE), in a band above the source.
    const promptText = shown.done ? `DONE. ${shown.prompt}`.trim() : shown.prompt;
    if (promptText) {
      setFont(ctx, 38, 'bold');
      const lines = wrapLines(ctx, promptText, room - 48).slice(0, 3);
      const bandH = lines.length * 48 + 28;
      fillChamfer(ctx, left - 14, bottom - bandH, room + 28, bandH, { cut: 16, fill: THEME.card, stroke: shown.done ? THEME.dim : THEME.warm, lineWidth: 4 });
      ctx.fillStyle = shown.done ? THEME.dim : css(PALETTE.amber);
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], left + 10, bottom - bandH + 52 + i * 48);
      bottom -= bandH + 18;
    }

    // Body: the largest size that fits between the header and the band.
    const top = 160;
    let used = BODY_PX[BODY_PX.length - 1];
    let clipped = true;
    for (const px of BODY_PX) {
      if (bodyHeight(ctx, card, px, room) <= bottom - top) {
        used = px;
        clipped = false;
        break;
      }
    }
    drawBody(ctx, card, used, left, top, room, bottom);
    shown.bodyPx = used;
    shown.clipped = clipped;
    shown.text = { title: card.title || shown.title, body: card.body || '', columns: card.columns || null, source: card.source || '', prompt: promptText };
    panel.end();
  }

  const lineHeight = (px) => Math.round(px * 1.3);
  function bodyHeight(ctx, card, px, room) {
    let h = 0;
    setFont(ctx, px);
    if (card.body) h += wrapLines(ctx, card.body, room).length * lineHeight(px);
    if (card.columns) {
      const colW = (room - 48) / card.columns.length;
      let tallest = 0;
      for (const column of card.columns) {
        setFont(ctx, px, 'bold');
        let c = wrapLines(ctx, column.heading, colW).length * lineHeight(px) + 10;
        setFont(ctx, px);
        c += wrapLines(ctx, column.text, colW).length * lineHeight(px);
        tallest = Math.max(tallest, c);
      }
      h += (card.body ? 16 : 0) + tallest;
    }
    return h;
  }
  function drawBody(ctx, card, px, left, top, room, bottom) {
    const lh = lineHeight(px);
    let y = top + px;
    const put = (text, x, width, color, weight) => {
      setFont(ctx, px, weight);
      ctx.fillStyle = color;
      for (const line of wrapLines(ctx, text, width)) {
        if (y > bottom) return;
        ctx.fillText(line, x, y);
        y += lh;
      }
    };
    if (card.body) put(card.body, left, room, THEME.text, 'normal');
    if (card.columns) {
      if (card.body) y += 16;
      const colW = (room - 48) / card.columns.length;
      const y0 = y;
      card.columns.forEach((column, i) => {
        y = y0;
        const x = left + i * (colW + 48);
        put(column.heading, x, colW, THEME.accent, 'bold');
        y += 10;
        put(column.text, x, colW, THEME.text, 'normal');
      });
    }
  }

  function mountCard(kind) {
    cardMount = kind;
    const mesh = panel.mesh;
    mesh.scale.setScalar(1);
    mesh.quaternion.identity();
    if (kind === 'desktop') {
      camera.add(mesh);
    } else if (kind === 'arm') {
      // Stands up from the tablet's top edge, leaning back toward the eyes.
      tablet.group.add(mesh);
      const edge = tablet.screenHeightM / 2 + 0.045;
      mesh.position.set(0, edge + (Math.cos(CARD_TILT) * CARD_H_M) / 2, (Math.sin(CARD_TILT) * CARD_H_M) / 2 + 0.01);
      mesh.rotation.set(CARD_TILT, 0, 0);
    } else {
      scene.add(mesh);
      placeWorldNow = true;
    }
  }

  const head = new THREE.Vector3();
  const forward = new THREE.Vector3();
  function placeCard(viewer) {
    const presenting = renderer.xr.isPresenting;
    const want = !presenting ? 'desktop' : tablet && tablet.state.mount === 'arm' ? 'arm' : 'world';
    if (want !== cardMount) mountCard(want);
    const mesh = panel.mesh;
    const has = shown.key !== null;
    if (cardMount === 'desktop') {
      mesh.visible = has && !(tablet && tablet.state.slide > 0);
      if (!mesh.visible) return;
      // Right side of the view, sized to the window.
      const distance = 0.6;
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
      const halfW = halfH * camera.aspect;
      const width = Math.min(0.84 * halfW, (0.9 * halfH * W) / H);
      const scale = width / CARD_W_M;
      mesh.scale.setScalar(scale);
      mesh.position.set(halfW - width / 2 - 0.025 * halfW, halfH * 0.72 - (CARD_H_M * scale) / 2, -distance);
    } else if (cardMount === 'arm') {
      mesh.visible = has;
    } else {
      mesh.visible = has;
      if (has && placeWorldNow) {
        placeWorldNow = false;
        head.copy(viewer);
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        mesh.position.copy(head).addScaledVector(forward, 0.9);
        mesh.position.y -= 0.18;
        mesh.lookAt(head);
        mesh.scale.setScalar(1.6);
      }
    }
  }

  // ---- stations -------------------------------------------------------------------
  const entries = []; // { id, data, station, done, radiusM, logged, beacon, placeholder, error }
  const byId = new Map();
  let active = null;
  let briefingOn = true; // the S1 card at the start spot, until the cabin shows it instead
  let lastDoneIndex = -1;

  const badgeOf = (id) => id.replace(/^S/, '');

  function radiusFor(entry) {
    if (entry.station.radiusM > 0) return entry.station.radiusM;
    let far = 0;
    const s = entry.data;
    for (const core of data.cores) if (core.station === s.id) far = Math.max(far, Math.hypot(core.position.x - s.x, core.position.z - s.z));
    for (const id of s.panoramas || []) {
      const pano = data.panoramas.find((p) => p.id === id);
      if (pano) far = Math.max(far, Math.hypot(pano.position.x - s.x, pano.position.z - s.z));
    }
    return Math.max(DEFAULT_RADIUS_M, far + SITE_MARGIN_M);
  }

  function nextAfter(index) {
    for (let i = index + 1; i < entries.length; i++) if (!entries[i].done) return entries[i].id;
    return 'START';
  }

  function complete(entry) {
    if (entry.done) return false;
    entry.done = true;
    mission.clock.chargeStop(entry.id); // 20 min (ASSUMPTION), once per station
    markBeaconDone(entry.beacon);
    if (!entry.logged) {
      mission.log.add({ title: `Stop ${badgeOf(entry.id)}: ${entry.data.title}`, lines: ['Stop done.'], station: entry.id });
    }
    stats.stationsDone = entries.reduce((n, e) => n + (e.done ? 1 : 0), 0);
    lastDoneIndex = entries.indexOf(entry);
    mission.setNextStation(nextAfter(lastDoneIndex));
    if (active === entry) showStation(entry);
    if (set.onDone) set.onDone(entry.id);
    return true;
  }

  function makeCtx(stationData, entry) {
    return {
      THREE,
      mission,
      patch,
      station: stationData,
      camera,
      scene,
      renderer,
      ui,
      hand,
      flash: (kind, options) => (mission.hud ? mission.hud.flash(kind, options) : false),
      log: (entry_) => {
        entry.logged++;
        return mission.log.add({ station: stationData.id, ...entry_ });
      },
      done: () => complete(entry),
      refresh: () => {
        if (active === entry) showStation(entry);
      },
      makeTube: createSampleTube,
    };
  }

  await Promise.all(
    REGISTRY.map(async (item) => {
      const stationData = mission.stations.get(item.id);
      if (!stationData) return;
      const entry = { id: item.id, data: stationData, station: null, done: false, radiusM: DEFAULT_RADIUS_M, logged: 0, beacon: mission.beacons.find((b) => b.id === item.id) || null, placeholder: false, error: null };
      const ctx = makeCtx(stationData, entry);
      try {
        const module = await item.load();
        entry.station = module.createStation(ctx);
      } catch (error) {
        // Not there yet, or broken: the walk goes on with a placeholder.
        entry.error = String(error && error.message ? error.message : error);
        entry.placeholder = true;
        entry.station = placeholderStation(ctx);
      }
      entry.radiusM = radiusFor(entry);
      byId.set(item.id, entry);
    }),
  );
  for (const id of order) if (byId.has(id)) entries.push(byId.get(id)); // walking order
  for (const entry of entries) if (entry.station.group) scene.add(entry.station.group);
  stats.stationCount = entries.length;

  function safely(entry, what, call) {
    try {
      return call();
    } catch (error) {
      console.error(`Station ${entry.id} ${what}:`, error);
      return false;
    }
  }

  function showStation(entry) {
    const station = entry.station;
    shown.key = entry.id;
    shown.badge = badgeOf(entry.id);
    shown.title = station.title || entry.data.title;
    shown.cards = safely(entry, 'cards', () => station.cards()) || [];
    if (shown.page >= shown.cards.length) shown.page = 0;
    shown.prompt = (station.prompt && safely(entry, 'prompt', () => station.prompt())) || '';
    shown.done = entry.done;
    cardDirty = true;
  }
  function showBriefing() {
    const card = briefingCard(mission);
    shown.key = 'S1';
    shown.badge = '1';
    shown.title = card.title;
    shown.cards = [card];
    shown.page = 0;
    shown.prompt = entries.length ? `Follow the blue route to stop ${badgeOf(entries[0].id)}.` : '';
    shown.done = false;
    cardDirty = true;
  }
  function showNothing() {
    shown.key = null;
    shown.cards = [];
    shown.text = null;
    panel.regions.length = 0;
  }

  function enter(entry) {
    if (active === entry) return;
    if (active) leave();
    active = entry;
    shown.page = 0;
    placeWorldNow = true;
    safely(entry, 'onEnter', () => entry.station.onEnter && entry.station.onEnter());
    showStation(entry);
    set.enters++;
  }
  function leave() {
    if (!active) return;
    const entry = active;
    active = null;
    safely(entry, 'onLeave', () => entry.station.onLeave && entry.station.onLeave());
    showNothing();
  }

  // ---- input ----------------------------------------------------------------------
  const info = { ray: new THREE.Ray(), device: 'desktop' };
  function rayFromObject(object) {
    object.updateWorldMatrix(true, false);
    info.ray.origin.setFromMatrixPosition(object.matrixWorld);
    info.ray.direction.set(0, 0, -1).transformDirection(object.matrixWorld);
  }
  // The ray of the right hand in VR, of the mouse (or the middle of the view) on desktop.
  function aimDefault() {
    if (renderer.xr.isPresenting) {
      info.device = 'vr';
      rayFromObject((xr && (xr.controllerFor('right') || xr.controllerFor('left'))) || camera);
      return;
    }
    info.device = 'desktop';
    const pointer = ui && ui.pointers[0];
    if (pointer && pointer.active) info.ray.set(pointer.origin, pointer.direction);
    else rayFromObject(camera);
  }
  // Gives the press to the active station. True if it used it.
  function route(kind) {
    if (!active) return false;
    const station = active.station;
    if (!station.onInput) return false;
    const entry = active;
    const handled = !!safely(entry, `onInput(${kind})`, () => station.onInput(kind, info));
    if (handled) {
      set.handled++;
      if (active === entry) showStation(entry);
    }
    return handled;
  }

  if (xr) {
    // Trigger: panels first (the hook set by the mission), then the station, then teleport.
    const panelsFirst = xr.hooks.select;
    xr.hooks.select = (controller, phase) => {
      if (panelsFirst && panelsFirst(controller, phase)) return true;
      if (phase !== 'start') return false;
      info.device = 'vr';
      rayFromObject(controller);
      return route('select');
    };
    // Right grip.
    for (const controller of xr.controllers) {
      controller.addEventListener('squeezestart', () => {
        if (controller.userData.handedness === 'left') return;
        info.device = 'vr';
        rayFromObject(controller);
        route('grip');
      });
    }
  }
  // A / E.
  const scanBefore = mission.actions.scan;
  mission.actions.scan = () => {
    aimDefault();
    if (route('scan')) return true;
    return scanBefore ? scanBefore() : false;
  };
  if (renderer) {
    // Desktop: G is the grip; a left click that no panel used goes to the station.
    window.addEventListener('keydown', (event) => {
      if (event.repeat || renderer.xr.isPresenting || event.code !== 'KeyG') return;
      aimDefault();
      route('grip');
    });
    let pressesBefore = 0;
    let swallowClick = false;
    window.addEventListener(
      'mousedown',
      () => {
        pressesBefore = ui ? ui.presses : 0; // capture phase: before the panels see the press
      },
      true,
    );
    renderer.domElement.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || renderer.xr.isPresenting) return;
      if (ui && ui.presses !== pressesBefore) return; // a panel took it
      if (tablet && tablet.open) return; // the tablet is up in front of the view
      aimDefault();
      swallowClick = route('select');
    });
    window.addEventListener(
      'click',
      (event) => {
        if (!swallowClick) return;
        swallowClick = false;
        event.stopImmediatePropagation(); // used by the station: do not also capture the mouse
      },
      true,
    );
  }

  // ---- public -----------------------------------------------------------------------
  let lastPrompt = '';
  let pathX = NaN;
  let pathZ = NaN;
  const set = {
    registry: REGISTRY.map((item) => item.id),
    entries,
    hand,
    card: panel,
    shown,
    stats,
    enters: 0,
    handled: 0,
    onDone: null, // (id) => {} after a station is completed
    radiusM: DEFAULT_RADIUS_M,

    get active() {
      return active ? active.id : null;
    },
    get cardMount() {
      return cardMount;
    },
    get: (id) => (byId.has(id) ? byId.get(id).station : null),
    isDone: (id) => !!(byId.has(id) && byId.get(id).done),
    allDone: () => entries.every((entry) => entry.done),
    // { id, title, done, placeholder, radiusM } per station, in walking order.
    list: () => entries.map((entry) => ({ id: entry.id, title: entry.data.title, done: entry.done, placeholder: entry.placeholder, radiusM: entry.radiusM, error: entry.error })),

    // The S1 briefing card as data, for the cabin hologram.
    briefing: () => briefingCard(mission),
    // Whether the S1 card is also shown at the start spot outside (on until the cabin shows it).
    showBriefingCard(on = true) {
      briefingOn = !!on;
      if (!briefingOn && shown.key === 'S1') showNothing();
    },

    nextCard() {
      if (shown.cards.length < 2) return;
      shown.page = (shown.page + 1) % shown.cards.length;
      cardDirty = true;
    },
    // Same as a press of that kind reaching the framework (tests, and other modules).
    input(kind, ray) {
      if (ray) {
        info.ray.copy(ray);
        info.device = renderer.xr.isPresenting ? 'vr' : 'desktop';
      } else aimDefault();
      return route(kind);
    },
    complete: (id) => (byId.has(id) ? complete(byId.get(id)) : false),

    // Once per frame. viewer = world position of the head. No allocations
    // (except one path point every PATH_STEP_M metres walked).
    update(dt, viewer) {
      // Which station the explorer is at.
      let nearest = null;
      let nearestD = Infinity;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const d = Math.hypot(viewer.x - entry.data.x, viewer.z - entry.data.z);
        entry.distanceM = d;
        if (d <= entry.radiusM && d < nearestD) {
          nearest = entry;
          nearestD = d;
        }
      }
      if (active && active !== nearest && (nearest || active.distanceM > active.radiusM + LEAVE_EXTRA_M)) leave();
      if (nearest && !active) enter(nearest);

      // The briefing card at the start spot, before the first stop is done.
      if (!active) {
        const atStart = briefingOn && lastDoneIndex < 0 && Math.hypot(viewer.x - data.start.x, viewer.z - data.start.z) <= BRIEFING_RADIUS_M;
        if (atStart && shown.key !== 'S1') showBriefing();
        else if (!atStart && shown.key !== null) showNothing();
      }

      for (let i = 0; i < entries.length; i++) {
        const station = entries[i].station;
        if (station.update) {
          try {
            station.update(dt);
          } catch (error) {
            if (!entries[i].updateFailed) console.error(`Station ${entries[i].id} update:`, error);
            entries[i].updateFailed = true;
          }
        }
      }

      // The station's "what to do now" line: redraw the card only when it changes.
      if (active && active.station.prompt) {
        const prompt = active.station.prompt() || '';
        if (prompt !== lastPrompt) {
          lastPrompt = prompt;
          if (prompt !== shown.prompt) {
            shown.prompt = prompt;
            cardDirty = true;
          }
        }
      } else lastPrompt = '';

      if (held || handParent === null) placeHand();
      placeCard(viewer);
      if (cardDirty && panel.mesh.visible) drawCard();

      // Numbers for the debrief.
      stats.slopeWarnings = mission.slopeWarnings.amber + mission.slopeWarnings.red;
      stats.distanceM = mission.clock.distanceM;
      if (!(Math.hypot(viewer.x - pathX, viewer.z - pathZ) < PATH_STEP_M)) {
        pathX = viewer.x;
        pathZ = viewer.z;
        stats.path.push([Math.round(viewer.x * 10) / 10, Math.round(viewer.z * 10) / 10]);
      }
    },
  };

  // The cabin step may look for the briefing here too (mission.stations is the Map of station data).
  mission.stations.briefing = set.briefing;
  mission.setNextStation(nextAfter(-1));
  return set;
}
