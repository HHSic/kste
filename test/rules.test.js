import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, loadProjectTerms, compileRegex, baseRuleId } from '../lib/rules/load.js';
import { compileTerms, termVariantSource } from '../lib/rules/compile.js';
import { lintText } from '../lib/engine/tier0.js';

// 플러그인 규칙 파일만 본다. 프로젝트 용어 통일표(K1.1)는 아래 테스트에서 따로 본다.
const rs = loadRules(undefined, { projectDir: null });

test('규칙 로드: deprecated·t0_enabled:false 제외, 컴파일 실패 없음', () => {
  assert.equal(rs.failures.length, 0, JSON.stringify(rs.failures));
  assert.ok(rs.counts.loaded > 150);
  assert.ok(rs.counts.deprecated >= 10);
  assert.equal(rs.counts.t0Disabled, 3);
  assert.ok(!rs.rules.some((r) => r.id.startsWith('DEP-')));
  assert.ok(!rs.rules.some((r) => ['K2.1-001', 'K2.1-002', 'K2.7-001'].includes(r.id)));
  assert.ok(rs.rules.every((r) => r.regex.flags.includes('u')));
});

test('컴파일 실패는 던지지 않고 수집한다', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kste-'));
  const yaml = [
    'banned:',
    '- id: K1.2-999',
    '  surface: "(안닫힘"',
    '  suggest: x',
    '  severity: warn',
    '  status: proposed',
    '- id: K1.2-998',
    '  surface: "정상"',
    '  suggest: y',
    '  severity: warn',
    '  status: proposed',
    '',
  ].join('\n');
  writeFileSync(path.join(dir, 'banned.yaml'), yaml);
  const r = loadRules(dir);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].id, 'K1.2-999');
  assert.equal(r.rules.length, 1);
});

test('규칙 ID -> 기본 ID', () => {
  assert.equal(baseRuleId('K1.3-001'), 'K1.3');
  assert.equal(baseRuleId('DEP-K4.6-002'), 'K4.6');
});

test('flags: M 은 멀티라인 정규식으로 컴파일된다', () => {
  assert.ok(compileRegex('바람$', 'M').flags.includes('m'));
  assert.ok(!compileRegex('바람$', '').flags.includes('m'));
});

// validate_rules.py 와 같은 검사의 JS 판: bad 예문은 탐지, good 예문은 비탐지
for (const r of rs.rules) {
  if (!r.examples) continue;
  const { bad, good } = r.examples;
  if (bad) {
    test(`${r.id} bad 예문 탐지`, () => {
      assert.ok(new RegExp(r.regex.source, r.regex.flags).test(bad), `${r.id} bad 미탐지: ${bad}`);
    });
  }
  if (good) {
    test(`${r.id} good 예문 비탐지`, () => {
      assert.ok(!new RegExp(r.regex.source, r.regex.flags).test(good), `${r.id} good 오탐: ${good}`);
    });
  }
}

// ---------- K1.1 프로젝트 용어 통일표 ----------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TERMS_YAML = [
  'terms:',
  '  - preferred: 설정',
  '    variants: [세팅, 셋팅, config]',
  '    pos: NNG',
  '    source: "테스트 용어집"',
  '    status: approved',
  '  - preferred: 사용자',
  '    variants: [유저]',
  '    pos: NNG',
  '    source: "테스트 용어집"',
  '    status: proposed',
  '  - preferred: 내려받다',
  '    variants: [다운받다, 다운로드 받다]',
  '    pos: VV',
  '    source: "테스트 용어집"',
  '    status: approved',
  '',
].join('\n');
const project = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kste-proj-'));
  mkdirSync(path.join(dir, 'rules'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, 'rules', name), text);
  return dir;
};
const k11 = (text, ruleset) => lintText(text, { ruleset }).findings.filter((f) => f.base === 'K1.1');

test('K1.1 변이형 정규식: 조사가 붙어도 찾고, 다른 낱말 속이나 preferred 자리는 찾지 않는다', () => {
  const re = (v, o) => compileRegex(termVariantSource(v, o));
  assert.ok(re('세팅', { preferred: '설정' }).test('세팅을 연다'));
  assert.ok(re('세팅', { preferred: '설정' }).test('화면 세팅.'));
  assert.ok(!re('세팅', { preferred: '설정' }).test('리세팅한다'));
  assert.ok(!re('설정', { preferred: '설정값' }).test('설정값을 바꾼다'));
  assert.ok(re('설정', { preferred: '설정값' }).test('설정을 바꾼다'));
  assert.ok(re('config', { preferred: '설정' }).test('config 파일을 연다'));
  assert.ok(!re('config', { preferred: '설정' }).test('configure 명령'));
  assert.ok(re('다운받다', { pos: 'VV', preferred: '내려받다' }).test('파일을 다운받아 연다'));
  assert.ok(re('다운로드 받다', { pos: 'VV', preferred: '내려받다' }).test('파일을 다운로드 받는다'));
});

test('K1.1 등급: approved 는 error, proposed 는 warn. example 과 deprecated 는 뺀다', () => {
  const tc = compileTerms([
    { preferred: '설정', variants: ['세팅'], status: 'approved', file: 'rules/terms.yaml' },
    { preferred: '사용자', variants: ['유저'], status: 'proposed', file: 'rules/terms.yaml' },
    { preferred: '비밀번호', variants: ['패스워드'], status: 'proposed', example: true, file: 'rules/terms.yaml' },
    { preferred: '회생제동', variants: ['회생 제동'], status: 'deprecated', file: 'rules/terms.yaml' },
  ]);
  assert.deepEqual(tc.rules.map((r) => [r.id, r.base, r.severity]), [['K1.1-001', 'K1.1', 'error'], ['K1.1-002', 'K1.1', 'warn']]);
  assert.equal(tc.counts.loaded, 2);
  assert.equal(tc.counts.deprecated, 1);
  assert.equal(tc.failures.length, 0);
});

test('K1.1: 프로젝트 rules/terms*.yaml 을 T0 에서 검사하고 템플릿은 읽지 않는다', () => {
  const dir = project({ 'terms.yaml': TERMS_YAML, 'terms.template.yaml': 'terms:\n  - preferred: 비밀번호\n    variants: [패스워드]\n    pos: NNG\n    source: "템플릿"\n' });
  const ruleset = loadRules(undefined, { projectDir: dir });
  assert.equal(ruleset.failures.length, 0, JSON.stringify(ruleset.failures));
  assert.deepEqual(Object.keys(ruleset.counts.files).filter((f) => f.startsWith('rules/')), ['rules/terms.yaml']);
  const f = k11('먼저 세팅 화면을 엽니다. 유저가 결과를 확인합니다. 파일을 다운받아 엽니다. 패스워드를 바꿉니다.\n', ruleset);
  assert.deepEqual(f.map((x) => [x.match, x.severity]), [['세팅', 'error'], ['유저', 'warn'], ['다운받', 'error']]);
  assert.match(f[0].suggest, /^설정 \(용어 통일표 rules\/terms\.yaml\)$/);
  // K1.8: 코드 스팬은 검사하지 않는다
  assert.deepEqual(k11('`세팅` 값을 바꿉니다.\n', ruleset), []);
});

test('K1.1: 템플릿만 있는 프로젝트(이 저장소)는 용어 규칙을 더하지 않는다', () => {
  const ruleset = loadRules(undefined, { projectDir: ROOT });
  assert.equal(ruleset.rules.filter((r) => r.base === 'K1.1').length, 0);
  assert.equal(ruleset.counts.loaded, rs.counts.loaded);
});

test('K1.1: 읽지 못한 용어 통일표는 던지지 않고 실패로 남긴다', () => {
  const dir = project({ 'terms.yaml': 'terms: [\n' });
  const ruleset = loadRules(undefined, { projectDir: dir });
  assert.equal(ruleset.failures.length, 1);
  assert.equal(ruleset.failures[0].file, 'rules/terms.yaml');
  assert.equal(loadProjectTerms(dir).entries.length, 0);
});
