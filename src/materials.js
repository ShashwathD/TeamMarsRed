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
function addHighlightRolloff(material, knee = 0.55) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      /* glsl */ `{
        float peak = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
        if (peak > ${knee.toFixed(3)}) {
          float range = ${(1 - knee).toFixed(3)};
          float over = (peak - ${knee.toFixed(3)}) / range;
          float rolled = ${knee.toFixed(3)} + range * over / (1.0 + over);
          gl_FragColor.rgb *= rolled / peak;
        }
      }`,
    );
  };
  material.customProgramCacheKey = () => `highlight-rolloff-${knee}`;
  return material;
}

// Walk patch: photo (if any) x tint. `photo` is { texture, meanLinear } or null.
export function createWalkMaterial(photo) {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  if (photo && photo.meanLinear > 0) {
    material.map = photo.texture;
    material.color.copy(MARS_SURFACE).multiplyScalar(1 / photo.meanLinear);
  } else {
    material.color.copy(MARS_SURFACE);
  }
  return addHighlightRolloff(material);
}

// Distant terrain: plain average surface colour.
// Vertex colours carry the fade from the photo's brightness at the patch edge.
export function createSurroundMaterial() {
  return addHighlightRolloff(
    new THREE.MeshStandardMaterial({ color: MARS_SURFACE, roughness: 1, metalness: 0, vertexColors: true }),
  );
}
