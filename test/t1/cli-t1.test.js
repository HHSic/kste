// CLI --t1 옵션과 모델 없음 폴백
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { t1Available, loadKiwi, modelInstalled } from '../../lib/t1/kiwi.js';
import { getT1 } from '../../lib/t1/worker.js';
import { lintTextT1 } from '../../lib/t1/engine.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'kste.js');
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8' });
const ON = t1Available();
const needModel = ON ? {} : { skip: 'models/kiwi 없음' };

test('모델 디렉터리가 비어 있으면 null (T0 폴백)', async () => {
  const dir = path.join(os.tmpdir(), 'kste-no-model');
  assert.equal(modelInstalled(dir), false);
  assert.equal(await loadKiwi({ modelDir: dir }), null);
  assert.equal(await getT1({ modelDir: dir }), null);
});

test('--t1 off: T1 inactive, T0 결과', () => {
  const r = run(['check', '-', '--t1', 'off'], '저장되어집니다.\n');
  assert.match(r.stdout, /T1 inactive/);
  assert.match(r.stdout, /T1 미설치로 미검사/);
  assert.equal(r.status, 1);
});

test('--t1 값 검사', () => {
  assert.equal(run(['check', '-', '--t1', 'maybe'], 'a').status, 2);
});

test('--t1 off 와 lintTextT1({t1:"off"}) 는 T0 와 같다', async () => {
  const r = await lintTextT1('저장되어집니다.\n', { t1: 'off' });
  assert.equal(r.meta.t1, false);
  assert.equal(r.meta.tier, 'T0');
});

test('--t1 on: T1 active 헤더, 미검사 목록에서 구현된 규칙이 빠진다', needModel, () => {
  const r = run(['check', '-', '--t1', 'on'], '저장되어집니다.\n');
  assert.match(r.stdout, /T1 active/);
  assert.doesNotMatch(r.stdout, /T1 미설치로 미검사/);
  assert.match(r.stdout, /K2\.6-001/);
  assert.equal(r.status, 1);
});

test('--t1 auto(기본): 모델이 있으면 켠다', needModel, () => {
  assert.match(run(['check', '-'], '전원을 켜세요.\n').stdout, /T1 active/);
  assert.match(run(['check', '-', '--t1', 'auto', '--json'], '전원을 켜세요.\n').stdout, /"t1": true/);
});

test('diff --t1 on: K8.3 명사 보존율', needModel, () => {
  const r = run(['diff', '데이터베이스 서버 설정 파일 위치를 확인한다.', '파일을 본다.', '--t1', 'on']);
  assert.match(r.stdout, /K8\.3/);
});
