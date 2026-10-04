import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers, countNegations, comparePreservation } from '../lib/engine/preserve.js';

const has = (r, id, sev) => r.findings.some((f) => f.ruleId === id && (!sev || f.severity === sev));

test('숫자 정규화: 쉼표·단위 공백 제거', () => {
  assert.deepEqual(extractNumbers('1,000 원'), ['1000원']);
  assert.deepEqual(extractNumbers('10 cm 와 220 V'), ['10cm', '220V']);
  assert.deepEqual(extractNumbers('3MB'), ['3MB']);
});

test('숫자 정규화: 천/만/억 환산', () => {
  assert.deepEqual(extractNumbers('30만 8천 명'), ['308000명']);
  assert.deepEqual(extractNumbers('308천명'), ['308000명']);
  assert.deepEqual(extractNumbers('50만명'), ['500000명']);
  assert.deepEqual(extractNumbers('1억 3천만 원'), ['130000000원']);
});

test('숫자 정규화: 날짜·시각', () => {
  assert.deepEqual(extractNumbers('2015.5.1'), extractNumbers('2015. 5. 1.'));
  assert.deepEqual(extractNumbers('오후 3시 20분'), extractNumbers('15:20'));
});

test('K8.1: 표기만 바뀌면 통과, 값이 사라지면 오류', () => {
  assert.equal(
    has(comparePreservation('접수는 2015.5.1 부터, 308천명 대상', '접수는 2015. 5. 1. 부터, 30만 8천 명 대상'), 'K8.1', 'error'),
    false,
  );
  const r = comparePreservation('30초 동안 누르세요.', '잠시 누르세요.');
  assert.ok(has(r, 'K8.1', 'error'));
  assert.deepEqual(r.stats.missing, ['30초']);
});

test('K8.1: 단위가 바뀌어도 오류', () => {
  assert.ok(has(comparePreservation('10 cm 이내', '10 m 이내'), 'K8.1', 'error'));
});

test('부정어 수 세기', () => {
  assert.equal(countNegations('열지 마세요. 사용하지 않는다. 오류가 없다.'), 3);
  assert.equal(countNegations('금지한다'), 1);
  assert.equal(countNegations('전원을 켜세요.'), 0);
});

test('K8.4: 부정 수가 홀수 번 바뀌면 경고', () => {
  assert.ok(has(comparePreservation('물을 붓지 마세요.', '물을 부으세요.'), 'K8.4', 'warn'));
  assert.ok(!has(comparePreservation('물을 붓지 마세요.', '물을 붓지 않습니다.'), 'K8.4'));
});

test('K8.2: 문장 수가 줄면 경고, 늘면 통과', () => {
  assert.ok(has(comparePreservation('하나다. 둘이다. 셋이다.', '하나다. 둘이다.'), 'K8.2', 'warn'));
  assert.ok(!has(comparePreservation('하나이고 둘이다.', '하나다. 둘이다.'), 'K8.2'));
});
