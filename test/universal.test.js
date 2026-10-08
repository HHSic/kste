import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run as cursor } from '../integrations/cursor/hooks/kste-cursor-hook.mjs';
import { run as claude } from '../integrations/claude/session-hook.mjs';
import { run as codex } from '../integrations/codex/hooks/kste-chat-hook.mjs';
import { loadState, saveState, setState, statePath } from '../integrations/shared/state.mjs';
import { loadState as claudeState, setCommand } from '../hooks/kste-hook.mjs';
import { callTool } from '../integrations/shared/kste-mcp.mjs';
import { install } from '../integrations/cursor/install.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sandbox = () => mkdtempSync(path.join(tmpdir(), 'kste-universal-'));
const input = (cwd, event, fields = {}) => ({ workspace_roots: [cwd], hook_event_name: event, conversation_id: 'session-1', generation_id: 'turn-1', ...fields });

test('세 도구: Git 하위 폴더에서도 default/off/T1 설정과 추가 상태를 공유한다', async () => {
  const root = sandbox();
  mkdirSync(path.join(root, '.git'));
  writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const child = path.join(root, 'docs');
  mkdirSync(child);
  assert.equal(loadState(child).t1, true);
  saveState(root, { enabled: false, t1: false, custom: 'keep', retries: { x: { count: 1 } } });
  assert.equal(claudeState(child).enabled, false);
  assert.equal(statePath(child), statePath(root));
  assert.equal(setCommand(['default'], child).ok, true);
  assert.equal(loadState(root).enabled, true);
  assert.equal(loadState(root).t1, true);
  assert.equal(loadState(root).custom, 'keep');
  await callTool('kste_state', { cwd: child, args: ['off'] });
  assert.match(codex({ cwd: root, hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext, /현재 설정: off/);
  const out = await cursor(input(child, 'sessionStart'), { installed: () => true });
  assert.match(out.additional_context, /현재 설정: off/);
  assert.doesNotMatch(out.additional_context, /## 통제 동사/);
});

test('Claude·Cursor: 새 세션에서 자동 스킬 적용과 Kiwi 준비, 실패와 명시적 off 처리', async () => {
  for (const run of [claude, cursor]) {
    const cwd = sandbox();
    let prepared = 0;
    const event = run === cursor ? 'sessionStart' : 'SessionStart';
    const out = await run(input(cwd, event, { cwd }), { installed: () => false, prepare: async () => { prepared++; } });
    const context = out.additional_context || out.hookSpecificOutput.additionalContext;
    assert.equal(prepared, 1);
    assert.match(context, /## 통제 동사 17/);
    setState(['off'], cwd);
    await run(input(cwd, event, { cwd }), { installed: () => false, prepare: async () => { prepared++; } });
    assert.equal(prepared, 1);
    setState(['default'], cwd);
    const failed = await run(input(cwd, event, { cwd }), { installed: () => false, prepare: async () => { throw new Error('network unavailable'); } });
    assert.match(failed.additional_context || failed.systemMessage, /준비.*실패|network unavailable/);
  }
});

test('Cursor: 답변 검사 → stop 후속 수정 1회, 재개·중단·off에서는 수정하지 않는다', async () => {
  const cwd = sandbox();
  await cursor(input(cwd, 'afterAgentResponse', { text: '파일이 저장되어집니다.' }));
  assert.match(setState(['last'], cwd).text, /K2\.6-001/);
  const first = await cursor(input(cwd, 'stop', { status: 'completed', loop_count: 0 }));
  assert.match(first.followup_message, /K2\.6-001/);
  await cursor(input(cwd, 'afterAgentResponse', { text: '파일이 저장되어집니다.' }));
  assert.deepEqual(await cursor(input(cwd, 'stop', { status: 'completed', loop_count: 1 })), {});
  await cursor(input(cwd, 'afterAgentResponse', { text: '파일이 저장되어집니다.' }));
  assert.deepEqual(await cursor(input(cwd, 'stop', { status: 'aborted' })), {});
  await cursor(input(cwd, 'afterAgentResponse', { text: '파일이 저장되어집니다.' }));
  setState(['off'], cwd);
  assert.deepEqual(await cursor(input(cwd, 'stop', { status: 'completed' })), {});
});

test('Cursor: 파일 오류 피드백, 같은 턴에서 교정한 파일 제거, 세션·턴 격리', async () => {
  const cwd = sandbox();
  setState(['t1', 'off'], cwd);
  const file = path.join(cwd, 'manual.md');
  writeFileSync(file, '파일이 저장되어집니다.\n');
  await cursor(input(cwd, 'afterFileEdit', { file_path: file }));
  assert.deepEqual(await cursor(input(cwd, 'stop', { conversation_id: 'session-2', status: 'completed' })), {});
  assert.match((await cursor(input(cwd, 'stop', { status: 'completed' }))).followup_message, /manual\.md.*error 1/);
  await cursor(input(cwd, 'afterFileEdit', { file_path: file }));
  writeFileSync(file, '파일을 저장합니다.\n');
  await cursor(input(cwd, 'afterFileEdit', { file_path: file }));
  assert.deepEqual(await cursor(input(cwd, 'stop', { status: 'completed' })), {});
  await cursor(input(cwd, 'afterAgentResponse', { text: '파일이 저장되어집니다.' }));
  assert.deepEqual(await cursor(input(cwd, 'stop', { generation_id: 'turn-2', status: 'completed' })), {});
  await cursor(input(cwd, 'afterAgentResponse', { text: '파일이 저장되어집니다.' }));
  assert.deepEqual(await cursor(input(cwd, 'beforeSubmitPrompt', { prompt: '다음 요청' })), { continue: true });
  assert.deepEqual(await cursor(input(cwd, 'stop', { status: 'completed' })), {});
});

test('Cursor: native JSON stdin 왕복과 설치된 복사본의 공통 MCP 실행', () => {
  const cwd = sandbox();
  const script = path.join(ROOT, 'integrations/cursor/hooks/kste-cursor-hook.mjs');
  const out = spawnSync(process.execPath, [script], { input: JSON.stringify(input(cwd, 'afterAgentResponse', { text: '파일이 저장되어집니다.' })), encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), {});
  const stop = spawnSync(process.execPath, [script], { input: JSON.stringify(input(cwd, 'stop', { status: 'completed' })), encoding: 'utf8' });
  assert.match(JSON.parse(stop.stdout).followup_message, /K2\.6-001/);
  const home = sandbox();
  install({ home, dryRun: true });
  assert.deepEqual(readdirSync(home), []);
  install({ home });
  const local = path.join(home, '.cursor/plugins/local/kste');
  const manifest = JSON.parse(readFileSync(path.join(local, '.cursor-plugin/plugin.json')));
  const mcp = manifest.mcpServers.kste.args[0].replace('${CURSOR_PLUGIN_ROOT}', local);
  const result = spawnSync(process.execPath, [mcp], { input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'kste_check', arguments: { text: '파일이 저장되어집니다.', t1: 'off' } } }) + '\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).result.content[0].text, /K2\.6-001/);
  writeFileSync(path.join(local, 'package.json'), 'old copy');
  assert.match(install({ home }).join('\n'), /백업/);
  assert.doesNotThrow(() => JSON.parse(readFileSync(path.join(local, 'package.json'))));
  install({ home, uninstall: true });
  assert.equal(existsSync(local), false);
});
