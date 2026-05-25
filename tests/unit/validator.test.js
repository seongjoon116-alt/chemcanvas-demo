/**
 * validator.js 단위 테스트
 *
 * validateAndFix는 LLM 호출 없이 결정적이므로 단위 테스트로 회귀 방지.
 * - atomId 검증
 * - bond 검증
 * - transitive overlap 보정
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  validateAndFix, getMolCenter, vecDist, translateMolecule, VALIDATOR_CONSTANTS,
} from '../../server/validator.js';

const { OVERLAP_THRESHOLD, MOLECULE_SEPARATION } = VALIDATOR_CONSTANTS;

// 헬퍼: 한 분자 생성
function mol(name, atoms = [], bonds = []) {
  return { name, atoms, bonds };
}
function atom(id, x = 0, y = 0, z = 0, element = 'C') {
  return { id, element, position: { x, y, z } };
}

describe('validateAndFix — atomId 검증', () => {
  test('null scenario는 안전 반환', () => {
    const r = validateAndFix(null);
    assert.equal(r.scenario, null);
    assert.deepEqual(r.issues, []);
  });

  test('존재하는 atomId는 통과', () => {
    const sc = {
      molecules: [mol('m1', [atom('A'), atom('B')])],
      steps: [{
        stepId: 0,
        targets: [{ atomId: 'A', property: 'position', to: { x: 1, y: 0, z: 0 } }],
      }],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.steps[0].targets.length, 1);
  });

  test('존재하지 않는 atomId는 target에서 제거', () => {
    const sc = {
      molecules: [mol('m1', [atom('A')])],
      steps: [{
        stepId: 0,
        targets: [
          { atomId: 'A', property: 'position', to: { x: 1, y: 0, z: 0 } },
          { atomId: 'GHOST', property: 'position', to: { x: 1, y: 0, z: 0 } },
        ],
      }],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.steps[0].targets.length, 1);
    assert.equal(r.scenario.steps[0].targets[0].atomId, 'A');
    assert.ok(r.issues.some(i => i.includes('GHOST')));
  });

  test('camera/label target은 atomId 없어도 통과', () => {
    const sc = {
      molecules: [mol('m1', [atom('A')])],
      steps: [{
        stepId: 0,
        targets: [
          { property: 'camera', to: { x: 0, y: 0, z: 10 } },
          { property: 'label',  to: { text: 'foo', color: '#fff' } },
        ],
      }],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.steps[0].targets.length, 2);
  });

  test('position target의 atomId 누락은 제거', () => {
    const sc = {
      molecules: [mol('m1', [atom('A')])],
      steps: [{
        stepId: 0,
        targets: [
          { property: 'position', to: { x: 1, y: 0, z: 0 } }, // atomId 누락
          { atomId: 'A', property: 'position', to: { x: 1, y: 0, z: 0 } },
        ],
      }],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.steps[0].targets.length, 1);
    assert.equal(r.scenario.steps[0].targets[0].atomId, 'A');
  });
});

describe('validateAndFix — bond connectTo 검증', () => {
  test('유효한 connectTo는 통과', () => {
    const sc = {
      molecules: [mol('m1', [atom('A'), atom('B')])],
      steps: [{
        stepId: 0,
        targets: [{ atomId: 'A', property: 'bond', to: { connectTo: 'B', action: 'form' } }],
      }],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.steps[0].targets.length, 1);
  });

  test('존재하지 않는 connectTo는 제거', () => {
    const sc = {
      molecules: [mol('m1', [atom('A')])],
      steps: [{
        stepId: 0,
        targets: [{ atomId: 'A', property: 'bond', to: { connectTo: 'GHOST', action: 'form' } }],
      }],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.steps[0].targets.length, 0);
    assert.ok(r.issues.some(i => i.includes('GHOST')));
  });
});

describe('validateAndFix — transitive overlap 보정', () => {
  test('분자가 1개면 보정 안 함', () => {
    const sc = { molecules: [mol('a', [atom('A', 0, 0, 0)])], steps: [] };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.molecules[0].atoms[0].position.x, 0);
  });

  test('분자[0]과 분자[1]이 겹치면 분자[1] +x 보정', () => {
    const sc = {
      molecules: [
        mol('a', [atom('A1', 0, 0, 0)]),
        mol('b', [atom('B1', 1, 0, 0)]), // 거리 1 < 5 → 겹침
      ],
      steps: [],
    };
    const r = validateAndFix(sc);
    const b1x = r.scenario.molecules[1].atoms[0].position.x;
    assert.equal(b1x, 1 + MOLECULE_SEPARATION, '분자[1]이 +MOLECULE_SEPARATION만큼 이동해야 함');
  });

  test('CRITICAL: 3분자 — 분자[2]가 분자[1]과만 겹쳐도 보정 (transitive)', () => {
    // mol[0] center: 0, mol[1] center: 20 (떨어짐), mol[2] center: 21 (mol[1]과 겹침)
    // 기존 코드: mol[0]과만 비교 → mol[2]는 보정 안 됨 (버그)
    // 신 코드: mol[2]는 mol[1]과 겹침 발견 → MOLECULE_SEPARATION × (2-1) = 9 만큼 보정
    const sc = {
      molecules: [
        mol('a', [atom('A1', 0,  0, 0)]),
        mol('b', [atom('B1', 20, 0, 0)]),
        mol('c', [atom('C1', 21, 0, 0)]),
      ],
      steps: [],
    };
    const r = validateAndFix(sc);
    const c1x = r.scenario.molecules[2].atoms[0].position.x;
    assert.equal(c1x, 21 + MOLECULE_SEPARATION, '분자[2]가 분자[1]과 겹침을 감지해 보정되어야 함');
  });

  test('분자[2]가 분자[0]과 분자[1] 모두와 겹치면 더 먼 쪽 기준 보정', () => {
    // mol[0]: 0, mol[1]: 1 → mol[1] 자동 보정 후 center가 1+9=10
    // mol[2]: 2 → mol[0] (dist=2 < 5) 와 mol[1] (보정 전 center 1, dist=1)
    //   mol[0]과 겹침 → shift = 9 × (2-0) = 18
    //   mol[1]과 겹침 → shift = 9 × (2-1) = 9
    //   최대값 18 적용
    const sc = {
      molecules: [
        mol('a', [atom('A1', 0, 0, 0)]),
        mol('b', [atom('B1', 1, 0, 0)]),
        mol('c', [atom('C1', 2, 0, 0)]),
      ],
      steps: [],
    };
    const r = validateAndFix(sc);
    const c1x = r.scenario.molecules[2].atoms[0].position.x;
    assert.equal(c1x, 2 + MOLECULE_SEPARATION * 2);
  });

  test('충분히 떨어진 분자들은 보정 안 함', () => {
    const sc = {
      molecules: [
        mol('a', [atom('A1', 0, 0, 0)]),
        mol('b', [atom('B1', 20, 0, 0)]),
      ],
      steps: [],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.molecules[1].atoms[0].position.x, 20);
  });
});

describe('validateAndFix — 좌표 범위 경고', () => {
  test('±80Å 범위 초과 시 issue로 경고 (제거는 안 함)', () => {
    const sc = {
      molecules: [mol('m', [atom('A')])],
      steps: [{
        stepId: 0,
        targets: [{ atomId: 'A', property: 'position', to: { x: 100, y: 0, z: 0 } }],
      }],
    };
    const r = validateAndFix(sc);
    assert.equal(r.scenario.steps[0].targets.length, 1, 'target은 그대로 유지');
    assert.ok(r.issues.some(i => i.includes('coord')));
  });
});

describe('헬퍼 함수', () => {
  test('getMolCenter — visible 원자만 평균', () => {
    const m = mol('x', [
      atom('A', 0, 0, 0),
      atom('B', 10, 0, 0),
      { id: 'C', element: 'C', position: { x: 1000, y: 0, z: 0 }, visible: false },
    ]);
    const c = getMolCenter(m);
    assert.equal(c.x, 5);
  });

  test('getMolCenter — 빈 분자', () => {
    assert.deepEqual(getMolCenter(mol('e', [])), { x: 0, y: 0, z: 0 });
  });

  test('vecDist — 기본 동작', () => {
    const d = vecDist({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    assert.equal(d, 5);
  });

  test('translateMolecule — 모든 원자 x 이동', () => {
    const m = mol('t', [atom('A', 1, 0, 0), atom('B', 2, 0, 0)]);
    translateMolecule(m, 10);
    assert.equal(m.atoms[0].position.x, 11);
    assert.equal(m.atoms[1].position.x, 12);
  });
});
