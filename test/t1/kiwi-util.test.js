// kiwi.js 보조 함수 (모델 없이 돈다): 바이트 오프셋 변환, 자모 정규화, 토큰 묶기
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeByteToChar, byteToCharOffset, utf8Length, normJamo, normTag, groupBySentence, toToken, loadUserWords } from '../../lib/t1/kiwi.js';

test('바이트 -> 문자 오프셋: 한글(3바이트)과 ASCII', () => {
  const s = '가나다 한글입니다. 둘째 문장이다.';
  const conv = makeByteToChar(s);
  assert.equal(conv(0), 0);
  assert.equal(conv(3), 1);
  assert.equal(conv(9), 3);
  // Kiwi splitIntoSents 실측: 첫 문장 end=바이트 26 -> "가나다 한글입니다." 의 끝(문자 10)
  assert.equal(utf8Length('가나다 한글입니다.'), 26);
  assert.equal(conv(26), 10);
  assert.equal(conv(utf8Length(s)), s.length);
});

test('바이트 -> 문자 오프셋: 이모지(4바이트, UTF-16 2칸)', () => {
  const s = '가 😀 나';
  const conv = makeByteToChar(s);
  assert.equal(conv(4), 2); // '가 ' 다음
  assert.equal(conv(8), 4); // 😀 다음 (UTF-16 길이 2)
  assert.equal(conv(9), 5);
  assert.equal(byteToCharOffset(s, utf8Length(s)), s.length);
});

test('문자 경계가 아닌 바이트 오프셋은 예외', () => {
  assert.throws(() => byteToCharOffset('가나', 1), RangeError);
  assert.throws(() => byteToCharOffset('가나', 100), RangeError);
});

test('스팬 변환: splitIntoSents 스팬 실측값 -> slice', () => {
  const s = '가나다 한글입니다. 😀 둘째 문장이다. 셋째.';
  const spans = [{ start: 0, end: 26 }, { start: 27, end: 52 }, { start: 53, end: 60 }]; // 실측(바이트)
  const conv = makeByteToChar(s);
  const texts = spans.map((x) => s.slice(conv(x.start), conv(x.end)));
  assert.deepEqual(texts, ['가나다 한글입니다.', '😀 둘째 문장이다.', '셋째.']);
});

test('조합형 종성 -> 호환 자모 정규화', () => {
  assert.equal(normJamo('ᆸ니다'), 'ㅂ니다');
  assert.equal(normJamo('ᆫ다'), 'ㄴ다');
  assert.equal(normJamo('ᆷ'), 'ㅁ');
  assert.equal(normJamo('ᆯ'), 'ㄹ');
  assert.equal(normJamo('습니다'), '습니다');
  assert.equal(normTag('XSV-R'), 'XSV');
});

test('토큰 변환·문장 묶기 (sentPosition)', () => {
  const raw = [
    { str: '문', tag: 'NNG', position: 0, wordPosition: 0, sentPosition: 0, lineNumber: 0, length: 1 },
    { str: 'ᆫ다', tag: 'EF-R', position: 1, wordPosition: 0, sentPosition: 0, lineNumber: 0, length: 2 },
    { str: '끝', tag: 'NNG', position: 5, wordPosition: 0, sentPosition: 1, lineNumber: 0, length: 1 },
  ];
  const toks = raw.map((t) => toToken(t, 100));
  assert.deepEqual([toks[1].form, toks[1].tag, toks[1].pos], ['ㄴ다', 'EF', 101]);
  const g = groupBySentence(toks);
  assert.equal(g.length, 2);
  assert.equal(g[0].length, 2);
  assert.equal(toToken({ ...raw[0], str: '' }).code, true);
});

test('terms*.yaml preferred 를 userWords 로 읽는다 (동사는 어간)', () => {
  const w = loadUserWords();
  assert.ok(w.some((x) => x.word === '회생제동' && x.tag === 'NNP'));
  assert.ok(w.some((x) => x.word === '내려받' && x.tag === 'VV'));
});
