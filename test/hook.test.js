import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'hooks', 'kste-hook.mjs');

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kste-hook-'));
  const stateDir = path.join(dir, '.kste');
  const env = { ...process.env, KSTE_STATE_DIR: stateDir };
  delete env.CLAUDE_PROJECT_DIR;
  const file = (name, text) => {
    const p = path.join(dir, name);
    writeFileSync(p, text);
    return p;
  };
  const hook = (filePath, tool = 'Write') =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: tool, cwd: dir, tool_input: { file_path: filePath } }),
      encoding: 'utf8',
      env,
    });
  const set = (...args) => spawnSync(process.execPath, [HOOK, 'set', ...args], { encoding: 'utf8', env, cwd: dir });
  return { dir, stateDir, file, hook, set };
}

const BAD_KO = '# 안내\n\n설정이 저장되어집니다.\n';

test('한국어 위반 파일: 종료 2, stderr 에 리포트', () => {
  const s = sandbox();
  const r = s.hook(s.file('bad.md', BAD_KO));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /\[KSTE\]/);
  assert.match(r.stderr, /K2\.6/);
  assert.match(r.stderr, /지적된 줄만/);
});

test('깨끗한 한국어 파일: 종료 0, 출력 없음', () => {
  const s = sandbox();
  const r = s.hook(s.file('ok.md', '# 안내\n\n전원을 켜세요.\n'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

test('영어 문서: 한국어 비율 검사로 제외, 종료 0', () => {
  const s = sandbox();
  const r = s.hook(s.file('en.md', '# Guide\n\nSettings are saved when you press the Save button. Do not close the window.\n'));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('영어가 대부분인 문서에 한국어 위반 한 줄: 제외', () => {
  const s = sandbox();
  const en = 'This guide explains how to install the package and configure the service. '.repeat(10);
  const r = s.hook(s.file('mixed.md', `# Guide\n\n${en}\n\n저장되어집니다.\n`));
  assert.equal(r.status, 0);
});

test('.md 가 아닌 파일, 다른 도구: 종료 0', () => {
  const s = sandbox();
  assert.equal(s.hook(s.file('bad.txt', BAD_KO)).status, 0);
  assert.equal(s.hook(s.file('bad2.md', BAD_KO), 'Read').status, 0);
});

test('코드 블록 안의 한국어 위반은 검사하지 않는다', () => {
  const s = sandbox();
  const r = s.hook(s.file('code.md', '# 예\n\n전원을 켜세요.\n\n```\n저장되어집니다.\n```\n'));
  assert.equal(r.status, 0, r.stderr);
});

test('off 상태: 즉시 종료 0, on 으로 되돌리면 다시 종료 2', () => {
  const s = sandbox();
  const f = s.file('bad.md', BAD_KO);
  assert.equal(s.set('off').status, 0);
  assert.equal(JSON.parse(readFileSync(path.join(s.stateDir, 'state.json'), 'utf8')).enabled, false);
  assert.equal(s.hook(f).status, 0);
  s.set('on');
  assert.equal(s.hook(f).status, 2);
});

test('같은 파일 3회 수정 요청 후 4번째는 종료 0 과 남은 위반 메시지', () => {
  const s = sandbox();
  const f = s.file('bad.md', BAD_KO);
  assert.equal(s.hook(f).status, 2);
  assert.equal(s.hook(f).status, 2);
  assert.equal(s.hook(f).status, 2);
  const r = s.hook(f);
  assert.equal(r.status, 0);
  const msg = JSON.parse(r.stdout).systemMessage;
  assert.match(msg, /KSTE: 3회 수정 후 남은 위반 1건/);
  // 포기 후에는 횟수를 새로 센다
  assert.equal(s.hook(f).status, 2);
});

test('고치면 재시도 횟수가 초기화된다', () => {
  const s = sandbox();
  const f = s.file('bad.md', BAD_KO);
  s.hook(f);
  s.hook(f);
  writeFileSync(f, '# 안내\n\n설정을 저장합니다.\n');
  assert.equal(s.hook(f).status, 0);
  writeFileSync(f, BAD_KO);
  for (let i = 0; i < 3; i++) assert.equal(s.hook(f).status, 2, `회차 ${i + 1}`);
});

test('warn 만 있으면 종료 0 이고 stdout JSON systemMessage 로 알린다', () => {
  const s = sandbox();
  const r = s.hook(s.file('warn.md', '# 안내\n\n품질에 있어서 최고입니다.\n'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(JSON.parse(r.stdout).systemMessage, /KSTE: .*경고 1건/);
});

test('strict 모드는 K3.3 세미콜론 warn 을 오류로 올린다', () => {
  const s = sandbox();
  const semi = s.file('semi.md', '# 안내\n\n먼저 전원을 켭니다; 그다음 설정을 확인합니다.\n');
  assert.equal(s.hook(semi).status, 0); // 80%: 경고
  s.set('strict');
  const r = s.hook(semi);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /K3\.3/);
});

test('set: 잘못된 인자는 종료 1, status 는 상태 한 줄', () => {
  const s = sandbox();
  assert.equal(s.set('bogus').status, 1);
  const r = s.set('status');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /KSTE hook: on · 모드 80% · T1 off/);
  assert.match(s.set('strict').stdout, /모드 strict/);
  assert.match(s.set('t1', 'on').stdout, /T1 on/);
});

test('깨진 stdin 은 종료 0', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});

test('plugin 매니페스트와 hooks.json 형식', () => {
  const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
  assert.equal(read('.claude-plugin/plugin.json').name, 'kste');
  const mp = read('.claude-plugin/marketplace.json');
  assert.equal(mp.name, 'kste');
  assert.equal(mp.plugins[0].name, 'kste');
  const h = read('hooks/hooks.json').hooks.PostToolUse[0];
  assert.match(h.matcher, /Write/);
  assert.match(h.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/kste-hook\.mjs/);
});

test('SKILL.md 본문은 2,000자 안쪽이고 규칙 사본은 원본과 같다', () => {
  const skill = readFileSync(path.join(ROOT, 'skills/kste/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\r?\n/, '');
  assert.ok(skill.length <= 2000, `본문 ${skill.length}자`);
  assert.equal(readFileSync(path.join(ROOT, 'skills/kste/references/rules.md'), 'utf8'), readFileSync(path.join(ROOT, 'docs/KSTE-규칙.md'), 'utf8'));
});
