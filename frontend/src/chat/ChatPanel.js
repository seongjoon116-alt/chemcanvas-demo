export class ChatPanel {
  #el;
  #messagesEl;
  #inputEl;
  #sendBtn;
  #suggestionsEl;
  #cotEl = null;

  onSend = null; // (message: string) => void

  constructor(paneId) {
    this.#el           = document.getElementById(paneId);
    this.#messagesEl   = this.#el.querySelector('#chat-messages');
    this.#inputEl      = this.#el.querySelector('#chat-input');
    this.#sendBtn      = this.#el.querySelector('#chat-send');
    this.#suggestionsEl = this.#el.querySelector('#suggest-btns');

    this.#sendBtn.addEventListener('click', () => this.#handleSend());
    this.#inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#handleSend(); }
    });
  }

  #handleSend() {
    const msg = this.#inputEl.value.trim();
    if (!msg) return;
    this.#inputEl.value = '';
    this.onSend?.(msg);
  }

  // 메시지를 채팅창에 추가한다.
  // - 빈 줄(\n\n)이 포함된 텍스트는 **단락 단위 여러 말풍선**으로 자동 분할 → 가독성 ↑
  // - 단일 줄바꿈(\n)은 <br>로 보존 → LLM이 의도한 라인 브레이크 유지
  // - 이미 <br>, <b>, <small> 등 일부 HTML 태그를 포함하는 경우(부팅 fallback 메시지 등)는 그대로 통과
  // 마지막으로 추가된 element를 반환 (back-compat: 호출자가 dom 참조를 받음).
  addMessage(content, sender = 'ai') {
    if (content == null) return null;
    const paragraphs = String(content)
      .split(/\n{2,}/)            // 빈 줄로 단락 분리
      .map(p => p.trim())
      .filter(Boolean);
    if (!paragraphs.length) return null;

    let last = null;
    for (const para of paragraphs) {
      const div = document.createElement('div');
      div.className = `message ${sender}`;
      // 단일 \n → <br>. 이미 들어있는 HTML 태그는 보존(현재 사용처: 부팅 메시지의 <b>/<small>)
      div.innerHTML = para.replace(/\n/g, '<br>');
      this.#messagesEl.appendChild(div);
      last = div;
    }
    this.#messagesEl.scrollTop = this.#messagesEl.scrollHeight;
    return last;
  }

  // CoT (Chain-of-Thought) 패널 표시 — 처리 단계를 실시간으로 보여줌
  showCoT() {
    const div = document.createElement('div');
    div.className = 'message ai cot-message';
    div.innerHTML = `
      <div class="cot-header">
        <div class="cot-spinner"></div>
        <span class="cot-title">분석 중...</span>
      </div>
      <div class="cot-steps"></div>
    `;
    this.#messagesEl.appendChild(div);
    this.#messagesEl.scrollTop = this.#messagesEl.scrollHeight;
    this.#cotEl = div;
    this.setInputEnabled(false);

    const stepsEl = div.querySelector('.cot-steps');
    const titleEl = div.querySelector('.cot-title');
    const spinnerEl = div.querySelector('.cot-spinner');
    const steps = [];

    const ctrl = {
      addStep: (text, status = 'active') => {
        const s = document.createElement('div');
        s.className = `cot-step ${status}`;
        s.textContent = text;
        stepsEl.appendChild(s);
        steps.push(s);
        this.#messagesEl.scrollTop = this.#messagesEl.scrollHeight;
        return steps.length - 1;
      },
      setStep: (idx, status, text) => {
        if (!steps[idx]) return;
        steps[idx].className = `cot-step ${status}`;
        if (text !== undefined) steps[idx].textContent = text;
      },
      setTitle: (text) => { titleEl.textContent = text; },
      done: (summaryText) => {
        div.innerHTML = `<div class="cot-collapsed">${summaryText}</div>`;
        this.#cotEl = null;
        this.setInputEnabled(true);
      },
    };
    return ctrl;
  }

  // 오류/취소 시 CoT 패널 제거
  removeCoT() {
    this.#cotEl?.remove();
    this.#cotEl = null;
    this.setInputEnabled(true);
  }

  setInputEnabled(enabled) {
    this.#inputEl.disabled = !enabled;
    this.#sendBtn.disabled = !enabled;
  }

  setSuggestions(suggestions) {
    // 시연 프롬프트 UI를 제거했어도 안전하게 호출 가능하도록 null-guard 추가
    if (!this.#suggestionsEl) return;
    this.#suggestionsEl.innerHTML = '';
    suggestions.forEach(({ label, message }) => {
      const btn = document.createElement('button');
      btn.className = 'suggest-btn';
      btn.innerHTML = `<span>→</span> ${label}`;
      btn.addEventListener('click', () => this.onSend?.(message));
      this.#suggestionsEl.appendChild(btn);
    });
  }

  clearMessages() {
    this.#messagesEl.innerHTML = '';
  }
}
