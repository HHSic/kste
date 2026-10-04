import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocess, PH, PH_BLOCK } from '../lib/engine/preprocess.js';
import { lintText } from '../lib/engine/tier0.js';

const DOC = [
  '---', 'genre: 절차문', 'title: x', '---',
  '# 제목',
  '',
  '`에 있어서`는 코드입니다. https://example.com/에있어서 를 보세요.',
  '```js',
  'const a = "에 있어서";',
  '```',
  '| 항목 | 값 |',
  '|---|---|',
  '| 가 | 나 |',
  '- 목록 하나',
  '1. 번호 하나 <b>굵게</b>',
].join('\n');

test('마스킹은 길이를 보존한다', () => {
  const pre = preprocess(DOC);
  assert.equal(pre.masked.length, DOC.length);
});

test('코드 블록·frontmatter·표 구분선은 블록 플레이스홀더로 치환된다', () => {
  const pre = preprocess(DOC);
  const kinds = pre.lines.map((l) => l.kind);
  assert.deepEqual(kinds.slice(0, 4), ['frontmatter', 'frontmatter', 'frontmatter', 'frontmatter']);
  assert.equal(kinds[7], 'code');
  assert.equal(kinds[8], 'code');
  assert.equal(kinds[11], 'table-sep');
  assert.ok(pre.masked.split('\n')[8].split('').every((c) => c === PH_BLOCK));
  assert.ok(!pre.masked.includes('const'));
  assert.equal(pre.frontmatter.genre, '절차문');
});

test('인라인 코드·URL·HTML 태그는 PH 로 치환된다', () => {
  const pre = preprocess(DOC);
  const line = pre.masked.split('\n')[6];
  assert.ok(line.startsWith(PH.repeat('`에 있어서`'.length)));
  assert.ok(!line.includes('example.com'));
  const li = pre.masked.split('\n')[14];
  assert.ok(!li.includes('<b>') && !li.includes('</b>'));
  assert.ok(li.includes('굵게'));
});

test('보호 영역 안의 규칙 표면형은 탐지하지 않는다', () => {
  const { findings } = lintText(DOC, { genre: 'procedural' });
  assert.equal(findings.filter((f) => f.ruleId.startsWith('K1.3')).length, 0);
});

test('보호 밖의 같은 표현은 탐지하고 라인·컬럼을 원문 기준으로 복원한다', () => {
  const doc = '# 제목\n\n설명\n품질에 있어서 최고입니다.\n';
  const { findings } = lintText(doc);
  const f = findings.find((x) => x.ruleId === 'K1.3-001');
  assert.ok(f);
  assert.equal(f.line, 4);
  assert.equal(f.col, 3);
});

test('목록 항목과 번호 목록을 인식한다', () => {
  const pre = preprocess('- 가나다\n1. 라마바\n* 사아자\n본문\n');
  assert.deepEqual(pre.lines.slice(0, 4).map((l) => [l.kind, l.isList, l.ordered]), [
    ['list', true, false], ['list', true, true], ['list', true, false], ['text', false, false],
  ]);
});

test('링크는 텍스트만 남기고 대상은 가린다', () => {
  const pre = preprocess('[문서](http://a.b/c)를 보세요');
  assert.ok(pre.masked.includes('문서'));
  assert.ok(!pre.masked.includes('http'));
});
