// K2.7 어절 수 단위 테스트: 모델 없이 토큰 열을 직접 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toEojeols } from '../../lib/t1/morph-pattern.js';
import { isLatinEojeol, chainWordCount } from '../../lib/t1/checks.js';

// "form/TAG@어절" 목록 -> 어절 열
const eojeols = (spec) => {
  let pos = 0;
  const toks = spec.split(/\s+/).map((x) => {
    const m = x.match(/^(.+?)\/([A-Z]+)@(\d+)$/);
    const t = { form: m[1], tag: m[2], wp: Number(m[3]), sp: 0, pos, len: m[1].length, line: 0 };
    pos += t.len;
    return t;
  });
  return toEojeols(toks);
};

test('영어 어절: SL 만, 또는 SL·SN 만 있는 어절', () => {
  const eo = eojeols('MongoDB/SL@0 S/SL@1 3/SN@1 2026/SN@2 설정/NNG@3 Guide/SL@4 이/VCP@4');
  assert.deepEqual(eo.map(isLatinEojeol), [true, true, false, false, false]);
});

test('이어진 영어 어절은 한 어절로 센다', () => {
  const eo = eojeols('Claude/SL@0 Code/SL@1 플러그인/NNP@2 설정/NNG@3 파일/NNG@4 변경/NNG@5');
  assert.equal(chainWordCount(eo, 0, eo.length), 5);
});

test('영어 어절 하나와 한국어 명사 연쇄는 그대로 센다', () => {
  const eo = eojeols('MongoDB/SL@0 연결/NNG@1 정보/NNG@2 설정/NNG@3');
  assert.equal(chainWordCount(eo, 0, eo.length), 4);
  const ko = eojeols('데이터베이스/NNG@0 서버/NNG@1 설정/NNG@2 파일/NNG@3 변경/NNG@4 이력/NNG@5');
  assert.equal(chainWordCount(ko, 0, ko.length), 6);
});

test('한국어 명사로 나뉜 영어 어절은 따로 센다', () => {
  const eo = eojeols('AWS/SL@0 계정/NNG@1 IAM/SL@2 정책/NNG@3');
  assert.equal(chainWordCount(eo, 0, eo.length), 4);
});
