import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// WebXR (VR headset) support: VR button, controller teleport, snap turn.
//
// Reference space is 'local-floor': the headset reports the head relative to
// the real floor, and the player rig (controls.js) is the group that carries
// that floor around the terrain. The camera and both controllers are children
// of the rig. Moving in VR is teleport and snap turn only (no smooth movement).
//
// Teleport: hold the trigger on either controller to aim, release to jump.
//   The aim is a ballistic arc from the controller. It is tested against the
//   full-resolution heights (patch.groundY), not the drawn meshes, so it is
//   exact at every level of detail. A landing point is valid only inside the
//   walkable patch and where there is ground data; the arc turns red and the
//   marker disappears otherwise. On release the rig is moved so that the
//   user's head is above the landing point and the floor is at the ground
//   height there.
// Snap turn: flick either thumbstick left or right for one 45 degree turn
//   about the head. The stick has to come back to the centre before it turns
//   again.
// Frame-time readout: A/B/X/Y on either controller (F on desktop).

export const SNAP_TURN_DEG = 45;
const STICK_ON = 0.6; // past this the stick counts as flicked
const STICK_OFF = 0.3; // back inside this it is re-armed

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
  const state = {
    presenting: false,
    teleports: 0,
    snapTurns: 0,
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

    // Small visible stub so the user can see where each controller points.
    const stub = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.012, 0.14).translate(0, 0, -0.07),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }),
    );
    stub.name = 'controller-pointer';
    controller.add(stub);

    controller.addEventListener('connected', (event) => {
      controller.userData.handedness = event.data?.handedness ?? null;
      placeFrameMeter();
    });
    controller.addEventListener('disconnected', () => {
      controller.userData.handedness = null;
      if (aim.controller === controller) stopAim();
      placeFrameMeter();
    });
    controller.addEventListener('selectstart', () => {
      aim.controller = controller;
    });
    controller.addEventListener('selectend', () => {
      if (aim.controller !== controller) return;
      teleport(trace(controller)); // aim again with the pose at release
      stopAim();
    });
    player.rig.add(controller);
    return controller;
  });

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
    sticks.clear();
    buttons.clear();
    player.setDesktopInput(true);
    frameMeter?.reset();
    placeFrameMeter();
  });

  // Thumbstick and button state per input source, for "one action per press".
  const sticks = new Map(); // inputSource -> armed
  const buttons = new Map(); // inputSource -> was pressed

  function pollGamepads() {
    const session = renderer.xr.getSession();
    if (!session) return;
    for (const source of session.inputSources) {
      const gamepad = source.gamepad;
      if (!gamepad) continue;
      // xr-standard: axes 2/3 are the thumbstick (0/1 a touchpad, if any).
      const x = gamepad.axes.length >= 4 ? gamepad.axes[2] : (gamepad.axes[0] ?? 0);
      const armed = sticks.get(source) ?? true;
      if (armed && Math.abs(x) >= STICK_ON) {
        sticks.set(source, false);
        player.turnAboutHead(x > 0 ? SNAP_TURN_DEG : -SNAP_TURN_DEG);
        state.snapTurns++;
      } else if (!armed && Math.abs(x) <= STICK_OFF) {
        sticks.set(source, true);
      }
      // xr-standard: buttons 4 and 5 are A/B (right) or X/Y (left).
      const pressed = Boolean(gamepad.buttons[4]?.pressed || gamepad.buttons[5]?.pressed);
      if (pressed && !buttons.get(source)) frameMeter?.toggle();
      buttons.set(source, pressed);
    }
  }

  // Call once per frame, before rendering.
  function update() {
    if (!state.presenting) return;
    pollGamepads();
    player.followGround();
    if (aim.controller) drawAim(trace(aim.controller));
  }

  return {
    button,
    controllers,
    arc,
    marker,
    state,
    update,
    placeFrameMeter,
    // For tests: where a controller's arc lands right now.
    traceController: (index) => {
      const r = trace(controllers[index]);
      return { valid: r.valid, hit: r.hit, timeS: r.timeS, x: r.point.x, y: r.point.y, z: r.point.z };
    },
    headPosition: () => player.headPosition(head).clone(),
  };
}
