/**
 * AnimationScenario 서버사이드 검증 + 자동 수정
 *
 * validateAndFix(scenario) 실행 순서:
 *  1. atomId 존재 검증 — 없는 ID 참조하는 target 제거
 *  2. bond connectTo + atomId 필수 체크 — 누락이면 target 제거
 *  3. 다분자 transitive overlap 감지 — 누적 x축 오프셋 적용
 *  4. 좌표 범위 검증 — ±80 초과 시 경고 (제거는 안 함)
 */

const OVERLAP_THRESHOLD = 5.0;  // Å — 이 거리 미만이면 overlap으로 판단
const MOLECULE_SEPARATION = 9.0; // Å — overlap 감지 시 적용할 x축 간격
const COORD_LIMIT = 80;          // Å — 이 범위 초과 시 경고

export function validateAndFix(scenario) {
  if (!scenario) return { scenario: null, issues: [] };

  const issues = [];

  // ── 1. 유효한 atomId 목록 수집 ────────────────────────────
  const validIds = new Set();
  for (const mol of scenario.molecules ?? []) {
    for (const atom of mol.atoms ?? []) {
      if (atom.id) validIds.add(atom.id);
    }
  }

  // ── 2. 각 step의 targets 검증 ─────────────────────────────
  for (const step of scenario.steps ?? []) {
    const before = (step.targets ?? []).length;

    step.targets = (step.targets ?? []).filter(target => {
      // camera/label은 atomId 없이 동작 가능
      const needsAtomId = target.property !== 'camera' && target.property !== 'label';

      // atomId 필수 체크: bond/position/visible/scale/opacity/orbital/highlight 모두 atomId 필요
      if (needsAtomId && !target.atomId) {
        issues.push(`[atomId] step${step.stepId ?? '?'} property="${target.property}" atomId 누락 → 제거`);
        return false;
      }

      // atomId 존재 검증
      if (target.atomId && !validIds.has(target.atomId)) {
        issues.push(`[atomId] step${step.stepId ?? '?'} "${target.atomId}" 없음 → 제거`);
        return false;
      }
      // bond connectTo 검증
      if (target.property === 'bond' && target.to?.connectTo) {
        if (!validIds.has(target.to.connectTo)) {
          issues.push(`[bond] step${step.stepId ?? '?'} connectTo "${target.to.connectTo}" 없음 → 제거`);
          return false;
        }
      }
      // 좌표 범위 경고
      if (target.property === 'position' && target.to) {
        const { x = 0, y = 0, z = 0 } = target.to;
        if (Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT || Math.abs(z) > COORD_LIMIT) {
          issues.push(`[coord] step${step.stepId ?? '?'} position (${x},${y},${z}) 범위 초과`);
        }
      }
      return true;
    });

    const removed = before - step.targets.length;
    if (removed > 0) {
      issues.push(`[step${step.stepId ?? '?'}] target ${removed}개 제거됨`);
    }
  }

  // ── 3. 다분자 transitive overlap 자동 수정 ────────────────
  // mol[i]를 mol[0..i-1] 전부와 비교. 가장 가까운 분자와의 겹침을 기반으로 오프셋 결정.
  // 결과적으로 i번째 분자는 max(0, MOLECULE_SEPARATION × (i-j)) 만큼 +x 이동.
  const mols = scenario.molecules ?? [];
  for (let i = 1; i < mols.length; i++) {
    let shift = 0;
    const ci = getMolCenter(mols[i]);
    for (let j = 0; j < i; j++) {
      const cj = getMolCenter(mols[j]);
      const dist = vecDist(cj, ci);
      if (dist < OVERLAP_THRESHOLD) {
        const needed = MOLECULE_SEPARATION * (i - j);
        if (needed > shift) shift = needed;
      }
    }
    if (shift > 0) {
      issues.push(
        `[overlap] "${mols[i].name ?? `mol${i}`}" 이(가) 앞 분자와 겹침 → x+${shift} 보정`
      );
      translateMolecule(mols[i], shift);
    }
  }

  return { scenario, issues };
}

// ── 헬퍼 (테스트에서 사용 가능하도록 export) ─────────────────
export function getMolCenter(mol) {
  const atoms = (mol.atoms ?? []).filter(a => a.visible !== false);
  if (!atoms.length) return { x: 0, y: 0, z: 0 };
  const n = atoms.length;
  return {
    x: atoms.reduce((s, a) => s + (a.position?.x ?? 0), 0) / n,
    y: atoms.reduce((s, a) => s + (a.position?.y ?? 0), 0) / n,
    z: atoms.reduce((s, a) => s + (a.position?.z ?? 0), 0) / n,
  };
}

export function vecDist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

export function translateMolecule(mol, offsetX) {
  for (const atom of mol.atoms ?? []) {
    if (atom.position) atom.position.x += offsetX;
  }
}

export const VALIDATOR_CONSTANTS = {
  OVERLAP_THRESHOLD,
  MOLECULE_SEPARATION,
  COORD_LIMIT,
};
