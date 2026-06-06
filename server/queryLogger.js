/**
 * ChemCanvas AI — 쿼리 모니터링 로거
 *
 * 각 /api/query 요청을 JSONL 형식으로 server/logs/YYYY-MM-DD.jsonl 에 기록.
 * 한 줄 = 쿼리 1건. JSON.parse로 바로 읽을 수 있고 메모리를 거의 차지하지 않음.
 *
 * 기록 항목:
 *   ts          — ISO 타임스탬프
 *   sessionId   — 탭별 세션 ID
 *   query       — 사용자 입력 원문
 *   act         — 분류 결과 (INSPECT / REACT / COMPARE / MANIPULATE / EXPLAIN)
 *   events      — tool_call, tool_result, generating 등 진행 이벤트 요약
 *   scenario    — 생성된 시나리오 요약 (title, 분자 수, 스텝 수)
 *   chatMessage — AI 응답 첫 300자
 *   durationMs  — 전체 소요 시간
 *   error       — 에러 메시지 (정상이면 null)
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR  = join(__dirname, 'logs');

function todayFile() {
  const d = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOGS_DIR, `${d}.jsonl`);
}

function write(entry) {
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(todayFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    // 로그 실패가 서버 동작에 영향 주지 않도록 조용히 경고만
    console.warn('[QueryLogger] 파일 기록 실패:', e.message);
  }
}

/**
 * 쿼리 1건의 로그 수집기를 생성.
 * onProgress() 로 진행 이벤트를 수집하다가 finish() 호출 시 파일에 기록.
 */
export function createQueryLogger(sessionId, userMessage) {
  const startMs = Date.now();
  const events  = [];
  let act       = null;

  return {
    /** orchestrator onProgress 콜백과 동일한 시그니처 */
    onProgress(event, data) {
      if (event === 'classify') {
        act = data.act;
        events.push({ event, act: data.act, molecules: data.molecules ?? [] });
        return;
      }
      // 경량 요약만 저장 (전체 분자 데이터 제외)
      const e = { event };
      if (data.mol   !== undefined) e.mol   = data.mol;
      if (data.atoms !== undefined) e.atoms = data.atoms;
      if (data.bonds !== undefined) e.bonds = data.bonds;
      events.push(e);
    },

    /** 요청 완료 시 호출. result / err 둘 중 하나가 있음 */
    finish(result, err) {
      write({
        ts:         new Date().toISOString(),
        sessionId,
        query:      userMessage,
        act,
        events,
        scenario:   result?.scenario ? {
          title:         result.scenario.title   ?? null,
          moleculeCount: result.scenario.molecules?.length ?? 0,
          stepCount:     result.scenario.steps?.length    ?? 0,
        } : null,
        chatMessage: (result?.chatMessage ?? '').slice(0, 300),
        durationMs: Date.now() - startMs,
        error:      err?.message ?? null,
      });
    },
  };
}
