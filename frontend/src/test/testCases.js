export const TEST_CASES = [
  // ── 소분자 ──────────────────────────────────────────────────
  {
    id: 'small_water',
    group: '소분자',
    name: '물 H₂O',
    atomCount: 3,
    query: '물 분자 구조 보여줘',
    desc: '가장 단순한 무기 분자',
  },
  {
    id: 'small_ethanol',
    group: '소분자',
    name: '에탄올 C₂H₆O',
    atomCount: 9,
    query: '에탄올 구조 보여줘',
    desc: '하이드록실기 포함 소형 유기 분자',
  },
  {
    id: 'small_benzene',
    group: '소분자',
    name: '벤젠 C₆H₆',
    atomCount: 12,
    query: '벤젠 분자 구조 보여줘',
    desc: '방향족 6원환 구조',
  },

  // ── 중분자 ──────────────────────────────────────────────────
  {
    id: 'medium_aspirin',
    group: '중분자',
    name: '아스피린 C₉H₈O₄',
    atomCount: 21,
    query: '아스피린 구조 보여줘',
    desc: '카르복실기 + 에스터기',
  },
  {
    id: 'medium_ibuprofen',
    group: '중분자',
    name: '이부프로펜 C₁₃H₁₈O₂',
    atomCount: 33,
    query: '이부프로펜 구조 보여줘',
    desc: '이소부틸기 + 카르복실기',
  },
  {
    id: 'medium_caffeine',
    group: '중분자',
    name: '카페인 C₈H₁₀N₄O₂',
    atomCount: 24,
    query: '카페인 구조 보여줘',
    desc: '퓨린 골격, N 원자 4개',
  },

  // ── 대분자 ──────────────────────────────────────────────────
  {
    id: 'large_testosterone',
    group: '대분자',
    name: '테스토스테론 C₁₉H₂₈O₂',
    atomCount: 49,
    query: '테스토스테론 구조 보여줘',
    desc: '스테로이드 4환 골격',
  },
  {
    id: 'large_cortisol',
    group: '대분자',
    name: '코르티솔 C₂₁H₃₀O₅',
    atomCount: 56,
    query: '코르티솔 구조 보여줘',
    desc: '스트레스 호르몬, 스테로이드',
  },

  // ── 비교 모드 ────────────────────────────────────────────────
  {
    id: 'compare_aspirin_ibu',
    group: '비교 모드',
    name: '아스피린 vs 이부프로펜',
    atomCount: null,
    query: '아스피린이랑 이부프로펜 구조 비교해줘',
    desc: '소염진통제 구조 비교',
  },
  {
    id: 'compare_ethanol_methanol',
    group: '비교 모드',
    name: '에탄올 vs 메탄올',
    atomCount: null,
    query: '에탄올이랑 메탄올 구조 비교해줘',
    desc: '알코올 동족체 비교',
  },

  // ── 화학반응 ─────────────────────────────────────────────────
  {
    id: 'react_ethylene_hbr',
    group: '화학반응',
    name: '에틸렌 + HBr 첨가반응',
    atomCount: null,
    query: '에틸렌에 HBr 첨가반응 보여줘',
    desc: '마르코프니코프 규칙',
  },
  {
    id: 'react_sn2',
    group: '화학반응',
    name: 'SN2 치환반응',
    atomCount: null,
    query: '메틸 브로마이드에 수산화 이온이 SN2 반응하는 과정을 보여줘',
    desc: '배면 공격, 구성 역전',
  },
];

export const ERROR_TYPES = [
  { id: 'no_hydrogen',     label: '수소 원자 미표시' },
  { id: 'edge_mismatch',   label: '엣지-노드 불일치 (결합선이 원자와 연결 안됨)' },
  { id: 'node_too_large',  label: '원자구가 결합선에 비해 너무 큼' },
  { id: 'compare_one_mol', label: '비교 모드인데 분자가 하나만 표시됨' },
  { id: 'no_animation',    label: '애니메이션이 재생되지 않음' },
  { id: 'wrong_structure', label: '분자 구조 오류 (원소·결합 잘못됨)' },
  { id: 'camera_bad',      label: '카메라가 이상함 (분자 잘리거나 너무 작음)' },
  { id: 'overlap',         label: '원자들이 겹쳐 구조 식별 불가' },
  { id: 'other',           label: '기타' },
];

// 그룹 목록 (렌더링 순서 고정)
export const GROUPS = ['소분자', '중분자', '대분자', '비교 모드', '화학반응'];
