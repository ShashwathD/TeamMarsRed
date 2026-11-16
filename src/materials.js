import * as THREE from 'three';

// Ground materials.
//
// The HiRISE photo is greyscale. It is multiplied by a tint so that its
// average comes out at MARS_SURFACE; the distant terrain, which has no photo,
// is drawn in MARS_SURFACE itself, so the two match on average. The colour is
// cosmetic: the brightness pattern is real, the hue is not measured.

export const MARS_SURFACE = new THREE.Color(0x96704f);

// Bright outcrops in the photo are several times brighter than the average and
// would otherwise clip to flat white-yellow. This compresses only the brightest
// values (above `knee` of full scale) so they keep their detail and hue, and
// leaves everything darker untouched. It takes the place of renderer tone
// mapping for the ground.
const rolloffGlsl = (knee) => /* glsl */ `{
        float peak = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
        if (peak > ${knee.toFixed(3)}) {
          float range = ${(1 - knee).toFixed(3)};
          float over = (peak - ${knee.toFixed(3)}) / range;
          float rolled = ${knee.toFixed(3)} + range * over / (1.0 + over);
          gl_FragColor.rgb *= rolled / peak;
        }
      }`;

function addHighlightRolloff(material, knee = 0.55) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', rolloffGlsl(knee));
  };
  material.customProgramCacheKey = () => `highlight-rolloff-${knee}`;
  return material;
}

// Walk patch: photo (if any) x tint. `photo` is { texture, meanLinear } or null.
//
// Two things can be switched while it runs, without recompiling the shader
// (material.userData.ground):
//   setPhoto(on)  - off draws the terrain in the plain surface colour, so only
//                   its real shape shows (lit by the sun and sky);
//   setSlope(on)  - a slope-hazard overlay: amber and red bands painted over
//                   the ground from a slope map, a texture with one value per
//                   terrain sample that the caller makes from the heights
//                   (setSlopeMap). Off, and a 1 x 1 empty map, until then.
// The overlay is mixed in after the lighting, so its colours read the same in
// sun and shade.
export function createWalkMaterial(photo, knee = 0.55) {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const hasPhoto = !!(photo && photo.meanLinear > 0);
  if (hasPhoto) {
    material.map = photo.texture;
    material.color.copy(MARS_SURFACE).multiplyScalar(1 / photo.meanLinear);
  } else {
    material.color.copy(MARS_SURFACE);
    material.defines = { ...material.defines, USE_UV: '' }; // the slope map needs the patch uv
  }

  const empty = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  empty.needsUpdate = true;
  // MINERALS HOOK (w5): a 1 x 1 clear map until src/mission/minerals.js sets the real one.
  const emptyMinerals = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  emptyMinerals.needsUpdate = true;
  const uniforms = {
    uPhotoOn: { value: 1 },
    uPlainColor: { value: MARS_SURFACE.clone() },
    uSlopeOn: { value: 0 },
    uSlopeMap: { value: empty },
    uSlopeFullDeg: { value: 90 }, // slope in degrees at a map value of 1.0
    uSlopeBands: { value: new THREE.Vector2(10, 15) }, // amber from x, red above y (set by setSlopeMap)
    uSlopeAmber: { value: new THREE.Color(0xffb020) },
    uSlopeRed: { value: new THREE.Color(0xe5412d) },
    uSlopeAlpha: { value: 0.62 },
    // MINERALS HOOK (w5): CRISM mineral-group overlay (not a hazard layer).
    uMineralOn: { value: 0 },
    uMineralMap: { value: emptyMinerals },
    uMineralUv: { value: new THREE.Vector4(1, 1, 0, 0) }, // patch uv * xy + zw = mineral-grid uv
    uMineralAlpha: { value: 0.55 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uPhotoOn;
        uniform vec3 uPlainColor;
        uniform float uSlopeOn;
        uniform sampler2D uSlopeMap;
        uniform float uSlopeFullDeg;
        uniform vec2 uSlopeBands;
        uniform vec3 uSlopeAmber;
        uniform vec3 uSlopeRed;
        uniform float uSlopeAlpha;
        uniform float uMineralOn;
        uniform sampler2D uMineralMap;
        uniform vec4 uMineralUv;
        uniform float uMineralAlpha;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        diffuseColor.rgb = mix(uPlainColor, diffuseColor.rgb, uPhotoOn);`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `${rolloffGlsl(knee)}
        if (uSlopeOn > 0.0) {
          #ifdef USE_MAP
            vec2 slopeUv = vMapUv;
          #else
            vec2 slopeUv = vUv;
          #endif
          float slopeDeg = texture2D(uSlopeMap, slopeUv).r * uSlopeFullDeg;
          float hazard = smoothstep(uSlopeBands.x - 0.25, uSlopeBands.x + 0.25, slopeDeg);
          vec3 hazardColor = mix(uSlopeAmber, uSlopeRed, smoothstep(uSlopeBands.y - 0.25, uSlopeBands.y + 0.25, slopeDeg));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hazardColor, hazard * uSlopeAlpha * uSlopeOn);
        }
        if (uMineralOn > 0.0) { // MINERALS HOOK (w5)
          #ifdef USE_MAP
            vec2 mineralUv = vMapUv * uMineralUv.xy + uMineralUv.zw;
          #else
            vec2 mineralUv = vUv * uMineralUv.xy + uMineralUv.zw;
          #endif
          if (mineralUv.x >= 0.0 && mineralUv.x <= 1.0 && mineralUv.y >= 0.0 && mineralUv.y <= 1.0) {
            vec4 mineral = texture2D(uMineralMap, mineralUv);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, mineral.rgb, mineral.a * uMineralAlpha * uMineralOn);
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => `walk-ground-${knee}`;

  material.userData.ground = {
    uniforms,
    hasPhoto,
    get photoOn() {
      return uniforms.uPhotoOn.value > 0;
    },
    get slopeOn() {
      return uniforms.uSlopeOn.value > 0;
    },
    setPhoto(on) {
      uniforms.uPhotoOn.value = on ? 1 : 0;
    },
    setSlope(on) {
      uniforms.uSlopeOn.value = on ? 1 : 0;
    },
    // texture: one value per terrain sample, laid out like the photo (row 0 of
    // the data is the SOUTH edge); fullDeg: degrees at a value of 1.0.
    setSlopeMap(texture, { fullDeg, amberFromDeg, redAboveDeg, amber, red }) {
      uniforms.uSlopeMap.value = texture;
      uniforms.uSlopeFullDeg.value = fullDeg;
      uniforms.uSlopeBands.value.set(amberFromDeg, redAboveDeg);
      if (amber !== undefined) uniforms.uSlopeAmber.value.set(amber);
      if (red !== undefined) uniforms.uSlopeRed.value.set(red);
    },
    // MINERALS HOOK (w5). texture: RGBA, one texel per CRISM pixel, alpha 0 =
    // nothing drawn, row 0 = south; uvTransform [sx, sy, ox, oy]: patch uv to its uv.
    get mineralsOn() {
      return uniforms.uMineralOn.value > 0;
    },
    setMinerals(on) {
      uniforms.uMineralOn.value = on ? 1 : 0;
    },
    setMineralMap(texture, { uvTransform, alpha }) {
      uniforms.uMineralMap.value = texture;
      uniforms.uMineralUv.value.set(uvTransform[0], uvTransform[1], uvTransform[2], uvTransform[3]);
      if (alpha !== undefined) uniforms.uMineralAlpha.value = alpha;
    },
  };
  return material;
}

// Distant terrain: plain average surface colour.
// Vertex colours carry the fade from the photo's brightness at the patch edge.
export function createSurroundMaterial() {
  return addHighlightRolloff(
    new THREE.MeshStandardMaterial({ color: MARS_SURFACE, roughness: 1, metalness: 0, vertexColors: true }),
  );
}
