import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'kste.js');
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8' });
const tmp = mkdtempSync(path.join(tmpdir(), 'kste-cli-'));
const file = (name, text) => {
  const p = path.join(tmp, name);
  writeFileSync(p, text);
  return p;
};

test('깨끗한 문서: 종료 코드 0', () => {
  const r = run(['check', file('ok.md', '전원을 켜세요.\n')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^\[KSTE\] 0 findings/);
});

test('error 가 있으면 종료 코드 1 (기본 fail-on error)', () => {
  const r = run(['check', file('err.md', '저장되어집니다.\n')]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error\s+K2\.6-001/);
});

test('warn 만 있으면 기본 0, --fail-on warn 이면 1', () => {
  const p = file('warn.md', '품질에 있어서 최고입니다.\n');
  assert.equal(run(['check', p]).status, 0);
  assert.equal(run(['check', p, '--fail-on', 'warn']).status, 1);
});

test('--json 출력은 파싱된다', () => {
  const r = run(['check', file('j.md', '저장되어집니다.\n'), '--json']);
  const j = JSON.parse(r.stdout);
  assert.equal(j.summary.error, 1);
  assert.ok(Array.isArray(j.outOfScope));
  assert.equal(r.status, 1);
});

test('stdin(-) 입력', () => {
  const r = run(['check', '-'], '저장되어집니다.\n');
  assert.equal(r.status, 1);
});

test('--all 은 숨김 항목을 보여 준다', () => {
  const p = file('hide.md', '관리자에 의해 승인된다.\n');
  assert.doesNotMatch(run(['check', p]).stdout, /K1\.4-002/);
  assert.match(run(['check', p, '--all']).stdout, /K1\.4-002/);
});

test('--genre 옵션', () => {
  const r = run(['check', '-', '--genre', 'procedural', '--json'], '설명입니다.\n');
  assert.equal(JSON.parse(r.stdout).summary.genre, 'procedural');
  assert.equal(run(['check', '-', '--genre', 'x'], 'a').status, 2);
});

test('diff: 숫자 누락은 종료 코드 1', () => {
  const a = file('a.txt', '30초 동안 누르세요.\n');
  const b = file('b.txt', '잠시 누르세요.\n');
  const r = run(['diff', a, b]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /K8\.1/);
});

test('diff: 표기만 바뀌면 0', () => {
  const r = run(['diff', file('a2.txt', '308천명이 참여했다.\n'), file('b2.txt', '30만 8천 명이 참여했다.\n')]);
  assert.equal(r.status, 0, r.stdout);
});

test('rules: 로드 수와 컴파일 실패 목록', () => {
  const r = run(['rules']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /로드된 규칙 \d+개/);
  assert.match(r.stdout, /컴파일 실패 0건/);
});

test('사용법 오류는 종료 코드 2', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['check']).status, 2);
  assert.equal(run(['check', path.join(tmp, 'nope.md')]).status, 2);
});
