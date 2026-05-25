/**
 * repairJson() 단위 테스트
 *
 * orchestrator.js의 repairJson은 LLM이 내놓는 깨진 JSON을 복구하는 핵심 함수.
 * LLM 호출 없이 결정적으로 동작하므로 단위 테스트로 회귀를 막을 수 있습니다.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { repairJson, truncateAndClose, parseResponse } from '../../server/orchestrator.js';

// repairJson 결과는 곧바로 JSON.parse가 통과해야 함 — 헬퍼
function repairAndParse(raw) {
  const fixed = repairJson(raw);
  return JSON.parse(fixed);
}

describe('repairJson — 기본 동작', () => {
  test('완전한 정상 JSON은 그대로 통과', () => {
    const raw = '{"a":1,"b":"hello"}';
    assert.deepEqual(repairAndParse(raw), { a: 1, b: 'hello' });
  });

  test('마크다운 코드 펜스 제거 (```json ... ```)', () => {
    const raw = '```json\n{"x": 42}\n```';
    assert.deepEqual(repairAndParse(raw), { x: 42 });
  });

  test('마크다운 펜스 (언어 표시 없음)', () => {
    const raw = '```\n{"y": [1,2,3]}\n```';
    assert.deepEqual(repairAndParse(raw), { y: [1, 2, 3] });
  });
});

describe('repairJson — trailing comma 제거', () => {
  test('객체의 trailing comma', () => {
    const raw = '{"a":1,"b":2,}';
    assert.deepEqual(repairAndParse(raw), { a: 1, b: 2 });
  });

  test('배열의 trailing comma', () => {
    const raw = '[1,2,3,]';
    assert.deepEqual(repairAndParse(raw), [1, 2, 3]);
  });

  test('중첩 객체에서 모든 trailing comma 제거', () => {
    const raw = '{"a":[1,2,],"b":{"c":3,}}';
    assert.deepEqual(repairAndParse(raw), { a: [1, 2], b: { c: 3 } });
  });

  test('CRITICAL: 문자열 내부의 콤마 + 닫는 괄호는 보존', () => {
    // 기존 정규식 버전이 잘못 처리하던 케이스
    const raw = '{"description":"분자, ]","x":1}';
    assert.deepEqual(repairAndParse(raw), { description: '분자, ]', x: 1 });
  });

  test('문자열 내부 콤마 + 공백 + 닫는 괄호도 보존', () => {
    const raw = '{"desc":"a, b, c]","y":2}';
    assert.deepEqual(repairAndParse(raw), { desc: 'a, b, c]', y: 2 });
  });
});

describe('repairJson — JS 주석 제거', () => {
  test('단행 주석 (//)', () => {
    const raw = `{
      "a": 1, // 이것은 주석
      "b": 2
    }`;
    assert.deepEqual(repairAndParse(raw), { a: 1, b: 2 });
  });

  test('블록 주석 (/* */)', () => {
    const raw = `{
      "a": 1, /* 주석 */
      "b": 2
    }`;
    assert.deepEqual(repairAndParse(raw), { a: 1, b: 2 });
  });

  test('CRITICAL: 블록 주석 EOF 안전성 (짝 안 맞아도 undefined 누적 없음)', () => {
    // 기존 코드의 'i+=2; 무조건 진행' 버그 케이스
    const raw = `{"a":1}/* 짝 안 맞는 주석`;
    // EOF 도달 시 안전하게 종료, "undefined" 문자열이 출력에 섞이지 않아야 함
    const fixed = repairJson(raw);
    assert.equal(fixed.includes('undefined'), false, 'undefined 문자열이 출력에 포함되면 안 됨');
    assert.deepEqual(JSON.parse(fixed), { a: 1 });
  });

  test('단행 주석이 마지막 줄(EOF 직전)에 있어도 안전', () => {
    const raw = `{"a":1} // 마지막 주석`;
    assert.deepEqual(repairAndParse(raw), { a: 1 });
  });
});

describe('repairJson — 문자열 escape 처리', () => {
  test('유효한 \\uXXXX는 보존', () => {
    const raw = '{"k":"한글 \\uAC00 char"}';
    const parsed = repairAndParse(raw);
    assert.equal(parsed.k, '한글 가 char');
  });

  test('CRITICAL: 유효하지 않은 \\uXXXX (hex 아닌 문자) → 안전 처리', () => {
    // 기존 코드는 그대로 출력 → JSON.parse 실패
    const raw = '{"k":"oops \\uZZZZ"}';
    // repair 후 parse 가능해야 함 (정확한 값은 구현 선택. 핵심: 파싱 통과)
    const fixed = repairJson(raw);
    assert.doesNotThrow(() => JSON.parse(fixed), 'invalid \\u escape 후에도 JSON parse 가능해야 함');
  });

  test('유효한 \\n, \\t, \\\\, \\" 보존', () => {
    const raw = '{"k":"line1\\nline2\\ttabbed \\"quoted\\""}';
    const parsed = repairAndParse(raw);
    assert.equal(parsed.k, 'line1\nline2\ttabbed "quoted"');
  });

  test('잘못된 escape (\\s 등) → 역슬래시 이중화로 복구', () => {
    const raw = '{"k":"path \\some"}';
    const fixed = repairJson(raw);
    assert.doesNotThrow(() => JSON.parse(fixed));
  });

  test('문자열 내부의 리터럴 개행 → 공백으로 치환', () => {
    const raw = '{"k":"line1\nline2"}';
    const parsed = repairAndParse(raw);
    assert.equal(typeof parsed.k, 'string');
    // 개행이 공백으로 치환되거나 그대로 보존 → 어쨌든 parse는 통과해야 함
    assert.ok(parsed.k.length > 0);
  });
});

describe('repairJson — 이스케이프 안 된 내부 따옴표', () => {
  test('내부 따옴표 + 뒤에 글자 → 자동 escape', () => {
    const raw = '{"k":"He said "hello" loudly"}';
    const fixed = repairJson(raw);
    assert.doesNotThrow(() => JSON.parse(fixed));
    const parsed = JSON.parse(fixed);
    assert.ok(parsed.k.includes('hello'), 'hello 텍스트가 보존되어야 함');
  });

  test('정상 종료 따옴표 뒤에 JSON 구분자가 오면 그대로 처리', () => {
    const raw = '{"a":"x","b":"y"}';
    assert.deepEqual(repairAndParse(raw), { a: 'x', b: 'y' });
  });
});

describe('repairJson — 실제 LLM 출력 시뮬레이션', () => {
  test('AnimationScenario 형태 + trailing comma + 주석', () => {
    const raw = `{
      "title": "Markovnikov 첨가",
      "molecules": [
        { "name": "ethylene", "atoms": [], }, // 빈 분자
      ],
      "steps": [],
    }`;
    const parsed = repairAndParse(raw);
    assert.equal(parsed.title, 'Markovnikov 첨가');
    assert.equal(parsed.molecules.length, 1);
    assert.equal(parsed.steps.length, 0);
  });

  test('마크다운 펜스 + trailing comma 동시 발생', () => {
    const raw = '```json\n{"a":[1,2,3,],"b":2,}\n```';
    assert.deepEqual(repairAndParse(raw), { a: [1, 2, 3], b: 2 });
  });
});

describe('truncateAndClose — 부분 JSON 복구 fallback', () => {
  test('정상 JSON은 그대로 통과', () => {
    const r = truncateAndClose('{"a":1,"b":2}');
    assert.deepEqual(r, { a: 1, b: 2 });
  });

  test('object의 중간이 잘린 경우 자동 닫기', () => {
    // "value" 다음에 갑자기 잘린 패턴
    const raw = '{"title":"test","molecules":[{"name":"foo","atoms":[{"id":"A","x":1}';
    const r = truncateAndClose(raw);
    assert.ok(r, '복구 결과는 null이 아니어야 함');
    assert.equal(r.title, 'test');
  });

  test('array 중간이 잘린 경우 자동 닫기', () => {
    const raw = '{"steps":[{"id":0},{"id":1';
    const r = truncateAndClose(raw);
    assert.ok(r);
    assert.equal(Array.isArray(r.steps), true);
    assert.ok(r.steps.length >= 1);
  });

  test('잘림 위치 직전 trailing comma 처리', () => {
    const raw = '{"a":1,"b":[1,2,3,';
    const r = truncateAndClose(raw);
    assert.ok(r);
    assert.equal(r.a, 1);
  });

  test('문자열 한가운데서 잘려도 복구', () => {
    const raw = '{"a":"hello world this is';
    const r = truncateAndClose(raw);
    assert.ok(r);
    assert.equal(typeof r.a, 'string');
  });

  test('회복 불가능한 경우 null', () => {
    assert.equal(truncateAndClose(''), null);
    assert.equal(truncateAndClose('{'), null); // 너무 짧음
  });
});

describe('parseResponse — <scenario> 추출 + 자동 수복', () => {
  test('정상 <scenario>...</scenario> 추출', () => {
    const text = `한국어 설명: 안녕\n<scenario>{"title":"t","molecules":[],"steps":[]}</scenario>`;
    const { scenario, chatMessage } = parseResponse(text);
    assert.equal(scenario.title, 't');
    assert.ok(chatMessage.includes('안녕'));
  });

  test('<scenario> 누락 시 scenario null, chatMessage는 전체 텍스트', () => {
    const text = '안녕하세요 시나리오 없음';
    const { scenario, chatMessage } = parseResponse(text);
    assert.equal(scenario, null);
    assert.equal(chatMessage, '안녕하세요 시나리오 없음');
  });

  test('깨진 JSON도 repairJson으로 수복', () => {
    const text = '<scenario>{"a":1, "b":2,}</scenario>';
    const { scenario } = parseResponse(text);
    assert.deepEqual(scenario, { a: 1, b: 2 });
  });

  test('수복도 안되는 큰 잘린 JSON은 truncate fallback으로 살림', () => {
    const text = '<scenario>{"title":"big","steps":[{"id":0,"desc":"unclosed string</scenario>';
    const { scenario } = parseResponse(text);
    // truncate fallback이 동작했다면 scenario가 부분적으로라도 살아야 함
    assert.ok(scenario, 'fallback이 동작해야 함');
    assert.equal(scenario.title, 'big');
  });
});
