import * as THREE from 'three';

// Butterscotch Mars sky: darker tan overhead, paler and dustier at the horizon.
export const SKY_ZENITH = new THREE.Color(0xa87850);
export const SKY_HORIZON = new THREE.Color(0xe2c29a);

// Light dust haze. Fog is exp(-(density * distance)^2): about 12% at 1 km,
// 40% at 2 km, so the walk patch stays readable out to its edges.
export const HAZE_DENSITY = 0.00035;

export function createSky(scene) {
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.FogExp2(SKY_HORIZON.getHex(), HAZE_DENSITY);

  // Gradient dome that follows the camera, drawn behind everything.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        zenith: { value: SKY_ZENITH },
        horizon: { value: SKY_HORIZON },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
          gl_Position = p.xyww; // pin to the far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith;
        uniform vec3 horizon;
        varying vec3 vDir;
        void main() {
          float up = clamp(normalize(vDir).y, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizon, zenith, pow(up, 0.45)), 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    }),
  );
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  scene.add(dome);

  // Sun low in the west (azimuth 265 degrees, 22 degrees up). The HiRISE photo
  // draped on the terrain was taken with the sun in the west (measured: the
  // photo's shading matches the terrain best for a sun azimuth of 255-285
  // degrees), so the computed shading agrees with the shadows in the photo.
  // The photo already contains real shading, so the computed sun is kept
  // moderate and the sky fill fairly strong, to avoid doubling the contrast.
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  sun.position.set(-0.924, 0.375, 0.081); // direction only (from the sun toward the origin)
  sun.name = 'sun';
  scene.add(sun);
  const fill = new THREE.HemisphereLight(0xe8c8a0, 0x6b4a34, 1.4);
  fill.name = 'sky-fill';
  scene.add(fill);

  return { dome, sun, fill };
}
