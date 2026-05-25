/**
 * ChemCanvas AI — 초기 분자 데이터 (서버와 프론트엔드 공유)
 *
 * 서버 `mocks/pubchem.js`의 carbocation 데이터와 프론트엔드 `App.js`의 fallback이
 * 동일한 정의를 유지하도록 단일 source of truth로 분리한 모듈입니다.
 *
 * 순수 데이터만 export — 어떤 환경(Node ESM / Vite 브라우저)에서도 동일하게 작동합니다.
 */

export const INITIAL_CARBOCATION = {
  pubchemCid: 0,
  name: '(R)-3-chloro-1-butene C2 carbocation',
  iupacName: '(R)-3-chloro-1-butene C2 carbocation intermediate',
  formula: 'C4H7Cl+',
  atoms: [
    { id: 'C3',     element: 'C',   label: 'C3',  position: { x:  0,     y:  0,    z: -1.5 }, hybridization: 'sp3', formalCharge: 0 },
    { id: 'C3_Cl',  element: 'Cl',  label: 'Cl',  position: { x:  1.5,   y:  0.5,  z: -2.5 }, formalCharge: 0 },
    { id: 'C3_H',   element: 'H',   label: 'H',   position: { x: -1.2,   y:  0.8,  z: -2.5 }, formalCharge: 0 },
    { id: 'C3_Me',  element: 'CH3', label: 'CH₃', position: { x:  0,     y: -1.8,  z: -2.5 }, formalCharge: 0 },
    { id: 'C2',     element: 'C',   label: 'C2⁺', position: { x:  0,     y:  0,    z:  1.5 }, hybridization: 'sp2', formalCharge: 1 },
    { id: 'C2_Me',  element: 'CH3', label: 'CH₃', position: { x:  1.56,  y:  0,    z:  2.4 }, formalCharge: 0 },
    { id: 'C2_H',   element: 'H',   label: 'H',   position: { x: -1.56,  y:  0,    z:  2.4 }, formalCharge: 0 },
    { id: 'Br_ion', element: 'Br',  label: 'Br⁻', position: { x: -4,     y:  6,    z:  1.5 }, formalCharge: -1, visible: false },
  ],
  bonds: [
    { atom1Id: 'C3', atom2Id: 'C3_Cl', order: 1 },
    { atom1Id: 'C3', atom2Id: 'C3_H',  order: 1 },
    { atom1Id: 'C3', atom2Id: 'C3_Me', order: 1 },
    { atom1Id: 'C3', atom2Id: 'C2',    order: 1 },
    { atom1Id: 'C2', atom2Id: 'C2_Me', order: 1 },
    { atom1Id: 'C2', atom2Id: 'C2_H',  order: 1 },
  ],
};

export const INITIAL_SCENARIO_TITLE = '(R)-3-chloro-1-butene + HBr → Markovnikov 첨가반응';
export const INITIAL_SCENARIO_REACTION_TYPE = 'electrophilic_addition';

export function buildInitialScenario() {
  return {
    title: INITIAL_SCENARIO_TITLE,
    reactionType: INITIAL_SCENARIO_REACTION_TYPE,
    molecules: [INITIAL_CARBOCATION],
    steps: [],
  };
}
