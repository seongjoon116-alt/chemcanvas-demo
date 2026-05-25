import * as THREE from 'three';

const BOND_COLOR = 0xaaaaaa;
const UP = new THREE.Vector3(0, 1, 0);

export function createBondMeshes(p1, p2, order = 1) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  if (len < 0.001) return [];

  const q   = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  const ctr = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const meshes = [];

  const addCyl = (radius, offset = new THREE.Vector3()) => {
    const geo = new THREE.CylinderGeometry(radius, radius, 1.0, 16);
    const mat = new THREE.MeshLambertMaterial({ color: BOND_COLOR });
    const m   = new THREE.Mesh(geo, mat);
    m.scale.y = len;
    m.position.copy(ctr).add(offset);
    m.quaternion.copy(q);
    m.castShadow = true;
    meshes.push(m);
  };

  if (order === 1) {
    addCyl(0.13);
  } else {
    let perp = dir.clone().normalize().cross(UP);
    if (perp.lengthSq() < 0.001)
      perp = dir.clone().normalize().cross(new THREE.Vector3(1, 0, 0));
    perp.normalize();

    const offsets = order === 2
      ? [perp.clone().multiplyScalar(-0.18), perp.clone().multiplyScalar(0.18)]
      : [perp.clone().multiplyScalar(-0.26), new THREE.Vector3(), perp.clone().multiplyScalar(0.26)];
    offsets.forEach(o => addCyl(order === 2 ? 0.10 : 0.08, o));
  }
  return meshes;
}

// Call every frame for bonds that connect moving atoms
export function updateBondMeshes(meshes, p1, p2) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  if (len < 0.001) return;
  const ctr = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const q   = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  meshes.forEach(m => {
    m.scale.y = len;
    m.position.copy(ctr);
    m.quaternion.copy(q);
  });
}
