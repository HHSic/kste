import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocess } from '../lib/engine/preprocess.js';
import { splitSentences } from '../lib/engine/sentences.js';

const split = (t) => splitSentences(preprocess(t));
const texts = (t) => split(t).map((s) => s.text);

test('마침표·물음표·느낌표로 나눈다', () => {
  assert.deepEqual(texts('켜세요. 맞나요? 네!'), ['켜세요.', '맞나요?', '네!']);
});

test('줄바꿈은 문장 경계다', () => {
  assert.deepEqual(texts('첫째 줄\n둘째 줄'), ['첫째 줄', '둘째 줄']);
});

test('소수·버전·파일명의 점에서 나누지 않는다', () => {
  assert.deepEqual(texts('값은 3.5 입니다. v2.0 을 쓰세요. a.md 를 열어요.'), ['값은 3.5 입니다.', 'v2.0 을 쓰세요.', 'a.md 를 열어요.']);
});

test('약어(Dr., e.g., vs.)에서 나누지 않는다', () => {
  assert.equal(split('Dr. Kim 은 오지 않았다. 그래서 끝났다.').length, 2);
  assert.equal(split('예를 들어 e.g. 이런 경우다. 끝이다.').length, 2);
});

test('날짜 표기(2019. 3. 9.)에서 나누지 않는다', () => {
  assert.deepEqual(texts('2019. 3. 9. 에 출시했다. 다음 문장이다.'), ['2019. 3. 9. 에 출시했다.', '다음 문장이다.']);
});

test('인용부호·괄호 뒤 마침표를 문장 끝으로 본다', () => {
  assert.deepEqual(texts('"켜세요." 다음이다.'), ['"켜세요."', '다음이다.']);
});

test('문장 속성: 목록·제목·표 셀, 라인·컬럼', () => {
  const s = split('# 제목\n\n- 항목입니다.\n| 가 | 나 |\n|---|---|\n| 다 | 라 |\n본문이다.');
  assert.equal(s[0].isHeading, true);
  assert.equal(s[1].isListItem, true);
  assert.equal(s[1].line, 3);
  assert.equal(s[1].col, 3);
  assert.equal(s.filter((x) => x.isTableCell).length, 4);
  const last = s[s.length - 1];
  assert.equal(last.text, '본문이다.');
  assert.equal(last.line, 7);
  assert.equal(last.isListItem || last.isHeading || last.isTableCell, false);
});

test('코드 블록은 문장에서 빠진다', () => {
  assert.deepEqual(texts('앞이다.\n```\nfoo. bar.\n```\n뒤이다.'), ['앞이다.', '뒤이다.']);
});

test('목록 항목 끝 콜론을 표시한다', () => {
  const s = split('- 다음을 확인하세요:');
  assert.equal(s[0].endsWithColon, true);
});
