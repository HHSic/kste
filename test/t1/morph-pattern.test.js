// morph DSL 단위 테스트: 모델 없이 토큰 열을 직접 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMorph, matchSeq, findMorph, toEojeols, matchChain, loadMorphPatterns } from '../../lib/t1/morph-pattern.js';

// "form/TAG@어절" 목록 -> 토큰 열
const seq = (spec) => {
  let pos = 0;
  return spec.split(/\s+/).map((x) => {
    const m = x.match(/^(.+?)\/([A-Z]+)@(\d+)$/);
    const t = { form: m[1], tag: m[2], wp: Number(m[3]), sp: 0, pos, len: m[1].length, line: 0 };
    pos += t.len;
    return t;
  });
};

test('품사 시퀀스: 인접 매칭', () => {
  const toks = seq('저장/NNG@0 되/XSV@0 어/EC@0 지/VX@0 ㅂ니다/EF@0');
  const m = findMorph('XSV:되 EC:어 VX:지', toks);
  assert.equal(m.length, 1);
  assert.deepEqual([m[0].start, m[0].end], [1, 4]);
  assert.equal(m[0].forms, '되/XSV 어/EC 지/VX');
});

test('인접하지 않으면 매치하지 않는다', () => {
  const toks = seq('되/XSV@0 를/JKO@0 어/EC@0 지/VX@0');
  assert.equal(findMorph('XSV:되 EC:어 VX:지', toks).length, 0);
});

test('TAG 만 지정하면 형태는 무엇이든', () => {
  const toks = seq('개선/NNG@0 시키/XSV@0 ㄹ/ETM@0');
  assert.equal(findMorph('NNG XSV:시키', toks).length, 1);
  assert.equal(findMorph('NNG XSV:하', toks).length, 0);
});

test('(A|B) 선택과 TAG:*접미 와일드카드 (patterns.yaml K2.6 형식)', () => {
  const src = '(XSV:되|VV:*히|VV:*이|VV:*리|VV:*기) EC:어 VX:지';
  assert.equal(findMorph(src, seq('닫/VV@0 히/VV@0')).length, 0);
  assert.equal(findMorph(src, seq('보이/VV@0 어/EC@0 지/VX@0')).length, 1); // *이
  assert.equal(findMorph(src, seq('닫히/VV@0 어/EC@0 지/VX@0')).length, 1); // *히
  assert.equal(findMorph(src, seq('끊기/VV@0 어/EC@0 지/VX@0')).length, 1); // *기
  assert.equal(findMorph(src, seq('만들/VV@0 어/EC@0 지/VX@0')).length, 0); // 단일 피동: 매치 안 함
  assert.equal(findMorph(src, seq('먹/VV@0 어/EC@0 지/VX@0')).length, 0);
});

test('TAG:(a|b) 형태 선택, 접두 와일드카드', () => {
  const p = parseMorph('(XSV|VV|VA|VCP|EP|XSA) ETN:(ㅁ|음)');
  assert.equal(matchSeq(p, seq('필요/NNG@0 하/XSA@0 ㅁ/ETN@0')).length, 1);
  assert.equal(matchSeq(p, seq('있/VA@0 음/ETN@0')).length, 1);
  assert.equal(matchSeq(p, seq('수신/NNG@0 함/NNG@0')).length, 0);
  assert.equal(matchSeq(parseMorph('VV:시* EC'), seq('시키/VV@0 어/EC@0')).length, 1);
  assert.equal(matchSeq(parseMorph('VV:*'), seq('가/VV@0')).length, 1);
});

test('선택 항목 X? 와 겹치지 않는 반복 매칭', () => {
  const p = parseMorph('NNG JKO? VV');
  assert.equal(matchSeq(p, seq('문/NNG@0 을/JKO@0 닫/VV@0')).length, 1);
  assert.equal(matchSeq(p, seq('문/NNG@0 닫/VV@0')).length, 1);
  const two = matchSeq(parseMorph('NNG VV'), seq('문/NNG@0 닫/VV@0 창/NNG@1 열/VV@1'));
  assert.equal(two.length, 2);
});

test('!(...) 문장에 해당 품사가 없음', () => {
  const p = parseMorph('!(VV|VA|VX|VCP|VCN|XSV|XSA)');
  assert.equal(findMorph(p, seq('에러/NNG@0 코드/NNG@1 목록/NNG@2 ./SF@2')).length, 1);
  assert.equal(findMorph(p, seq('에러/NNG@0 를/JKO@0 보/VV@1 다/EF@1')).length, 0);
});

test('chain(...) 파싱과 어절 단위 연쇄', () => {
  const p = parseMorph('chain(NNG|NNP|SL|SN|NR|XPN|XSN, eojeol>=4, josa=none)');
  assert.equal(p.type, 'chain');
  assert.equal(p.min, 4);
  assert.ok(p.tags.has('NNP') && p.tags.has('XSN'));
  // 제어/반 처럼 과분할돼도 어절 수로 센다: [전동기][제어 반][전원][공급][장치를][점검하]
  const toks = seq('전동기/NNG@0 제어/NNG@1 반/NNG@1 전원/NNG@2 공급/NNG@3 장치/NNG@4 를/JKO@4 점검/NNG@5 하/XSV@5');
  const eo = toEojeols(toks);
  assert.equal(eo.length, 6);
  const c = matchChain(p, eo, { min: 2 });
  assert.equal(c.length, 1);
  assert.equal(c[0].length, 4); // 장치를(조사 있음)은 연쇄에서 빠진다
});

test('매치 위치: 어절·문장 번호와 오프셋', () => {
  const toks = [
    { form: '저장', tag: 'NNG', wp: 3, sp: 2, pos: 10, len: 2, line: 1 },
    { form: '되', tag: 'XSV', wp: 3, sp: 2, pos: 12, len: 1, line: 1 },
    { form: '어', tag: 'EC', wp: 3, sp: 2, pos: 13, len: 1, line: 1 },
    { form: '지', tag: 'VX', wp: 3, sp: 2, pos: 14, len: 1, line: 1 },
  ];
  const [m] = findMorph('XSV:되 EC:어 VX:지', toks);
  assert.equal(m.pos, 12);
  assert.equal(m.endPos, 15);
  assert.equal(m.wordStart, 3);
  assert.equal(m.sent, 2);
  assert.equal(m.line, 1);
});

test('잘못된 패턴은 예외', () => {
  assert.throws(() => parseMorph('xsv:되'));
  assert.throws(() => parseMorph(''));
});

test('patterns.yaml 의 모든 morph 가 파싱된다 (DEP- 제외)', () => {
  const ps = loadMorphPatterns();
  const ids = ps.map((p) => p.id);
  for (const id of ['K2.6-001', 'K2.9-001', 'K2.1-001', 'K2.1-002', 'K2.7-001']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some((i) => i.startsWith('DEP-')));
  assert.equal(ps.find((p) => p.id === 'K2.7-001').parsed.type, 'chain');
});
