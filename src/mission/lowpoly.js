import * as THREE from 'three';

// Shared look for the mission's procedural objects (brief: LOW-POLY LOOK):
// chunky shapes with few faces, flat shading, one small flat palette.

export const PALETTE = {
  marsOrange: 0xd9713c,
  marsDeep: 0xa8502b,
  offWhite: 0xefe6d8,
  slate: 0x2a3340,
  teal: 0x23b5c4,
  amber: 0xffb020,
  red: 0xe5412d,
  routeBlue: 0x2f7fe6,
  routeBlueLight: 0xa9dcff,
  roverOrange: 0xff8a1f,
};

// CSS colour string for canvas drawing.
export const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

const SELF_LIT = 0.5; // share of the colour that does not depend on the lights

let sharedMaterial = null;
// One material for every flat-shaded, vertex-coloured mission object.
export function lowPolyMaterial() {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    sharedMaterial.name = 'mission-lowpoly';
    // Part of each colour is shown whatever the light, so the palette stays
    // recognisable on the side facing away from the low sun; the facets still shade.
    sharedMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * ${SELF_LIT.toFixed(2)};
        diffuseColor.rgb *= ${(1 - SELF_LIT).toFixed(2)};`,
      );
    };
    sharedMaterial.customProgramCacheKey = () => `mission-lowpoly-${SELF_LIT}`;
  }
  return sharedMaterial;
}

// Merges simple geometries into one flat-shaded mesh geometry with a colour
// per part: one draw call per object. parts = [{ geometry, color, x, y, z, rotY }].
// The part geometries are disposed.
export function mergeParts(parts) {
  let count = 0;
  const prepared = parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    if (geometry !== part.geometry) part.geometry.dispose();
    if (part.rotY) geometry.rotateY(part.rotY);
    geometry.translate(part.x || 0, part.y || 0, part.z || 0);
    count += geometry.attributes.position.count;
    return { geometry, color: new THREE.Color(part.color) };
  });
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let offset = 0;
  for (const { geometry, color } of prepared) {
    const source = geometry.attributes.position;
    positions.set(source.array.subarray(0, source.count * 3), offset * 3);
    for (let i = 0; i < source.count; i++) {
      colors[(offset + i) * 3] = color.r;
      colors[(offset + i) * 3 + 1] = color.g;
      colors[(offset + i) * 3 + 2] = color.b;
    }
    offset += source.count;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeVertexNormals(); // per face: the geometry is not indexed
  merged.computeBoundingSphere();
  return merged;
}
