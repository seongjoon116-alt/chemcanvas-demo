import * as THREE from 'three';

export const ATOM_RADII = {
  H: 0.28, C: 0.56, N: 0.56, O: 0.52, F: 0.44,
  Cl: 0.72, Br: 0.80, I: 0.92, P: 0.64, S: 0.60,
  CH3: 0.76, CH2: 0.68,
};

export const ATOM_COLORS = {
  H:   0xffffff, C:   0x222222, N:   0x3050f8,
  O:   0xff4136, F:   0x00ff00, Cl:  0x00d82c,
  Br:  0xff00ff, I:   0x940094, P:   0xff8c00,
  S:   0xffff00, CH3: 0x00d2ff, CH2: 0x00b8d4,
  DEFAULT: 0xaaaaaa,
};

export const ELEMENT_NAMES = {
  H:'수소', C:'탄소', N:'질소', O:'산소', F:'플루오린',
  Cl:'염소', Br:'브로민', I:'아이오딘', P:'인', S:'황',
  CH3:'메틸기', CH2:'메틸렌',
};

export const ATOM_MASSES = {
  H:1.008, C:12.011, N:14.007, O:15.999, F:18.998,
  Cl:35.45, Br:79.904, I:126.90, P:30.974, S:32.06,
  CH3:15.035, CH2:14.027,
};

// CSS/HTML legend 등 DOM 쪽에서 사용하는 hex 문자열 변환 유틸 (단일 source of truth)
export function colorHex(element) {
  const n = ATOM_COLORS[element] ?? ATOM_COLORS.DEFAULT;
  return '#' + n.toString(16).padStart(6, '0');
}

// ── Geometry / Material 캐싱 ──────────────────────────────────
// 동일 원소는 동일 geometry + material 공유 → GPU 메모리, 드로콜 절감.
// transform/visibility는 mesh 단위로 독립적이므로 공유해도 안전.
// SphereGeometry 32×32 → 16×16으로 폴리곤 절반. 작은 분자에선 시각 차이 거의 없음.
const SPHERE_SEGMENTS = 16;

const _geoCache = new Map(); // element → THREE.SphereGeometry
const _matCache = new Map(); // element → THREE.MeshLambertMaterial

function getAtomGeometry(element) {
  const radius = ATOM_RADII[element] ?? 0.6;
  const key = `${element}|${radius}`;
  if (!_geoCache.has(key)) {
    _geoCache.set(key, new THREE.SphereGeometry(radius, SPHERE_SEGMENTS, SPHERE_SEGMENTS));
  }
  return _geoCache.get(key);
}

function getAtomMaterial(element) {
  if (!_matCache.has(element)) {
    const color = ATOM_COLORS[element] ?? ATOM_COLORS.DEFAULT;
    _matCache.set(element, new THREE.MeshLambertMaterial({ color }));
  }
  return _matCache.get(element);
}

export function getAtomRadius(element) {
  return ATOM_RADII[element] ?? 0.6;
}

export function createAtomMesh(atom) {
  const el     = atom.element || 'C';
  const geo    = getAtomGeometry(el);
  const mat    = getAtomMaterial(el);
  const mesh   = new THREE.Mesh(geo, mat);

  mesh.position.set(atom.position.x, atom.position.y, atom.position.z);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  mesh.visible       = atom.visible !== false;
  // 캐시된 material을 공유한다는 표시 — SceneManager가 dispose 여부 판단에 사용
  mesh.userData = { atomId: atom.id, element: el, sharedMaterial: true, sharedGeometry: true };
  return mesh;
}

// p-orbital은 인스턴스마다 transparent/opacity가 다를 수 있어 캐싱하지 않고 매번 생성.
// 하지만 base geometry는 공유 가능.
let _orbitalGeoBase = null;
function getOrbitalBaseGeometry() {
  if (!_orbitalGeoBase) {
    const g = new THREE.SphereGeometry(0.50, 12, 12);
    g.scale(1, 2, 1);
    _orbitalGeoBase = g;
  }
  return _orbitalGeoBase;
}

export function createPOrbitalLobes(atomPos) {
  const baseGeo = getOrbitalBaseGeometry();

  // 두 lobe는 동일 material 공유 가능 (한 atom 그룹에 한 번만 생성됨)
  const mat = new THREE.MeshLambertMaterial({
    color: 0x339af0, transparent: true, opacity: 0.45,
    emissive: 0x339af0, emissiveIntensity: 0.5,
  });

  const group = new THREE.Group();
  group.userData = { orbitalMaterial: mat, sharedGeometry: true };

  [1, -1].forEach(sign => {
    const lobe = new THREE.Mesh(baseGeo, mat);
    lobe.position.set(atomPos.x, atomPos.y + sign * 1.1, atomPos.z);
    group.add(lobe);
  });
  return group;
}
