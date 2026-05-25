/**
 * ChemCanvas AI — 시나리오 구조 검증기
 * run.js에서 호출됨. 각 check 이름 → 검증 함수 매핑.
 */

const VALID_STEP_TYPES = new Set([
  'approach', 'bond_form', 'bond_break', 'rotate_view',
  'highlight', 'inversion', 'show_orbital', 'hide_orbital',
  'label_show', 'reveal',
]);

const VALID_PROPERTIES = new Set([
  'position', 'visible', 'scale', 'camera', 'opacity',
  'bond', 'orbital', 'label', 'highlight',
]);

export function runValidators(result, expected, checks) {
  const passed = [];
  const failed = [];
  const ok   = msg => passed.push(msg);
  const fail = msg => failed.push(msg);

  // 자주 쓰는 데이터 미리 추출
  const scenario = result?.scenario ?? null;
  const molecules = scenario?.molecules ?? [];
  const steps = scenario?.steps ?? [];

  // validIds: 모든 atomId 집합
  const validIds = new Set();
  for (const mol of molecules) {
    for (const atom of mol.atoms ?? []) {
      if (atom.id) validIds.add(atom.id);
    }
  }

  for (const check of checks) {
    switch (check) {

      // ── 기본 존재 확인 ────────────────────────────────────
      case 'scenario_not_null':
        scenario
          ? ok('시나리오 생성됨')
          : fail('시나리오 null — JSON 파싱 실패 또는 <scenario> 태그 누락');
        break;

      // ── 분자 수 (정확) ────────────────────────────────────
      case 'molecule_count': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const got = molecules.length;
        const want = expected.moleculeCount;
        got === want
          ? ok(`분자 수 정확 (${got}개)`)
          : fail(`분자 수 불일치 — 기대 ${want}개, 실제 ${got}개`);
        break;
      }

      // ── 분자 수 (최소) ────────────────────────────────────
      case 'min_molecule_count': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const got = molecules.length;
        const want = expected.minMoleculeCount ?? 1;
        got >= want
          ? ok(`분자 수 충분 (${got}개 ≥ ${want})`)
          : fail(`분자 수 부족 — ${got}개 < 최소 ${want}개`);
        break;
      }

      // ── 최소 원자 수 ──────────────────────────────────────
      case 'min_atom_count': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const total = molecules.reduce((s, m) => s + (m.atoms?.length ?? 0), 0);
        total >= expected.minAtomCount
          ? ok(`원자 수 충분 (${total}개 ≥ ${expected.minAtomCount})`)
          : fail(`원자 수 부족 — ${total}개 < 최소 ${expected.minAtomCount}개`);
        break;
      }

      // ── atomId 참조 유효성 ────────────────────────────────
      case 'atom_ids_valid': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const bad = [];
        for (const step of steps) {
          for (const t of step.targets ?? []) {
            if (t.atomId && !validIds.has(t.atomId)) {
              bad.push(`step${step.stepId ?? '?'} → "${t.atomId}"`);
            }
          }
        }
        bad.length === 0
          ? ok(`atomId 참조 유효 (등록된 원자 ${validIds.size}개)`)
          : fail(`유효하지 않은 atomId ${bad.length}건: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}`);
        break;
      }

      // ── bond connectTo 유효성 ─────────────────────────────
      case 'bond_ids_valid': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const bad = [];
        for (const step of steps) {
          for (const t of step.targets ?? []) {
            if (t.property === 'bond' && t.to?.connectTo) {
              if (!validIds.has(t.to.connectTo)) {
                bad.push(`step${step.stepId ?? '?'} → connectTo "${t.to.connectTo}"`);
              }
            }
          }
        }
        bad.length === 0
          ? ok('bond connectTo 참조 유효')
          : fail(`유효하지 않은 connectTo ${bad.length}건: ${bad.slice(0, 3).join(', ')}`);
        break;
      }

      // ── step type 유효성 ──────────────────────────────────
      case 'step_types_valid': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const bad = steps.filter(s => !VALID_STEP_TYPES.has(s.type));
        bad.length === 0
          ? ok(`스텝 타입 유효 (${steps.length}개)`)
          : fail(`알 수 없는 스텝 타입: ${bad.map(s => s.type).join(', ')}`);
        break;
      }

      // ── target property 유효성 ────────────────────────────
      case 'step_targets_valid': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const bad = [];
        for (const step of steps) {
          for (const t of step.targets ?? []) {
            if (t.property && !VALID_PROPERTIES.has(t.property)) {
              bad.push(`step${step.stepId ?? '?'} property="${t.property}"`);
            }
          }
        }
        bad.length === 0
          ? ok('target property 유효')
          : fail(`알 수 없는 property ${bad.length}건: ${bad.slice(0, 3).join(', ')}`);
        break;
      }

      // ── 좌표 범위 (±80Å) ─────────────────────────────────
      case 'positions_in_range': {
        if (!scenario) { fail('시나리오 없음'); break; }
        let out = 0;
        for (const mol of molecules) {
          for (const atom of mol.atoms ?? []) {
            const { x = 0, y = 0, z = 0 } = atom.position ?? {};
            if (Math.abs(x) > 80 || Math.abs(y) > 80 || Math.abs(z) > 80) out++;
          }
        }
        out === 0
          ? ok('원자 좌표 범위 정상 (±80Å 이내)')
          : fail(`좌표 범위(±80Å) 초과 원자 ${out}개`);
        break;
      }

      // ── 스텝 존재 ─────────────────────────────────────────
      case 'has_steps':
        if (!scenario) { fail('시나리오 없음'); break; }
        steps.length > 0
          ? ok(`애니메이션 스텝 존재 (${steps.length}개)`)
          : fail('애니메이션 스텝 없음 (steps 배열이 비어 있음)');
        break;

      // ── 최소 스텝 수 ──────────────────────────────────────
      case 'min_step_count': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const got = steps.length;
        const want = expected.minStepCount ?? 1;
        got >= want
          ? ok(`스텝 수 충분 (${got}개 ≥ ${want})`)
          : fail(`스텝 수 부족 — ${got}개 < 최소 ${want}개`);
        break;
      }

      // ── 다분자 간격 (COMPARE용) ───────────────────────────
      case 'molecules_separated': {
        if (!scenario) { fail('시나리오 없음'); break; }
        if (molecules.length < 2) { fail('분자가 2개 미만 — 간격 검사 불가'); break; }

        const center = mol => {
          const atoms = (mol.atoms ?? []).filter(a => a.visible !== false);
          if (!atoms.length) return { x: 0, y: 0, z: 0 };
          const n = atoms.length;
          return {
            x: atoms.reduce((s, a) => s + (a.position?.x ?? 0), 0) / n,
            y: atoms.reduce((s, a) => s + (a.position?.y ?? 0), 0) / n,
            z: atoms.reduce((s, a) => s + (a.position?.z ?? 0), 0) / n,
          };
        };

        const c0 = center(molecules[0]);
        const c1 = center(molecules[1]);
        const dist = Math.sqrt((c0.x - c1.x) ** 2 + (c0.y - c1.y) ** 2 + (c0.z - c1.z) ** 2);
        dist >= 5
          ? ok(`분자 간 거리 충분 (${dist.toFixed(1)}Å ≥ 5Å)`)
          : fail(`분자 겹침 위험 — 중심 간 거리 ${dist.toFixed(1)}Å < 5Å`);
        break;
      }

      // ── 한국어 설명 포함 ──────────────────────────────────
      case 'chat_message_korean': {
        const msg = result?.chatMessage ?? '';
        /[가-힯]/.test(msg)
          ? ok('한국어 설명 포함')
          : fail('한국어 설명 없음 (chatMessage가 비어있거나 영어만 있음)');
        break;
      }

      // ── MANIPULATE / EXPLAIN: 새 분자 호출 금지 검증 ─────
      // 통과 조건:
      //   1) scenario.molecules가 비어있음 (현재 씬 유지)
      //   2) 또는 scenario.molecules의 모든 name이 expected.contextMoleculeNames에 포함
      //      (즉 이미 씬에 있던 분자만 사용)
      case 'no_new_molecules_fetched': {
        if (!scenario) { fail('시나리오 없음'); break; }
        const allowed = new Set((expected.contextMoleculeNames ?? []).map(n => n.toLowerCase()));
        const newMols = molecules
          .map(m => (m.name ?? '').toLowerCase())
          .filter(name => name && !allowed.has(name));
        if (newMols.length === 0) {
          ok(`새 분자 호출 없음 (씬 분자 ${molecules.length}개 모두 허용 목록)`);
        } else {
          fail(`새 분자 ${newMols.length}개 발견 — MANIPULATE/EXPLAIN 규칙 위반: ${newMols.slice(0, 3).join(', ')}`);
        }
        break;
      }

      default:
        fail(`알 수 없는 check: "${check}"`);
    }
  }

  return { passed, failed };
}
