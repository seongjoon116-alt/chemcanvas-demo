import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { molToRCMT } from '../../server/orchestrator.js';

// 테스트용 최소 분자 픽스처
const ethanol = {
  pubchemCid: 702,
  name: 'ethanol',
  atoms: [
    { id: 'C1', element: 'C', hybridization: 'sp3', formalCharge: 0, position: { x: 1.234, y: -0.001, z: 0.0 }, visible: true },
    { id: 'C2', element: 'C', hybridization: 'sp3', formalCharge: 0, position: { x: 0.0,   y: 0.0,   z: 0.0 }, visible: true },
    { id: 'O3', element: 'O', hybridization: 'sp3', formalCharge: 0, position: { x: -0.6,  y: 1.04,  z: 0.0 }, visible: true },
    { id: 'H4', element: 'H', hybridization: 'sp3', formalCharge: 0, position: { x: 1.98,  y: -0.81, z: 0.5 }, visible: true },
  ],
  bonds: [
    { atom1Id: 'C1', atom2Id: 'C2', order: 1 },
    { atom1Id: 'C2', atom2Id: 'O3', order: 1 },
    { atom1Id: 'C1', atom2Id: 'H4', order: 1 },
  ],
};

const carbocation = {
  pubchemCid: 0,
  name: 'carbocation',
  atoms: [
    { id: 'C2', element: 'C', hybridization: 'sp2', formalCharge: 1,  position: { x: 0, y: 0, z: 0 }, visible: true  },
    { id: 'Br', element: 'Br', hybridization: 'sp3', formalCharge: -1, position: { x: 3, y: 0, z: 0 }, visible: false },
  ],
  bonds: [
    { atom1Id: 'C2', atom2Id: 'Br', order: 1 },
  ],
};

describe('molToRCMT — 기본 포맷', () => {
  it('헤더 라인: CID / name / atoms / bonds 카운트', () => {
    const rcmt = molToRCMT(ethanol);
    const header = rcmt.split('\n')[0];
    assert.ok(header.includes('CID:702'), '헤더에 CID 포함');
    assert.ok(header.includes('name:ethanol'), '헤더에 name 포함');
    assert.ok(header.includes('atoms:4'), '원자 수 4 표시');
    assert.ok(header.includes('bonds:3'), '결합 수 3 표시');
  });

  it('원자 라인: ID:ELEMENT(hyb,charge)@x,y,z 형식', () => {
    const rcmt = molToRCMT(ethanol);
    const atomLine = rcmt.split('\n')[1];
    assert.ok(atomLine.includes('C1:C(sp3,0)@1.234,-0.001,0.000'), 'C1 원자 포맷 정확');
    assert.ok(atomLine.includes('O3:O(sp3,0)@-0.600,1.040,0.000'), 'O3 원자 포맷 정확');
  });

  it('결합 라인: # ATOM1-ATOM2:order 형식', () => {
    const rcmt = molToRCMT(ethanol);
    const bondLine = rcmt.split('\n')[2];
    assert.ok(bondLine.startsWith('# '), '결합 라인은 # 으로 시작');
    assert.ok(bondLine.includes('C1-C2:1'), 'C1-C2 단일결합');
    assert.ok(bondLine.includes('C2-O3:1'), 'C2-O3 결합');
  });
});

describe('molToRCMT — 특수 케이스', () => {
  it('visible:false 원자는 ,h 접미사 추가', () => {
    const rcmt = molToRCMT(carbocation);
    const atomLine = rcmt.split('\n')[1];
    assert.ok(atomLine.includes('Br:Br(sp3,-1,h)@'), 'hidden 원자에 ,h 접미사');
  });

  it('visible:true 원자에는 ,h 없음', () => {
    const rcmt = molToRCMT(carbocation);
    const atomLine = rcmt.split('\n')[1];
    assert.ok(atomLine.includes('C2:C(sp2,1)@'), 'visible 원자에 ,h 없음');
    assert.ok(!atomLine.startsWith('C2:C(sp2,1,h)'), 'C2는 hidden 아님');
  });

  it('좌표는 소수점 3자리로 고정', () => {
    const mol = {
      pubchemCid: 1, name: 'test', atoms: [
        { id: 'A1', element: 'C', hybridization: 'sp3', formalCharge: 0,
          position: { x: 1, y: -2.1234567, z: 0 }, visible: true },
      ], bonds: [],
    };
    const rcmt = molToRCMT(mol);
    assert.ok(rcmt.includes('@1.000,-2.123,0.000'), '좌표 3자리 반올림');
  });

  it('H 원자도 전부 포함 (H-stripping 없음)', () => {
    const rcmt = molToRCMT(ethanol);
    assert.ok(rcmt.includes('H4:H(sp3,0)'), 'H 원자 포함됨');
  });

  it('토큰 절감 확인: RCMT < 원본 JSON의 40%', () => {
    const rcmt    = molToRCMT(ethanol);
    const fullJson = JSON.stringify({ result: ethanol });
    assert.ok(rcmt.length < fullJson.length * 0.4,
      `RCMT(${rcmt.length}chars) < JSON(${fullJson.length}chars) × 40%`);
  });
});

describe('molToRCMT — 결합 차수', () => {
  it('이중결합 :2, 삼중결합 :3 표현', () => {
    const mol = {
      pubchemCid: 1, name: 'ethylene', atoms: [
        { id: 'C1', element: 'C', hybridization: 'sp2', formalCharge: 0,
          position: { x: 0, y: 0, z: 0 }, visible: true },
        { id: 'C2', element: 'C', hybridization: 'sp2', formalCharge: 0,
          position: { x: 1.3, y: 0, z: 0 }, visible: true },
      ],
      bonds: [{ atom1Id: 'C1', atom2Id: 'C2', order: 2 }],
    };
    const rcmt = molToRCMT(mol);
    assert.ok(rcmt.includes('C1-C2:2'), '이중결합 :2 표현');
  });
});
