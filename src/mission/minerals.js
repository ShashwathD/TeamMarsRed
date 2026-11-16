import { ensureMineralState } from './mineralState.js';

// The CRISM mineral layer (brief: TABLET AND CREDITS).
//
//   installMinerals(mission, deps) loads data/walk/<site>/minerals.json into
//   mission.minerals.data (emit 'data'), makes ONE small texture from its grid
//   (one texel per 36 m CRISM pixel, nearest-neighbour so the pixels read
//   honestly), hands it to the walk-ground material as a translucent overlay
//   (off at the start, no extra geometry) and registers the "Minerals" chip in
//   the tablet's LAYERS tab. A missing file leaves the whole feature off.
//
// Every name, colour, size and caveat shown comes from minerals.json. The map
// says which minerals are probably there. It is NOT a hazard map.
//
// No top-level import of three: the pure parts below run in node for checks;
// the texture is made with deps.THREE.

export const MINERAL_LAYER_ID = 'minerals';
export const MINERAL_OVERLAY_ALPHA = 0.55; // how strongly the overlay covers the ground (looks only)
const UNCLASSIFIED = 'unclassified';

const hexToRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Groups that are drawn (everything but "unclassified"), in the file's order.
export function drawnGroups(data) {
  return data.groups.filter((group) => group.id !== UNCLASSIFIED);
}

// RGBA bytes (sRGB) for the grid, one texel per CRISM pixel. Row 0 of the
// result is the SOUTH edge (texture v = 0), the grid's row 0 is north.
// Group colour for high confidence, the paler one for medium, alpha 0 for
// unclassified (-1) or anything the file does not name.
export function mineralPixels(data) {
  const { width, height, data: cells } = data.grid;
  const byGroup = new Map(data.groups.map((group) => [group.id, group]));
  const classColour = data.classes.map((cls) => {
    const group = byGroup.get(cls.group);
    if (!group || group.id === UNCLASSIFIED || !group.color) return null;
    return hexToRgb(cls.confidence === 'medium' && group.paleColor ? group.paleColor : group.color);
  });
  const bytes = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const out = (height - 1 - row) * width * 4;
    for (let col = 0; col < width; col++) {
      const colour = classColour[cells[row * width + col]];
      if (!colour) continue; // stays 0,0,0,0
      const o = out + col * 4;
      bytes[o] = colour[0];
      bytes[o + 1] = colour[1];
      bytes[o + 2] = colour[2];
      bytes[o + 3] = 255;
    }
  }
  return bytes;
}

// Walk-patch uv (u east, v north, 0..1 over the patch) -> grid uv:
// gridUv = patchUv * [sx, sy] + [ox, oy]. Both are plain lon/lat windows of
// the same projection, so this is a scale and an offset, nothing else.
export function mineralUvTransform(grid, meta) {
  const sx = (meta.east - meta.west) / (grid.east - grid.west);
  const sy = (meta.north - meta.south) / (grid.north - grid.south);
  return [sx, sy, (meta.west - grid.west) / (grid.east - grid.west), (meta.south - grid.south) / (grid.north - grid.south)];
}

// The class index (or -1) of the grid pixel under a lon/lat, or null outside the grid.
export function classIndexAt(data, lon, lat) {
  const g = data.grid;
  const col = Math.floor(((lon - g.west) / (g.east - g.west)) * g.width);
  const row = Math.floor(((g.north - lat) / (g.north - g.south)) * g.height);
  if (col < 0 || row < 0 || col >= g.width || row >= g.height) return null;
  return g.data[row * g.width + col];
}

const groupName = (data, id) => (data.groups.find((group) => group.id === id) || { name: id }).name;

// "Orbit says" for the stations, from minerals.json's "stations".
//   uniform: every station in the file has the same group (then it is said
//   once, in the S1 briefing, and not on the station cards).
export function stationGroups(data) {
  const byStation = (data && data.stations) || {};
  const ids = Object.keys(byStation);
  const groups = [...new Set(ids.map((id) => byStation[id].group))];
  return { byStation, uniform: ids.length > 0 && groups.length === 1, group: groups.length === 1 ? groups[0] : null };
}

export const orbitText = (name) => `Orbit says: ${name} (CRISM, approximate)`;

// The one line for a card, or null when that card gets none. 'S1' is the
// briefing: it carries the line when every station agrees (otherwise the
// start spot's own group).
export function orbitLine(mission, stationId) {
  const data = mission && mission.minerals ? mission.minerals.data : null;
  if (!data || !data.stations) return null;
  const { byStation, uniform, group } = stationGroups(data);
  if (stationId === 'S1') {
    if (uniform) return orbitText(groupName(data, group));
    const start = byStation.S1 || byStation.START;
    return start ? orbitText(groupName(data, start.group)) : null;
  }
  if (uniform || !byStation[stationId]) return null;
  return orbitText(groupName(data, byStation[stationId].group));
}

// A station's cards with the line added to the first card that has body text.
// Returns the same array when there is nothing to add.
export function withOrbitLine(mission, stationId, cards) {
  const line = orbitLine(mission, stationId);
  if (!line || !Array.isArray(cards) || !cards.length) return cards;
  let at = cards.findIndex((card) => card && typeof card.body === 'string' && card.body && !card.columns);
  if (at < 0) at = 0;
  return cards.map((card, i) => (i === at ? { ...card, body: card.body ? `${card.body}\n${line}` : line } : card));
}

// The LAYERS chip, in the shape of the mission file's layers plus:
//   info    the one-line explanation behind the chip's "i"
//   legend  [[css colour, group name], ...] drawn on the chip
//   creditNotes  sentences added to the credits entry (the caveats)
export function mineralLayer(data) {
  return {
    id: MINERAL_LAYER_ID,
    name: 'Minerals',
    mission: 'Mars Reconnaissance Orbiter (MRO)',
    instrument: 'CRISM',
    source: `Parente et al. 2021, ${data.licence}`,
    note: '',
    kind: 'spectral',
    retrieved: data.retrieved,
    info: `Best-match minerals from orbit, ${data.pixelSizeM} m pixels; names are spectral matches, not confirmed.`,
    legend: drawnGroups(data).map((group) => [group.color, group.name]),
    creditNotes: [data.caveat, data.surfaceNote].filter(Boolean),
  };
}

function createMineralTexture(THREE, data) {
  const { width, height } = data.grid;
  const texture = new THREE.DataTexture(mineralPixels(data), width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'mineral-map';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; // each 36 m pixel stays a flat square
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// deps: { THREE, patch, terrain, cabin (optional) }. Returns
// { loaded, data, layer, texture, uvTransform, set(on), toggle(), on }.
export async function installMinerals(mission, deps = {}) {
  const state = ensureMineralState(mission);
  const { THREE, patch, terrain } = deps;
  const api = {
    loaded: false,
    data: null,
    layer: null,
    texture: null,
    uvTransform: null,
    set: (on) => !!(mission.layerSet && mission.layerSet.set(MINERAL_LAYER_ID, on)),
    toggle: () => !!(mission.layerSet && mission.layerSet.toggle(MINERAL_LAYER_ID)),
    get on() {
      return !!(mission.layerSet && mission.layerSet.get(MINERAL_LAYER_ID));
    },
  };

  let data = state.data;
  if (!data) {
    try {
      const folder = patch && patch.folder ? patch.folder : `./data/walk/${mission.site}/`;
      const response = await fetch(`${folder}minerals.json`);
      if (!response.ok) return api; // no mineral data for this site: feature off
      data = await response.json();
    } catch (error) {
      console.warn(`Minerals: not loaded (${error.message})`);
      return api;
    }
    if (!data || !data.grid || !Array.isArray(data.grid.data) || !Array.isArray(data.groups) || !Array.isArray(data.classes)) return api;
    state.data = data;
    state.emit('data');
  }
  api.data = data;
  api.loaded = true;

  // The S1 briefing text carries the "Orbit says" line when every station
  // agrees. The cabin hologram reads mission.cardText('S1'), the station card
  // reads briefingCard() (hooked in stations/index.js): both get the same line.
  if (typeof mission.cardText === 'function' && !mission.cardText.withOrbitLine) {
    const plain = mission.cardText.bind(mission);
    mission.cardText = (id) => {
      const text = plain(id);
      const line = id === 'S1' ? orbitLine(mission, 'S1') : null;
      return line && typeof text === 'string' ? `${text}\n${line}` : text;
    };
    mission.cardText.withOrbitLine = true;
  }
  if (deps.cabin && typeof deps.cabin.redraw === 'function') deps.cabin.redraw();

  // Overlay on the walk ground + the chip.
  const ground = terrain && terrain.material && terrain.material.userData ? terrain.material.userData.ground : null;
  const canDraw = !!(THREE && patch && ground && typeof ground.setMineralMap === 'function');
  if (canDraw) {
    api.texture = createMineralTexture(THREE, data);
    api.uvTransform = mineralUvTransform(data.grid, patch.meta);
    ground.setMineralMap(api.texture, { uvTransform: api.uvTransform, alpha: MINERAL_OVERLAY_ALPHA });
  }
  api.layer = mineralLayer(data);
  if (mission.layerSet && typeof mission.layerSet.register === 'function') {
    mission.layerSet.register(api.layer, { on: false, can: canDraw, apply: (on) => canDraw && ground.setMinerals(on) });
  }
  return api;
}
