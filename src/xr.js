import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// WebXR (VR headset) support: VR button, stick movement, smooth turn, controller teleport, pointer rays.
//
// Reference space is 'local-floor': the headset reports the head relative to
// the real floor, and the player rig (controls.js) is the group that carries
// that floor around the terrain. The camera and both controllers are children
// of the rig.
//
// Walk: the LEFT thumbstick moves the rig over the ground, forward / back and
//   sideways relative to where the head faces (yaw only). Press the stick
//   down and hold it to run. Speeds are the desktop ones (controls.js). The
//   head stays inside the walkable patch and on ground data, like a teleport.
//   The EVA clock and the path are charged from the head position each frame
//   (mission.js, cabin.js), so stick walking is charged like desktop walking.
// Turn: the RIGHT thumbstick turns smoothly about the head.
// Pointer rays: each controller always shows a long thin ray (RAY_LENGTH_M)
//   along its pointing direction. Other code may shorten it to what it points
//   at with setRayLength(index, metres) each frame; a dot marks that point.
//
// Teleport: hold the trigger on either controller to aim, release to jump.
//   The aim is a ballistic arc from the controller. It is tested against the
//   full-resolution heights (patch.groundY), not the drawn meshes, so it is
//   exact at every level of detail. A landing point is valid only inside the
//   walkable patch and where there is ground data; the arc turns red and the
//   marker disappears otherwise. On release the rig is moved so that the
//   user's head is above the landing point and the floor is at the ground
//   height there.
// Frame-time readout: A/B/X/Y on either controller (F on desktop).
//
// Other code can take over a trigger press or a button through `hooks`:
//   hooks.select(controller, 'start' | 'end') - return true from 'start' to use
//     the press up (for example it landed on a UI panel): no teleport aim then
//     starts, and the matching 'end' is reported to the hook only;
//   hooks.button(handedness, index) - index 4 is A (right) or X (left), 5 is B
//     or Y; return true to use the press up, false to leave it to the
//     frame-time readout;
//   hooks.move() - return false to switch stick walking off (inside the cabin);
//   hooks.desktopAim() - return true to keep T / the right mouse button from
//     starting a teleport aim on desktop (the tablet is up in front of the view).

export const TURN_RATE_DEG_S = 90; // right stick at full deflection
const STICK_DEAD = 0.15; // inside this the stick does nothing; scaled smoothly from there to full
const STICK_PRESS = 3; // xr-standard: button 3 is the thumbstick pressed down

export const RAY_LENGTH_M = 30;
const RAY_HALF_WIDTH = 0.0025; // per metre of length: the ray widens with distance so the far end stays readable
const COLOR_RAY = 0xd8f6ff;

const ARC_SPEED = 20; // m/s: reaches about 10 m aimed level, about 40 m aimed 45 degrees up
const ARC_GRAVITY = 9.8;
const ARC_STEP_S = 0.025; // 0.5 m of travel per test
const ARC_MAX_S = 5;
const ARC_POINTS = 40;

const COLOR_OK = 0x7fe8ff;
const COLOR_BAD = 0xff4a3a;

// Where the arc from `origin` along `direction` (unit vector) meets the
// ground. Returns { valid, hit, point, timeS }: `hit` is false if it never
// comes down within ARC_MAX_S; `valid` is true only for a landing inside the
// walkable patch on real ground data.
export function traceArc(patch, origin, direction, out = {}) {
  const b = patch.bounds;
  const vx = direction.x * ARC_SPEED;
  const vy = direction.y * ARC_SPEED;
  const vz = direction.z * ARC_SPEED;
  const at = (t, p) => p.set(origin.x + vx * t, origin.y + vy * t - 0.5 * ARC_GRAVITY * t * t, origin.z + vz * t);
  // Height above the ground; outside the patch the ground is taken as the
  // nearest edge height, only to end the arc somewhere sensible.
  const p = out.point || (out.point = new THREE.Vector3());
  const above = (t) => {
    at(t, p);
    const g = patch.groundY(p.x, p.z);
    return Number.isNaN(g) ? NaN : p.y - g;
  };

  out.valid = false;
  out.hit = false;
  out.timeS = ARC_MAX_S;
  out.speed = ARC_SPEED;
  out.gravity = ARC_GRAVITY;

  const first = above(0);
  if (!(first > 0)) {
    // Controller under the ground or over missing data: nothing to aim at.
    out.timeS = 0;
    at(0, p);
    return out;
  }
  let t0 = 0;
  for (let t = ARC_STEP_S; t <= ARC_MAX_S; t += ARC_STEP_S) {
    const h = above(t);
    if (Number.isNaN(h)) {
      out.timeS = t0; // ran into missing data: stop short, not valid
      at(t0, p);
      return out;
    }
    if (h <= 0) {
      let lo = t0;
      let hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      out.timeS = hi;
      at(hi, p);
      out.hit = true;
      const inside = p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
      const ground = inside ? patch.groundY(p.x, p.z) : NaN;
      if (!Number.isNaN(ground)) {
        p.y = ground; // exactly on the full-resolution ground
        out.valid = true;
      }
      return out;
    }
    t0 = t;
  }
  at(ARC_MAX_S, p);
  return out;
}

function createArc() {
  // Flat ribbon along the arc, a few centimetres wide.
  const positions = new Float32Array(ARC_POINTS * 2 * 3);
  const indices = [];
  for (let i = 0; i < ARC_POINTS - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: COLOR_OK,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  mesh.name = 'teleport-arc';
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

function createMarker() {
  const material = new THREE.MeshBasicMaterial({
    color: COLOR_OK,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    fog: false,
    toneMapped: false,
    depthTest: false, // always visible, even where the ground is rough
    depthWrite: false,
  });
  const marker = new THREE.Group();
  marker.name = 'teleport-marker';
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.4, 40), material);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), material);
  // Upright post, so the landing point is visible even when the ring is seen edge-on.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), material);
  post.position.y = 0.6;
  post.renderOrder = 900;
  post.frustumCulled = false;
  marker.add(post);
  for (const part of [ring, dot]) {
    part.rotation.x = -Math.PI / 2; // lie flat: the group's +y is the ground normal
    part.renderOrder = 900;
    part.frustumCulled = false;
    marker.add(part);
  }
  marker.visible = false;
  return marker;
}

export function createXR({ renderer, scene, camera, player, patch, frameMeter, onTeleport }) {
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const button = VRButton.createButton(renderer);
  document.body.appendChild(button);

  const arc = createArc();
  const marker = createMarker();
  scene.add(arc, marker);

  const aim = { controller: null, result: { point: new THREE.Vector3() } };
  const hooks = { select: null, button: null, desktopAim: null, move: null };
  const captured = new Set(); // controllers whose current trigger press a hook has used up
  const state = {
    presenting: false,
    teleports: 0,
    snapTurns: 0, // kept for older tests: the stick no longer snap turns
    stickMoveM: 0, // ground covered with the left stick
    running: false, // left stick held down this frame
    lastTeleport: null,
    refreshRateHz: null,
  };

  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const side = new THREE.Vector3();
  const point = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const head = new THREE.Vector3();
  const facing = new THREE.Vector3();

  // One long pointer ray per controller: a thin four-sided cone from the
  // controller along -z, one unit long, sized by scale only. The dot marks
  // the point a ray was shortened to.
  const rayGeometry = new THREE.CylinderGeometry(RAY_HALF_WIDTH, 0.00005, 1, 4, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  const rayMaterial = new THREE.MeshBasicMaterial({
    color: COLOR_RAY,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    depthWrite: false,
  });
  const dotGeometry = new THREE.SphereGeometry(1, 8, 6);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, depthTest: false, depthWrite: false, transparent: true });
  const rayLengths = [RAY_LENGTH_M, RAY_LENGTH_M];

  function trace(controller) {
    controller.updateWorldMatrix(true, false);
    controller.matrixWorld.decompose(origin, quaternion, scale);
    direction.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    return traceArc(patch, origin, direction, aim.result);
  }

  function drawAim(result) {
    const color = result.valid ? COLOR_OK : COLOR_BAD;
    arc.material.color.setHex(color);
    const positions = arc.geometry.attributes.position.array;
    for (let i = 0; i < ARC_POINTS; i++) {
      const t = (result.timeS * i) / (ARC_POINTS - 1);
      point.set(
        origin.x + direction.x * ARC_SPEED * t,
        origin.y + direction.y * ARC_SPEED * t - 0.5 * ARC_GRAVITY * t * t,
        origin.z + direction.z * ARC_SPEED * t,
      );
      velocity.set(direction.x * ARC_SPEED, direction.y * ARC_SPEED - ARC_GRAVITY * t, direction.z * ARC_SPEED);
      side.crossVectors(velocity, up);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      // Wider with distance so the far end stays visible.
      side.normalize().multiplyScalar(0.012 + 0.004 * ARC_SPEED * t);
      positions.set([point.x - side.x, point.y, point.z - side.z, point.x + side.x, point.y, point.z + side.z], i * 6);
    }
    arc.geometry.attributes.position.needsUpdate = true;
    arc.visible = result.timeS > 0;

    marker.visible = result.valid;
    if (result.valid) {
      const p = result.point;
      const e = patch.spacing;
      const dx = patch.groundY(p.x + e, p.z) - patch.groundY(p.x - e, p.z);
      const dz = patch.groundY(p.x, p.z + e) - patch.groundY(p.x, p.z - e);
      normal.set(-dx, 2 * e, -dz);
      if (Number.isNaN(normal.x) || Number.isNaN(normal.z)) normal.set(0, 1, 0);
      normal.normalize();
      marker.quaternion.setFromUnitVectors(up, normal);
      marker.position.copy(p).addScaledVector(normal, 0.05);
      // Grow with distance so it can still be seen 40 m away.
      marker.scale.setScalar(Math.max(1, origin.distanceTo(p) / 5));
    }
  }

  function stopAim() {
    aim.controller = null;
    arc.visible = false;
    marker.visible = false;
  }

  function teleport(result) {
    if (!result.valid) return false;
    const x = result.point.x;
    const z = result.point.z;
    if (!player.moveHeadTo(x, z)) return false;
    state.teleports++;
    state.lastTeleport = { x, y: player.position.y, z };
    onTeleport?.(x, z);
    return true;
  }

  // Controllers: pointing ray space, children of the rig.
  const controllers = [0, 1].map((index) => {
    const controller = renderer.xr.getController(index);
    controller.name = `controller-${index}`;
    controller.userData.handedness = null;

    // Long ray so the user can always see where each controller points.
    const ray = new THREE.Mesh(rayGeometry, rayMaterial);
    ray.name = 'controller-pointer';
    ray.renderOrder = 979;
    ray.frustumCulled = false;
    ray.scale.setScalar(RAY_LENGTH_M);
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.name = 'controller-pointer-dot';
    dot.renderOrder = 981;
    dot.frustumCulled = false;
    dot.visible = false;
    controller.add(ray, dot);
    controller.userData.ray = ray;
    controller.userData.rayDot = dot;

    controller.addEventListener('connected', (event) => {
      controller.userData.handedness = event.data?.handedness ?? null;
      placeFrameMeter();
    });
    controller.addEventListener('disconnected', () => {
      controller.userData.handedness = null;
      captured.delete(controller);
      if (aim.controller === controller) stopAim();
      placeFrameMeter();
    });
    controller.addEventListener('selectstart', () => {
      if (hooks.select && hooks.select(controller, 'start')) {
        captured.add(controller);
        return;
      }
      aim.controller = controller;
    });
    controller.addEventListener('selectend', () => {
      if (captured.delete(controller)) {
        hooks.select?.(controller, 'end');
        return;
      }
      if (aim.controller !== controller) return;
      teleport(trace(controller)); // aim again with the pose at release
      stopAim();
    });
    player.rig.add(controller);
    return controller;
  });

  // The controller (pointing-ray space) held in the given hand ('left' | 'right'), or null.
  // (Written without a callback: it is called every frame.)
  const controllerFor = (hand) =>
    controllers[0].userData.handedness === hand ? controllers[0] : controllers[1].userData.handedness === hand ? controllers[1] : null;

  // Frame-time panel: on the camera on desktop; in VR on the left controller,
  // or in front of the face if there is no left controller.
  function placeFrameMeter() {
    if (!frameMeter) return;
    const mesh = frameMeter.mesh;
    if (!state.presenting) {
      const distance = 0.5;
      const halfH = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const halfW = halfH * camera.aspect;
      const width = Math.min(0.42 * halfW, 0.3);
      camera.add(mesh);
      mesh.scale.setScalar(width);
      mesh.rotation.set(0, 0, 0);
      mesh.position.set(-halfW + width / 2 + 0.012, -halfH + width / 4 + 0.012, -distance);
      return;
    }
    const left = controllers.find((c) => c.userData.handedness === 'left');
    if (left) {
      left.add(mesh);
      mesh.scale.setScalar(0.16);
      mesh.rotation.set(-Math.PI / 4, 0, 0); // tilted up toward the face
      mesh.position.set(0, 0.07, 0.03);
    } else {
      camera.add(mesh);
      mesh.scale.setScalar(0.22);
      mesh.rotation.set(0, 0, 0);
      mesh.position.set(-0.18, -0.16, -0.7);
    }
  }
  placeFrameMeter();

  renderer.xr.addEventListener('sessionstart', () => {
    state.presenting = true;
    player.setDesktopInput(false);
    document.exitPointerLock?.();
    frameMeter?.reset();
    placeFrameMeter();
    const session = renderer.xr.getSession();
    // The viewer is built for 72 frames a second; ask for that if the headset offers a choice.
    try {
      const rates = session?.supportedFrameRates;
      if (rates && Array.from(rates).includes(72)) session.updateTargetFrameRate(72)?.catch?.(() => {});
    } catch {
      /* optional feature */
    }
    state.refreshRateHz = session?.frameRate ?? null;
  });
  renderer.xr.addEventListener('sessionend', () => {
    state.presenting = false;
    stopAim();
    captured.clear();
    buttons.clear();
    lastMs = 0;
    player.setDesktopInput(true);
    frameMeter?.reset();
    placeFrameMeter();
  });

  // Desktop teleport, so the same arc and landing code can be tried without a
  // headset: hold T (or the right mouse button) to aim where you look, release to jump.
  const desktopAimer = new THREE.Object3D();
  desktopAimer.name = 'desktop-aimer';
  desktopAimer.position.set(0.2, -0.3, 0); // below and right of the eye, so the arc is visible
  camera.add(desktopAimer);
  function desktopAimStart() {
    if (state.presenting) return;
    if (hooks.desktopAim && hooks.desktopAim()) return; // something in front of the view takes the press (the open tablet)
    aim.controller = desktopAimer;
  }
  function desktopAimEnd() {
    if (aim.controller !== desktopAimer) return;
    teleport(trace(desktopAimer));
    stopAim();
  }
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyT' && !event.repeat) desktopAimStart();
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyT') desktopAimEnd();
  });
  renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button === 2) desktopAimStart();
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 2) desktopAimEnd();
  });
  renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('blur', () => {
    if (aim.controller === desktopAimer) stopAim();
  });

  // Pointer rays: back to the full length at the start of every frame; whoever
  // knows what a ray points at (UI panels, the airlock door, the return
  // marker) then shortens it. The shortest length given in a frame wins.
  function resetRays() {
    for (let i = 0; i < 2; i++) {
      const controller = controllers[i];
      rayLengths[i] = RAY_LENGTH_M;
      controller.userData.ray.scale.setScalar(RAY_LENGTH_M);
      controller.userData.ray.visible = state.presenting && aim.controller !== controller; // the teleport arc replaces it while aiming
      controller.userData.rayDot.visible = false;
    }
  }
  function setRayLength(index, metres) {
    const controller = controllers[index];
    if (!controller || !(metres > 0) || metres >= rayLengths[index]) return;
    rayLengths[index] = metres;
    controller.userData.ray.scale.setScalar(metres);
    const dot = controller.userData.rayDot;
    dot.position.set(0, 0, -metres);
    dot.scale.setScalar(0.004 + 0.005 * metres);
    dot.visible = controller.userData.ray.visible;
  }

  // Stick value outside the dead zone, rescaled to 0..1 (sign kept).
  const stick = (v) => (Math.abs(v) <= STICK_DEAD ? 0 : (Math.sign(v) * (Math.abs(v) - STICK_DEAD)) / (1 - STICK_DEAD));

  // Left stick: walk the head over the ground. x = right, y = back (stick axes), each -1..1.
  function stickMove(x, y, run, dt) {
    if (hooks.move && hooks.move() === false) return;
    const length = Math.hypot(x, y);
    if (length <= STICK_DEAD) return;
    camera.getWorldDirection(facing);
    const flat = Math.hypot(facing.x, facing.z);
    if (flat < 1e-3) return; // looking straight up or down: no heading to walk along
    const fx = facing.x / flat;
    const fz = facing.z / flat;
    const amount = Math.min((length - STICK_DEAD) / (1 - STICK_DEAD), 1);
    const step = ((run ? player.state.runSpeed : player.state.walkSpeed) * amount * dt) / length;
    // forward = (fx, fz), right = (-fz, fx) in (x east, z south)
    const dx = (-y * fx - x * fz) * step;
    const dz = (-y * fz + x * fx) * step;
    player.headPosition(head);
    const b = patch.bounds;
    const hx = head.x;
    const hz = head.z;
    const tx = Math.min(Math.max(hx + dx, b.minX), b.maxX);
    const tz = Math.min(Math.max(hz + dz, b.minZ), b.maxZ);
    // Refused over missing data: slide along whichever axis is still open.
    if (!player.moveHeadTo(tx, tz) && !player.moveHeadTo(tx, hz) && !player.moveHeadTo(hx, tz)) return;
    player.headPosition(head);
    state.stickMoveM += Math.hypot(head.x - hx, head.z - hz);
  }

  // Button state per input source, for "one action per press".
  const buttons = new Map(); // inputSource -> buttons held last frame (bit 0: index 4, bit 1: index 5)

  function pollGamepads(dt) {
    state.running = false;
    const session = renderer.xr.getSession();
    if (!session) return;
    for (const source of session.inputSources) {
      const gamepad = source.gamepad;
      if (!gamepad) continue;
      // xr-standard: axes 2/3 are the thumbstick (0/1 a touchpad, if any).
      const wide = gamepad.axes.length >= 4;
      const x = (wide ? gamepad.axes[2] : gamepad.axes[0]) || 0;
      const y = (wide ? gamepad.axes[3] : gamepad.axes[1]) || 0;
      if (source.handedness === 'left') {
        const run = !!gamepad.buttons[STICK_PRESS]?.pressed;
        if (run) state.running = true;
        stickMove(x, y, run, dt);
      } else if (source.handedness === 'right') {
        const turn = stick(x);
        if (turn) player.turnAboutHead(turn * TURN_RATE_DEG_S * dt);
      }
      // xr-standard: buttons 4 and 5 are A/B (right) or X/Y (left).
      const held = (gamepad.buttons[4]?.pressed ? 1 : 0) | (gamepad.buttons[5]?.pressed ? 2 : 0);
      const before = buttons.get(source) ?? 0;
      let meter = false;
      for (let bit = 0; bit < 2; bit++) {
        if (!(held & (1 << bit)) || before & (1 << bit)) continue; // not newly pressed
        if (hooks.button && hooks.button(source.handedness, 4 + bit)) continue;
        // One toggle per press, also when two free buttons go down together or one is still held.
        if (!before) meter = true;
      }
      if (meter) frameMeter?.toggle();
      buttons.set(source, held);
    }
  }

  // Call once per frame, before rendering.
  let lastMs = 0;
  function update() {
    resetRays();
    if (state.presenting) {
      const now = performance.now();
      const dt = lastMs ? Math.min((now - lastMs) / 1000, 0.1) : 0;
      lastMs = now;
      pollGamepads(dt);
      player.followGround();
    }
    if (aim.controller) drawAim(trace(aim.controller));
  }

  return {
    button,
    controllers,
    controllerFor,
    hooks,
    arc,
    marker,
    state,
    update,
    placeFrameMeter,
    setRayLength,
    // For tests: where a controller's arc lands right now.
    traceController: (index) => {
      const r = trace(controllers[index]);
      return { valid: r.valid, hit: r.hit, timeS: r.timeS, x: r.point.x, y: r.point.y, z: r.point.z };
    },
    headPosition: () => player.headPosition(head).clone(),
  };
}
