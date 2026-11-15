import * as THREE from 'three';

// Desktop walking: WASD (or arrow keys to turn) + mouse look with pointer lock.
//
// The player is a "rig" group standing on the ground: rig.position is the
// feet, rig.rotation.y the heading. The camera is a child raised to eye
// height. In WebXR (step 5) the headset drives the camera inside the same rig
// and the local-floor space supplies the eye height, so teleport and snap
// turn only need to call setPosition / setHeading.
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

  function applyLook() {
    rig.rotation.y = -THREE.MathUtils.degToRad(state.headingDeg);
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
    if (document.pointerLockElement !== domElement) return;
    setHeading(state.headingDeg + event.movementX * 0.12);
    setPitch(state.pitchDeg - event.movementY * 0.12);
  });
  window.addEventListener('keydown', (event) => {
    if (event.code.startsWith('Arrow')) event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  function update(dt) {
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
    get position() {
      return rig.position;
    },
  };
}
