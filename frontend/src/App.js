import { SceneManager }  from './scene/SceneManager.js';
import { ChatPanel }     from './chat/ChatPanel.js';
import { initScene, sendQueryStream } from './api/client.js';
import { colorHex, ELEMENT_NAMES } from './scene/AtomFactory.js';
import { buildInitialScenario } from '../../shared/initialMolecule.js';

// 꼬리 답변(step.description) 사이에 사람이 읽을 시간 보장 — 한국어 평균 ~11자/초.
// playStep이 step.duration만큼 기다린 뒤, 모자란 만큼 추가 대기.
// minimum 2.2s, maximum 5.5s로 클램프. duration이 이미 충분히 길면 추가 대기 없음.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function readingDelayMs(description) {
  if (!description) return 0;
  const chars = description.length;
  const target = Math.max(2200, Math.min(5500, chars * 90));
  return target;
}

// ── Session ID (persisted per browser tab) ───────────────
const SESSION_ID = (() => {
  let id = sessionStorage.getItem('chemcanvas_session');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('chemcanvas_session', id); }
  return id;
})();

// 한글 원소 명 + 영문 기호 라벨 ("수소 H")
function elementLabelKo(element) {
  const name = ELEMENT_NAMES[element];
  if (!name) return element;
  const displayEl = element === 'CH3' ? 'CH₃' : element === 'CH2' ? 'CH₂' : element;
  return `${name} ${displayEl}`;
}

// 씬에 있는 원소만 legend에 표시.
// molecules가 비어있으면 (MANIPULATE/EXPLAIN 등 현재 씬 유지 모드) 기존 legend를 그대로 두고 빠짐.
function updateLegend(scenario) {
  const legendEl = document.getElementById('atom-legend');
  if (!legendEl) return;

  const seen = new Set();
  for (const mol of (scenario.molecules || [])) {
    for (const atom of (mol.atoms || [])) {
      if (atom.visible !== false) seen.add(atom.element);
    }
  }
  if (seen.size === 0) return; // 새 분자 정보 없음 → legend 보존

  legendEl.innerHTML = [...seen].map(el => {
    const color  = colorHex(el);
    const border = el === 'H' ? 'border:1px solid #ced4da;' : '';
    return `<div class="legend-item">
      <span class="dot" style="background:${color};${border}"></span>
      ${elementLabelKo(el)}
    </div>`;
  }).join('');
}

// ── Server log SSE ────────────────────────────────────────
function connectLogStream() {
  const entriesEl  = document.getElementById('log-entries');
  const countEl    = document.getElementById('log-count');
  if (!entriesEl) return;

  const MAX_LOGS = 100;
  let count = 0;

  const es = new EventSource('/api/logs');
  es.addEventListener('log', e => {
    try {
      const { level, text } = JSON.parse(e.data);
      const div = document.createElement('div');
      div.className = `log-entry ${level}`;
      div.textContent = text;
      entriesEl.appendChild(div);

      count++;
      if (count > MAX_LOGS) {
        entriesEl.firstChild?.remove();
        count = MAX_LOGS;
      }
      countEl && (countEl.textContent = count);
      entriesEl.scrollTop = entriesEl.scrollHeight;
    } catch (err) {
      // 잘못된 SSE payload — 개발 디버깅 보조
      console.warn('[log SSE] JSON parse failed:', err.message, e.data);
    }
  });
}

let currentScenario = null;
const sceneManager  = new SceneManager();
const chatPanel     = new ChatPanel('chat-pane');

async function handleSend(userMessage) {
  chatPanel.addMessage(userMessage, 'user');
  const cot = chatPanel.showCoT();
  const molsInvolved = [];

  try {
    const context = currentScenario
      ? { molecules: currentScenario.molecules.map(m => m.name), reactionStep: 0 }
      : null;

    let finalResult  = null;
    // 같은 이름의 분자를 두 번 조회해도 step idx가 겹치지 않도록 배열 사용
    // tool_call 발생 순서대로 push, tool_result는 가장 오래된 pending과 매칭
    const molPendingSteps = new Map(); // mol name → 대기 중인 step idx 배열 (FIFO)

    // 진행 중인 step 인덱스 (LLM 호출 대기 단계 등 — done 이벤트나 다음 단계 시작 시 마무리)
    let analyzingIdx  = -1;
    let renderingIdx  = -1;

    await sendQueryStream(userMessage, SESSION_ID, context, (event, data) => {
      if (event === 'progress') {
        if (data.event === 'analyzing') {
          cot.setTitle(data.text);
          analyzingIdx = cot.addStep(data.text, 'active');
        } else if (data.event === 'classify') {
          // 1라운드 LLM 응답이 도착하면서 쿼리 분석 완료
          if (analyzingIdx >= 0) cot.setStep(analyzingIdx, 'done', `쿼리 분석 — ${data.text}`);
          analyzingIdx = -1;
          cot.setTitle(data.text);
        } else if (data.event === 'tool_call') {
          cot.setTitle('PubChem 조회 중...');
          const idx = cot.addStep(`${data.mol} 구조 조회 중...`, 'active');
          if (!molPendingSteps.has(data.mol)) molPendingSteps.set(data.mol, []);
          molPendingSteps.get(data.mol).push(idx);
          molsInvolved.push(data.mol);
        } else if (data.event === 'tool_result') {
          const queue = molPendingSteps.get(data.mol);
          const idx = queue?.shift() ?? -1;
          cot.setStep(idx, 'done', `${data.mol} — ${data.atoms}원자, ${data.bonds}결합`);
        } else if (data.event === 'generating') {
          // PubChem 결과 받고 LLM 2차 호출 시작 — 사용자가 가장 답답해하는 구간
          cot.setTitle(data.text);
          renderingIdx = cot.addStep(data.text, 'active');
        }
      } else if (event === 'done') {
        finalResult = data;
        // 응답 도착 시점에 active로 남아있던 마지막 step 마무리
        if (renderingIdx >= 0) cot.setStep(renderingIdx, 'done', '모델 렌더링 완료');
        if (analyzingIdx >= 0) cot.setStep(analyzingIdx, 'done', '쿼리 분석 완료');
      }
    });

    if (!finalResult) throw new Error('응답을 받지 못했습니다.');

    const { scenario, chatMessage } = finalResult;
    const summary = molsInvolved.length
      ? `처리 완료 (${molsInvolved.join(', ')})`
      : '응답 완료';
    cot.done(`✓ ${summary}`);
    chatPanel.addMessage(chatMessage, 'ai');

    if (scenario) {
      // LLM이 molecules: []로 응답하는 경우 = MANIPULATE/EXPLAIN의 "현재 씬 유지" 의도.
      // 이 때 loadScenario를 호출하면 #clearScene이 일어나 화면이 비고 legend도 사라짐.
      // → 이전 currentScenario의 분자를 그대로 두고, 새 steps만 현재 씬 위에서 재생한다.
      const hasNewMolecules = (scenario.molecules?.length ?? 0) > 0;
      if (hasNewMolecules) {
        currentScenario = scenario;
        sceneManager.loadScenario(scenario);
        updateLegend(scenario);
      } else if (currentScenario) {
        // steps만 새 시나리오의 것을 쓰고 분자는 이전 것을 참조시킨다.
        // (validator/SceneManager가 atomId를 lookup할 때 currentScenario.molecules의 id를 그대로 사용)
        scenario.molecules = currentScenario.molecules;
      }

      const steps = scenario.steps || [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const showDesc = step.description && i > 0;
        if (showDesc) {
          chatPanel.addMessage(step.description, 'ai');
        }
        await sceneManager.playStep(step);

        // 메시지를 띄운 step이면 사람이 읽을 시간 보장
        // (애니메이션 duration이 이미 길면 추가 대기 없음)
        if (showDesc) {
          const animMs = step.duration || 1000;
          const needMs = readingDelayMs(step.description);
          const extra  = Math.max(0, needMs - animMs);
          if (extra > 0) await sleep(extra);
        }
      }
    }
  } catch (err) {
    chatPanel.removeCoT();
    chatPanel.addMessage(`오류가 발생했습니다: ${err.message}`, 'ai');
    console.error(err);
  }
}

async function boot() {
  chatPanel.onSend = handleSend;

  try {
    sceneManager.init(
      document.getElementById('canvas-3d'),
      document.getElementById('viewer-pane'),
      document.getElementById('atom-tooltip'),
      document.getElementById('result-badge'),
    );
  } catch (err) {
    console.error('Scene init failed:', err);
    chatPanel.addMessage('3D 뷰어를 초기화하지 못했습니다. WebGL이 지원되는지 확인해 주세요.', 'ai');
    return;
  }

  try {
    const { scenario, chatMessage } = await initScene();
    currentScenario = scenario;
    sceneManager.loadScenario(scenario);
    updateLegend(scenario);
    chatPanel.addMessage(chatMessage, 'ai');
  } catch (err) {
    console.warn('서버 초기화 실패, 기본 데이터 사용:', err.message);
    currentScenario = buildInitialScenario();
    sceneManager.loadScenario(currentScenario);
    updateLegend(currentScenario);
    chatPanel.addMessage(
      '안녕하세요! ChemCanvas AI입니다.\n\n화면에 <b>(R)-3-chloro-1-butene C2 카보양이온</b>이 표시되어 있습니다.\n\n<small style="color:#868e96">⚠ 서버에 연결할 수 없어 AI 응답 기능이 제한됩니다.</small>',
      'ai',
    );
  }

  connectLogStream();

  document.getElementById('btn-new-session')?.addEventListener('click', () => {
    sessionStorage.removeItem('chemcanvas_session');
    location.reload();
  });
}

boot();
