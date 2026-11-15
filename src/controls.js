import * as THREE from 'three';

// Desktop walking: WASD (or arrow keys to turn) + mouse look with pointer lock.
//
// The player is a "rig" group standing on the ground: rig.rotation.y is the
// heading and rig.position.y the ground height under the user. On desktop the
// camera is a child raised to eye height, so rig.position is the feet.
//
// In WebXR the headset drives the camera inside the same rig. The rig origin
// is then the centre of the user's real floor ('local-floor' space) and the
// user may be standing somewhere else in the room, so the VR code moves the
// rig with moveHeadTo / turnAboutHead / followGround, which all work from
// where the head actually is. Keyboard and mouse are ignored while in VR
// (no smooth movement in the headset).
//
// Heading is in degrees clockwise from north: 0 = north (-z), 90 = east (+x).

export const EYE_HEIGHT_M = 1.7;

export function createPlayer({ camera, scene, domElement, patch }) {
  const rig = new THREE.Group();
  rig.name = 'player-rig';
  rig.rotation.order = 'YXZ';
  camera.rotation.order = 'YXZ';
  camera.position.set(0, EYE_HEIGHT_M, 0);
  rig.add(camera);
  scene.add(rig);

  const state = { headingDeg: 0, pitchDeg: 0, walkSpeed: 3, runSpeed: 15, turnSpeedDeg: 70 };

  const keys = new Set();
  let desktopInput = true;
  const head = new THREE.Vector3();

  function applyLook() {
    rig.rotation.y = -THREE.MathUtils.degToRad(state.headingDeg);
    if (!desktopInput) return; // in VR the headset owns the camera
    camera.rotation.set(THREE.MathUtils.degToRad(state.pitchDeg), 0, 0);
  }

  function setPosition(x, z) {
    const b = patch.bounds;
    const cx = Math.min(Math.max(x, b.minX), b.maxX);
    const cz = Math.min(Math.max(z, b.minZ), b.maxZ);
    const y = patch.groundY(cx, cz);
    if (Number.isNaN(y)) return false; // no ground data there: stay put
    rig.position.set(cx, y, cz);
    return true;
  }

  function setHeading(deg) {
    state.headingDeg = ((deg % 360) + 360) % 360;
    applyLook();
  }

  function setPitch(deg) {
    state.pitchDeg = Math.min(Math.max(deg, -89), 89);
    applyLook();
  }

  domElement.addEventListener('click', () => {
    if (document.pointerLockElement === domElement) return;
    // Chrome returns a promise; a refusal (e.g. clicking again too soon after
    // Esc) is harmless, so do not let it surface as an uncaught error.
    try {
      domElement.requestPointerLock?.()?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable: keyboard controls still work */
    }
  });
  document.addEventListener('mousemove', (event) => {
    if (!desktopInput || document.pointerLockElement !== domElement) return;
    setHeading(state.headingDeg + event.movementX * 0.12);
    setPitch(state.pitchDeg - event.movementY * 0.12);
  });
  window.addEventListener('keydown', (event) => {
    if (event.code.startsWith('Arrow')) event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  // World position of the head (the camera), up to date with the rig.
  function headPosition(target = new THREE.Vector3()) {
    rig.updateWorldMatrix(true, false);
    return target.copy(camera.position).applyMatrix4(rig.matrixWorld);
  }

  // Move the rig so the head is straight above ground point (x, z) and the
  // rig's floor is at the ground height there. Refuses (returns false) outside
  // the walkable patch or where there is no ground data.
  function moveHeadTo(x, z) {
    const b = patch.bounds;
    if (!(x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ)) return false;
    const y = patch.groundY(x, z);
    if (Number.isNaN(y)) return false;
    headPosition(head);
    rig.position.set(rig.position.x + x - head.x, y, rig.position.z + z - head.z);
    return true;
  }

  // Turn the rig by `deg` (clockwise seen from above) about the vertical line
  // through the head, so the user turns on the spot wherever they stand.
  function turnAboutHead(deg) {
    headPosition(head);
    const x = head.x;
    const z = head.z;
    setHeading(state.headingDeg + deg);
    headPosition(head);
    rig.position.x += x - head.x;
    rig.position.z += z - head.z;
  }

  // Keep the rig's floor at the ground height under the head (the user can
  // take real steps inside the room).
  function followGround() {
    headPosition(head);
    const y = patch.groundY(head.x, head.z);
    if (!Number.isNaN(y)) rig.position.y = y;
  }

  // Entering VR: the headset takes over the camera. Leaving VR: stand where
  // the head was and give the camera back to the mouse.
  function setDesktopInput(enabled) {
    if (enabled === desktopInput) return;
    desktopInput = enabled;
    keys.clear();
    if (enabled) {
      headPosition(head);
      camera.position.set(0, EYE_HEIGHT_M, 0);
      camera.scale.set(1, 1, 1);
      setPitch(0);
      setPosition(head.x, head.z);
    }
  }

  function update(dt) {
    if (!desktopInput) return;
    const turn = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    if (turn) setHeading(state.headingDeg + turn * state.turnSpeedDeg * dt);

    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (!forward && !strafe) return;

    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? state.runSpeed : state.walkSpeed;
    const length = Math.hypot(forward, strafe);
    const h = THREE.MathUtils.degToRad(state.headingDeg);
    // forward = (sin h, -cos h), right = (cos h, sin h) in (x east, z south)
    const dx = ((forward * Math.sin(h) + strafe * Math.cos(h)) / length) * speed * dt;
    const dz = ((-forward * Math.cos(h) + strafe * Math.sin(h)) / length) * speed * dt;
    setPosition(rig.position.x + dx, rig.position.z + dz);
  }

  applyLook();
  setPosition(0, 0);

  return {
    rig,
    state,
    update,
    setPosition,
    setHeading,
    setPitch,
    headPosition,
    moveHeadTo,
    turnAboutHead,
    followGround,
    setDesktopInput,
    get position() {
      return rig.position;
    },
  };
}
