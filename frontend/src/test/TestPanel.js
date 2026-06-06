/**
 * TestPanel — UI 레벨 테스트 시퀀스 실행기
 *
 * 흐름:
 *   1. 사이드바 "🧪 테스트 시퀀스" 버튼 → 셋업 모달 오픈
 *   2. 테스트 선택 후 "실행 시작"
 *   3. 각 테스트:
 *      a) 뷰어 상단 프로그레스바 업데이트
 *      b) runQuery(query) 호출 → 3D 애니메이션 완료 대기
 *      c) 뷰어 하단 평가 바 표시 → 사용자 평가
 *   4. 전체 완료 → 요약 모달 + JSON 내보내기
 */

import { TEST_CASES, ERROR_TYPES, GROUPS } from './testCases.js';

export class TestPanel {
  /**
   * @param {(query: string) => Promise<void>} runQuery
   *   쿼리를 서버에 보내고 3D 애니메이션까지 완료될 때 resolve되는 함수
   */
  constructor(runQuery) {
    this._runQuery = runQuery;
    this._selected = new Set(TEST_CASES.map(t => t.id)); // 기본 전체 선택
    this._results  = [];
    this._ratingResolve = null;

    this._setupModal   = document.getElementById('tp-setup-modal');
    this._summaryModal = document.getElementById('tp-summary-modal');
    this._progressBar  = document.getElementById('tp-progress-bar');
    this._ratingBar    = document.getElementById('tp-rating-bar');

    this._renderCaseList();
    this._renderErrorTypes();
    this._bindEvents();
  }

  // ── 초기 렌더링 ────────────────────────────────────────────

  _renderCaseList() {
    const container = document.getElementById('tp-case-list');
    if (!container) return;

    container.innerHTML = GROUPS.map(group => {
      const cases = TEST_CASES.filter(t => t.group === group);
      return `
        <div class="tp-group" data-group="${group}">
          <label class="tp-group-label">
            <input type="checkbox" class="tp-group-cb" data-group="${group}" checked>
            <strong>${group}</strong>
            <span class="tp-group-count">${cases.length}개</span>
          </label>
          <div class="tp-cases">
            ${cases.map(tc => `
              <label class="tp-case-label" data-id="${tc.id}">
                <input type="checkbox" class="tp-case-cb" data-id="${tc.id}" checked>
                <div class="tp-case-info">
                  <span class="tp-case-name">${tc.name}</span>
                  ${tc.atomCount ? `<span class="tp-case-atoms">${tc.atomCount}원자</span>` : ''}
                  <span class="tp-case-desc">${tc.desc}</span>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // 그룹 체크박스 → 하위 케이스 일괄 토글
    container.querySelectorAll('.tp-group-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const group = cb.dataset.group;
        container.querySelectorAll(`.tp-case-cb`).forEach(ccb => {
          const tc = TEST_CASES.find(t => t.id === ccb.dataset.id);
          if (tc?.group === group) {
            ccb.checked = cb.checked;
            cb.checked ? this._selected.add(ccb.dataset.id) : this._selected.delete(ccb.dataset.id);
          }
        });
        this._updateRunBtn();
      });
    });

    // 개별 케이스 체크박스
    container.querySelectorAll('.tp-case-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? this._selected.add(cb.dataset.id) : this._selected.delete(cb.dataset.id);
        this._syncGroupCb(cb.dataset.id);
        this._updateRunBtn();
      });
    });
  }

  _renderErrorTypes() {
    const list = document.getElementById('tp-error-list');
    if (!list) return;
    list.innerHTML = ERROR_TYPES.map(e => `
      <label class="tp-err-opt">
        <input type="checkbox" class="tp-err-cb" data-err="${e.id}">
        <span>${e.label}</span>
      </label>
    `).join('');

    // "기타" 체크 시 텍스트 입력 표시
    list.addEventListener('change', e => {
      if (e.target?.dataset?.err === 'other') {
        document.getElementById('tp-err-other').classList.toggle('hidden', !e.target.checked);
      }
    });
  }

  _bindEvents() {
    // 셋업 모달 열기/닫기
    document.getElementById('btn-test-panel')?.addEventListener('click', () => this._openSetup());
    document.getElementById('tp-setup-close')?.addEventListener('click',  () => this._closeSetup());
    document.getElementById('tp-setup-backdrop')?.addEventListener('click', () => this._closeSetup());

    // 전체 선택/해제
    document.getElementById('tp-select-all')?.addEventListener('click',   () => this._selectAll(true));
    document.getElementById('tp-deselect-all')?.addEventListener('click', () => this._selectAll(false));

    // 실행
    document.getElementById('tp-run-btn')?.addEventListener('click', () => this._run());

    // 평가 — 정상
    document.getElementById('tp-rate-ok')?.addEventListener('click', () => {
      this._ratingResolve?.({ pass: true, errors: [] });
    });

    // 평가 — 오류 있음 (오류 패널 오픈)
    document.getElementById('tp-rate-fail')?.addEventListener('click', () => {
      document.getElementById('tp-err-panel').classList.remove('hidden');
      document.getElementById('tp-rate-ok').disabled   = true;
      document.getElementById('tp-rate-fail').disabled = true;
    });

    // 오류 유형 확인 제출
    document.getElementById('tp-err-submit')?.addEventListener('click', () => {
      const errors = [...document.querySelectorAll('.tp-err-cb:checked')].map(cb => cb.dataset.err);
      const other  = document.getElementById('tp-err-other').value.trim();
      if (other) errors.push(`other:${other}`);
      this._ratingResolve?.({ pass: false, errors });
    });

    // 요약 모달 닫기
    document.getElementById('tp-summary-close')?.addEventListener('click',    () => this._closeSummary());
    document.getElementById('tp-summary-backdrop')?.addEventListener('click', () => this._closeSummary());

    // 요약 → 다시 실행
    document.getElementById('tp-rerun-btn')?.addEventListener('click', () => {
      this._closeSummary();
      this._openSetup();
    });

    // 결과 내보내기
    document.getElementById('tp-export-btn')?.addEventListener('click', () => this._export());
  }

  // ── 셋업 모달 ──────────────────────────────────────────────

  _openSetup() {
    this._setupModal.classList.remove('hidden');
    this._updateRunBtn();
  }

  _closeSetup() {
    this._setupModal.classList.add('hidden');
  }

  _updateRunBtn() {
    const btn = document.getElementById('tp-run-btn');
    if (!btn) return;
    const count = this._selected.size;
    btn.textContent = count ? `▶ ${count}개 테스트 실행` : '테스트를 선택하세요';
    btn.disabled = count === 0;
  }

  _selectAll(val) {
    document.querySelectorAll('.tp-case-cb').forEach(cb => {
      cb.checked = val;
      val ? this._selected.add(cb.dataset.id) : this._selected.delete(cb.dataset.id);
    });
    document.querySelectorAll('.tp-group-cb').forEach(cb => cb.checked = val);
    this._updateRunBtn();
  }

  _syncGroupCb(caseId) {
    const group = TEST_CASES.find(t => t.id === caseId)?.group;
    if (!group) return;
    const groupCases = TEST_CASES.filter(t => t.group === group);
    const allChecked  = groupCases.every(t => this._selected.has(t.id));
    const someChecked = groupCases.some(t => this._selected.has(t.id));
    const groupCb = document.querySelector(`.tp-group-cb[data-group="${group}"]`);
    if (groupCb) {
      groupCb.checked       = allChecked;
      groupCb.indeterminate = someChecked && !allChecked;
    }
  }

  // ── 테스트 실행 ────────────────────────────────────────────

  async _run() {
    const selected = TEST_CASES.filter(t => this._selected.has(t.id));
    if (!selected.length) return;

    this._closeSetup();
    this._results = [];

    const pbLabel = document.getElementById('tp-pb-label');
    const pbName  = document.getElementById('tp-pb-name');
    const pbFill  = document.getElementById('tp-pb-fill');
    this._progressBar.classList.remove('hidden');

    for (let i = 0; i < selected.length; i++) {
      const tc = selected[i];

      // 프로그레스바 업데이트
      pbLabel.textContent   = `${i + 1} / ${selected.length}`;
      pbName.textContent    = tc.name;
      pbFill.style.width    = `${Math.round(i / selected.length * 100)}%`;

      const startMs  = Date.now();
      let   runError = null;

      try {
        await this._runQuery(tc.query);
      } catch (e) {
        runError = e.message;
      }

      const durationMs = Date.now() - startMs;

      // 평가 바 표시 → 사용자 평가 대기
      const rating = await this._showRating(tc, i + 1, selected.length);
      this._hideRating();

      this._results.push({
        id: tc.id, name: tc.name, group: tc.group,
        query: tc.query, durationMs, runError, rating,
        ts: new Date().toISOString(),
      });
    }

    // 완료
    pbFill.style.width  = '100%';
    pbLabel.textContent = `완료`;
    pbName.textContent  = `${selected.length}개 테스트 완료`;

    setTimeout(() => {
      this._progressBar.classList.add('hidden');
      this._showSummary();
    }, 1000);
  }

  // ── 평가 바 ────────────────────────────────────────────────

  _showRating(tc, current, total) {
    return new Promise(resolve => {
      this._ratingResolve = resolve;

      document.getElementById('tp-rate-title').textContent    = tc.name;
      document.getElementById('tp-rate-progress').textContent = `${current} / ${total}`;

      // 상태 초기화
      document.getElementById('tp-err-panel').classList.add('hidden');
      document.getElementById('tp-err-other').value = '';
      document.getElementById('tp-err-other').classList.add('hidden');
      document.getElementById('tp-rate-ok').disabled   = false;
      document.getElementById('tp-rate-fail').disabled = false;
      document.querySelectorAll('.tp-err-cb').forEach(cb => cb.checked = false);

      this._ratingBar.classList.remove('hidden');
    });
  }

  _hideRating() {
    this._ratingBar.classList.add('hidden');
    this._ratingResolve = null;
  }

  // ── 요약 모달 ──────────────────────────────────────────────

  _showSummary() {
    const pass  = this._results.filter(r => r.rating?.pass).length;
    const fail  = this._results.length - pass;
    const total = this._results.length;
    const totalSec = (this._results.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(0);

    // 오류 집계
    const errCount = {};
    for (const r of this._results) {
      for (const e of r.rating?.errors ?? []) {
        errCount[e] = (errCount[e] || 0) + 1;
      }
    }
    const topErrors = Object.entries(errCount).sort(([,a],[,b]) => b-a);

    const el = document.getElementById('tp-summary-content');
    el.innerHTML = `
      <div class="tp-sum-stats">
        <div class="tp-stat tp-stat-pass">
          <span class="tp-stat-num">${pass}</span>
          <span class="tp-stat-lbl">통과</span>
        </div>
        <div class="tp-stat tp-stat-fail">
          <span class="tp-stat-num">${fail}</span>
          <span class="tp-stat-lbl">실패</span>
        </div>
        <div class="tp-stat tp-stat-time">
          <span class="tp-stat-num">${totalSec}s</span>
          <span class="tp-stat-lbl">총 소요</span>
        </div>
        <div class="tp-stat">
          <span class="tp-stat-num">${Math.round(pass / total * 100)}%</span>
          <span class="tp-stat-lbl">통과율</span>
        </div>
      </div>

      ${topErrors.length ? `
        <div class="tp-sum-section">
          <div class="tp-sum-section-title">오류 유형 집계</div>
          ${topErrors.map(([id, cnt]) => {
            const label = id.startsWith('other:')
              ? `기타: ${id.slice(6)}`
              : (ERROR_TYPES.find(e => e.id === id)?.label ?? id);
            return `<div class="tp-err-tally">
              <span class="tp-err-tally-label">${label}</span>
              <span class="tp-err-tally-cnt">${cnt}건</span>
            </div>`;
          }).join('')}
        </div>
      ` : ''}

      <div class="tp-sum-section">
        <div class="tp-sum-section-title">개별 결과</div>
        ${this._results.map(r => {
          const errLabels = (r.rating?.errors ?? []).map(e =>
            e.startsWith('other:') ? e.slice(6)
            : (ERROR_TYPES.find(t => t.id === e)?.label ?? e)
          ).join(' · ');
          return `
            <div class="tp-result-row ${r.rating?.pass ? 'pass' : 'fail'}">
              <span class="tp-result-icon">${r.rating?.pass ? '✅' : '❌'}</span>
              <div class="tp-result-body">
                <div class="tp-result-top">
                  <span class="tp-result-name">${r.name}</span>
                  <span class="tp-result-time">${(r.durationMs/1000).toFixed(1)}s</span>
                </div>
                ${r.runError ? `<div class="tp-result-meta tp-result-err">서버 오류: ${r.runError}</div>` : ''}
                ${errLabels ? `<div class="tp-result-meta">${errLabels}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this._summaryModal.classList.remove('hidden');
  }

  _closeSummary() {
    this._summaryModal.classList.add('hidden');
  }

  // ── 결과 내보내기 ──────────────────────────────────────────

  _export() {
    const pass = this._results.filter(r => r.rating?.pass).length;
    const data = {
      exportedAt: new Date().toISOString(),
      summary: { total: this._results.length, pass, fail: this._results.length - pass },
      results: this._results,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `chemcanvas-test-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }
}
