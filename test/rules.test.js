import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRules, compileRegex, baseRuleId } from '../lib/rules/load.js';

const rs = loadRules();

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
