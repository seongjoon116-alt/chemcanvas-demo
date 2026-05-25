# ChemCanvas AI — 프로젝트 요약

> **중요**: 아래 변경이 발생할 때마다 `.claude/MEMORY.md`를 반드시 최신 상태로 갱신할 것.
> **중요**: `cursorrules.md` 과 `.claude/CLAUDE.md` 파일은 완벽히 같은 내용을 유지할 것.
> **중요**: 코드 수정 후에는 반드시 `node tests/run.js` 를 실행하고 결과를 확인할 것.

갱신 트리거:
- 새 파일/모듈 추가 또는 기존 파일 삭제
- 기술 스택 변경 (라이브러리 추가·제거·버전 변경)
- AI 모델 변경 (LLM 교체 또는 버전 업)
- Phase 완료 또는 새 Phase 시작
- API 엔드포인트 추가·변경·삭제
- 데이터 모델(AnimationScenario 등) 구조 변경
- 배포 서버 정보 변경 (IP, 도메인, 인프라 등)
- 환경 변수 추가·변경
- 주요 버그 발견 또는 수정
- 세션 관리 방식 변경

갱신 항목:
1. 파일 맨 위 `최종 업데이트` 날짜를 오늘 날짜로 수정
2. 변경된 섹션의 내용을 실제 코드 기준으로 수정
3. TODO 목록 반영 (완료된 항목 체크, 새 항목 추가)

---

## 테스트 절차

코드를 수정할 때마다 아래 명령을 실행해 회귀 여부를 확인한다.

```powershell
# 서버가 실행 중인 상태에서 (run.ps1 먼저)
node tests/run.js          # 전체 3개 케이스 실행
node tests/run.js 01       # 특정 케이스만 (파일명 필터)
```

| 케이스 | 입력 | 검증 항목 |
|--------|------|----------|
| 01_inspect | 아스피린 구조 보여줘 | INSPECT, 분자 1개, 원자 15개 이상, atomId 유효 |
| 02_react | 에틸렌에 HBr 첨가반응 보여줘 | REACT, 분자 2개, 스텝 2개 이상 |
| 03_compare | 아스피린이랑 이부프로펜 구조 비교해줘 | COMPARE, 분자 2개, 분자 간 거리 ≥ 5Å |

새 검증 항목 추가: `tests/validators.js` 에 `case` 블록 추가 후 케이스 JSON의 `checks` 배열에 이름 추가.

---

## 프로젝트 개요

자연어(한국어/영어)로 질문하면 3D 분자 모델과 반응 애니메이션을 브라우저에서 보여주는 화학 교육 플랫폼.

- **타겟**: 유기화학 학습 중인 고등학생/대학생
- **핵심 원칙**: PubChem 실측 데이터 → LLM 시나리오 생성 → Three.js 렌더링. LLM은 좌표를 절대 임의로 생성하지 않음.

---

## 개발 워크플로우

> **로컬에서 개발 → 완료 후 Oracle 클라우드에 배포**

### 로컬 개발 (평상시)
```
.\run.ps1 실행
  → 포트 3001/5173 기존 프로세스 자동 Kill
  → 백엔드  http://localhost:3001  (새 PowerShell 창)
  → 프론트  http://localhost:5173  (새 PowerShell 창, Vite HMR)
  → 백엔드 실제 LISTEN 확인 후 Chrome으로 브라우저 오픈

코드 수정 → Vite가 즉시 핫리로드 (저장만 하면 반영)
종료: 두 PowerShell 창 닫기
```

### 클라우드 배포 (개발 완료 시)
```
.\deploy.ps1 실행
  → 소스 파일 SCP 업로드
  → 서버에서 npm install + vite build
  → /var/www/html/ 에 dist 복사
  → PM2 재시작
  → http://168.107.10.156 에서 확인
```

### 환경 변수 (server/.env)
```
GEMINI_API_KEY=<발급: https://aistudio.google.com/app/apikey>
GEMINI_MODEL=gemini-2.5-flash
PORT=3001
PUBCHEM_API_KEY=<선택, 무료 발급: https://pubchem.ncbi.nlm.nih.gov/docs/programmatic-access>
```
- 로컬: `server/.env` (`.env.example` 복사 후 수정, run.ps1이 자동 생성, UTF-8 BOM 없이)
- 서버: `/var/www/chemcanvas/.env` (SSH 접속 후 직접 편집)

---

## 시스템 파이프라인 (현재)

```
사용자 입력 (자연어)
    ↓
Frontend (Three.js + GSAP, Vite)
    ↓  POST /api/query  →  SSE 스트리밍 응답
Express 서버 (Node.js, port 3001)
    ↓  onProgress 콜백으로 progress 이벤트 전송
orchestrator.js → Gemini 2.5 Flash API
    ↓  tool_use: get_molecule_3d(name)
server/pubchem.js → PubChem REST API (3D SDF 파싱)
    ↓  3D 없으면 2D fallback / CID+mol 캐싱
LLM → <scenario>AnimationScenario JSON</scenario>
    ↓
Frontend → SSE 수신 → CoT 패널 실시간 업데이트
    ↓
SceneManager.loadScenario() + playStep() → Three.js 렌더 + GSAP 애니메이션
```

---

## 현재 구현 단계

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 1 | 정적 데모 모듈화 + Three.js 씬 엔진 | ✅ 완료 |
| Phase 2 | AI 오케스트레이터 + Gemini API | ✅ 완료 |
| Phase 3 | PubChem REST API 실제 연동 (SDF 파싱) | ✅ 완료 |
| Phase 3+ | UI: CoT 스트리밍 / 서버 로그 / 동적 legend | ✅ 완료 |
| Phase 4 | 세션 영속성 + DB + 멀티탭 UX | ⏳ 미구현 |

---

## 핵심 데이터 모델

**AnimationScenario** — 서버가 프론트엔드에 전달하는 최종 결과물

```
AnimationScenario
  ├── title, reactionType
  ├── molecules[]: MoleculeData (pubchemCid, atoms[], bonds[])
  │     └── atoms[]: { id, element, label, position{x,y,z}, formalCharge, hybridization, visible }
  └── steps[]: AnimationStep (type, description(한국어), duration, targets[])
        └── type: approach | bond_break | bond_form | rotate_view | highlight | inversion | show_orbital | hide_orbital | label_show | reveal
```

---

## API 엔드포인트

| 메서드 | 경로 | 응답 | 설명 |
|--------|------|------|------|
| GET | `/api/health` | JSON | 서버 상태 확인 |
| GET | `/api/init` | JSON | 초기 시나리오 + 환영 메시지 |
| POST | `/api/query` | **SSE 스트리밍** | 쿼리 처리 (progress/done/error 이벤트) |
| GET | `/api/logs` | **SSE 스트리밍** | 서버 console 로그 실시간 전송 |

### /api/query SSE 이벤트 구조
```
event: progress  data: { event: "tool_call",   mol, text }
event: progress  data: { event: "tool_result", mol, atoms, bonds, text }
event: progress  data: { event: "generating",  text }
event: done      data: { scenario, chatMessage }
event: error     data: { message }
```

---

## 파일 구조 (현재)

```
better_pubchem/
├── run.ps1                  ← 로컬 개발 실행 (포트 정리 + 백엔드 대기 + Chrome 오픈)
├── deploy.ps1               ← Oracle 클라우드 배포
├── cursorrules.md           ← CLAUDE.md와 동일 내용 유지
├── prototype/               ← 참조용 원본 파일 (수정하지 않음)
│   ├── pitch_demo.html
│   ├── chemcanvas_demo_v2.html
│   └── chemcanvas_ai_plan.md
├── frontend/
│   ├── index.html           (전체 CSS + 레이아웃: CoT 패널, 서버 로그 패널, legend)
│   ├── package.json         (three ^0.160.0, gsap ^3.12.2, vite ^5.0.0)
│   ├── vite.config.js       (/api → localhost:3001 프록시)
│   └── src/
│       ├── App.js           (부팅, 세션, handleSend, updateLegend, connectLogStream)
│       ├── api/client.js    (sendQueryStream SSE 파서, initScene)
│       ├── chat/ChatPanel.js (showCoT 컨트롤러, setInputEnabled)
│       └── scene/
│           ├── SceneManager.js  (loadScenario, #fitCamera, playStep, GSAP 애니메이션)
│           ├── AtomFactory.js
│           └── BondFactory.js
├── server/
│   ├── index.js             (Express, SSE /api/query + /api/logs, console 브로드캐스트)
│   ├── orchestrator.js      (Gemini API + tool_use 루프 + onProgress + repairJson + validateAndFix)
│   ├── validator.js         (validateAndFix: atomId/bond/overlap/coord 검증 및 자동수정)
│   ├── pubchem.js           (PubChem REST API: nameToCid, fetchSdf, parseSdf V2000, inferHybridization)
│   ├── .env                 (로컬용, gitignore 대상)
│   ├── .env.example         (템플릿: GEMINI_API_KEY, GEMINI_MODEL, PORT, PUBCHEM_API_KEY)
│   ├── mocks/pubchem.js     (초기 시나리오 + 5개 하드코딩 분자, getInitialScenario용으로 유지)
│   └── prompts/system.txt   (LLM 시스템 프롬프트 + classify_query 가이드)
├── tests/
│   ├── run.js               ← 통합 테스트 실행기 (node tests/run.js)
│   ├── validators.js        ← 시나리오 구조 검증 함수 모음
│   └── cases/
│       ├── 01_inspect.json  (아스피린 INSPECT)
│       ├── 02_react.json    (에틸렌+HBr REACT)
│       └── 03_compare.json  (아스피린 vs 이부프로펜 COMPARE)
└── .claude/
    ├── CLAUDE.md            (이 파일)
    ├── MEMORY.md            (상세 상태 기록)
    └── settings.local.json
```

---

## 배포 정보

- 서버: Oracle AMD VM `168.107.10.156` (Ubuntu 22.04, nginx + PM2)
- SSH 키: `C:\Users\acer\Desktop\capstone_gala\ssh-key-2026-05-20 (1).key`
- 프론트엔드: `/var/www/html/` (Vite 빌드 결과물)
- 백엔드: `/var/www/chemcanvas/` (PM2 `chemcanvas-server`)
- nginx: 포트 80, `/api/*` → `localhost:3001` 프록시

---

## 주요 설계 결정

| 결정 | 이유 |
|------|------|
| AnimationScenario JSON 인터페이스 | LLM 출력을 검증 가능한 JSON으로 제한 → 할루시네이션 방지 |
| PubChem REST API (SDF V2000 파싱) | LLM이 정확한 좌표/결합각을 생성할 수 없음. Å 단위 그대로 Three.js에 사용 |
| SSE 스트리밍 /api/query | 툴 호출 단계별 진행 상황 실시간 전달 (CoT 효과) |
| /api/logs SSE + console 오버라이드 | 개발 중 서버 로그를 UI에서 직접 확인 |
| GSAP 애니메이션 | `.addLabel` 기반 동기화로 여러 객체 동시 애니메이션 조율 용이 |
| dynamicBonds 매 프레임 갱신 | 이동하는 원자 사이 결합 정합성을 GSAP으로 따로 관리하는 것보다 단순하고 견고 |
| mocks/pubchem.js 유지 | getInitialScenario()가 /api/init에서 여전히 사용됨. Phase 4까지 유지 |
| LLM: Google Gemini 2.5 Flash | 원래 설계는 Claude였으나 변경 (`@google/generative-ai`) |
| validator.js 서버사이드 검증 | LLM이 생성한 JSON의 atomId 무결성·분자 overlap을 응답 전 자동 수정 |
| repairJson() in orchestrator.js | 복잡한 시나리오에서 LLM이 trailing comma / 리터럴 개행 삽입 시 자동 수복 |
| SceneManager #fitCamera() | 다분자 시나리오 로드 시 무게중심+바운딩반지름으로 카메라 자동 조정. xOffset 누적 제거 |
| tests/run.js 통합 테스트 | 실제 서버에 쿼리를 날려 시나리오 구조를 자동 검증. 수정마다 회귀 확인 |
| H-stripping (COMPARE 모드) | 20원자 초과 분자에서 H 원자 제거해 LLM 컨텍스트를 ~50% 축소. `fr.response.result`를 shallow copy로 교체해 molCache 원본 오염 방지 |
| 수정 라운드 `tools: []` | `<scenario>` 누락 시 수정 라운드에서 `model.generateContent({ contents, tools: [] })` 호출 — 툴을 비활성화하지 않으면 모델이 다시 function call을 반환해 `.text()` 호출이 throw됨 |
| REACT molecule_count 유연화 | REACT 모드는 반응물 외에 중간체·생성물까지 별도 분자로 생성할 수 있음. 검증은 정확히 N개가 아닌 `minMoleculeCount >= N`으로 해야 함 |

---

## 디버깅 교훈 (2025-05 리빌드)

아래는 실제 버그 수정 과정에서 얻은 경험 기록이다. 유사한 문제가 재발할 때 참고할 것.

### 1. LLM 지시 추가는 다른 모드와의 충돌을 반드시 확인할 것
`classify_query` 결과에 `FORMAT_REMINDER: "Do NOT write any text before <scenario>"` 필드를 추가했더니, REACT CoT("분석 후 생성")와 충돌해 REACT가 `<scenario>` 자체를 생략하는 회귀가 발생했다. **global한 지시 변경은 모든 ACT 모드를 개별 테스트해야 하며, 특정 모드에만 적용해야 할 내용은 ACT_INSTRUCTIONS 안에 격리해야 한다.**

### 2. 캐시된 객체를 직접 변형하면 나중 쿼리까지 오염된다
`molCache.get(cid)`로 가져온 분자 객체의 `atoms`·`bonds`를 직접 재할당(`mol.atoms = ...`)하면 캐시 원본이 바뀐다. COMPARE 이후 INSPECT를 하면 H가 제거된 버전이 반환된다. **캐시에서 가져온 객체를 변형할 때는 반드시 shallow/deep copy 후 `fr.response.result = copy`로 교체해야 한다.**

### 3. 수정 라운드에서 tools를 꺼야 한다
`<scenario>` 누락 수정 라운드에서 `model.generateContent({ contents })`를 그대로 호출하면 모델이 다시 `classify_query` 같은 tool call을 반환할 수 있다. 이때 `response.text()`는 throw되고 catch 블록에서 `finalText`가 갱신되지 않아 전체 재시도 사이클로 빠진다. **수정 라운드는 반드시 `tools: []`를 명시해 순수 텍스트 응답을 강제해야 한다.**

### 4. 테스트 검증 조건을 LLM 실제 출력에 맞게 설정해야 한다
- **minAtomCount**: LLM이 explicit H 원자를 생략하는 경우가 있음 (아스피린 21원자 → heavy atom 13개만 생성). 임계값은 heavy atom 기준으로 설정할 것 (예: 10).
- **moleculeCount (REACT)**: REACT 모드는 반응물 2개 외에 중간체·생성물을 추가 분자로 생성한다. 정확한 수 대신 `minMoleculeCount`로 검증해야 한다.

### 5. 서버 재시작 시 반드시 `server/` 디렉터리에서 실행해야 한다
`dotenv/config`는 **현재 작업 디렉터리**에서 `.env`를 로드한다. 프로젝트 루트(`better_pubchem/`)에서 `node server/index.js`를 실행하면 `server/.env`를 찾지 못해 GEMINI_API_KEY 오류가 난다. 항상 `node index.js`를 `server/` 안에서 실행하거나 `run.ps1`을 사용할 것.

### 6. LLM 응답 비결정성에 대한 대응 레이어
동일한 쿼리라도 `<scenario>` 태그 포함 여부가 실행마다 달라질 수 있다. 현재 3단계 방어:
1. **system.txt CRITICAL 규칙**: `<scenario>` 출력 강제
2. **수정 라운드 (orchestrator.js)**: 누락 시 즉시 추가 round (`tools: []`)
3. **index.js 재시도**: 최종 `scenario null`이면 1초 대기 후 전체 재실행

이 레이어들이 연쇄적으로 작동하므로 하나가 실패해도 다음이 보완한다.
