import * as THREE from 'three';
import { PALETTE, css, lowPolyMaterial, mergeParts } from './lowpoly.js';
import { THEME, createPanel, drawParagraph, fillChamfer, fitText, setFont } from './ui.js';
import { MINERAL_PICK_COUNT, ensureMineralState } from './mineralState.js';

// Mineral objective, cabin side (workstream W2):
//   - a wall map on the right-hand cabin wall: the walk patch photo (or shaded
//     relief if there is no photo), the mineral groups from
//     mission.minerals.data.grid drawn over it, a legend, the stations and the
//     candidate deposits as pins, each with a list row;
//   - picking: point + trigger / click on a pin or its row toggles it in
//     mission.minerals.picks (three at most), CONFIRM, CHANGE;
//   - the plan summary from mission.minerals.plan and its polyline on the map;
//   - the airlock door stays shut until the picks are confirmed (cabin.doorGuard);
//   - a low-poly shelf with three slots for the sample containers.
//
// The map shows which minerals the orbiter's spectra best match. It says
// nothing about danger and is never called a hazard map.
//
// Cost: nothing per frame. The wall canvas is redrawn only on a mineral-state
// event or a tap; the photo + minerals + stations picture underneath is made
// once per data load. Three extra draw calls (wall panel, shelf label, one
// merged mesh for the frame and the shelf) plus the hover quad.

// Cabin measurements, in cabin metres (the same numbers as in cabin.js).
const HALF_W = 2.1;
const BACK_Z = 2.3;
const DOOR_HALF_W = 0.6;

// Wall map: on the right wall (+x), between the console and the back wall,
// centre at standing eye height. The left wall has the mission log.
const WALL = { z: 0.05, y: 1.55, widthM: 2.6, widthPx: 2048, heightPx: 1024 };
// Shelf: on the back wall left of the airlock door, top at hand height.
const SHELF = { x: -1.38, y: 1.08, widthM: 1.1, depthM: 0.26, slotGapM: 0.36, slotReachM: 0.17 };

const MAP = { x: 28, y: 96, size: 900 }; // the map square on the canvas, pixels
const LIST = { x: 956, y: 96, w: 520 };
const SIDE = { x: 1504, w: 516 };
const OVERLAY_ALPHA = 0.62;
const PIN_R = 25;
const RELIEF_N = 300;

export const DOOR_HINT = 'Pick three deposits on the wall map first';
const ORBIT_NOTE = 'orbit says, approximate';
const CAVEAT_FALLBACK = 'Names are spectral matches, not confirmed.'; // the brief's wording, used only if the data has no caveat

export const formatKm = (metres) => (metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`);
export function formatMinutes(minutes) {
  const whole = Math.round(Math.max(minutes, 0));
  return whole < 60 ? `${whole} min` : `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')} min`;
}

// How many picks the door waits for: three, or fewer if the data has fewer deposits.
export function picksNeeded(state) {
  const deposits = state.data && Array.isArray(state.data.deposits) ? state.data.deposits : [];
  return Math.min(MINERAL_PICK_COUNT, deposits.length);
}

// Adds or removes one deposit. Returns { ok, hint }; the caller emits 'picks' when ok.
export function togglePick(state, id, locked = false) {
  if (locked) return { ok: false, hint: 'The EVA has started: the picks are fixed.' };
  if (state.confirmed) return { ok: false, hint: 'Confirmed. Press CHANGE to alter the picks.' };
  if (!state.deposit(id)) return { ok: false, hint: '' };
  const at = state.picks.indexOf(id);
  if (at >= 0) {
    state.picks.splice(at, 1);
    return { ok: true, hint: '' };
  }
  if (state.picks.length >= MINERAL_PICK_COUNT) {
    return { ok: false, hint: `${MINERAL_PICK_COUNT} deposits is the limit. Unpick one to choose another.` };
  }
  state.picks.push(id);
  return { ok: true, hint: '' };
}

// The plan summary, every number from the plan (mineralRoute.js). reserveHours
// is the mission's own reserve assumption.
export function planSummary(plan, reserveHours) {
  if (!plan) return null;
  const lines = [];
  if (Number.isFinite(plan.distance_m)) lines.push(`Total distance: ${formatKm(plan.distance_m)}`);
  if (Number.isFinite(plan.total_eva_minutes)) lines.push(`EVA clock cost: ${formatMinutes(plan.total_eva_minutes)}`);
  if (Number.isFinite(plan.deposit_stop_minutes)) lines.push(`${plan.deposit_stop_minutes} min per deposit stop (ASSUMPTION)`);
  const ok = plan.reserve_ok !== false;
  const reserve = ok
    ? `Reserve stays above ${reserveHours} h`
    : `Warning: this plan goes under the ${reserveHours} h reserve. You may still go.`;
  return { lines, reserve, ok };
}

function reserveHoursOf(mission) {
  const found = mission.data && Array.isArray(mission.data.assumptions) ? mission.data.assumptions.find((a) => a.id === 'reserveHours') : null;
  return found && Number.isFinite(found.value) ? found.value : 1; // 1 h is the brief's figure
}

const box = (w, h, d, color, x, y, z) => ({ geometry: new THREE.BoxGeometry(w, h, d), color, x, y, z });

export function installCabinMinerals(mission, deps = {}) {
  const state = ensureMineralState(mission);
  const cabin = deps.cabin || mission.cabin || null;
  const patch = deps.patch;
  const ui = deps.ui && deps.ui.add ? deps.ui : mission.ui;
  const renderer = deps.renderer || null;
  const terrain = deps.terrain || (mission.world && mission.world.terrain) || null;
  if (!cabin || !cabin.group || !patch) throw new Error('installCabinMinerals needs the cabin and the patch');
  const anisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  const reserveHours = reserveHoursOf(mission);

  // ---- objects in the cabin ---------------------------------------------------
  const group = new THREE.Group();
  group.name = 'cabin-minerals';
  cabin.group.add(group);

  const panel = createPanel({ name: 'cabin-mineral-map', widthPx: WALL.widthPx, heightPx: WALL.heightPx, widthM: WALL.widthM, anisotropy });
  panel.mesh.position.set(HALF_W - 0.045, WALL.y, WALL.z);
  panel.mesh.rotation.y = -Math.PI / 2; // faces into the room
  group.add(panel.mesh);
  if (ui) ui.add(panel);

  const P = PALETTE;
  const shelfTop = SHELF.y;
  const shelfZ = BACK_Z - SHELF.depthM / 2;
  const parts = [
    // frame behind the wall map
    box(0.04, panel.heightM + 0.1, WALL.widthM + 0.1, P.slate, HALF_W - 0.02, WALL.y, WALL.z),
    // shelf: back plate, board, lip, two brackets
    box(SHELF.widthM, 0.5, 0.03, P.slate, SHELF.x, shelfTop + 0.2, BACK_Z - 0.015),
    box(SHELF.widthM, 0.05, SHELF.depthM, P.offWhite, SHELF.x, shelfTop - 0.025, shelfZ),
    box(SHELF.widthM, 0.03, 0.03, P.marsOrange, SHELF.x, shelfTop + 0.015, BACK_Z - SHELF.depthM + 0.015),
    box(0.05, 0.2, SHELF.depthM - 0.04, P.slate, SHELF.x - SHELF.widthM / 2 + 0.08, shelfTop - 0.15, shelfZ + 0.02),
    box(0.05, 0.2, SHELF.depthM - 0.04, P.slate, SHELF.x + SHELF.widthM / 2 - 0.08, shelfTop - 0.15, shelfZ + 0.02),
  ];
  const shelfSlots = [];
  for (let i = 0; i < MINERAL_PICK_COUNT; i++) {
    const x = SHELF.x + (i - (MINERAL_PICK_COUNT - 1) / 2) * SHELF.slotGapM;
    parts.push({ geometry: new THREE.CylinderGeometry(0.085, 0.1, 0.02, 6), color: P.teal, x, y: shelfTop + 0.01, z: shelfZ });
    const slot = new THREE.Object3D();
    slot.name = `cabin-shelf-slot-${i + 1}`;
    slot.position.set(x, shelfTop + 0.02, shelfZ); // a container stands here, its base at the slot's origin
    slot.userData.slotIndex = i;
    group.add(slot);
    shelfSlots.push(slot);
  }
  const furniture = new THREE.Mesh(mergeParts(parts), lowPolyMaterial());
  furniture.name = 'cabin-mineral-shelf';
  group.add(furniture);

  const shelfLabel = createPanel({ name: 'cabin-shelf-label', widthPx: 512, heightPx: 128, widthM: 0.9, anisotropy });
  shelfLabel.mesh.position.set(SHELF.x, shelfTop + 0.62, BACK_Z - 0.035);
  shelfLabel.mesh.rotation.y = Math.PI;
  group.add(shelfLabel.mesh);

  // ---- which slot a ray or a hand is on (for the sampling workstream) ------------
  const slotCentre = new THREE.Vector3();
  const toCentre = new THREE.Vector3();
  function slotWorld(i, target) {
    shelfSlots[i].updateWorldMatrix(true, false);
    target.setFromMatrixPosition(shelfSlots[i].matrixWorld);
    target.y += 0.1; // the middle of a container standing in the slot
    return target;
  }
  // ray = { origin, direction } in world space (a THREE.Ray works). Index 0..2 of the
  // nearest slot the ray passes within reach of, or -1. No allocations.
  function slotAt(ray) {
    if (!ray || !ray.origin || !ray.direction || !cabin.group.visible) return -1;
    const lengthSq = ray.direction.lengthSq();
    if (!(lengthSq > 0)) return -1;
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < shelfSlots.length; i++) {
      slotWorld(i, slotCentre);
      toCentre.copy(slotCentre).sub(ray.origin);
      const t = toCentre.dot(ray.direction) / lengthSq;
      if (t <= 0 || t >= bestT) continue;
      const missSq = toCentre.lengthSq() - t * t * lengthSq;
      if (missSq > SHELF.slotReachM * SHELF.slotReachM) continue;
      best = i;
      bestT = t;
    }
    return best;
  }
  // The slot nearest a world point (a hand letting go), within maxM, or -1.
  function slotNear(point, maxM = 0.3) {
    let best = -1;
    let bestD = maxM;
    for (let i = 0; i < shelfSlots.length; i++) {
      const d = slotWorld(i, slotCentre).distanceTo(point);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  // ---- map geometry ------------------------------------------------------------
  const mapX = (x) => (x / patch.sizeX + 0.5) * MAP.size;
  const mapY = (z) => (z / patch.sizeZ + 0.5) * MAP.size;
  const groupOf = (id) => state.group(id);

  // The picture under the pins: photo (or relief), minerals, stations. Made once per data load.
  const base = document.createElement('canvas');
  base.width = MAP.size;
  base.height = MAP.size;
  const baseCtx = base.getContext('2d');
  let baseKind = 'none';

  function drawRelief(ctx) {
    // Shaded relief from the terrain heights, lit from the north-west.
    const n = RELIEF_N;
    const small = document.createElement('canvas');
    small.width = n;
    small.height = n;
    const smallCtx = small.getContext('2d');
    const picture = smallCtx.createImageData(n, n);
    const stepX = patch.sizeX / n;
    const stepZ = patch.sizeZ / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = (c + 0.5) * stepX - patch.sizeX / 2;
        const z = (r + 0.5) * stepZ - patch.sizeZ / 2;
        const dx = (patch.elevationAt(x + stepX, z) - patch.elevationAt(x - stepX, z)) / (2 * stepX);
        const dz = (patch.elevationAt(x, z + stepZ) - patch.elevationAt(x, z - stepZ)) / (2 * stepZ);
        let shade = (-dx * -0.6 + 0.5 + -dz * -0.6) / Math.sqrt(dx * dx + dz * dz + 1);
        if (!Number.isFinite(shade)) shade = 0.4;
        const v = Math.round(60 + 150 * Math.min(Math.max(shade, 0), 1));
        const i = (r * n + c) * 4;
        picture.data[i] = v;
        picture.data[i + 1] = v;
        picture.data[i + 2] = v;
        picture.data[i + 3] = 255;
      }
    }
    smallCtx.putImageData(picture, 0, 0);
    ctx.drawImage(small, 0, 0, MAP.size, MAP.size);
  }

  function photoImage() {
    const fromDeps = deps.photo && deps.photo.texture ? deps.photo.texture.image : null;
    if (fromDeps) return fromDeps;
    const material = terrain && terrain.material;
    const map = material && (material.map || (material.material && material.material.map));
    return map && map.image ? map.image : null;
  }

  function drawBase() {
    const ctx = baseCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.dark;
    ctx.fillRect(0, 0, MAP.size, MAP.size);
    const image = photoImage();
    baseKind = 'relief';
    if (image) {
      try {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, MAP.size, MAP.size); // row 0 of the photo is north, like the map
        baseKind = 'photo';
      } catch {
        baseKind = 'relief';
      }
    }
    if (baseKind === 'relief') drawRelief(ctx);
    // Dim the ground a little so the flat group colours stand out.
    ctx.fillStyle = 'rgba(11, 15, 20, 0.3)';
    ctx.fillRect(0, 0, MAP.size, MAP.size);

    // Mineral groups: one flat rectangle per 36 m data pixel.
    const data = state.data;
    const grid = data && data.grid;
    if (grid && Array.isArray(grid.data) && grid.width > 0 && grid.height > 0) {
      const colors = data.classes.map((cls) => {
        const g = groupOf(cls.group);
        if (!g || g.id === 'unclassified') return null;
        return cls.confidence === 'medium' ? g.paleColor || g.color : g.color;
      });
      const nw = patch.lonLatToLocal(grid.west, grid.north);
      const se = patch.lonLatToLocal(grid.east, grid.south);
      const x0 = mapX(nw.x);
      const y0 = mapY(nw.z);
      const cellW = (mapX(se.x) - x0) / grid.width;
      const cellH = (mapY(se.z) - y0) / grid.height;
      ctx.globalAlpha = OVERLAY_ALPHA;
      for (let r = 0; r < grid.height; r++) {
        const top = Math.round(y0 + r * cellH);
        const bottom = Math.round(y0 + (r + 1) * cellH);
        for (let c = 0; c < grid.width; c++) {
          const index = grid.data[r * grid.width + c];
          const color = index >= 0 ? colors[index] : null;
          if (!color) continue;
          const left = Math.round(x0 + c * cellW);
          ctx.fillStyle = color;
          ctx.fillRect(left, top, Math.round(x0 + (c + 1) * cellW) - left, bottom - top);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Stations and the airlock: squares, numbered as on the beacons.
    ctx.textAlign = 'center';
    for (const beacon of mission.beacons || []) {
      const x = mapX(beacon.x);
      const y = mapY(beacon.z);
      ctx.fillStyle = THEME.text;
      ctx.strokeStyle = THEME.dark;
      ctx.lineWidth = 4;
      ctx.fillRect(x - 19, y - 19, 38, 38);
      ctx.strokeRect(x - 19, y - 19, 38, 38);
      ctx.fillStyle = THEME.dark;
      setFont(ctx, 28, 'bold');
      ctx.fillText(beacon.kind === 'airlock' ? 'A' : String(beacon.badge), x, y + 10);
    }
    ctx.textAlign = 'left';
  }

  // ---- drawing the wall panel -----------------------------------------------------
  let hint = '';
  const shownText = { map: '', shelf: '' };
  // Once the player has left with confirmed picks they are fixed (samples are collected against them).
  // A walk begun without picks (?skipcabin=1) leaves them open, so the door can never be stuck shut.
  const evaStarted = () => !!(state.confirmed && cabin.state && cabin.state.evaCount > 0);

  function line(ctx, points, color, width, dash) {
    if (!Array.isArray(points) || points.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = MAP.x + mapX(points[i][0]);
      const y = MAP.y + mapY(points[i][1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.setLineDash(dash || []);
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function wallButton(ctx, id, x, y, w, h, label, enabled, onTap) {
    fillChamfer(ctx, x, y, w, h, { cut: 18, fill: enabled ? THEME.accent : THEME.card, stroke: enabled ? THEME.text : THEME.cardLine, lineWidth: 4 });
    ctx.fillStyle = enabled ? THEME.dark : THEME.dim;
    ctx.textAlign = 'center';
    fitText(ctx, label, x + w / 2, y + h / 2 + 16, 46, w - 36, { weight: 'bold', minPx: 30 });
    ctx.textAlign = 'left';
    panel.region(id, x, y, w, h, onTap, { hover: enabled });
  }

  function draw() {
    const W = panel.widthPx;
    const H = panel.heightPx;
    const ctx = panel.begin();
    const said = [];
    const say = (text) => said.push(text);
    const data = state.data;
    const deposits = data && Array.isArray(data.deposits) ? data.deposits : [];
    const needed = picksNeeded(state);
    const locked = evaStarted();

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, H);
    fillChamfer(ctx, 8, 8, W - 16, H - 16, { cut: 26, fill: THEME.card, stroke: state.confirmed ? THEME.accent : THEME.cardLine, lineWidth: 5 });

    // -- the map
    ctx.fillStyle = THEME.accent;
    const title = 'MINERALS FROM ORBIT: PICK THREE DEPOSITS';
    fitText(ctx, title, MAP.x, 68, 40, MAP.size, { weight: 'bold', minPx: 30 });
    say(title);
    ctx.drawImage(base, MAP.x, MAP.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(MAP.x, MAP.y, MAP.size, MAP.size);
    ctx.clip();
    const plan = state.plan;
    if (plan && Array.isArray(plan.polyline) && plan.polyline.length > 1) {
      line(ctx, plan.polyline, THEME.dark, 11);
      line(ctx, plan.polyline, css(PALETTE.routeBlue), 6);
    } else if (mission.route && mission.route.points) {
      line(ctx, mission.route.points, css(PALETTE.routeBlueLight), 4, [14, 10]);
    }
    ctx.textAlign = 'center';
    for (const deposit of deposits) {
      const x = MAP.x + mapX(deposit.x);
      const y = MAP.y + mapY(deposit.z);
      const picked = state.picks.includes(deposit.id);
      const g = groupOf(deposit.group);
      ctx.beginPath();
      ctx.moveTo(x + PIN_R, y);
      for (let k = 1; k <= 8; k++) ctx.lineTo(x + PIN_R * Math.cos((k * Math.PI) / 4), y + PIN_R * Math.sin((k * Math.PI) / 4));
      ctx.closePath();
      ctx.fillStyle = picked ? THEME.text : THEME.dark;
      ctx.fill();
      ctx.lineWidth = picked ? 7 : 5;
      ctx.strokeStyle = picked ? THEME.accent : g ? g.color : THEME.dim;
      ctx.stroke();
      ctx.fillStyle = picked ? THEME.dark : THEME.text;
      fitText(ctx, deposit.id, x, y + 8, 24, 2 * PIN_R - 8, { weight: 'bold', minPx: 16 });
    }
    ctx.textAlign = 'left';
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = THEME.cardLine;
    ctx.strokeRect(MAP.x, MAP.y, MAP.size, MAP.size);
    for (const deposit of deposits) {
      panel.region(`pin-${deposit.id}`, MAP.x + mapX(deposit.x) - 32, MAP.y + mapY(deposit.z) - 32, 64, 64, () => api.toggle(deposit.id));
    }

    // -- the list of candidates
    ctx.fillStyle = THEME.text;
    const listTitle = `CANDIDATE DEPOSITS: ${state.picks.length} of ${needed || MINERAL_PICK_COUNT} picked`;
    fitText(ctx, listTitle, LIST.x, 68, 30, LIST.w, { weight: 'bold', minPx: 22 });
    say(listTitle);
    if (!data) {
      ctx.fillStyle = THEME.dim;
      setFont(ctx, 30);
      drawParagraph(ctx, 'Mineral data not loaded yet.', LIST.x, LIST.y + 44, LIST.w, 38);
      say('Mineral data not loaded yet.');
    }
    const listRoom = 760;
    const rowH = deposits.length ? Math.max(40, Math.min(76, Math.floor(listRoom / deposits.length))) : 76;
    const twoLines = rowH >= 60;
    deposits.forEach((deposit, i) => {
      const y = LIST.y + i * rowH;
      const h = rowH - 6;
      const picked = state.picks.includes(deposit.id);
      const g = groupOf(deposit.group);
      const name = g ? g.name : String(deposit.group);
      const area = `${Number(deposit.area_ha).toFixed(1)} ha`;
      fillChamfer(ctx, LIST.x, y, LIST.w, h, { cut: 10, fill: picked ? '#2c4250' : THEME.bg, stroke: picked ? THEME.accent : THEME.cardLine, lineWidth: picked ? 5 : 3 });
      const baseline = twoLines ? y + 32 : y + h / 2 + 10;
      ctx.fillStyle = THEME.text;
      fitText(ctx, deposit.id, LIST.x + 14, baseline, 28, 62, { weight: 'bold', minPx: 20 });
      if (g) {
        ctx.fillStyle = g.color;
        ctx.fillRect(LIST.x + 84, baseline - 23, 26, 26);
      }
      ctx.fillStyle = THEME.text;
      ctx.textAlign = 'right';
      fitText(ctx, area, LIST.x + LIST.w - 14, baseline, 28, 120, { weight: 'bold' });
      ctx.textAlign = 'left';
      fitText(ctx, name, LIST.x + 122, baseline, 28, twoLines ? 250 : 130, { weight: 'bold', minPx: 20 });
      ctx.fillStyle = THEME.dim;
      if (twoLines) fitText(ctx, ORBIT_NOTE, LIST.x + 122, y + 60, 22, 260);
      else fitText(ctx, ORBIT_NOTE, LIST.x + 258, baseline, 20, 130, { minPx: 14 });
      if (picked) {
        ctx.fillStyle = THEME.accent;
        ctx.textAlign = 'right';
        if (twoLines) fitText(ctx, 'PICKED', LIST.x + LIST.w - 14, y + 60, 22, 110, { weight: 'bold' });
        ctx.textAlign = 'left';
      }
      say(`${deposit.id} ${name} ${area} ${ORBIT_NOTE}${picked ? ' PICKED' : ''}`);
      panel.region(`row-${deposit.id}`, LIST.x, y, LIST.w, h, () => api.toggle(deposit.id));
    });

    // -- hint under the list
    const defaultHint = !deposits.length
      ? ''
      : locked
        ? 'The EVA has started: the picks are fixed.'
        : state.confirmed
          ? 'Confirmed. The airlock is behind you. CHANGE lets you pick again before leaving.'
          : state.picks.length === needed
            ? 'Press CONFIRM to set the route.'
            : 'Trigger (click) on a pin or a row to pick it.';
    const shownHint = hint || defaultHint;
    ctx.fillStyle = hint ? THEME.amber : THEME.dim;
    setFont(ctx, 28, hint ? 'bold' : 'normal');
    drawParagraph(ctx, shownHint, LIST.x, 900, LIST.w, 36, 3);
    say(shownHint);

    // -- legend
    let y = 68;
    ctx.fillStyle = THEME.text;
    fitText(ctx, 'MINERAL GROUPS (BEST MATCH)', SIDE.x, y, 30, SIDE.w, { weight: 'bold', minPx: 22 });
    say('MINERAL GROUPS (BEST MATCH)');
    y += 20;
    for (const g of data ? data.groups : []) {
      if (g.id === 'unclassified') continue;
      ctx.fillStyle = g.color;
      ctx.fillRect(SIDE.x, y, 44, 30);
      ctx.fillStyle = g.paleColor || g.color;
      ctx.fillRect(SIDE.x + 44, y, 44, 30);
      ctx.strokeStyle = THEME.dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(SIDE.x, y, 88, 30);
      ctx.fillStyle = THEME.text;
      fitText(ctx, g.name, SIDE.x + 104, y + 25, 28, SIDE.w - 104, { minPx: 20 });
      say(g.name);
      y += 40;
    }
    ctx.fillStyle = THEME.dim;
    setFont(ctx, 22);
    const notes = [
      'Paler: medium confidence. No colour: no known spectral class.',
      (data && data.caveat) || CAVEAT_FALLBACK,
      'Octagons: candidate deposits. Squares: airlock (A) and stations. Blue line: route.',
    ];
    y += 22;
    for (const note of notes) {
      y = drawParagraph(ctx, note, SIDE.x, y, SIDE.w, 27, 3).y + 8;
      say(note);
    }

    // -- plan
    y = Math.max(y + 18, 500);
    ctx.fillStyle = THEME.cardLine;
    ctx.fillRect(SIDE.x, y - 34, SIDE.w, 3);
    ctx.fillStyle = THEME.text;
    fitText(ctx, 'PLAN', SIDE.x, y, 30, SIDE.w, { weight: 'bold' });
    say('PLAN');
    y += 42;
    const summary = planSummary(plan, reserveHours);
    if (summary) {
      ctx.fillStyle = THEME.text;
      for (const text of summary.lines) {
        fitText(ctx, text, SIDE.x, y, 30, SIDE.w, { minPx: 22 });
        say(text);
        y += 40;
      }
      ctx.fillStyle = summary.ok ? THEME.accent : THEME.amber;
      setFont(ctx, 28, 'bold');
      drawParagraph(ctx, summary.reserve, SIDE.x, y, SIDE.w, 34, 3);
      say(summary.reserve);
    } else {
      ctx.fillStyle = THEME.dim;
      setFont(ctx, 28);
      const waiting = state.picks.length === needed && needed > 0 ? 'Working out the route...' : 'Pick three deposits to see the distance and the EVA clock cost.';
      drawParagraph(ctx, waiting, SIDE.x, y, SIDE.w, 36, 3);
      say(waiting);
    }

    // -- buttons
    const canConfirm = needed > 0 && state.picks.length === needed && !state.confirmed && !locked;
    const canChange = state.confirmed && !locked;
    wallButton(ctx, 'confirm', SIDE.x, 800, SIDE.w, 88, state.confirmed ? 'CONFIRMED' : 'CONFIRM', canConfirm, () => api.confirm());
    wallButton(ctx, 'change', SIDE.x, 904, SIDE.w, 88, 'CHANGE', canChange, () => api.change());
    say(state.confirmed ? 'CONFIRMED' : 'CONFIRM');
    say('CHANGE');

    panel.end();
    shownText.map = said.join('\n');
  }

  function drawShelfLabel() {
    const ctx = shelfLabel.begin();
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, shelfLabel.widthPx, shelfLabel.heightPx);
    fillChamfer(ctx, 6, 6, shelfLabel.widthPx - 12, shelfLabel.heightPx - 12, { cut: 16, fill: THEME.card, stroke: THEME.cardLine, lineWidth: 4 });
    const text = `SAMPLE SHELF  ${state.shelved.length} / ${MINERAL_PICK_COUNT}`;
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    fitText(ctx, text, shelfLabel.widthPx / 2, 82, 46, shelfLabel.widthPx - 48, { weight: 'bold', minPx: 30 });
    ctx.textAlign = 'left';
    shelfLabel.end();
    shownText.shelf = text;
  }

  const refreshDoor = () => {
    if (cabin.refreshDoorSign) cabin.refreshDoorSign();
  };
  function setHint(text) {
    if (hint === text) return;
    hint = text;
    draw();
  }

  // ---- picking ---------------------------------------------------------------------
  const api = {
    group,
    panel,
    shelf: furniture,
    shelfLabel,
    shelfSlots,
    slotAt,
    slotNear,
    shownText,
    get hint() {
      return hint;
    },
    get baseKind() {
      return baseKind;
    },
    redraw: draw,

    // A pin or its row was tapped.
    toggle(id) {
      const result = togglePick(state, id, evaStarted());
      hint = result.hint;
      if (result.ok) state.emit('picks'); // redraws through the listener
      else draw();
      return result.ok;
    },
    confirm() {
      const needed = picksNeeded(state);
      if (state.confirmed || evaStarted()) return false;
      if (!needed || state.picks.length !== needed) {
        setHint(`Pick ${needed || MINERAL_PICK_COUNT} deposits first.`);
        return false;
      }
      hint = '';
      state.confirmed = true;
      state.emit('confirmed');
      return true;
    },
    change() {
      if (evaStarted()) {
        setHint('The EVA has started: the picks are fixed.');
        return false;
      }
      if (!state.confirmed) {
        setHint('Not confirmed yet: tap a pin or a row to pick or unpick it.');
        return false;
      }
      hint = '';
      state.confirmed = false;
      state.emit('confirmed');
      return true;
    },
  };

  // ---- the airlock door waits for the picks (hook in cabin.js: doorGuard) ---------------
  // Returns null (nothing to say) or { block, hint }. With no mineral data or no
  // deposits the door is never held: the walk itself must stay usable.
  cabin.doorGuard = (attempt = false) => {
    if (picksNeeded(state) === 0) return null;
    if (!state.confirmed) {
      if (attempt) setHint(`${DOOR_HINT}.`);
      return { block: true, hint: DOOR_HINT };
    }
    if (state.plan && state.plan.reserve_ok === false && !evaStarted()) {
      return { block: false, hint: `Plan goes under the ${reserveHours} h reserve. You may still go.` };
    }
    return null;
  };

  state.on((kind) => {
    if (kind === 'data') drawBase();
    if (kind === 'data' || kind === 'picks' || kind === 'plan' || kind === 'confirmed') draw();
    if (kind === 'data' || kind === 'plan' || kind === 'confirmed') refreshDoor();
    if (kind === 'shelved') drawShelfLabel();
  });

  drawBase();
  draw();
  drawShelfLabel();
  refreshDoor();
  mission.cabinMinerals = api;
  return api;
}
