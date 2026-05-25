const BASE = '/api';

export async function initScene() {
  const res = await fetch(`${BASE}/init`);
  if (!res.ok) throw new Error(`init failed: ${res.status}`);
  return res.json();
}

// SSE 스트리밍 쿼리 — onEvent(eventType, data) 콜백으로 진행 상황 전달
// eventType: 'progress' | 'done' | 'error'
export async function sendQueryStream(userMessage, sessionId, currentMoleculeContext, onEvent) {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage, sessionId, currentMoleculeContext }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `query failed: ${res.status}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE 이벤트는 \n\n 으로 구분
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let eventType = 'message';
      let eventData = '';
      for (const line of block.split('\n')) {
        const t = line.trimEnd();
        if (t.startsWith('event: '))     eventType = t.slice(7);
        else if (t.startsWith('data: ')) eventData = t.slice(6);
      }
      if (eventData) {
        try {
          const data = JSON.parse(eventData);
          if (eventType === 'error') streamError = new Error(data.message);
          else onEvent(eventType, data);
        } catch (err) {
          // SSE payload가 깨졌거나 의도치 않은 텍스트가 섞인 경우 — 디버깅용 로그
          console.warn('[SSE] JSON.parse failed:', err.message, 'event:', eventType, 'data:', eventData);
        }
      }
    }
  }

  if (streamError) throw streamError;
}
