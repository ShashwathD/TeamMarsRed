import * as THREE from 'three';
import { PALETTE, css, lowPolyMaterial, mergeParts } from './lowpoly.js';

// Data layers that the tablet's LAYERS tab switches (brief: LAYER BEHAVIOUR).
//
// The list, names and credits come from the mission file (data.layers); this
// module only knows how to show and hide each one:
//   photo      ON at the start. The HiRISE photo on the walk patch (off: plain
//              colour, real shape)
//   slope      OFF at the start. Slope-hazard overlay on the walk patch: amber
//              and red bands (limits from data.terrain.slopeBandsDeg) from the
//              slope of the 2 m terrain, the same slope grid the route planner uses
//   traverse   ON at the start, but only on the tablet's map: in the world the
//              rover's real path (the orange ribbon, with a small stud at each
//              rover waypoint inside the patch) stays hidden until
//              reveal('traverse') is called (station S3 does that)
//   samples    ON at the start. A ring of stakes around each place a core in
//              the mission file was taken (all are at stations S4 and S5), with
//              a sign that says "approximate position": the place is the
//              rover's waypoint at that sol, which is why it is a ring, not a pin
//   panoramas  ON at the start. Camera icon on the tablet's map; nothing in
//              the world yet (the step that adds the panoramas reads the state)
//   backdrop   the distant CTX terrain around the walk patch. Always on: it
//              has no chip on the tablet (it is in the credits), only a
//              switch for code (the cabin step may need to hide it)

// Layers that are drawn in the world only once a station has turned them on.
const WORLD_FROM_STATION = { traverse: 'S3' };
// Layers with no chip on the tablet.
const NO_CHIP = ['backdrop'];

const SLOPE_FULL_DEG = 63.75; // slope map value 255: 4 steps per degree
const RING_RADIUS_M = 2.6;
const RING_STAKES = 6;

// One byte per terrain sample, laid out like the photo (texture row 0 = south edge).
function createSlopeTexture(routeGrid, patch) {
  const { cols, rows } = patch;
  const bytes = new Uint8Array(cols * rows);
  const slope = routeGrid.slopeDeg;
  for (let r = 0; r < rows; r++) {
    const out = (rows - 1 - r) * cols;
    for (let c = 0; c < cols; c++) {
      const deg = slope[r * cols + c];
      bytes[out + c] = Number.isFinite(deg) ? Math.min(255, Math.round((deg / SLOPE_FULL_DEG) * 255)) : 0;
    }
  }
  const texture = new THREE.DataTexture(bytes, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  texture.name = 'slope-map';
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Cores that share a rover waypoint share one site.
export function sampleSites(cores) {
  const sites = [];
  for (const core of cores) {
    const { x, z } = core.position;
    let site = sites.find((s) => Math.hypot(s.x - x, s.z - z) < 1);
    if (!site) {
      site = { x, z, feature: core.feature, numbers: [], names: [], waypointSol: core.waypointSol };
      sites.push(site);
    }
    site.numbers.push(core.number);
    site.names.push(core.name);
  }
  return sites;
}

// Low-poly ring of short stakes around each site, plus one taller post that
// carries a sample-tube shape. One mesh for all sites.
function createSampleMarkers(patch, sites) {
  const parts = [];
  for (const site of sites) {
    for (let k = 0; k < RING_STAKES; k++) {
      const angle = (k / RING_STAKES) * Math.PI * 2;
      const x = site.x + Math.sin(angle) * RING_RADIUS_M;
      const z = site.z - Math.cos(angle) * RING_RADIUS_M;
      const ground = patch.groundY(x, z);
      if (Number.isNaN(ground)) continue;
      const tall = k === 0; // the stake due north of the site carries the tube
      const height = tall ? 1.9 : 0.9;
      parts.push({ geometry: new THREE.BoxGeometry(0.16, height, 0.16), color: PALETTE.offWhite, x, y: ground + height / 2 - 0.15, z, rotY: angle });
      if (tall) {
        // A fat sample tube lying at a slant across the top of the post.
        const tube = new THREE.CylinderGeometry(0.16, 0.16, 0.8, 6).rotateZ(Math.PI / 3);
        const cap = new THREE.CylinderGeometry(0.19, 0.19, 0.2, 6).translate(0, 0.45, 0).rotateZ(Math.PI / 3);
        parts.push({ geometry: tube, color: PALETTE.slate, x, y: ground + height + 0.05, z, rotY: angle });
        // The body of the three-sided "approximate position" sign (its faces are a second mesh).
        parts.push({ geometry: new THREE.CylinderGeometry(SIGN_INRADIUS_M * 2, SIGN_INRADIUS_M * 2, SIGN_H_M + 0.06, 3), color: PALETTE.slate, x, y: ground + SIGN_Y_M, z });
        parts.push({ geometry: cap, color: PALETTE.amber, x, y: ground + height + 0.05, z, rotY: angle });
      } else {
        parts.push({ geometry: new THREE.OctahedronGeometry(0.2, 0), color: PALETTE.amber, x, y: ground + height - 0.05, z });
      }
    }
  }
  const mesh = new THREE.Mesh(mergeParts(parts), lowPolyMaterial());
  mesh.name = 'mission-sample-sites';
  return mesh;
}

// A small low-poly stud on the ground at each rover waypoint. One mesh.
function createWaypointStuds(patch, waypoints) {
  const parts = [];
  const seen = [];
  for (const [x, z] of waypoints) {
    if (seen.some((s) => Math.hypot(s[0] - x, s[1] - z) < 0.5)) continue; // several waypoints can share a spot
    seen.push([x, z]);
    const ground = patch.groundY(x, z);
    if (Number.isNaN(ground)) continue;
    parts.push({ geometry: new THREE.CylinderGeometry(0.3, 0.5, 0.4, 6), color: PALETTE.roverOrange, x, y: ground + 0.1, z });
  }
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(mergeParts(parts), lowPolyMaterial());
  mesh.name = 'mission-rover-stops';
  mesh.userData.count = parts.length;
  return mesh;
}

// "APPROXIMATE POSITION" signs: a three-sided sign on the tall post of each
// site, so it can be read from any side. One mesh and one small texture for
// all sites; the slate core behind the faces is part of the stakes mesh.
const SIGN_W_M = 1.1;
const SIGN_H_M = 0.5;
const SIGN_Y_M = 1.2; // middle of the sign above the ground
const SIGN_INRADIUS_M = SIGN_W_M / (2 * Math.sqrt(3));
export const SIGN_TEXT = ['APPROXIMATE', 'POSITION'];

function signTexture(anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 232;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css(PALETTE.amber);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = css(PALETTE.slate);
  ctx.fillRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = css(PALETTE.offWhite);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 70px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillText(SIGN_TEXT[0], canvas.width / 2, 78, canvas.width - 48);
  ctx.fillText(SIGN_TEXT[1], canvas.width / 2, 160, canvas.width - 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

// Where the tall post of a site stands (due north of it, on the ring).
const signPost = (site) => ({ x: site.x, z: site.z - RING_RADIUS_M });

function createSampleSigns(patch, sites, anisotropy) {
  const positions = [];
  const uvs = [];
  for (const site of sites) {
    const post = signPost(site);
    const ground = patch.groundY(post.x, post.z);
    if (Number.isNaN(ground)) continue;
    for (let k = 0; k < 3; k++) {
      const face = new THREE.PlaneGeometry(SIGN_W_M, SIGN_H_M).toNonIndexed();
      face.translate(0, 0, SIGN_INRADIUS_M + 0.006);
      face.rotateY(Math.PI / 3 + (k * Math.PI * 2) / 3); // the faces of a 3-sided cylinder
      face.translate(post.x, ground + SIGN_Y_M, post.z);
      positions.push(...face.attributes.position.array);
      uvs.push(...face.attributes.uv.array);
      face.dispose();
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: signTexture(anisotropy), fog: false }));
  mesh.name = 'mission-sample-signs';
  return mesh;
}

// terrain: the walk terrain (its material carries the photo and slope switches);
// surround: the distant terrain or null; traverse: the rover-path mesh.
// The sample-site markers go into their own group in the scene
// ('mission-layer-objects'), not into the mission's route-and-beacons group,
// so mission.stats() keeps meaning the route, the rover path and the beacons.
export function createLayers({ data, patch, routeGrid, terrain, surround, traverse, scene, anisotropy = 4 }) {
  const ground = terrain && terrain.material && terrain.material.userData ? terrain.material.userData.ground : null;
  const bands = data.terrain.slopeBandsDeg;

  let slopeTexture = null;
  if (ground) {
    slopeTexture = createSlopeTexture(routeGrid, patch);
    ground.setSlopeMap(slopeTexture, {
      fullDeg: SLOPE_FULL_DEG,
      amberFromDeg: bands.amberFrom,
      redAboveDeg: bands.redAbove,
      amber: PALETTE.amber,
      red: PALETTE.red,
    });
  }

  const sites = sampleSites(data.cores);
  const samples = createSampleMarkers(patch, sites);
  const signs = createSampleSigns(patch, sites, anisotropy);
  const stops = createWaypointStuds(patch, data.traverse.waypoints || []);
  const group = new THREE.Group();
  group.name = 'mission-layer-objects';
  group.add(samples, signs);
  if (stops) group.add(stops);
  scene.add(group);

  // Layers still waiting for their station before they show in the world.
  const waiting = new Set(Object.keys(WORLD_FROM_STATION));
  const showTraverse = (on) => {
    const shown = on && !waiting.has('traverse');
    if (traverse) traverse.visible = shown;
    if (stops) stops.visible = shown;
  };

  // What each switch does; `can` is false when there is nothing to switch.
  const controls = {
    photo: { on: true, can: !!(ground && ground.hasPhoto), apply: (on) => ground.setPhoto(on) },
    slope: { on: false, can: !!ground, apply: (on) => ground.setSlope(on) },
    traverse: { on: true, can: !!traverse, apply: showTraverse },
    samples: { on: true, can: true, apply: (on) => (samples.visible = signs.visible = on) },
    panoramas: { on: true, can: true, apply: () => {} },
    backdrop: { on: true, can: !!(surround && surround.mesh), apply: (on) => (surround.mesh.visible = on) },
  };

  const layers = {
    // The mission file's list, in its order, for the tablet chips.
    list: data.layers.filter((layer) => controls[layer.id] && !NO_CHIP.includes(layer.id)),
    // Every layer of the mission file, chip or not, for the credits.
    credits: data.layers,
    sites,
    group,
    samples,
    signs,
    stops,
    signPost,
    slopeTexture,
    slopeFullDeg: SLOPE_FULL_DEG,
    bands,
    onChange: null, // (id, on) => {} after a switch

    has: (id) => Object.prototype.hasOwnProperty.call(controls, id),
    can: (id) => !!(controls[id] && controls[id].can),
    get: (id) => !!(controls[id] && controls[id].on),

    set(id, on) {
      const control = controls[id];
      if (!control || !control.can) return false;
      control.on = !!on;
      control.apply(control.on);
      if (layers.onChange) layers.onChange(id, control.on);
      return true;
    },
    toggle: (id) => layers.set(id, !layers.get(id)),

    // Is the layer drawn in the world right now? (On, and not waiting for its station.)
    inWorld: (id) => layers.get(id) && !waiting.has(id),
    // The station that turns the layer on in the world, while it has not yet; else null.
    waitingFor: (id) => (waiting.has(id) ? WORLD_FROM_STATION[id] : null),
    // A station turns the layer on in the world (S3: the rover traverse).
    reveal(id) {
      if (!waiting.delete(id)) return false;
      const control = controls[id];
      control.on = true;
      control.apply(true);
      if (layers.onChange) layers.onChange(id, true);
      return true;
    },

    state() {
      const out = {};
      for (const id of Object.keys(controls)) out[id] = controls[id].on;
      return out;
    },
  };
  showTraverse(controls.traverse.on); // hidden in the world until its station
  return layers;
}
