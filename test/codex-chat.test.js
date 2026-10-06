import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run as chat, controlArgs } from '../integrations/codex/hooks/kste-chat-hook.mjs';
import { run as fileHook } from '../integrations/codex/hooks/kste-codex-hook.mjs';
import { callTool } from '../integrations/codex/mcp/kste-mcp.mjs';
import { loadState, setState, statePath } from '../integrations/codex/state.mjs';
import { install } from '../integrations/codex/install.mjs';
import { resolveT1Mode, closeT1 } from '../lib/t1/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'kste-codex-chat-'));
const stop = (cwd, text, continued = false) => chat({ cwd, hook_event_name: 'Stop', last_assistant_message: text, stop_hook_active: continued });
const context = (cwd, prompt) => chat({ cwd, hook_event_name: 'UserPromptSubmit', prompt }).hookSpecificOutput.additionalContext;

test('채팅: 기본 on, 오류 답변 수정 요청, 재개한 턴에서는 루프를 막는다', () => {
  const cwd = tmp();
  assert.match(context(cwd, '설치 방법을 알려 주세요.'), /KSTE 현재 설정: on, 모드 default/);
  assert.equal(loadState(cwd).t1, true, '새 프로젝트는 Kiwi 검사를 켜고 시작한다');
  assert.match(context(cwd, '설치 방법을 알려 주세요.'), /한국어로 답할 때 적용/);
  const first = stop(cwd, '파일이 저장되어집니다.');
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /K2\.6-001/);
  assert.match(first.reason, /파일을 수정하거나 추가 작업을 하지 마세요/);
  assert.match(context(cwd, '/kste last'), /```text/);
  assert.equal(stop(cwd, '```text\n' + setState(['last'], cwd).text + '\n```'), null, '검사 예문을 재검사하지 않는다');
  const second = stop(cwd, '파일이 저장되어집니다.', true);
  assert.equal(second.decision, undefined);
  assert.match(second.systemMessage, /자동 수정 후 오류/);
  assert.equal(stop(cwd, '파일이 저장됩니다.', true), null);
  assert.match(setState(['last'], cwd).text, /지적 없음/);
  assert.equal(stop(cwd, '파일이 저장되어집니다.').decision, 'block', '다음 사용자 턴은 다시 검사한다');
});

test('세션: 별도 호출 없이 스킬 본문을 적용하고 off는 자동 활성화하지 않는다', () => {
  const cwd = tmp();
  const start = () => chat({ cwd, hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(start(), /스킬을 이 세션에 자동 적용/);
  assert.match(start(), /## 통제 동사 17/);
  assert.doesNotMatch(start(), /^name: kste$/m, 'frontmatter를 작문 지시로 넣지 않는다');
  setState(['off'], cwd);
  assert.doesNotMatch(start(), /## 통제 동사 17/);
  assert.match(start(), /현재 설정: off/);
  assert.match(context(cwd, '/kste on'), /## 통제 동사 17/, 'off로 시작한 세션도 on 명령으로 스킬을 적용한다');
});

test('채팅: on/off/default/strict가 즉시 적용되며 80 별칭과 예시 텍스트를 처리한다', () => {
  const cwd = tmp();
  assert.match(context(cwd, '/kste off'), /명령은 hook에서 처리/);
  assert.equal(loadState(cwd).enabled, false);
  assert.equal(stop(cwd, '파일이 저장되어집니다.'), null);
  assert.match(context(cwd, '다음은 사용 예시입니다: /kste on'), /현재 설정: off/);
  assert.equal(controlArgs('/kste on\n다른 요청'), null);
  assert.equal(controlArgs('$kste check README.md'), null);
  // 문서 작업 인자는 상태 명령이 아니므로 사용법 오류로 처리하지 않는다.
  context(cwd, '$kste on');
  assert.equal(loadState(cwd).enabled, true);
  const warning = '파일을 저장하세요; 화면을 닫으세요.';
  assert.equal(stop(cwd, warning), null);
  context(cwd, '/kste strict');
  assert.equal(stop(cwd, warning).decision, 'block');
  setState(['t1', 'off'], cwd);
  setState(['off'], cwd);
  context(cwd, '/kste default');
  assert.equal(loadState(cwd).enabled, true, 'default는 KSTE를 함께 켠다');
  assert.equal(loadState(cwd).t1, true, 'default는 꺼 둔 Kiwi 검사도 켠다');
  assert.equal(stop(cwd, warning), null);
  setState(['t1', 'off'], cwd);
  context(cwd, '/kste strict');
  assert.equal(loadState(cwd).t1, false, '명시적인 t1 off는 strict 전환에도 유지한다');
  context(cwd, '/kste 80');
  assert.equal(loadState(cwd).mode, '80');
  assert.equal(loadState(cwd).t1, true, '80 별칭도 default와 같이 T1을 켠다');
  assert.match(context(cwd, '/kste t1 status'), /Kiwi 형태소 분석/);
  assert.equal(loadState(cwd).t1, true, '상태 조회는 설정을 바꾸지 않는다');
  context(cwd, '/kste off extra');
  assert.equal(loadState(cwd).enabled, true, '잘못된 인자는 기존 상태를 보존한다');
});

test('채팅: 영문·코드·누락된 답변은 건너뛰며 Stop 출력은 JSON이다', () => {
  const cwd = tmp();
  for (const text of ['The file was saved.', '```text\n저장되어집니다.\n```', null]) assert.equal(stop(cwd, text), null);
  const script = path.join(ROOT, 'integrations/codex/hooks/kste-chat-hook.mjs');
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd, hook_event_name: 'Stop', last_assistant_message: '파일이 저장되어집니다.' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).decision, 'block');
  assert.equal(spawnSync(process.execPath, [script], { input: '{}', encoding: 'utf8' }).stdout, '');
});

test('상태: Git 하위 디렉터리에서 MCP·CLI·답변 hook이 같은 설정을 읽는다', async () => {
  const cwd = tmp();
  mkdirSync(path.join(cwd, '.git'));
  writeFileSync(path.join(cwd, '.git/HEAD'), 'ref: refs/heads/main\n');
  const nested = path.join(cwd, 'docs');
  mkdirSync(nested);
  setState(['strict'], cwd);
  const existing = loadState(cwd);
  writeFileSync(statePath(cwd), JSON.stringify({ ...existing, retries: { 'a.md': { count: 2 } }, custom: 'preserve' }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/kste.js'), 'set', 'off'], { cwd: nested, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statePath(nested), statePath(cwd));
  assert.equal(loadState(cwd).enabled, false);
  assert.equal(loadState(cwd).custom, 'preserve');
  assert.equal(loadState(cwd).retries['a.md'].count, 2);
  assert.ok(!existsSync(path.join(nested, '.kste')));
  const result = await callTool('kste_state', { cwd: nested, args: ['on'] });
  assert.equal(JSON.parse(result.content[1].text).enabled, true);
  assert.equal(stop(nested, '파일을 저장하세요; 화면을 닫으세요.').decision, 'block');
});

test('MCP: 상태 전환과 strict 검사, 명시적 검사는 off에서도 동작한다', async () => {
  const cwd = tmp();
  let r = await callTool('kste_state', { cwd, args: ['strict'] });
  assert.match(r.content[0].text, /모드 strict/);
  r = await callTool('kste_check', { cwd, text: '파일을 저장하세요; 화면을 닫으세요.', t1: 'off' });
  assert.ok(JSON.parse(r.content[1].text).summary.error > 0);
  assert.equal(JSON.parse(r.content[1].text).summary.mode, 'strict');
  r = await callTool('kste_state', { cwd, args: ['default'] });
  assert.equal(JSON.parse(r.content[1].text).mode, 'default');
  assert.equal(JSON.parse(r.content[1].text).t1, true);
  r = await callTool('kste_check', { cwd, text: '파일을 저장하세요; 화면을 닫으세요.', t1: 'off' });
  assert.equal(JSON.parse(r.content[1].text).summary.mode, 'default');
  assert.equal(JSON.parse(r.content[1].text).summary.error, 0);
  await callTool('kste_state', { cwd, args: ['off'] });
  assert.equal(stop(cwd, '파일이 저장되어집니다.'), null);
  r = await callTool('kste_check', { cwd, text: '파일이 저장되어집니다.', t1: 'off' });
  assert.ok(JSON.parse(r.content[1].text).summary.error > 0);
  await assert.rejects(callTool('kste_state', { cwd, args: ['off', 'extra'] }), /사용:/);
});

test('MCP: default의 Kiwi 설정을 실제 검사에 적용하고 명시적인 off는 우선한다', async (t) => {
  t.after(closeT1);
  const cwd = tmp();
  setState(['t1', 'off'], cwd);
  await callTool('kste_state', { cwd, args: ['default'] });
  const request = { cwd, text: '파일이 저장됩니다.' };
  if (resolveT1Mode('on').use) {
    const r = await callTool('kste_check', request);
    assert.equal(JSON.parse(r.content[1].text).summary.t1, true, '인자를 생략하면 default의 T1 on을 따른다');
  } else {
    await assert.rejects(callTool('kste_check', request), /Kiwi 모델 또는 kiwi-nlp/, '설정만 켜진 것을 엔진 설치로 표시하지 않는다');
  }
  const r = await callTool('kste_check', { ...request, t1: 'off' });
  assert.equal(JSON.parse(r.content[1].text).summary.t1, false);
});

test('파일 hook: 문자열 패치 입력과 상태 off를 처리한다', async () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, 'a.md'), '파일이 저장되어집니다.');
  const input = { cwd, tool_input: '*** Begin Patch\n*** Update File: a.md\n*** End Patch' };
  assert.equal((await fileHook(input)).code, 2);
  setState(['off'], cwd);
  assert.equal((await fileHook(input)).code, 0);
});

test('설치: hooks는 기본 포함, --no-hooks 재설치와 제거는 다른 설정을 보존한다', () => {
  const home = tmp();
  const cfg = path.join(home, '.codex/config.toml');
  install({ home });
  assert.match(readFileSync(cfg, 'utf8'), /\[\[hooks\.Stop\]\]/);
  writeFileSync(cfg, readFileSync(cfg, 'utf8') + '\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "other-check"\n');
  install({ home, withHooks: false });
  assert.doesNotMatch(readFileSync(cfg, 'utf8'), /kste:hooks:begin/);
  assert.match(readFileSync(cfg, 'utf8'), /other-check/);
  install({ home });
  assert.equal(readFileSync(cfg, 'utf8').split('kste:hooks:begin').length, 2);
  install({ home, uninstall: true });
  assert.match(readFileSync(cfg, 'utf8'), /other-check/);
  assert.ok(!existsSync(path.join(home, '.codex/prompts/kste.md')));
});
