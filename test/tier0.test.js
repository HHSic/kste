import test from 'node:test';
import assert from 'node:assert/strict';
import { lintText } from '../lib/engine/tier0.js';
import { buildReport, renderMarkdown, filterFindings } from '../lib/engine/report.js';

const ids = (r) => r.findings.map((f) => f.ruleId);

test('사전 규칙: 확정형 번역투·이중피동·중복', () => {
  const r = lintText('품질에 있어서 최고다.\n저장되어집니다.\n매 1년마다 점검한다.');
  assert.ok(ids(r).includes('K1.3-001'));
  assert.ok(ids(r).includes('K2.6-001'));
  assert.ok(r.findings.some((f) => f.base === 'K1.2'));
});

test('finding 필드', () => {
  const f = lintText('품질에 있어서 최고다.').findings.find((x) => x.ruleId === 'K1.3-001');
  assert.equal(f.line, 1);
  assert.equal(f.col, 3);
  assert.equal(f.severity, 'warn');
  assert.ok(f.suggest);
  assert.equal(f.show, true);
});

test('show_by_default:false 규칙은 show:false 이고 기본 리포트에서 빠진다', () => {
  const r = lintText('관리자에 의해 승인된다.');
  const f = r.findings.find((x) => x.ruleId === 'K1.4-002');
  assert.ok(f);
  assert.equal(f.show, false);
  assert.equal(filterFindings(r.findings).some((x) => x.ruleId === 'K1.4-002'), false);
  assert.equal(filterFindings(r.findings, { all: true }).some((x) => x.ruleId === 'K1.4-002'), true);
});

test('장르 자동 추정: -세요 비율', () => {
  assert.equal(lintText('전원을 켜세요.\n뚜껑을 여세요.\n물을 넣으세요.').meta.genre, 'procedural');
  assert.equal(lintText('이 모듈은 요청을 처리합니다.\n결과는 캐시에 저장됩니다.').meta.genre, 'descriptive');
  assert.equal(lintText('설명입니다.', { genre: 'procedural' }).meta.genre, 'procedural');
  assert.equal(lintText('---\ngenre: 서술문\n---\n전원을 켜세요.').meta.genre, 'descriptive');
});

const longSentence = (n) => Array.from({ length: n }, (_, i) => `단어${'가나다라마바사아자차'[i % 10]}`).join(' ') + ' 입니다.';

test('길이: 절차문 17어절 경고(K4.4), 서술문은 21어절부터(K5.1)', () => {
  const s17 = longSentence(17); // 17 단어 + 입니다. = 18어절
  assert.ok(ids(lintText(s17, { genre: 'procedural' })).includes('K4.4'));
  assert.ok(!ids(lintText(longSentence(15), { genre: 'procedural' })).includes('K4.4'));
  assert.ok(!ids(lintText(s17, { genre: 'descriptive' })).includes('K5.1'));
  assert.ok(ids(lintText(longSentence(21), { genre: 'descriptive' })).includes('K5.1'));
  const strong = lintText(longSentence(26), { genre: 'descriptive' }).findings.find((f) => f.ruleId === 'K5.1');
  assert.equal(strong.strong, true);
  assert.equal(strong.severity, 'warn');
});

test('세미콜론은 코드 밖에서만 탐지', () => {
  assert.ok(ids(lintText('하나다; 둘이다.')).includes('K3.3'));
  assert.ok(!ids(lintText('`a; b` 를 쓴다.\n```\nx; y\n```')).includes('K3.3'));
});

test('쉼표 나열 3개 이상은 K3.5 정보', () => {
  const r = lintText('사과, 배, 감을 사세요.');
  const f = r.findings.find((x) => x.ruleId === 'K3.5');
  assert.ok(f);
  assert.equal(f.severity, 'info');
  assert.ok(!ids(lintText('사과, 배를 사세요.')).includes('K3.5'));
});

test('단락 문장 수 6 초과는 K5.2 (서술문)', () => {
  const p = Array.from({ length: 7 }, () => '이 값은 설정입니다.').join(' ');
  assert.ok(ids(lintText(p, { genre: 'descriptive' })).includes('K5.2'));
});

test('개조식 종결(-함/-됨/-음/-임): 본문은 error, 목록·제목·표 셀은 면제', () => {
  const r = lintText('접수 마감 시간까지 제출해야 함.');
  const f = r.findings.find((x) => x.ruleId === 'K2.1');
  assert.ok(f);
  assert.equal(f.severity, 'error');
  assert.ok(!ids(lintText('- 접수 마감 시간까지 제출해야 함.')).includes('K2.1'));
  assert.ok(!ids(lintText('# 제출 서류가 필요함')).includes('K2.1'));
  assert.ok(!ids(lintText('| 항목 | 값 |\n|---|---|\n| 서류 | 제출해야 함 |')).includes('K2.1'));
  assert.ok(!ids(lintText('설계과정 결함.')).includes('K2.1'));
});

test('개조식 선언 문서는 K2.1 이 경고', () => {
  const f = lintText('---\ngenre: 개조식\n---\n치사율은 2% 정도로 추정됨.').findings.find((x) => x.ruleId === 'K2.1');
  assert.equal(f.severity, 'warn');
});

test('명사 연쇄는 옵션을 켰을 때만, 정밀도 낮음 표시', () => {
  const t = '전동기 제어반 전원 공급 장치를 점검하세요.';
  assert.ok(!ids(lintText(t)).includes('K2.7'));
  const f = lintText(t, { nounChain: true }).findings.find((x) => x.ruleId === 'K2.7');
  assert.ok(f);
  assert.equal(f.precision, 'low');
});

test('리포트: 형식과 고정 "린터 범위 밖" 블록', () => {
  const res = lintText('품질에 있어서 최고다.');
  const md = renderMarkdown(buildReport(res));
  assert.match(md, /^\[KSTE\] \d+ findings \(T0 \d+\) · T1 inactive · mode 80%/);
  assert.match(md, /warn\s+K1\.3-001\s+L1:3/);
  assert.match(md, /--- 린터 범위 밖 \(사람 확인\) ---/);
  for (const id of ['K1.9', 'K2.8', 'K4.7', 'K5.4', 'K6.5', 'K8.4']) assert.ok(md.includes(id), id);
});
