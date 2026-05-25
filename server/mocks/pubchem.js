// Mock PubChem molecule data — coordinates match Three.js units (Angstrom scale)
// 초기 carbocation 데이터는 ../../shared/initialMolecule.js 에서 import (frontend와 공유)

import {
  INITIAL_CARBOCATION,
  buildInitialScenario,
} from '../../shared/initialMolecule.js';

const MOLECULES = {
  'carbocation': INITIAL_CARBOCATION,

  'HBr': {
    pubchemCid: 260,
    name: 'Hydrogen bromide',
    iupacName: 'hydrogen bromide',
    formula: 'HBr',
    atoms: [
      { id:'H1', element:'H',  label:'H',  position:{x:-0.8,y:0,z:0}, formalCharge:0 },
      { id:'Br1',element:'Br', label:'Br', position:{x:0.8, y:0,z:0}, formalCharge:0 },
    ],
    bonds: [{ atom1Id:'H1', atom2Id:'Br1', order:1 }],
  },

  // cyclohexane (chair conformation, sub-axial methyl at C1)
  // Sub과 Ha_ax는 모두 C1에 결합되지만 다른 방향이어야 하므로 좌표 분리
  // Ha_ax: 위쪽(+y, axial), Sub: 아래쪽(-y, equatorial-like) 가시화
  'cyclohexane': {
    pubchemCid: 8078,
    name: 'Cyclohexane',
    iupacName: 'cyclohexane',
    formula: 'C6H12',
    atoms: [
      { id:'C1', element:'C',   label:'C1', position:{x:0,     y:0.25, z:1.28},  hybridization:'sp3', formalCharge:0 },
      { id:'C2', element:'C',   label:'C2', position:{x:1.25,  y:-0.25,z:0.64},  hybridization:'sp3', formalCharge:0 },
      { id:'C3', element:'C',   label:'C3', position:{x:1.25,  y:0.25, z:-0.64}, hybridization:'sp3', formalCharge:0 },
      { id:'C4', element:'C',   label:'C4', position:{x:0,     y:-0.25,z:-1.28}, hybridization:'sp3', formalCharge:0 },
      { id:'C5', element:'C',   label:'C5', position:{x:-1.25, y:0.25, z:-0.64}, hybridization:'sp3', formalCharge:0 },
      { id:'C6', element:'C',   label:'C6', position:{x:-1.25, y:-0.25,z:0.64},  hybridization:'sp3', formalCharge:0 },
      // axial H (C1 위쪽 +y 방향) — 충돌 회피를 위해 Sub과 z를 약간 분리
      { id:'Ha_ax', element:'H', label:'Ha(ax)', position:{x:0,     y:1.35,  z:1.28},  formalCharge:0 },
      // equatorial H (C1 옆쪽)
      { id:'Ha_eq', element:'H', label:'Ha(eq)', position:{x:0.9,   y:-0.25, z:2.1},   formalCharge:0 },
      // 치환기 CH3 — Ha_ax 반대편(-y, axial 아래)으로 배치해 충돌 해소
      { id:'Sub',   element:'CH3', label:'Sub(ax)', position:{x:0,   y:-0.85, z:1.95}, formalCharge:0 },
    ],
    bonds: [
      { atom1Id:'C1',atom2Id:'C2',order:1 }, { atom1Id:'C2',atom2Id:'C3',order:1 },
      { atom1Id:'C3',atom2Id:'C4',order:1 }, { atom1Id:'C4',atom2Id:'C5',order:1 },
      { atom1Id:'C5',atom2Id:'C6',order:1 }, { atom1Id:'C6',atom2Id:'C1',order:1 },
      { atom1Id:'C1',atom2Id:'Ha_ax',order:1 },
      { atom1Id:'C1',atom2Id:'Sub',order:1 },
    ],
  },

  'butadiene': {
    pubchemCid: 7845,
    name: 'Butadiene (s-cis)',
    iupacName: 'buta-1,3-diene',
    formula: 'C4H6',
    atoms: [
      { id:'C1d', element:'C', label:'C1', position:{x:-2.0,y:0.6,z:0}, hybridization:'sp2', formalCharge:0 },
      { id:'C2d', element:'C', label:'C2', position:{x:-0.7,y:0,  z:0}, hybridization:'sp2', formalCharge:0 },
      { id:'C3d', element:'C', label:'C3', position:{x:0.7, y:0,  z:0}, hybridization:'sp2', formalCharge:0 },
      { id:'C4d', element:'C', label:'C4', position:{x:2.0, y:0.6,z:0}, hybridization:'sp2', formalCharge:0 },
    ],
    bonds: [
      { atom1Id:'C1d',atom2Id:'C2d',order:2 },
      { atom1Id:'C2d',atom2Id:'C3d',order:1 },
      { atom1Id:'C3d',atom2Id:'C4d',order:2 },
    ],
  },

  'ethylene': {
    pubchemCid: 6325,
    name: 'Ethylene (dienophile)',
    iupacName: 'ethene',
    formula: 'C2H4',
    atoms: [
      { id:'C1e', element:'C', label:'C1', position:{x:-0.6,y:-4,z:0}, hybridization:'sp2', formalCharge:0 },
      { id:'C2e', element:'C', label:'C2', position:{x:0.6, y:-4,z:0}, hybridization:'sp2', formalCharge:0 },
    ],
    bonds: [{ atom1Id:'C1e',atom2Id:'C2e',order:2 }],
  },
};

const ALIASES = {
  'hbr': 'HBr', 'hydrogen bromide': 'HBr',
  '(r)-3-chloro-1-butene': 'carbocation', '3-chloro-1-butene': 'carbocation',
  'carbocation': 'carbocation', 'c2 carbocation': 'carbocation',
  'cyclohexane': 'cyclohexane', '사이클로헥세인': 'cyclohexane',
  'butadiene': 'butadiene', '부타디엔': 'butadiene', 'diene': 'butadiene',
  'ethylene': 'ethylene', '에틸렌': 'ethylene', 'dienophile': 'ethylene',
};

export function getMolecule3D(name) {
  const key = ALIASES[name.toLowerCase()] || name;
  return MOLECULES[key] || null;
}

export function getInitialScenario() {
  return buildInitialScenario();
}

export function getInitialChatMessage() {
  return '안녕하세요! ChemCanvas AI입니다.\n\n현재 화면에는 <b>(R)-3-chloro-1-butene</b>에서 H+ 첨가 후 생성된 <b>C2 카보양이온 중간체</b>가 표시되어 있습니다. 원자 위에 마우스를 올리면 원소 정보를 확인할 수 있어요.\n\n아래 버튼을 클릭하거나 질문을 직접 입력해 시뮬레이션을 시작하세요.';
}
