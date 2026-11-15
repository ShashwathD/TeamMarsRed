import * as THREE from 'three';

// TEMPORARY orientation check: a tall red pole with an "N" sign, standing
// `distanceM` due north (-z) of the given point. Remove once orientation is
// trusted.
export function createNorthMarker(patch, fromX, fromZ, { distanceM = 60, heightM = 30 } = {}) {
  const group = new THREE.Group();
  group.name = 'north-marker';

  const x = fromX;
  const z = Math.max(fromZ - distanceM, patch.bounds.minZ);
  const ground = patch.groundY(x, z);
  group.position.set(x, Number.isNaN(ground) ? 0 : ground, z);

  const material = new THREE.MeshBasicMaterial({ color: 0xd21f1f, fog: false });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, heightM, 12), material);
  pole.position.y = heightM / 2;
  group.add(pole);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#d21f1f';
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, 240, 240);
  ctx.fillStyle = '#d21f1f';
  ctx.font = 'bold 200px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false }));
  sign.scale.set(10, 10, 1);
  sign.position.y = heightM + 5;
  group.add(sign);

  return group;
}
