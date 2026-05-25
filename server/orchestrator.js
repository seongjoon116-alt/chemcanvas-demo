import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import QuickLRU from 'quick-lru';
import { getMolecule3D } from './pubchem.js';
import { validateAndFix } from './validator.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const SYSTEM_TEXT  = readFileSync(join(__dirname, 'prompts', 'system.txt'), 'utf8');
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-05-14';
const MAX_TOOL_ROUNDS = 5;
const SESSION_TURN_LIMIT = 30;
const SESSION_MAX_ENTRIES = 1000;
const SESSION_MAX_AGE_MS  = 1000 * 60 * 60; // 1시간 미사용 세션 자동 만료

// ── Dialogue Act별 CoT 분석 체크리스트 ──────────────────────
const ACT_INSTRUCTIONS = {

  INSPECT: `[INSPECT 모드] <scenario> 생성 전 아래 순서로 분석하세요.

1. 분자 확인
   · get_molecule_3d 결과에서 분자식·원자 수·결합 수 파악
   · 원소 종류 목록화 (C, H, O, N, 할로젠 등)

2. 구조 특징 파악
   · 고리 구조 여부 (벤젠고리, 지환 등)
   · 이중/삼중 결합 위치
   · 주요 작용기: OH, COOH, NH2, C=O, 할로젠 등

3. 하이라이트 대상 선정
   · 화학적으로 가장 특징적인 원자 2~4개 선택
   · 각 원자의 hybridization과 역할 확인

4. 스텝 설계
   · 소분자(<10원자): 2스텝 / 중분자(10~20): 3스텝 / 대분자(>20): 4스텝
   · rotate_view(최적 각도) → highlight(특징 원자) → label_show(작용기명)
   · 모든 atomId는 get_molecule_3d 결과의 실제 id만 사용`,

  REACT: `[REACT 모드] <scenario> 생성 전 아래 순서로 분석하세요.

1. 반응 분류
   · 유형 결정: 친전자성 첨가(EA) | 친핵성 치환(SN1/SN2) | 제거(E1/E2) | 산화환원 | 라디칼
   · 협동(concerted) vs 단계적(stepwise) 결정

2. 전자 흐름 분석
   · 친핵체(HOMO 제공자): 어느 분자의 어느 원자가 공격하는가?
   · 친전자체(LUMO 수용자): 어느 분자의 어느 원자/결합이 공격받는가?
   · 끊기는 결합의 원자쌍 / 새로 형성되는 결합의 원자쌍 각각 명시

3. 중간체 계획
   · 카보양이온/음이온/라디칼 등 중간체 존재 여부 판단
   · 존재하면: 초기 visible:false로 배치 → reveal 스텝에서 등장
   · 없으면: bond_break + bond_form 동시 처리 (concerted)

4. 입체화학 확인
   · 공격 방향 (정면 vs 배면 공격)
   · 생성물의 R/S 또는 cis/trans 변화 → label_show로 표시

5. 애니메이션 스텝 확정
   approach(800ms) → highlight 전이상태(600ms) → bond_break/form(600ms) → reveal(400ms) → label_show(500ms)
   · 각 atomId는 get_molecule_3d 결과의 실제 id만 사용
   · 반응에 관여하지 않는 원자에는 target 추가 금지

⚠ 위 1~5는 추론용 분석이며 JSON에 직접 쓰지 않습니다.
targets의 property는 반드시 아래 중 하나만 사용하세요:
position | visible | scale | camera | opacity | bond | orbital | label | highlight
hybridization, formalCharge, element 등은 property로 절대 사용 불가합니다.`,

  COMPARE: `[COMPARE 모드]
⚠ 분석 텍스트를 출력하지 말고 즉시 <scenario> JSON을 작성하세요.

배치 규칙:
· 분자[0]: PubChem 좌표 그대로 (중심 x≈0)
· 분자[1]: 분자[0] 최대 x + 4Å 이상 오프셋 (y, z는 원래 좌표 유지)

스텝은 3개 이하로 간결하게:
highlight(공통 구조) → highlight(차이 부위) → label_show(차이의 화학적 의미)`,

  MANIPULATE: `[MANIPULATE 모드] 현재 씬만 수정하세요.
· get_molecule_3d 절대 호출 금지 — 새 분자 추가 없음
· 허용 조작: rotate_view / highlight / position / show_orbital / hide_orbital / reveal
· 현재 씬에 이미 존재하는 atomId만 targets에 사용 — 없는 id 참조 즉시 오류
· 스텝은 1~2개로 최소화`,

  EXPLAIN: `[EXPLAIN 모드] 현재 씬을 유지하며 개념을 설명하세요.
· get_molecule_3d 절대 호출 금지
· highlight + label_show만 사용, 스텝 1~2개
· <scenario> 이후 한국어 설명에 집중: 개념의 원리와 현재 분자에서 나타나는 부분을 연결해 설명`,
};

// ── Tool 선언 ────────────────────────────────────────────────
const FUNCTION_DECLARATIONS = [
  {
    name: 'classify_query',
    description: `ALWAYS call this in your FIRST response, in parallel with any get_molecule_3d calls.
Classify the user intent and list molecules needed.`,
    parameters: {
      type: 'OBJECT',
      properties: {
        act: {
          type: 'STRING',
          enum: ['INSPECT', 'REACT', 'COMPARE', 'MANIPULATE', 'EXPLAIN'],
          description: `INSPECT — 분자 구조 시각화 (분자 1개+)
REACT — 화학 반응 메커니즘 (반응물 2개+)
COMPARE — 여러 분자 구조 비교 (분자 2개+)
MANIPULATE — 현재 씬 조작 (카메라/강조/이동, 새 분자 없음)
EXPLAIN — 현재 씬으로 개념 설명 (새 분자 없음)`,
        },
        molecules: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'PubChem에서 가져올 분자 영문명 목록. MANIPULATE/EXPLAIN은 빈 배열.',
        },
      },
      required: ['act', 'molecules'],
    },
  },
  {
    name: 'get_molecule_3d',
    description: 'PubChem에서 분자 3D 좌표를 가져옵니다. 여러 분자는 병렬 호출하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: {
          type: 'STRING',
          description: '분자 영문명 (예: "ethanol", "benzene", "aspirin")',
        },
      },
      required: ['name'],
    },
  },
];

// ── Sessions: LRU + TTL ──────────────────────────────────────
// 매 탭당 새 sessionId가 생성되므로 Map 무한 누적 방지를 위해 LRU 사용
const sessions = new QuickLRU({
  maxSize: SESSION_MAX_ENTRIES,
  maxAge:  SESSION_MAX_AGE_MS,
});

function getSession(sessionId) {
  let entry = sessions.get(sessionId);
  if (!entry) {
    entry = { contents: [] };
    sessions.set(sessionId, entry);
  }
  return entry;
}

// 세션 contents 슬라이싱: tool_use ↔ tool_response 짝이 깨지지 않도록 보장
// Gemini는 `model`의 functionCall 직후에 반드시 `user`의 functionResponse가 와야 함
function pairAwareTrim(contents, limit = SESSION_TURN_LIMIT) {
  if (contents.length <= limit) return contents;
  let start = contents.length - limit;
  // 시작점이 functionResponse만 들고 있는 user면 한 칸 뒤로 (앞 model이 잘려서 짝 깨짐)
  // 가장 가까운 'user' 메시지 중 functionResponse를 포함하지 않는 메시지로 정렬
  while (start < contents.length) {
    const c = contents[start];
    if (c.role !== 'user') { start++; continue; }
    const hasFnResp = (c.parts ?? []).some(p => p.functionResponse);
    if (!hasFnResp) break;
    start++;
  }
  return contents.slice(start);
}

// ── Tool 실행 ─────────────────────────────────────────────────
async function handleToolCall(name, args) {
  if (name === 'classify_query') {
    const instruction = ACT_INSTRUCTIONS[args.act] ?? '';
    return { act: args.act, instruction };
  }

  if (name === 'get_molecule_3d') {
    const mol = await getMolecule3D(args.name);
    if (!mol) {
      return { error: `"${args.name}"을(를) PubChem에서 찾을 수 없습니다. 영문 IUPAC 명칭으로 다시 시도하세요.` };
    }
    return mol;
  }

  return { error: `Unknown tool: ${name}` };
}

function buildSystemInstruction(currentMolecules) {
  if (!currentMolecules?.length) return SYSTEM_TEXT;
  const ctx = JSON.stringify(currentMolecules, null, 2);
  return `${SYSTEM_TEXT}\n\n## Current 3D Scene Molecules\nThese molecules are already loaded. Use their atomIds directly. Only call get_molecule_3d for NEW molecules not listed here.\n\`\`\`json\n${ctx}\n\`\`\``;
}

// ── JSON 수복 ────────────────────────────────────────────────
// LLM이 내놓는 흔한 깨진 JSON 패턴을 단일 패스 스캐너로 수복합니다.
// 모든 처리(주석 제거 / trailing comma 제거 / 따옴표 escape / 제어문자 escape)를
// 한 번에 처리해 정규식 사이드이펙트(문자열 내부 매칭) 위험을 제거.
//
// 처리 항목:
//   · 마크다운 코드 펜스 (\`\`\`json ... \`\`\`) 제거
//   · 문자열 외부: JS 단행/블록 주석 제거 (EOF 안전)
//   · 문자열 외부: trailing comma (e.g. {"a":1,} 또는 [1,2,]) 제거
//   · 문자열 내부: 잘못된 이스케이프 → 역슬래시 이중화
//   · 문자열 내부: \uXXXX hex 검증, 잘못된 경우 \\u로 이중화
//   · 문자열 내부: 리터럴 개행/CR/제어문자 → 공백 또는 \uXXXX
//   · 문자열 내부: 이스케이프 안 된 내부 따옴표 → \" 처리
export function repairJson(raw) {
  let s = raw;
  s = s.replace(/^```[a-z]*\s*\n?/m, '').replace(/\n?```\s*$/m, '');

  let out = '';
  let i = 0;
  const len = s.length;

  // 문자열 외부에서 직전에 쓴 non-whitespace 문자 (trailing comma 감지용)
  // 우리는 out 버퍼에 직접 쓰지 않고 comma만 우선 보관 → 다음 non-ws 문자에 따라 결정
  let pendingComma = false;

  const flushComma = (next) => {
    if (!pendingComma) return;
    // 다음 non-whitespace가 } 또는 ] 이면 trailing comma → 버림
    if (next === '}' || next === ']') {
      pendingComma = false;
      return;
    }
    out += ',';
    pendingComma = false;
  };

  const isHex = (ch) => (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');

  while (i < len) {
    const c = s[i];

    // 문자열 외부: 주석 제거
    if (c === '/' && s[i + 1] === '/') {
      while (i < len && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < len - 1 && !(s[i] === '*' && s[i + 1] === '/')) i++;
      // 짝 맞춤 시에만 건너뛰기. EOF 도달 시 종료.
      if (i < len - 1) i += 2;
      else i = len;
      continue;
    }

    // 문자열 외부: 콤마는 일단 보류
    if (c === ',') {
      // 이미 보류 중이면 (중복 콤마) 첫 번째만 유지
      pendingComma = true;
      i++;
      continue;
    }

    // 공백은 그대로 통과 (보류 콤마 상태 유지)
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      out += c;
      i++;
      continue;
    }

    // 문자열 시작
    if (c === '"') {
      flushComma('"');
      out += '"';
      i++;
      while (i < len) {
        const ch = s[i];

        // 역슬래시 처리
        if (ch === '\\') {
          const nx = s[i + 1] ?? '';
          if ('"\\/bfnrt'.includes(nx)) {
            out += ch + nx;
            i += 2;
          } else if (nx === 'u') {
            // \uXXXX 형식 검증
            const hex = s.slice(i + 2, i + 6);
            if (hex.length === 4 && [...hex].every(isHex)) {
              out += s.slice(i, i + 6);
              i += 6;
            } else {
              // 잘못된 \u — 역슬래시 이중화 후 1자만 진행
              out += '\\\\';
              i++;
            }
          } else {
            // 잘못된 이스케이프 → \\X로 이중화
            out += '\\\\';
            i++;
          }
          continue;
        }

        // 종료 따옴표 판별
        if (ch === '"') {
          let j = i + 1;
          while (j < len && (s[j] === ' ' || s[j] === '\t')) j++;
          const after = s[j] ?? '';
          if (':,}]\n\r'.includes(after) || j >= len) {
            out += '"';
            i++;
            break;
          }
          out += '\\"';
          i++;
          continue;
        }

        if (ch === '\n') { out += ' '; i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch < '\x20') {
          out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
          i++;
          continue;
        }

        out += ch;
        i++;
      }
      continue;
    }

    // 그 외 문자
    flushComma(c);
    out += c;
    i++;
  }

  // 끝까지 보류된 콤마는 폐기 (trailing comma)
  return out;
}

// JSON parse 실패의 마지막 fallback — JSON.parse 위치 에러를 기반으로 그 위치까지만 잘라
// unclosed brace/bracket을 자동으로 닫아 부분적으로라도 시나리오를 살린다.
// LLM이 매우 큰 JSON을 출력할 때 마지막 부분이 깨져도 앞부분(타이틀, 첫 분자/스텝)은 사용 가능.
export function truncateAndClose(raw) {
  // 1차: 그대로 시도
  try { return JSON.parse(raw); } catch (e) {
    // 에러 위치 추출: "at position N"
    // "Unexpected end of JSON input"처럼 position 정보가 없는 경우는 raw 끝까지 사용
    const posMatch = e.message.match(/position\s+(\d+)/);
    const errPos = posMatch ? parseInt(posMatch[1]) : raw.length;
    if (errPos < 10) return null; // 너무 앞이면 복구해도 의미 없음

    // 에러 위치 직전까지만 잘라서 unclosed brace/bracket 자동 닫기
    let truncated = raw.slice(0, errPos);
    // 마지막 콤마/세미콜론 제거
    truncated = truncated.replace(/[,;]\s*$/, '');

    // 문자열 내부면 종료 따옴표 추가 (간단 휴리스틱: 짝수개 따옴표인지)
    let inString = false;
    let escaped = false;
    for (let i = 0; i < truncated.length; i++) {
      const ch = truncated[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = !inString;
    }
    if (inString) truncated += '"';

    // 괄호/대괄호 stack을 계산해 자동 닫기
    const stack = [];
    inString = false;
    escaped = false;
    for (let i = 0; i < truncated.length; i++) {
      const ch = truncated[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
      else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
    }
    // 마지막 콤마 한 번 더 제거 (잘린 위치 직전에 trailing comma 가능성)
    truncated = truncated.replace(/,\s*$/, '');
    while (stack.length) {
      const open = stack.pop();
      truncated += open === '{' ? '}' : ']';
    }

    try { return JSON.parse(truncated); } catch { return null; }
  }
}

export function parseResponse(text) {
  const match = text.match(/<scenario>([\s\S]*?)<\/scenario>/);
  let scenario = null;
  if (match) {
    const raw = match[1].trim();
    try {
      scenario = JSON.parse(raw);
    } catch (e) {
      console.warn(`Scenario JSON parse error: ${e.message} — 자동 수복 시도`);
      try {
        scenario = JSON.parse(repairJson(raw));
        console.log('Scenario JSON 수복 성공 (repairJson)');
      } catch (e2) {
        // 마지막 fallback: 에러 위치까지 자른 후 자동 괄호 닫기
        const truncated = truncateAndClose(repairJson(raw));
        if (truncated) {
          scenario = truncated;
          console.log('Scenario JSON 수복 성공 (truncate+close fallback)');
        } else {
          console.error(`Scenario JSON 수복 실패: ${e2.message}`);
        }
      }
    }
  }
  const chatMessage = text
    .replace(/<scenario>[\s\S]*?<\/scenario>/g, '')
    .replace(/^한국어 설명:/m, '')
    .trim();
  return { scenario, chatMessage };
}

// ── 메인 쿼리 함수 ────────────────────────────────────────────
export async function query(userMessage, sessionId, currentMoleculeContext, onProgress = null) {
  const apiKey  = process.env.GEMINI_API_KEY;
  const modelId = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const systemInstruction = buildSystemInstruction(currentMoleculeContext?.molecules);

  const genAI = new GoogleGenerativeAI(apiKey);

  // 메인 모델: tools 활성
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction,
    tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
  });

  // 수정 라운드 전용 모델: tools 미지정 → tool_call 재발생 차단
  // (SDK가 generateContent({ tools: [] })를 어떻게 처리하든 무관하게 동작)
  const repairModel = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction,
  });

  const session  = getSession(sessionId);
  const contents = [...session.contents, { role: 'user', parts: [{ text: userMessage }] }];

  let finalText = null;
  let maxRoundsExceeded = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // LLM 호출 직전에 진행 상태 발행:
    //   round 0: classify_query/get_molecule_3d tool call이 곧 도착하므로 "쿼리 분석 중"
    //   round > 0: PubChem 결과를 받고 <scenario> 작성하는 단계 → "모델 렌더링 중"
    // 이전 구현은 응답이 돌아온 직후 발행되어 대기 시간 동안 PubChem 단계가 그대로 떠 있는 문제 있음.
    if (round === 0) {
      onProgress?.('analyzing', { text: '쿼리 분석 중...' });
    } else {
      onProgress?.('generating', { text: '모델 렌더링 중...' });
    }

    const result   = await model.generateContent({ contents });
    const response = result.response;
    const calls    = response.functionCalls?.() ?? [];

    if (!calls.length) {
      finalText = response.text();
      contents.push({ role: 'model', parts: [{ text: finalText }] });

      // <scenario> 누락 시 즉시 수정 라운드 (별도 repairModel 사용)
      if (!finalText.includes('<scenario>')) {
        console.warn('⚠ <scenario> 태그 누락 — 수정 라운드 진행');
        onProgress?.('generating', { text: '<scenario> 보완 중...' });
        contents.push({
          role: 'user',
          parts: [{ text: 'Your previous response was missing the <scenario> block. You MUST now output the AnimationScenario JSON immediately. Start your response with <scenario> — no text before it.\n\n<scenario>\n{ ...JSON here... }\n</scenario>\n\n한국어 설명: ...' }],
        });
        try {
          const fixResult = await repairModel.generateContent({ contents });
          const fixText = fixResult.response.text();
          contents.push({ role: 'model', parts: [{ text: fixText }] });
          if (fixText.includes('<scenario>')) {
            finalText = fixText;
            console.log('✓ 수정 라운드 성공: <scenario> 확인');
          } else {
            console.warn('✗ 수정 라운드에도 <scenario> 없음');
          }
        } catch (fixErr) {
          console.error('수정 라운드 오류:', fixErr.message);
        }
      }

      break;
    }

    const modelParts = response.candidates[0].content.parts;
    contents.push({ role: 'model', parts: modelParts });

    // 모든 툴 병렬 처리
    const resultParts = await Promise.all(calls.map(async call => {
      if (call.name === 'classify_query') {
        const actLabels = {
          INSPECT: '구조 탐색', REACT: '반응 시뮬레이션',
          COMPARE: '분자 비교', MANIPULATE: '씬 조작', EXPLAIN: '개념 설명',
        };
        onProgress?.('classify', {
          act: call.args.act,
          text: `${actLabels[call.args.act] ?? call.args.act} 모드`,
          molecules: call.args.molecules ?? [],
        });
      }

      if (call.name === 'get_molecule_3d') {
        onProgress?.('tool_call', { text: `${call.args.name} 구조 조회 중...`, mol: call.args.name });
      }

      const toolResult = await handleToolCall(call.name, call.args);

      if (call.name === 'get_molecule_3d' && toolResult && !toolResult.error) {
        onProgress?.('tool_result', {
          text: `${call.args.name} 수신 완료`,
          mol: call.args.name,
          atoms: toolResult.atoms?.length ?? 0,
          bonds: toolResult.bonds?.length ?? 0,
        });
      }

      return {
        functionResponse: {
          name: call.name,
          response: { result: toolResult },
        },
      };
    }));

    // COMPARE 모드에서 큰 분자(>12 원자)의 H 원자 제거 → 컨텍스트 크기 감소
    // 임계값 20 → 12로 낮춤. 큰 분자 2~3개 비교 시 토큰 폭발 방지.
    // shallow copy로 atoms/bonds 배열만 교체. atom 객체는 같은 참조 유지(현재 mutation 없음).
    const act = calls.find(c => c.name === 'classify_query')?.args?.act;
    if (act === 'COMPARE') {
      for (const part of resultParts) {
        const fr = part.functionResponse;
        if (fr?.name === 'get_molecule_3d') {
          const mol = fr.response?.result;
          if (mol && !mol.error && (mol.atoms?.length ?? 0) > 10) {
            const hIds = new Set(mol.atoms.filter(a => a.element === 'H').map(a => a.id));
            if (hIds.size > 0) {
              fr.response.result = {
                ...mol,
                atoms: mol.atoms.filter(a => !hIds.has(a.id)),
                bonds: mol.bonds.filter(b => !hIds.has(b.atom1Id) && !hIds.has(b.atom2Id)),
              };
              console.log(`[COMPARE] ${mol.name}: H ${hIds.size}개 제거 → ${fr.response.result.atoms.length}원자`);
            }
          }
        }
      }
    }

    contents.push({ role: 'user', parts: resultParts });

    if (round === MAX_TOOL_ROUNDS - 1) {
      maxRoundsExceeded = true;
    }
  }

  if (!finalText) {
    finalText = '죄송합니다, 응답을 생성하지 못했습니다.';
    if (maxRoundsExceeded) {
      console.warn(`⚠ MAX_TOOL_ROUNDS(${MAX_TOOL_ROUNDS}) 도달 — finalText 없음`);
      onProgress?.('generating', { text: '최대 round 초과 — 응답 생성 실패' });
    }
  }

  session.contents = pairAwareTrim(contents, SESSION_TURN_LIMIT);

  const { scenario: rawScenario, chatMessage } = parseResponse(finalText);
  const { scenario, issues } = validateAndFix(rawScenario);
  if (issues.length) {
    console.warn('[Validator]\n' + issues.join('\n'));
  }
  return { scenario, chatMessage: chatMessage || finalText };
}

// ── 테스트 헬퍼 (unit test에서 사용) ─────────────────────────
export const __test__ = {
  pairAwareTrim,
  sessions,
};
