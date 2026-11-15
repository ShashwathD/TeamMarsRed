import * as THREE from 'three';

// Frame-time readout drawn in the scene (HTML overlays are invisible in VR).
//
// It measures the time between one animation frame and the next, which is
// what the viewer sees: on a 72 Hz headset a frame that is on time takes
// 13.9 ms, and one missed frame shows up as 27.8 ms. "avg" and "worst" cover
// the last WINDOW_FRAMES frames; the text is redrawn four times a second.
//
// The panel is a small textured plane. main.js hangs it on the camera on
// desktop, and on the left controller (or the camera) in VR.

const WINDOW_FRAMES = 144;
const REDRAW_MS = 250;

export function createFrameMeter() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  // 2:1 plane, 1 unit wide; scale the mesh to set its size in metres.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.5),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  mesh.name = 'frame-meter';
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  mesh.visible = false;

  const samples = new Float32Array(WINDOW_FRAMES);
  let count = 0; // valid samples, up to WINDOW_FRAMES
  let next = 0;
  let last = -1; // time of the previous frame, -1 = none yet
  let lastDraw = -Infinity;
  const stats = { avgMs: NaN, worstMs: NaN, frames: 0 };

  function measure() {
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < count; i++) {
      sum += samples[i];
      if (samples[i] > worst) worst = samples[i];
    }
    stats.frames = count;
    stats.avgMs = count ? sum / count : NaN;
    stats.worstMs = count ? worst : NaN;
    return stats;
  }

  function draw() {
    const { avgMs, worstMs, frames } = measure();
    const text = (v) => (Number.isNaN(v) ? '--' : v.toFixed(1));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(20, 12, 8, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText('FRAME TIME (ms)', 12, 24);
    ctx.font = '600 30px ui-monospace, Menlo, monospace';
    ctx.fillText(`avg   ${text(avgMs)}`, 12, 60);
    ctx.fillText(`worst ${text(worstMs)}`, 12, 96);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#d8c8b8';
    ctx.fillText(`over the last ${frames} frames`, 12, 118);
    texture.needsUpdate = true;
  }

  // Call once per animation frame with performance.now().
  function tick(now) {
    if (last >= 0) {
      samples[next] = now - last;
      next = (next + 1) % WINDOW_FRAMES;
      if (count < WINDOW_FRAMES) count++;
    }
    last = now;
    if (mesh.visible && now - lastDraw >= REDRAW_MS) {
      lastDraw = now;
      draw();
    }
  }

  // Forget the history (entering or leaving VR changes the frame rate, and
  // the pause in between is not a frame).
  function reset() {
    count = 0;
    next = 0;
    last = -1;
    lastDraw = -Infinity;
  }

  function setVisible(visible) {
    mesh.visible = visible;
    lastDraw = -Infinity;
    if (visible) draw();
  }

  return {
    mesh,
    tick,
    reset,
    setVisible,
    toggle: () => setVisible(!mesh.visible),
    measure,
    get visible() {
      return mesh.visible;
    },
  };
}
