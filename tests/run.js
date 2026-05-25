/**
 * ChemCanvas AI — 테스트 실행기
 *
 * 사용법:
 *   node tests/run.js                    ← unit + integration 전체 실행
 *   node tests/run.js --unit             ← 단위 테스트만 (LLM 불필요)
 *   node tests/run.js --integration      ← 통합 테스트만 (서버 실행 필요)
 *   node tests/run.js --integration 01   ← 케이스 필터 (파일명 부분일치)
 *
 * 환경변수:
 *   TEST_RATE_LIMIT_MS  — 통합 케이스 사이 대기 (기본 15000ms)
 *   TEST_SERVER         — 통합 테스트 대상 서버 (기본 http://localhost:3001)
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { runValidators } from './validators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = process.env.TEST_SERVER || 'http://localhost:3001';
const CASES_DIR = join(__dirname, 'cases');
const UNIT_DIR  = join(__dirname, 'unit');
const RATE_LIMIT_MS = parseInt(process.env.TEST_RATE_LIMIT_MS || '15000');

// ── 인자 파싱 ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const wantUnit        = args.includes('--unit');
const wantIntegration = args.includes('--integration');
const runAll          = !wantUnit && !wantIntegration;
const filter          = args.find(a => !a.startsWith('--')) ?? '';

// ── 단위 테스트 (node --test 위임) ─────────────────────────────
async function runUnitTests() {
  if (!existsSync(UNIT_DIR)) {
    console.log('단위 테스트 디렉터리(tests/unit)가 없어 건너뜁니다.');
    return { passed: 0, failed: 0, skipped: true };
  }

  // Node --test는 디렉터리 인자를 일관되게 받지 못하므로 파일 목록을 직접 명시
  const testFiles = readdirSync(UNIT_DIR)
    .filter(f => f.endsWith('.test.js'))
    .map(f => join(UNIT_DIR, f));

  if (!testFiles.length) {
    console.log('tests/unit/ 에 *.test.js 파일이 없습니다.');
    return { passed: 0, failed: 0, skipped: true };
  }

  return new Promise((resolve) => {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│          단위 테스트 (node --test)                          │');
    console.log('└─────────────────────────────────────────────────────────────┘\n');

    const proc = spawn(
      process.execPath,
      ['--test', '--test-reporter=spec', ...testFiles],
      { stdio: 'inherit' },
    );
    proc.on('close', code => {
      resolve({ exitCode: code, passed: code === 0 ? 1 : 0, failed: code === 0 ? 0 : 1 });
    });
  });
}

// ── 통합 테스트 ────────────────────────────────────────────────
async function queryServer(userMessage, context = null) {
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${SERVER}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage, sessionId, currentMoleculeContext: context }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop();

    for (const chunk of chunks) {
      let eventType = null;
      let dataStr   = null;

      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        if (line.startsWith('data:'))  dataStr   = line.slice(5).trim();
      }

      if (eventType === 'done' && dataStr) {
        result = JSON.parse(dataStr);
      }
      if (eventType === 'error' && dataStr) {
        throw new Error(JSON.parse(dataStr).message ?? 'server error');
      }
    }
  }

  return result;
}

async function runCase(casePath) {
  const tc = JSON.parse(readFileSync(casePath, 'utf8'));

  console.log(`\n${'─'.repeat(65)}`);
  console.log(`▶  ${tc.name}`);
  console.log(`   입력: "${tc.input}"`);

  const start = Date.now();
  let result, serverError;

  try {
    // 케이스 JSON에 context가 있으면 currentMoleculeContext로 전달
    result = await queryServer(tc.input, tc.context ?? null);
  } catch (e) {
    serverError = e;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`   소요: ${elapsed}s`);

  if (serverError) {
    console.log(`   ✗ 서버 오류: ${serverError.message}`);
    return { name: tc.name, pass: false, elapsed };
  }

  let { passed, failed } = runValidators(result, tc.expected ?? {}, tc.checks ?? []);

  // LLM 비결정성 흡수 — 1차 실패 시 1회 retry
  // (rate limit 짧게 대기 후 동일 입력 재호출. 같은 결과면 진짜 코드 버그.)
  if (failed.length > 0) {
    console.log(`   ⟳ 1차 실패 (${failed.length}개) — 3초 후 1회 재시도 (LLM 비결정성)`);
    await new Promise(r => setTimeout(r, 3000));
    const retryStart = Date.now();
    try {
      const retryResult = await queryServer(tc.input, tc.context ?? null);
      const retryElapsed = ((Date.now() - retryStart) / 1000).toFixed(1);
      const retry = runValidators(retryResult, tc.expected ?? {}, tc.checks ?? []);
      if (retry.failed.length < failed.length) {
        console.log(`   ⟳ 재시도 소요: ${retryElapsed}s — ${retry.failed.length}개 실패 (개선)`);
        passed = retry.passed;
        failed = retry.failed;
        result = retryResult;
      } else {
        console.log(`   ⟳ 재시도 소요: ${retryElapsed}s — ${retry.failed.length}개 실패 (개선 없음, 1차 결과 유지)`);
      }
    } catch (e) {
      console.log(`   ⟳ 재시도 중 서버 오류: ${e.message}`);
    }
  }

  passed.forEach(msg => console.log(`   ✓ ${msg}`));
  failed.forEach(msg => console.log(`   ✗ ${msg}`));

  const pass = failed.length === 0;
  const summary = pass
    ? `   ★ PASS (${passed.length}개 항목 통과)`
    : `   ✗ FAIL — ${failed.length}개 항목 실패`;
  console.log(summary);

  return { name: tc.name, pass, elapsed, passedCount: passed.length, failedCount: failed.length };
}

async function runIntegrationTests(filter) {
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│          ChemCanvas AI  통합 테스트                         │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log(`서버: ${SERVER}`);
  if (filter) console.log(`필터: "${filter}"`);

  try {
    const h = await fetch(`${SERVER}/api/health`);
    if (!h.ok) throw new Error(`status ${h.status}`);
    console.log('서버 연결 ✓\n');
  } catch (e) {
    console.error(`\n✗ 서버에 연결할 수 없습니다 (${e.message})`);
    console.error('  → run.ps1 로 서버를 먼저 실행하세요.\n');
    return { passed: 0, failed: 1, skipped: false };
  }

  const files = readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.json') && (!filter || f.includes(filter)))
    .sort()
    .map(f => join(CASES_DIR, f));

  if (!files.length) {
    console.error(`tests/cases/ 에 매칭되는 케이스가 없습니다 (필터: "${filter}")`);
    return { passed: 0, failed: 1, skipped: false };
  }

  const results = [];
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && RATE_LIMIT_MS > 0) {
      process.stdout.write(`   (rate limit 대기 ${RATE_LIMIT_MS / 1000}s...)`);
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      process.stdout.write('\n');
    }
    results.push(await runCase(files[i]));
  }

  const total  = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed = total - passed;

  console.log(`\n${'═'.repeat(65)}`);
  console.log(`통합 결과: ${passed} / ${total} PASS${failed > 0 ? `  (${failed} FAIL)` : ''}`);
  results.forEach(r => {
    const icon   = r.pass ? '✓' : '✗';
    const timing = `(${r.elapsed}s)`;
    console.log(`  ${icon} ${r.name} ${timing}`);
  });
  console.log('');

  return { passed, failed };
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  let totalFailed = 0;

  if (runAll || wantUnit) {
    const unit = await runUnitTests();
    totalFailed += unit.failed;
  }

  if (runAll || wantIntegration) {
    const integ = await runIntegrationTests(filter);
    totalFailed += integ.failed;
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('예상치 못한 오류:', err);
  process.exit(1);
});
