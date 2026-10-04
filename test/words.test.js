import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocess } from '../lib/engine/preprocess.js';
import { countWords, nounChains } from '../lib/engine/words.js';

const n = (t) => countWords(preprocess(t).masked.trim()).count;

test('K7.1-1 공백으로 나눈다', () => {
  assert.equal(n('전원 플러그를 콘센트에 꽂으세요.'), 4);
});

test('K7.1-2 괄호 안 내용은 한 어절이다', () => {
  assert.equal(n('설정 (자세한 내용은 아래 참고) 을 확인하세요'), 4);
  assert.equal(n('제품(모델명 ABC 123)을 확인하세요'), 2);
});

test('K7.2 숫자와 단위는 한 어절이다', () => {
  assert.equal(n('10 cm 이내로 설치하세요'), 3);
  assert.equal(n('220 V 전원을 쓰세요'), 3);
  assert.equal(n('50만 명이 참여했다'), 2); // 수 단위: 50만 명이 + 참여했다
  assert.equal(n('3 개월 동안 사용하세요'), 3);
});

test('K7.2 약어·식별자는 한 어절이다', () => {
  assert.equal(n('API e.g. U.S.A. 약어'), 4);
  assert.equal(n('`npm run build -- --watch` 를 실행하세요'), 3);
  assert.equal(n('foo_bar(a, b) 를 호출하세요'), 3);
});

test('K7.2 URL 은 한 어절이다', () => {
  assert.equal(n('https://example.com/a/b?c=1 에서 내려받으세요'), 3);
});

test('K7.2 따옴표 인용은 한 어절이다', () => {
  assert.equal(n('"저장 후 다음 이동" 을 누르세요'), 3);
  assert.equal(n('‘안전을 위한 주의 사항’을 읽으세요'), 2);
});

test('명사 연쇄 근사: 조사로 끝나지 않는 한글 어절의 연속', () => {
  const r = countWords('권장 안전 사용 기간을 확인하세요');
  assert.equal(r.nounChain.max, 3);
  assert.equal(r.nounChain.precision, 'low');
  assert.deepEqual(nounChains(['전동기', '제어반', '전원', '공급', '장치를', '점검']).map((c) => c.length), [4]);
  assert.equal(nounChains(['제품을', '설치하세요']).length, 0);
});
