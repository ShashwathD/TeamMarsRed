import * as THREE from 'three';
import { PALETTE, lowPolyMaterial, mergeParts } from './lowpoly.js';
import { THEME, createPanel, drawParagraph, fillChamfer, fitText, setFont, wrapLines } from './ui.js';
import { MINERAL_PICK_COUNT, ensureMineralState } from './mineralState.js';
import { MISSION_SITES } from './mission.js';

// MINERALS W4: sampling, shelving, mission complete, debrief, next spot.
//
//   installSampling(mission, deps)   deps = { THREE, scene, camera, renderer, player, xr, patch,
//                                             terrain, ui, cabin, stations, cabinMinerals }
//
// OUTSIDE  One low-poly marker per picked deposit (after the picks are confirmed), with a
//          label. Within COLLECT_M metres: trigger / click on the marker, or grip / G, puts a
//          sample container in the carry slot, writes the LOG entry, charges the deposit stop
//          to the EVA clock once (plan.deposit_stop_minutes) and flashes the HUD.
// CABIN    Containers go on the shelf by hand. VR: grab one from the carry slot (right grip
//          or trigger) and release it at a shelf slot. Desktop: click a container, then the
//          shelf; or click the shelf (or press G) to put the next one in the next free slot.
// COMPLETE Every station done and three containers shelved: state.complete, emit('complete').
// DEBRIEF  A panel over the hologram table in the cabin's debrief phase, next to the cabin's
//          own debrief (which is untouched): stations, groups sampled, EVA time, objectives,
//          data sources. Partial numbers are shown as they are; there is no fail state.
// NEXT     After completion the same panel offers the next point of interest.
//
// INPUT: registered with the station framework (stationSet.inputFirst, the one hook this
// file has in stations/index.js). A press reaches it after the UI panels and before the
// active station and the teleport, so a deposit is a target of the same rank as a station.
//
// Nothing is allocated or drawn per frame: labels and panels are redrawn only on a change.

export const COLLECT_M = 12;
// Walk patches that exist as folders in data/walk (each is checked with a request before it is offered).
const WALK_PATCHES = ['jezero_delta', 'jezero', 'gale'];

const MARKER_HIT = { y: 1.6, radius: 1.7 }; // a sphere around the post and its label, for pointing
const CONTAINER_H = 0.12;
const CARRY_SCALE = 0.5;
const CARRY_STEP_M = 0.07;
const SLOT_RAY_M = 0.17; // a ray this close to a shelf slot points at it
const SLOT_HAND_M = 0.35; // a held container this close to a shelf slot is released into it
const GRAB_HAND_M = 0.2; // VR: the hand this close to a carried container grabs it

// ---- texts (pure, so they can be checked without a browser) -----------------------

export const markerLabel = (groupName) => `SAMPLE: ${groupName} (orbit says, approximate)`;
export const containerLabel = (groupName) => `${groupName} / collected at orbital match, unconfirmed`;
export const sampleLogLine = (groupName, pixelSizeM) => `Orbit says ${groupName} here. Position approximate (${pixelSizeM} m pixels). Not confirmed on the ground.`;

export function formatEva(seconds) {
  const minutes = Math.round(Math.max(seconds, 0) / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

// The numbers and lines of the debrief, from the live state. No drawing.
export function debriefSummary({ state, stationList = [], evaS = 0, totalS = 0, layers = [] }) {
  const stationCount = stationList.length;
  const stationsDone = stationList.reduce((n, s) => n + (s.done ? 1 : 0), 0);
  const groupName = (id) => {
    const group = state.group(id);
    return group ? group.name : id;
  };
  const samples = state.collected.map((c) => ({
    depositId: c.depositId,
    group: groupName(c.group),
    shelved: state.isShelved(c.depositId),
  }));
  const shelved = samples.reduce((n, s) => n + (s.shelved ? 1 : 0), 0);
  const sources = layers.filter((layer) => layer.id !== 'minerals').map((layer) => `${layer.name}: ${layer.source}`); // the minerals get their full line below
  const data = state.data;
  if (data && data.source) {
    let line = `Minerals: ${data.source}`;
    if (data.doi && !line.includes(data.doi)) line += `, doi:${data.doi}`;
    if (data.licence && !line.includes(data.licence)) line += `, ${data.licence}`;
    if (data.madeFrom) line += `. From ${data.madeFrom}`;
    sources.push(line);
  }
  return {
    stationsDone,
    stationCount,
    stationsVisited: stationList.filter((s) => s.done).map((s) => s.id),
    samples,
    collected: samples.length,
    shelved,
    needed: MINERAL_PICK_COUNT,
    evaS,
    totalS,
    complete: stationCount > 0 && stationsDone === stationCount && shelved >= MINERAL_PICK_COUNT,
    objectives: `stations ${stationsDone}/${stationCount}, samples ${shelved}/${MINERAL_PICK_COUNT}`,
    sources,
    caveat: data && data.caveat ? data.caveat : '',
  };
}

// Which sites the next-spot page offers. walkOk: ids of walk patches that answered.
export function nextSpotRows({ sites = [], walkOk = [], currentSite, currentName, missionSites = [] }) {
  const nameOf = (id) => {
    const site = sites.find((s) => s.id === id);
    if (site) return site.name;
    return id === currentSite && currentName ? currentName : id;
  };
  const available = walkOk.map((id) => ({
    id,
    name: nameOf(id),
    available: true,
    note: id === currentSite ? 'this walk, from the start' : missionSites.includes(id) ? 'walk with a mission' : 'terrain walk, no mission yet',
  }));
  const others = sites.filter((s) => !walkOk.includes(s.id)).map((s) => ({ id: s.id, name: s.name, available: false, note: 'not yet available' }));
  return available.concat(others);
}

// ---- install ------------------------------------------------------------------------

export function installSampling(mission, deps = {}) {
  const state = ensureMineralState(mission);
  const scene = deps.scene;
  const camera = deps.camera;
  const renderer = deps.renderer;
  const patch = deps.patch;
  const xr = deps.xr || null;
  const ui = mission.ui || (deps.ui && deps.ui.add ? deps.ui : null);
  const cabin = deps.cabin || mission.cabin || null;
  const stations = deps.stations || mission.stationSet || null;
  const hand = stations ? stations.hand : null;
  const tablet = mission.tablet || null;
  const anisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  const presenting = () => !!(renderer && renderer.xr.isPresenting);

  const groupName = (id) => {
    const group = state.group(id);
    return group ? group.name : id;
  };
  const groupColor = (id) => {
    const group = state.group(id);
    return group && group.color ? group.color : THEME.dim;
  };

  const lastViewer = new THREE.Vector3(NaN, 0, NaN);
  const point = new THREE.Vector3();
  const point2 = new THREE.Vector3();

  // ---- deposit markers (outside) ---------------------------------------------------
  const markerGroup = new THREE.Group();
  markerGroup.name = 'mineral-sample-markers';
  scene.add(markerGroup);
  let markerGeometry = null; // one geometry and the shared low-poly material for every marker
  const markers = []; // pool: { root, label, depositId, x, y, z, near, text }

  function makeMarker() {
    if (!markerGeometry) {
      markerGeometry = mergeParts([
        { geometry: new THREE.CylinderGeometry(0.55, 0.65, 0.08, 6), color: PALETTE.slate, y: 0.04 },
        { geometry: new THREE.CylinderGeometry(0.05, 0.05, 1.7, 5), color: PALETTE.offWhite, y: 0.93 },
        { geometry: new THREE.OctahedronGeometry(0.26), color: PALETTE.teal, y: 2.05 },
      ]);
    }
    const root = new THREE.Group();
    root.name = 'mineral-sample-marker';
    root.add(new THREE.Mesh(markerGeometry, lowPolyMaterial()));
    const label = createPanel({ name: 'mineral-sample-label', widthPx: 1024, heightPx: 224, widthM: 3.4, anisotropy });
    label.mesh.position.y = 2.95;
    root.add(label.mesh);
    root.visible = false;
    markerGroup.add(root);
    const marker = { root, label, depositId: null, x: 0, y: 0, z: 0, near: false, text: '' };
    markers.push(marker);
    return marker;
  }

  function drawMarkerLabel(marker) {
    const deposit = state.deposit(marker.depositId);
    if (!deposit) return;
    const panel = marker.label;
    const W = panel.widthPx;
    const H = panel.heightPx;
    const ctx = panel.begin();
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, H);
    const collected = state.isCollected(marker.depositId);
    fillChamfer(ctx, 6, 6, W - 12, H - 12, { cut: 22, fill: THEME.card, stroke: collected ? THEME.dim : THEME.accent, lineWidth: 6 });
    ctx.fillStyle = groupColor(deposit.group);
    ctx.fillRect(34, 40, 40, 64);
    const first = markerLabel(groupName(deposit.group));
    ctx.fillStyle = THEME.text;
    fitText(ctx, first, 94, 92, 50, W - 94 - 34, { weight: 'bold', minPx: 34 });
    const second = collected
      ? 'Collected. Shelve the container in the rover cabin.'
      : marker.near
        ? 'Collect: trigger (click) this marker, or grip (G).'
        : `Come within ${COLLECT_M} m to collect.`;
    ctx.fillStyle = collected ? THEME.dim : THEME.text;
    fitText(ctx, second, 34, 172, 42, W - 68, { minPx: 30 });
    panel.end();
    marker.text = `${first}\n${second}`;
  }

  // Markers follow the confirmed picks; a deposit already collected keeps its marker.
  function syncMarkers() {
    const ids = [];
    if (state.confirmed) for (const id of state.picks) if (!ids.includes(id)) ids.push(id);
    for (const c of state.collected) if (!ids.includes(c.depositId)) ids.push(c.depositId);
    let used = 0;
    for (const id of ids) {
      const deposit = state.deposit(id);
      if (!deposit) continue;
      const marker = markers[used] || makeMarker();
      used++;
      marker.depositId = id;
      marker.x = deposit.x;
      marker.z = deposit.z;
      const y = patch ? patch.groundY(deposit.x, deposit.z) : 0;
      marker.y = Number.isFinite(y) ? y : 0;
      marker.root.position.set(marker.x, marker.y, marker.z);
      marker.near = Math.hypot(lastViewer.x - marker.x, lastViewer.z - marker.z) <= COLLECT_M;
      marker.root.visible = true;
      drawMarkerLabel(marker);
    }
    for (let i = used; i < markers.length; i++) {
      markers[i].root.visible = false;
      markers[i].depositId = null;
    }
  }

  // ---- containers and the carry slot --------------------------------------------------
  const containerGeometries = new Map(); // one geometry per group colour
  function containerGeometry(color) {
    if (containerGeometries.has(color)) return containerGeometries.get(color);
    const h = CONTAINER_H;
    // Origin at the base, so a container stands on whatever it is put on.
    const geometry = mergeParts([
      { geometry: new THREE.CylinderGeometry(0.036, 0.036, h * 0.78, 6), color: PALETTE.offWhite, y: h * 0.39 },
      { geometry: new THREE.CylinderGeometry(0.039, 0.039, h * 0.2, 6), color, y: h * 0.42 }, // band in the group's map colour
      { geometry: new THREE.CylinderGeometry(0.042, 0.042, h * 0.22, 6), color: PALETTE.slate, y: h * 0.89 }, // lid
    ]);
    containerGeometries.set(color, geometry);
    return geometry;
  }

  const containers = []; // { depositId, group, label, mesh, where: 'carry' | 'hand' | 'shelf', slot, heldWith }
  const carry = new THREE.Group();
  carry.name = 'mineral-carry';
  carry.visible = false;
  const carryLabel = createPanel({ name: 'mineral-carry-label', widthPx: 1024, heightPx: 256, widthM: 0.3, anisotropy, renderOrder: 930 });
  carryLabel.mesh.position.set(0, CONTAINER_H * CARRY_SCALE + 0.05, 0);
  carry.add(carryLabel.mesh);
  let carryParent = null;
  let carryText = '';

  function drawCarryLabel() {
    const W = carryLabel.widthPx;
    const H = carryLabel.heightPx;
    const ctx = carryLabel.begin();
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, H);
    fillChamfer(ctx, 4, 4, W - 8, H - 8, { cut: 18, fill: THEME.card, stroke: THEME.cardLine, lineWidth: 4 });
    const lines = [];
    let row = 0;
    for (const c of containers) {
      if (c.where === 'shelf') continue;
      ctx.fillStyle = groupColor(c.group);
      ctx.fillRect(26, 30 + row * 72, 26, 44);
      ctx.fillStyle = THEME.text;
      fitText(ctx, c.label, 68, 66 + row * 72, 40, W - 68 - 26, { minPx: 26 });
      lines.push(c.label);
      row++;
    }
    carryLabel.end();
    carryText = lines.join('\n');
  }

  function layoutCarry() {
    let n = 0;
    for (const c of containers) {
      if (c.where !== 'carry') continue;
      if (c.mesh.parent !== carry) carry.add(c.mesh);
      c.mesh.position.set((n - 1) * CARRY_STEP_M, 0, 0);
      c.mesh.quaternion.identity();
      c.mesh.scale.setScalar(CARRY_SCALE);
      n++;
    }
    drawCarryLabel();
  }

  // Desktop: lower left of the view. VR: beside the forearm tablet (or lower left of the view without one).
  function placeCarry() {
    let waiting = false;
    for (let i = 0; i < containers.length; i++) if (containers[i].where !== 'shelf') waiting = true;
    if (!waiting || !camera) {
      carry.visible = false;
      return;
    }
    const onArm = presenting() && tablet && tablet.state.mount === 'arm' && tablet.group.parent;
    const parent = onArm ? tablet.group : camera;
    if (parent !== carryParent) {
      carryParent = parent;
      parent.add(carry);
      carry.quaternion.identity();
      if (onArm) carry.position.set(-(tablet.screenWidthM / 2 + 0.24), -0.02, 0.02);
    }
    if (parent === camera) {
      const distance = 0.6;
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
      const halfW = halfH * camera.aspect;
      carry.position.set(-(halfW - 0.18), -halfH * 0.42, -distance);
      carry.visible = !(tablet && tablet.open && !presenting()); // the open desktop tablet covers the view
    } else carry.visible = true;
  }

  // ---- collecting ------------------------------------------------------------------------
  function collect(depositId) {
    const deposit = state.deposit(depositId);
    if (!deposit || state.isCollected(depositId) || state.collected.length >= MINERAL_PICK_COUNT) return false;
    const name = groupName(deposit.group);
    state.collected.push({ depositId, group: deposit.group });
    const mesh = new THREE.Mesh(containerGeometry(groupColor(deposit.group)), lowPolyMaterial());
    mesh.name = `sample-container-${depositId}`;
    containers.push({ depositId, group: deposit.group, label: containerLabel(name), mesh, where: 'carry', slot: -1, heldWith: null });
    layoutCarry();
    if (mission.log) {
      mission.log.add({ title: `Deposit ${depositId}: sample container`, lines: [sampleLogLine(name, state.data.pixelSizeM)], station: null });
    }
    // The deposit stop (ASSUMPTION, from the route plan) is charged once: a deposit is collected once.
    const stopMinutes = state.plan ? state.plan.deposit_stop_minutes : NaN;
    if (Number.isFinite(stopMinutes) && mission.clock) mission.clock.charge(stopMinutes * 60, { reason: 'stop' });
    else console.warn('Sampling: no route plan with deposit_stop_minutes; the deposit stop was not charged to the EVA clock.');
    if (mission.hud) mission.hud.flash('COLLECT', { detail: `(${name}, unconfirmed)` });
    for (const marker of markers) if (marker.depositId === depositId) drawMarkerLabel(marker);
    state.emit('collected');
    drawDebrief();
    return true;
  }

  function markerOnRay(ray) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (!marker.root.visible || !marker.near || state.isCollected(marker.depositId)) continue;
      point.set(marker.x, marker.y + MARKER_HIT.y, marker.z);
      point2.copy(point).sub(ray.origin);
      if (point2.dot(ray.direction) <= 0) continue; // behind the pointer
      const d = ray.distanceSqToPoint(point);
      if (d <= MARKER_HIT.radius * MARKER_HIT.radius && d < bestD) {
        best = marker;
        bestD = d;
      }
    }
    return best;
  }
  function nearestMarker() {
    let best = null;
    let bestD = COLLECT_M;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (!marker.root.visible || state.isCollected(marker.depositId)) continue;
      const d = Math.hypot(lastViewer.x - marker.x, lastViewer.z - marker.z);
      if (d <= bestD) {
        best = marker;
        bestD = d;
      }
    }
    return best;
  }

  function fieldInput(kind, info) {
    if (kind === 'select') {
      const marker = markerOnRay(info.ray);
      return marker ? collect(marker.depositId) : false;
    }
    // Grip / G: the nearest deposit in range, unless a station that is not done yet is active
    // here (its own grip action comes first; the marker can still be pointed at).
    if (stations && stations.active && !stations.isDone(stations.active)) return false;
    const marker = nearestMarker();
    return marker ? collect(marker.depositId) : false;
  }

  // ---- the shelf ----------------------------------------------------------------------------
  let shelf = null; // { slots: [Object3D x3], slotAt, temporary }
  function getShelf() {
    if (shelf && !shelf.temporary) return shelf;
    const made = deps.cabinMinerals || mission.cabinMinerals || null;
    if (made && Array.isArray(made.shelfSlots) && made.shelfSlots.length >= MINERAL_PICK_COUNT) {
      if (shelf && shelf.temporary) {
        // The cabin's own shelf has arrived: move over anything on the temporary one.
        for (const c of containers) if (c.where === 'shelf') made.shelfSlots[c.slot].add(c.mesh);
        shelf.board.removeFromParent();
      }
      shelf = { slots: made.shelfSlots, slotAt: typeof made.slotAt === 'function' ? made.slotAt.bind(made) : null, temporary: false };
      return shelf;
    }
    if (shelf || !cabin) return shelf;
    // TEMPORARY shelf until the cabin workstream's shelf is there: a plank on the right-hand
    // wall (cabin metres: the wall is at x = 2.1), three slots along it.
    const board = new THREE.Mesh(
      mergeParts([
        { geometry: new THREE.BoxGeometry(0.24, 0.04, 1.0), color: PALETTE.slate, y: -0.02 },
        { geometry: new THREE.BoxGeometry(0.03, 0.16, 1.0), color: PALETTE.slate, x: 0.105, y: 0.06 },
      ]),
      lowPolyMaterial(),
    );
    board.name = 'mineral-shelf-temporary';
    board.position.set(1.93, 1.15, 0.45);
    const slots = [];
    for (let i = 0; i < MINERAL_PICK_COUNT; i++) {
      const slot = new THREE.Object3D();
      slot.name = `mineral-shelf-slot-${i}`;
      slot.position.set(-0.02, 0, (i - 1) * 0.3);
      board.add(slot);
      slots.push(slot);
    }
    cabin.group.add(board);
    shelf = { slots, slotAt: null, temporary: true, board };
    return shelf;
  }

  const slotTaken = (index) => containers.some((c) => c.where === 'shelf' && c.slot === index);
  function nextFreeSlot() {
    for (let i = 0; i < MINERAL_PICK_COUNT; i++) if (!slotTaken(i)) return i;
    return -1;
  }

  // The shelf slot a ray points at, or a held container is next to. -1 for none.
  function slotFor(ray, heldMesh) {
    const s = getShelf();
    if (!s) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < MINERAL_PICK_COUNT; i++) {
      s.slots[i].getWorldPosition(point);
      point.y += CONTAINER_H / 2;
      if (heldMesh && presenting()) {
        heldMesh.getWorldPosition(point2);
        const d = point2.distanceTo(point);
        if (d <= SLOT_HAND_M && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      if (ray) {
        point2.copy(point).sub(ray.origin);
        if (point2.dot(ray.direction) > 0) {
          const d = Math.sqrt(ray.distanceSqToPoint(point));
          if (d <= SLOT_RAY_M && d < bestD) {
            best = i;
            bestD = d;
          }
        }
      }
    }
    if (best < 0 && ray && s.slotAt) {
      const hit = s.slotAt(ray);
      if (typeof hit === 'number') best = hit >= 0 && hit < MINERAL_PICK_COUNT ? hit : -1;
      else if (hit) best = s.slots.indexOf(hit.slot || hit.object || hit);
      if (best < 0 && hit && typeof hit === 'object' && Number.isInteger(hit.index)) best = hit.index;
    }
    return best;
  }

  function carriedOnRay(info) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i];
      if (c.where !== 'carry') continue;
      c.mesh.getWorldPosition(point);
      point.y += (CONTAINER_H * CARRY_SCALE) / 2;
      const reach = info.device === 'vr' ? point.distanceTo(info.ray.origin) : Infinity;
      const d = Math.sqrt(info.ray.distanceSqToPoint(point));
      const score = Math.min(d, reach);
      if ((d <= 0.045 || reach <= GRAB_HAND_M) && score < bestD) {
        best = c;
        bestD = score;
      }
    }
    return best;
  }
  const firstCarried = () => containers.find((c) => c.where === 'carry') || null;
  const heldContainer = () => containers.find((c) => c.where === 'hand') || null;

  function grab(c, kind) {
    if (!hand) return shelve(c, nextFreeSlot());
    hand.hold(c.mesh);
    c.mesh.scale.setScalar(1);
    c.mesh.position.set(0, -CONTAINER_H / 2, 0); // the fist closes round its middle
    c.where = 'hand';
    c.heldWith = kind;
    layoutCarry();
    return true;
  }
  function backToCarry(c) {
    if (hand && hand.held === c.mesh) hand.release();
    c.where = 'carry';
    c.heldWith = null;
    layoutCarry();
  }
  function shelve(c, index) {
    const s = getShelf();
    if (!s || index < 0 || index >= MINERAL_PICK_COUNT || slotTaken(index) || c.where === 'shelf') return false;
    if (hand && hand.held === c.mesh) hand.release();
    s.slots[index].add(c.mesh);
    c.mesh.position.set(0, 0, 0);
    c.mesh.quaternion.identity();
    c.mesh.scale.setScalar(1);
    c.where = 'shelf';
    c.slot = index;
    c.heldWith = null;
    if (!state.isShelved(c.depositId)) state.shelved.push(c.depositId);
    layoutCarry();
    state.emit('shelved');
    checkComplete();
    drawDebrief();
    return true;
  }
  // One action: the next carried container onto the next free slot (or the slot asked for, if free).
  function shelveNext(index = -1) {
    const c = heldContainer() || firstCarried();
    if (!c) return false;
    return shelve(c, index >= 0 && !slotTaken(index) ? index : nextFreeSlot());
  }

  function cabinInput(kind, info) {
    const held = heldContainer();
    if (held) {
      const index = slotFor(info.ray, held.mesh);
      if (index < 0) return false;
      if (!slotTaken(index)) shelve(held, index);
      return true;
    }
    const c = carriedOnRay(info);
    if (c) return grab(c, kind);
    const index = slotFor(info.ray, null);
    // Desktop one-step: a click on the shelf, or G anywhere in the cabin.
    if (index >= 0 || (kind === 'grip' && info.device === 'desktop')) return shelveNext(index);
    return false;
  }

  function onInput(kind, info) {
    if (kind !== 'select' && kind !== 'grip') return false;
    if (cabin && cabin.inside) return cabinInput(kind, info);
    return fieldInput(kind, info);
  }
  if (stations && Array.isArray(stations.inputFirst)) stations.inputFirst.push(onInput);
  else console.warn('Sampling: the station framework has no inputFirst hook; deposits and the shelf get no input.');

  // VR: letting go of the grip releases a container grabbed with it: into the shelf slot it
  // is at (or the controller points at), otherwise back to the carry slot.
  const releaseRay = new THREE.Ray();
  if (xr && xr.controllers) {
    for (const controller of xr.controllers) {
      controller.addEventListener('squeezeend', () => {
        const held = heldContainer();
        if (!held || held.heldWith !== 'grip' || controller.userData.handedness === 'left') return;
        controller.updateWorldMatrix(true, false);
        releaseRay.origin.setFromMatrixPosition(controller.matrixWorld);
        releaseRay.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
        const index = slotFor(releaseRay, held.mesh);
        if (index < 0 || slotTaken(index) || !shelve(held, index)) backToCarry(held);
      });
    }
  }

  // ---- mission complete ---------------------------------------------------------------------
  const stationList = () => (stations ? stations.list() : []);
  function summary() {
    return debriefSummary({
      state,
      stationList: stationList(),
      evaS: mission.clock ? mission.clock.elapsedS : 0,
      totalS: mission.clock ? mission.clock.totalS : 0,
      layers: mission.data.layers || [],
    });
  }
  function checkComplete() {
    if (state.complete) return true;
    const s = summary();
    if (!s.complete) return false;
    state.complete = true;
    if (mission.log) mission.log.add({ title: 'Mission complete', lines: [`Objectives met: ${s.objectives}.`], station: null });
    state.emit('complete');
    drawDebrief();
    return true;
  }
  if (stations) {
    const before = stations.onDone;
    stations.onDone = (id) => {
      if (before) before(id);
      checkComplete();
      drawDebrief();
    };
  }

  // ---- debrief and next spot (cabin, over the hologram table) ------------------------------
  let debrief = null;
  let page = 'debrief'; // 'debrief' | 'next'
  let shownDebrief = '';
  const next = { sites: [], walkOk: [], loaded: false, chosen: null };

  if (cabin && typeof document !== 'undefined') {
    debrief = createPanel({ name: 'mineral-debrief', widthPx: 1280, heightPx: 896, widthM: 1.1, anisotropy });
    // Cabin metres: above the hologram table (at x 0.15, z -1.2), facing the place the player stands.
    debrief.mesh.position.set(0.15, 2.1, -1.25); // clear of the debrief console's top row
    debrief.mesh.visible = false;
    cabin.group.add(debrief.mesh);
    if (ui) ui.add(debrief);
  }

  function nextRows() {
    return nextSpotRows({ sites: next.sites, walkOk: next.walkOk, currentSite: mission.site, currentName: mission.data.mission, missionSites: MISSION_SITES });
  }

  // The cabin's transit (the starfield) only runs from its briefing phase and is not callable
  // for another site, so a choice loads the page for that site; a mission site then starts in
  // its cabin with the same briefing and transit.
  function chooseSite(id) {
    if (!next.walkOk.includes(id)) return false;
    next.chosen = id;
    if (typeof window !== 'undefined' && window.location) window.location.search = `?site=${encodeURIComponent(id)}`;
    return true;
  }

  function drawDebrief() {
    if (!debrief) return;
    const W = debrief.widthPx;
    const H = debrief.heightPx;
    const ctx = debrief.begin();
    const lines = [];
    const say = (text) => lines.push(text);
    const s = summary();
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, H);
    fillChamfer(ctx, 8, 8, W - 16, H - 16, { cut: 30, fill: THEME.card, stroke: s.complete ? THEME.accent : THEME.cardLine, lineWidth: 6 });
    const left = 48;
    const room = W - 2 * left;
    const button = (id, x, y, w, h, label, onTap) => {
      fillChamfer(ctx, x, y, w, h, { cut: 18, fill: THEME.accent, stroke: THEME.text, lineWidth: 4 });
      ctx.fillStyle = THEME.dark;
      ctx.textAlign = 'center';
      fitText(ctx, label, x + w / 2, y + h / 2 + 15, 42, w - 36, { weight: 'bold', minPx: 26 });
      ctx.textAlign = 'left';
      debrief.region(id, x, y, w, h, onTap);
      say(`[${label}]`);
    };

    if (page === 'next' && state.complete) {
      ctx.fillStyle = THEME.accent;
      fitText(ctx, 'NEXT POINT OF INTEREST', left, 84, 50, room - 280, { weight: 'bold' });
      say('NEXT POINT OF INTEREST');
      button('debrief-back', W - left - 250, 34, 250, 72, '< DEBRIEF', () => {
        page = 'debrief';
        drawDebrief();
      });
      const rows = nextRows();
      const rowH = Math.min(78, Math.floor((H - 190) / Math.max(rows.length, 1)));
      let y = 128;
      if (!next.loaded) {
        ctx.fillStyle = THEME.dim;
        fitText(ctx, 'Reading the site list...', left, y + 44, 36, room);
        say('Reading the site list...');
      }
      for (const row of rows) {
        if (row.available) {
          button(`site-${row.id}`, left, y + 4, 300, rowH - 12, 'GO', () => chooseSite(row.id));
          ctx.fillStyle = THEME.text;
          fitText(ctx, `${row.name}  (${row.note})`, left + 324, y + rowH / 2 + 12, 36, room - 324, { weight: 'bold', minPx: 24 });
        } else {
          ctx.fillStyle = THEME.dim;
          fitText(ctx, `${row.name}: ${row.note}`, left + 324, y + rowH / 2 + 12, 34, room - 324, { minPx: 24 });
        }
        say(`${row.name}: ${row.note}`);
        y += rowH;
      }
      ctx.fillStyle = THEME.dim;
      const source = 'Source: data/sites.json and the walk patches in data/walk. GO loads that site.';
      fitText(ctx, source, left, H - 40, 26, room, { minPx: 20 });
      say(source);
    } else {
      const title = s.complete ? 'MISSION COMPLETE' : 'MISSION DEBRIEF: NOT COMPLETE YET';
      ctx.fillStyle = s.complete ? THEME.accent : THEME.text;
      fitText(ctx, title, left, 84, 50, room, { weight: 'bold', minPx: 34 });
      say(title);
      const cells = [
        ['STATIONS VISITED', `${s.stationsDone} of ${s.stationCount}`],
        ['SAMPLES SHELVED', `${s.shelved} of ${s.needed} (collected ${s.collected})`],
        ['EVA TIME USED', `${formatEva(s.evaS)} of ${Math.round(s.totalS / 3600)} h`],
      ];
      cells.forEach(([label, value], i) => {
        const x = left + i * (room / 3);
        ctx.fillStyle = THEME.dim;
        fitText(ctx, label, x, 140, 28, room / 3 - 20);
        ctx.fillStyle = THEME.text;
        fitText(ctx, value, x, 192, 44, room / 3 - 20, { weight: 'bold', minPx: 24 });
        say(`${label}: ${value}`);
      });
      ctx.fillStyle = THEME.dim;
      fitText(ctx, 'GROUPS SAMPLED (orbit says, approximate)', left, 252, 28, room);
      say('GROUPS SAMPLED (orbit says, approximate)');
      let y = 300;
      if (!s.samples.length) {
        ctx.fillStyle = THEME.text;
        fitText(ctx, 'No sample collected yet.', left, y, 36, room);
        say('No sample collected yet.');
        y += 46;
      }
      s.samples.forEach((sample, i) => {
        const deposit = state.deposit(sample.depositId);
        ctx.fillStyle = deposit ? groupColor(deposit.group) : THEME.dim;
        ctx.fillRect(left, y - 30, 24, 34);
        ctx.fillStyle = THEME.text;
        const text = `${i + 1}  ${sample.group} (deposit ${sample.depositId}): ${sample.shelved ? 'on the shelf' : 'collected, not shelved yet'}`;
        fitText(ctx, text, left + 40, y, 36, room - 40, { minPx: 26 });
        say(text);
        y += 46;
      });
      y = Math.max(y, 438) + 6;
      ctx.fillStyle = s.complete ? THEME.accent : THEME.amber;
      const objectives = `OBJECTIVES MET: ${s.objectives}`;
      fitText(ctx, objectives, left, y, 38, room, { weight: 'bold', minPx: 26 });
      say(objectives);
      y += 40;
      ctx.fillStyle = THEME.dim;
      setFont(ctx, 24);
      if (s.caveat) {
        y = drawParagraph(ctx, s.caveat, left, y, room, 30, 2).y + 6;
        say(s.caveat);
      }
      fitText(ctx, 'DATA SOURCES USED', left, y + 4, 26, room, { weight: 'bold' });
      say('DATA SOURCES USED');
      y += 36;
      const bottom = H - 150;
      const sources = s.sources.join('; ');
      let px = 24;
      for (const trial of [24, 22, 20, 18]) {
        px = trial;
        setFont(ctx, px);
        if (wrapLines(ctx, sources, room).length * (px + 5) <= bottom - y + px) break;
      }
      ctx.fillStyle = THEME.dim;
      setFont(ctx, px);
      drawParagraph(ctx, sources, left, y, room, px + 5, Math.max(1, Math.floor((bottom - y + px) / (px + 5))));
      say(sources);
      if (s.complete) {
        button('next-spot', W - left - 420, H - 128, 420, 88, 'NEXT SPOT >', () => {
          page = 'next';
          drawDebrief();
        });
        ctx.fillStyle = THEME.dim;
        setFont(ctx, 26);
        const hint = 'Every station visited and three containers shelved. The table offers the next point of interest.';
        drawParagraph(ctx, hint, left, H - 96, room - 450, 32, 2);
        say(hint);
      } else {
        ctx.fillStyle = THEME.dim;
        setFont(ctx, 26);
        const hint =
          s.collected > s.shelved
            ? 'These are the numbers so far. Put the carried containers on the shelf: grip and release (click the shelf, or G).'
            : 'These are the numbers so far. You can go back out through the airlock behind you.';
        drawParagraph(ctx, hint, left, H - 96, room, 32, 2);
        say(hint);
      }
    }
    debrief.end();
    shownDebrief = lines.join('\n');
  }

  function loadNextSpots() {
    if (typeof fetch !== 'function') return Promise.resolve();
    const sitesJob = fetch('./data/sites.json')
      .then((response) => (response.ok ? response.json() : { sites: [] }))
      .then((json) => {
        next.sites = Array.isArray(json.sites) ? json.sites : [];
      })
      .catch(() => {});
    const walkJobs = WALK_PATCHES.map((id) =>
      fetch(`./data/walk/${id}/walk.json`, { method: 'HEAD' })
        .then((response) => response.ok)
        .catch(() => false),
    );
    return Promise.all([sitesJob, Promise.all(walkJobs)]).then(([, oks]) => {
      next.walkOk = WALK_PATCHES.filter((id, i) => oks[i]);
      next.loaded = true;
      if (page === 'next') drawDebrief();
    });
  }
  const nextReady = loadNextSpots();

  // ---- phase changes, state changes, frames ------------------------------------------------
  function onPhase() {
    const inside = !!(cabin && cabin.inside);
    if (!inside) {
      const held = heldContainer();
      if (held) backToCarry(held); // nothing leaves the cabin in the hand
    } else getShelf();
    if (debrief) {
      debrief.mesh.visible = inside && cabin.phase === 'debrief';
      if (debrief.mesh.visible) {
        checkComplete();
        if (!state.complete) page = 'debrief';
        drawDebrief();
      }
    }
  }
  if (cabin) {
    const before = cabin.onChange;
    cabin.onChange = (inside, phase) => {
      if (before) before(inside, phase);
      onPhase();
    };
  }

  state.on((kind) => {
    if (kind === 'data' || kind === 'picks' || kind === 'confirmed' || kind === 'plan') syncMarkers();
    if (kind === 'data') {
      layoutCarry();
      drawDebrief();
    }
  });

  // Once per frame, after the mission's own update. No allocations; a label is redrawn only
  // when the explorer crosses the collect distance.
  function update(viewer) {
    lastViewer.copy(viewer);
    placeCarry();
    if (cabin && cabin.inside) return;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (!marker.root.visible) continue;
      const near = Math.hypot(viewer.x - marker.x, viewer.z - marker.z) <= COLLECT_M;
      if (near !== marker.near) {
        marker.near = near;
        drawMarkerLabel(marker);
      }
      marker.label.mesh.rotation.y = Math.atan2(viewer.x - marker.x, viewer.z - marker.z);
    }
  }
  const missionUpdate = mission.update;
  mission.update = (timeS, viewer, dt) => {
    missionUpdate.call(mission, timeS, viewer, dt);
    update(viewer);
  };

  const sampling = {
    state,
    markers,
    markerGroup,
    containers,
    carry,
    panels: { debrief, carryLabel },
    nextReady,
    get shelf() {
      return getShelf();
    },
    get page() {
      return page;
    },
    get shownText() {
      return { debrief: shownDebrief, carry: carryText, markers: markers.filter((m) => m.root.visible).map((m) => m.text) };
    },
    collect, // (depositId) -> true if collected now
    shelveNext, // (slotIndex?) -> true: the next carried container onto the next free slot
    grab: (depositId, kind = 'select') => {
      const c = containers.find((x) => x.depositId === depositId && x.where === 'carry');
      return c ? grab(c, kind) : false;
    },
    onInput, // (kind, { ray, device }) as the station framework calls it
    checkComplete,
    summary,
    nextRows,
    chooseSite,
    showPage(name) {
      page = name === 'next' && state.complete ? 'next' : 'debrief';
      drawDebrief();
      return page;
    },
    update,
  };
  mission.sampling = sampling;
  syncMarkers();
  onPhase();
  return sampling;
}
