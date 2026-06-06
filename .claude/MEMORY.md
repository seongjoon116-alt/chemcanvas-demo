# ChemCanvas AI — 프로젝트 현재 상태 (메모리)

> 최종 업데이트: 2026-06-06 (LLM Gemini→DeepSeek V4 마이그레이션 + 모니터링 로거 + UI 테스트 패널)

---

## 🆕 최근 변경 요약 (2026-06-06)

### A. LLM Gemini 2.5 Flash → DeepSeek V4 마이그레이션

- `server/package.json`: `@google/generative-ai` 제거, `openai ^4.82.0` 추가
- `server/.env.example`: `GEMINI_API_KEY/GEMINI_MODEL` → `DEEPSEEK_API_KEY/DEEPSEEK_MODEL`
- `server/index.js`: 환경변수 참조명 변경 (2곳)
- `server/orchestrator.js`: **완전 재작성** (Google SDK → OpenAI SDK)
  - `import OpenAI from 'openai'`, `DEFAULT_MODEL = 'deepseek-v4-0424'`
  - Tool 선언 형식: `functionDeclarations[]` → `tools[].function` (`type:'function'`)
  - 메시지 이력: `contents[]{parts[]}` → `messages[]{role, content}` (OpenAI 형식)
  - 툴 응답: Google `functionResponse` in user parts → `{role:'tool', tool_call_id, content}`
  - 수정 라운드: `repairModel`(별도 인스턴스) 제거 → `tools` 파라미터 생략으로 대체
  - `pairAwareTrim`: OpenAI 형식에서 trim 시작점이 반드시 `user` role이어야 함 (orphaned tool 방지)
  - 세션 저장: `session.contents = pairAwareTrim(messages.filter(m => m.role !== 'system'))`
  - `repairJson()`, `truncateAndClose()`, `parseResponse()`, `validateAndFix` — 변경 없음

### B. 쿼리 모니터링 로거 (server/queryLogger.js 신규)

- **`server/queryLogger.js`** — 요청별 JSONL 로거
  - `createQueryLogger(sessionId, userMessage)` → `{onProgress, finish}` 반환
  - `onProgress(event, data)`: tool_call/tool_result/classify 이벤트 경량 요약 수집
  - `finish(result, err)`: `server/logs/YYYY-MM-DD.jsonl` 에 1줄 기록 (날짜 자동 로테이션)
  - 기록 항목: ts, sessionId, query, act, events[], scenario{title,moleculeCount,stepCount}, chatMessage(300자), durationMs, error
- **`server/logs/.gitkeep`** — logs 디렉터리 git 추적용 빈 파일
- `server/index.js`: `createQueryLogger` import + `/api/query` 핸들러에 통합

### C. UI 레벨 테스트 시퀀스 패널 (신규)

- **`frontend/src/test/testCases.js`**
  - 12개 테스트 케이스 (소분자 3, 중분자 3, 대분자 2, 비교 모드 2, 화학반응 2)
  - 9개 오류 유형 (no_hydrogen, edge_mismatch, node_too_large, compare_one_mol, no_animation, wrong_structure, camera_bad, overlap, other)
  - `GROUPS` 배열로 렌더링 순서 고정
- **`frontend/src/test/TestPanel.js`**
  - `new TestPanel(handleSend)` — 생성자에서 DOM 이벤트 바인딩
  - 셋업 모달: 테스트 케이스 그룹/개별 선택, 전체 선택/해제
  - 실행 루프: `await runQuery(query)` → 평가 바 → 다음 케이스
  - 평가 바: "정상 / 오류 있음" + 오류 유형 체크박스 + 기타 텍스트
  - 요약 모달: 통과율 통계, 오류 유형 집계, 개별 결과 목록, JSON 내보내기
- `frontend/src/App.js`: `import { TestPanel }`, `new TestPanel(handleSend)` in `boot()`
- `frontend/index.html`: TestPanel HTML/CSS 전체 추가
  - 사이드바 "🧪 테스트 시퀀스" 버튼 (`#btn-test-panel`)
  - 뷰어 상단 프로그레스바 (`#tp-progress-bar`, `#tp-pb-fill`)
  - 뷰어 하단 평가 바 (`#tp-rating-bar`)
  - 셋업 모달 (`#tp-setup-modal`), 요약 모달 (`#tp-summary-modal`)

### 이전 (2026-05-25) 코드 리뷰 반영 내역 — 변경 없음 (여전히 적용됨)

- `server/orchestrator.js`: `repairJson` 단일패스, `truncateAndClose` fallback, `QuickLRU` 세션
- `server/pubchem.js`: `QuickLRU` 캐시 + `PQueue` 동시성 제한
- `server/validator.js`: transitive overlap 보정, atomId 누락 검증
- `frontend/src/scene/`: `_disposeObject`, `dynBonds` 전체 등록, `#fitCamera` FOV 보정
- `tests/`: unit 48 + integration 5 = 53 PASS

---

## 프로젝트 개요

자연어(한국어/영어)로 질문하면 3D 분자 모델과 반응 애니메이션을 브라우저에서 보여주는 **화학 교육 플랫폼**.

- **프로젝트명**: ChemCanvas AI
- **타겟**: 유기화학 학습 중인 고등학생/대학생
- **핵심 원칙**: PubChem 실측 데이터 → LLM 시나리오 생성 → Three.js 렌더링. LLM은 좌표를 절대 임의로 생성하지 않음.

---

## 현재 구현 단계

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 1 | 정적 데모 모듈화 + Three.js 씬 엔진 | ✅ 완료 |
| Phase 2 | AI 오케스트레이터 + Gemini API + mock PubChem | ✅ 완료 |
| Phase 3 | 실제 PubChem REST API 연동 (SDF 파싱) | ✅ 완료 |
| Phase 3+ | UI 개선: CoT 스트리밍 / 서버 로그 / 동적 legend | ✅ 완료 |
| Phase 4 | 세션 영속성 + DB + 멀티탭 UX | ⏳ 미구현 |

---

## 파일 구조 (실제 현재 상태)

```
better_pubchem/
├── .claude/
│   ├── CLAUDE.md             # 프로젝트 요약 + AI 지시사항 (cursorrules.md와 동일)
│   ├── MEMORY.md             # 현재 상태 상세 기록 (이 파일)
│   └── settings.local.json
├── cursorrules.md            # CLAUDE.md와 동일 내용 유지
├── run.ps1                   # 로컬 개발 실행 (포트 Kill → 백엔드 대기 → Chrome 오픈)
├── deploy.ps1                # Oracle 클라우드 배포 스크립트
├── prototype/                # 참조용 원본 (수정하지 않음)
│   ├── pitch_demo.html
│   ├── chemcanvas_demo_v2.html
│   ├── chemcanvas_ai_plan.md
│   └── KakaoTalk_*.jpg
├── frontend/
│   ├── index.html            # 전체 CSS + 레이아웃 HTML
│   │                         #   - CoT 패널 (.cot-message, .cot-step, .cot-spinner)
│   │                         #   - 서버 로그 패널 (#log-panel, .log-entry)
│   │                         #   - legend: <div id="atom-legend"> (빈 div, 동적 생성)
│   ├── package.json          # three ^0.160.0, gsap ^3.12.2, vite ^5.0.0
│   ├── vite.config.js        # /api → localhost:3001 프록시
│   └── src/
│       ├── App.js            # 부팅, 세션, handleSend, updateLegend, connectLogStream
│       │                     #   - updateLegend(scenario): 씬의 원소만 legend 렌더링
│       │                     #   - connectLogStream(): EventSource('/api/logs')
│       │                     #   - handleSend: sendQueryStream + CoT 컨트롤러 사용
│       │                     #   - new TestPanel(handleSend): UI 테스트 시퀀스 패널
│       ├── api/client.js     # sendQueryStream(msg, sid, ctx, onEvent): SSE 파서
│       │                     # initScene(): GET /api/init
│       ├── chat/ChatPanel.js # showCoT() → {addStep, setStep, setTitle, done}
│       │                     # removeCoT(): 에러 시 CoT 패널 강제 제거
│       ├── test/
│       │   ├── testCases.js  # 12개 테스트 케이스 정의 + 9개 오류 유형 + GROUPS
│       │   └── TestPanel.js  # UI 테스트 시퀀스 실행기 (셋업→실행→평가→요약)
│       └── scene/
│           ├── SceneManager.js  # Three.js 씬 구성 + GSAP 애니메이션
│           ├── AtomFactory.js   # 원소별 메시 (CPK 색상, ATOM_RADII, ATOM_COLORS)
│           └── BondFactory.js   # 결합 메시 (단일/이중/삼중, updateBondMeshes)
├── server/
│   ├── index.js              # Express (port 3001)
│   │                         #   - console.log/warn/error 오버라이드 → SSE 브로드캐스트
│   │                         #   - GET /api/logs: SSE 로그 스트림
│   │                         #   - POST /api/query: SSE 스트리밍 응답 + queryLogger
│   ├── orchestrator.js       # DeepSeek V4 API + tool_use 루프 (OpenAI SDK, max 5 rounds)
│   │                         #   - query(msg, sid, ctx, onProgress): onProgress 콜백
│   │                         #   - onProgress events: tool_call / tool_result / generating
│   │                         #   - pairAwareTrim: OpenAI format, trim start = user role
│   ├── queryLogger.js        # JSONL 모니터링 로거 (server/logs/YYYY-MM-DD.jsonl)
│   │                         #   - createQueryLogger(sid, msg) → {onProgress, finish}
│   ├── logs/.gitkeep         # logs 디렉터리 git 추적용
│   ├── pubchem.js            # PubChem REST API 실제 연동
│   │                         #   - nameToCid(name): 이름 → CID
│   │                         #   - fetchSdf(cid): 3D SDF (404이면 2D fallback)
│   │                         #   - parseSdf(): V2000 파싱 → atoms[], bonds[]
│   │                         #   - inferHybridization(): 결합차수로 sp/sp2/sp3 추론
│   │                         #   - CID 캐시 + 분자 캐시 (Map)
│   ├── mocks/pubchem.js      # 하드코딩 분자 5개 + getInitialScenario() (유지)
│   │                         #   carbocation, HBr, cyclohexane, butadiene, ethylene
│   ├── package.json          # openai ^4.82.0, express, cors, dotenv, quick-lru, p-queue
│   ├── .env                  # DEEPSEEK_API_KEY, DEEPSEEK_MODEL, PORT, PUBCHEM_API_KEY
│   ├── .env.example          # 동일 키 + 주석
│   └── prompts/system.txt    # LLM 시스템 프롬프트 (AnimationScenario 스키마 명시)
```

---

## 핵심 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | Vanilla JS (ES modules), Three.js 0.160, GSAP 3.12, Vite 5 |
| Backend | Node.js (ES modules), Express 4, PM2 |
| AI | DeepSeek V4 (`deepseek-v4-0424`, OpenAI-compatible API) |
| 분자 데이터 | PubChem REST API (SDF V2000 파싱, 3D→2D fallback) |
| 배포 | Oracle Cloud AMD VM, Ubuntu 22.04, nginx |

> ⚠️ **LLM**: 원래 설계는 Anthropic Claude → Google Gemini → 현재 **DeepSeek V4** (`openai` SDK, `baseURL: https://api.deepseek.com/v1`)

---

## 시스템 파이프라인 (현재)

```
사용자 입력 (한국어/영어)
    ↓
Frontend (App.js → ChatPanel.showCoT() 표시)
    ↓  POST /api/query  {userMessage, sessionId, currentMoleculeContext}
Express 서버 → SSE 스트리밍 시작
    ↓
orchestrator.js → Gemini 2.5 Flash API
    ├─ tool_call: onProgress('tool_call') → SSE progress 이벤트
    ↓  tool_use: get_molecule_3d(name)
server/pubchem.js → PubChem REST API
    ├─ name → CID → 3D SDF (404이면 2D)
    ├─ SDF V2000 파싱 → atoms[], bonds[]
    ├─ hybridization 추론
    └─ onProgress('tool_result') → SSE progress 이벤트
    ↓
Gemini → <scenario>AnimationScenario JSON</scenario>
    ↓  onProgress('generating') → SSE progress 이벤트
    ↓  SSE 'done' 이벤트 → { scenario, chatMessage }
Frontend
    ├─ CoT 패널 → "✓ 처리 완료 (에탄올)" 로 접힘
    ├─ updateLegend(scenario): 씬 원소만 표시
    ├─ SceneManager.loadScenario(scenario)
    └─ playStep() 순차 실행
```

---

## API 엔드포인트

| 메서드 | 경로 | 응답 | 설명 |
|--------|------|------|------|
| GET | `/api/health` | JSON `{ok:true}` | 서버 상태 확인 |
| GET | `/api/init` | JSON `{scenario, chatMessage}` | 초기 carbocation 시나리오 |
| POST | `/api/query` | **SSE** | 툴 호출 진행 상황 + 최종 결과 스트리밍 |
| GET | `/api/logs` | **SSE** | 서버 console 로그 실시간 브로드캐스트 |

### /api/query SSE 이벤트
```
event: progress  data: { event:"tool_call",   mol, text }
event: progress  data: { event:"tool_result", mol, atoms, bonds, text }
event: progress  data: { event:"generating",  text }
event: done      data: { scenario, chatMessage }
event: error     data: { message }
```

---

## 핵심 데이터 모델

### AnimationScenario
```json
{
  "title": "반응 제목",
  "reactionType": "electrophilic_addition | ring_flip | cycloaddition | substitution | elimination | none",
  "molecules": [{
    "pubchemCid": 702,
    "name": "ethanol",
    "atoms": [
      { "id":"C1", "element":"C", "label":"C1", "position":{"x":0.5,"y":0,"z":0},
        "formalCharge":0, "hybridization":"sp3", "visible":true }
    ],
    "bonds": [{ "atom1Id":"C1", "atom2Id":"O1", "order":1 }]
  }],
  "steps": [{
    "type": "approach | bond_form | bond_break | rotate_view | highlight | inversion | show_orbital | hide_orbital | label_show | reveal",
    "description": "한국어 설명",
    "duration": 1500,
    "targets": [{ "atomId":"C1", "property":"position", "to":{"x":1,"y":0,"z":0} }]
  }]
}
```

---

## 세션 관리

- **프론트엔드**: `sessionStorage` UUID → 탭별 독립 세션
- **백엔드**: `Map<sessionId, {contents: GeminiContent[]}>` 인메모리
  - 최대 30턴 유지 (오래된 항목 자동 trim)
  - 서버 재시작 시 세션 초기화 (Phase 4에서 DB 영속화 예정)

---

## 환경 변수 (server/.env)

```
DEEPSEEK_API_KEY=  # https://platform.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-0424
PORT=3001
PUBCHEM_API_KEY=   # 선택. 없으면 5req/s, 있으면 10req/s
                   # https://pubchem.ncbi.nlm.nih.gov/docs/programmatic-access
```

- UTF-8 BOM 없이 저장 필수 (run.ps1이 자동 처리)
- 서버 재시작 없이는 변경 반영 안 됨

---

## 배포 정보

| 항목 | 값 |
|------|-----|
| 서버 URL | `http://168.107.10.156` |
| 서버 사양 | Oracle Cloud AMD VM, Ubuntu 22.04 |
| 웹서버 | nginx (포트 80, `/api/*` → localhost:3001 프록시) |
| 앱 서버 | PM2 (`chemcanvas-server`, `/var/www/chemcanvas/index.js`) |
| 프론트엔드 | `/var/www/html/` (Vite 빌드 결과물) |
| SSH 키 | `C:\Users\acer\Desktop\capstone_gala\ssh-key-2026-05-20 (1).key` |
| 배포 명령 | `.\deploy.ps1` |
| env 파일 | `/var/www/chemcanvas/.env` (서버에서 직접 편집) |

---

## 알려진 이슈 / TODO

- [ ] Phase 4: SQLite/Postgres 세션 영속성
- [ ] Phase 4: 세션 목록 사이드바 UI
- [ ] `mocks/pubchem.js`의 cyclohexane에서 Sub 원자 좌표가 Ha_ax와 중복 (버그 가능)
- [ ] PubChem에서 가져온 대형 분자(수십 원자)의 H 원자를 숨기는 "중원자만 표시" 옵션 미구현
- [ ] `currentMoleculeContext`가 분자명 배열만 전달됨 — 실제 원자 데이터 전달로 개선 가능
- [ ] deploy.ps1에 server/pubchem.js 업로드 누락 가능성 확인 필요
- [ ] DeepSeek API 잔액 충전 필요 (platform.deepseek.com) — 현재 402 오류 발생 중
- [ ] server/logs/ 디렉터리를 .gitignore에 추가 (JSONL 로그 파일 git 추적 방지)
- [x] UI 레벨 테스트 시퀀스 패널 구현 (TestPanel.js, testCases.js)

---

## 최근 수정 이력

### 2026-05-22 — Phase 3 + UI 개선

**Phase 3: PubChem 실제 연동**
- `server/pubchem.js` 신규 생성
  - `nameToCid`: 이름 → PubChem CID
  - `fetchSdf`: 3D SDF 요청 (404이면 2D fallback)
  - `parseSdf`: SDF V2000 atom/bond 블록 파싱, 전하 코드 변환
  - `inferHybridization`: 결합차수 기반 sp/sp2/sp3 추론
  - CID 캐시 + 분자 캐시 (중복 API 호출 방지)
- `server/orchestrator.js`: `getMolecule3D` import를 `./pubchem.js`로 변경
- `server/.env` + `.env.example`: `PUBCHEM_API_KEY=` 추가

**UI 개선**
- `server/index.js`
  - `console.log/warn/error` 오버라이드 → SSE logClients 브로드캐스트
  - `GET /api/logs` SSE 엔드포인트 추가
  - `POST /api/query` → SSE 스트리밍으로 변경
- `server/orchestrator.js`
  - `query()` 함수에 `onProgress` 콜백 파라미터 추가
  - tool_call / tool_result / generating 이벤트 발행
- `frontend/src/api/client.js`
  - `sendQueryStream()` 추가 (SSE 파서, onEvent 콜백)
  - 기존 `sendQuery` 제거
- `frontend/src/chat/ChatPanel.js`
  - `showCoT()` 추가: 처리 단계 실시간 표시 컨트롤러 반환
  - `removeCoT()` 추가: 에러 시 CoT 패널 강제 제거
  - 기존 `showTyping/removeTyping` 제거
- `frontend/src/App.js`
  - `updateLegend(scenario)`: 씬에 등장한 원소만 동적 렌더링
  - `connectLogStream()`: EventSource로 서버 로그 수신 → 사이드바 표시
  - `handleSend`: SSE 스트리밍 + CoT 컨트롤러 연동
- `frontend/index.html`
  - 정적 legend 아이템 제거 → `<div id="atom-legend">` 빈 div
  - CoT CSS 추가 (.cot-message, .cot-step, .cot-spinner)
  - 서버 로그 패널 HTML/CSS 추가 (#log-panel, .log-entry.info/warn/error)

**run.ps1 개선**
- `Kill-Port` 함수: 실행 전 3001·5173 포트 강제 해제
- 백엔드 실제 LISTEN 대기 루프 (최대 10초)
- `.env` 최초 생성 시 UTF-8 BOM 없이 작성
- 브라우저 오픈: Chrome exe 직접 실행 (기본 브라우저 대신)
