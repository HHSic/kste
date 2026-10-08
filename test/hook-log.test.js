import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run as chat } from '../integrations/shared/chat-hook.mjs';
import { run as dispatch } from '../integrations/codex/hooks/kste-run-hook.mjs';
import { run as cursor } from '../integrations/cursor/hooks/kste-cursor-hook.mjs';
import { setState, statePath } from '../integrations/shared/state.mjs';
import { callTool } from '../integrations/shared/kste-mcp.mjs';
import { hookLogPath, readHookLogs, withHookLog, hookDecision } from '../integrations/shared/hook-log.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kste-trace-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
const ends = (cwd) => readHookLogs(cwd, 1000).entries.filter((e) => e.phase === 'end');

test('Stop: exit 0 + block을 실제 수정 요청으로 기록하고 재개·off는 구분한다', (t) => {
  const cwd = fixture(t);
  const input = { cwd, hook_event_name: 'Stop', last_assistant_message: '파일이 저장되어집니다. PRIVATE_BODY' };
  assert.equal(chat(input).decision, 'block');
  chat({ ...input, stop_hook_active: true });
  setState(['off'], cwd);
  chat(input);
  const log = ends(cwd);
  assert.equal(log[0].reason, 'answer_retry');
  assert.equal(log[0].exit_code, 0);
  assert.equal(log[0].effect, 'turn_retry_requested');
  assert.equal(log[0].kste_intervened, true);
  assert.equal(log[0].errors, 1);
  assert.ok(log[0].rule_ids.includes('K2.6-001'));
  assert.equal(log[1].reason, 'retry_limit');
  assert.equal(log[1].kste_intervened, false);
  assert.equal(log[2].reason, 'disabled');
  assert.equal(log[2].effect, 'none');
  const raw = readFileSync(hookLogPath(cwd), 'utf8');
  assert.doesNotMatch(raw, /PRIVATE_BODY|저장되어집니다|last_assistant_message|prompt/);
  const grouped = readHookLogs(cwd).entries.filter((e) => e.run_id === log[0].run_id);
  assert.equal(grouped[0].phase, 'start');
  assert.equal(grouped.at(-1).phase, 'end');
  assert.ok(grouped.some((e) => e.phase === 'decision' && e.reason === 'answer_retry'));
});

test('PostToolUse: 여러 파일 중 오류가 있으면 exit 2 피드백을 기록한다', async (t) => {
  const cwd = fixture(t);
  setState(['t1', 'off'], cwd);
  writeFileSync(path.join(cwd, 'bad.md'), '파일이 저장되어집니다. PRIVATE_DOCUMENT\n');
  writeFileSync(path.join(cwd, 'good.md'), '파일을 저장합니다.\n');
  const out = await dispatch({ cwd, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: '*** Update File: bad.md\n*** Update File: good.md' }, 'file');
  assert.equal(out.code, 2);
  const [end] = ends(cwd);
  assert.equal(end.exit_code, 2);
  assert.equal(end.reason, 'file_feedback');
  assert.equal(end.effect, 'tool_result_feedback');
  assert.equal(end.host, 'codex');
  assert.equal(end.kste_intervened, true);
  const records = readHookLogs(cwd).entries;
  assert.equal(records.filter((e) => e.phase === 'start').length, 1, '하위 공통 hook은 별도 실행처럼 기록하지 않는다');
  assert.ok(records.some((e) => e.reason === 'file_feedback' && e.errors === 1 && e.rule_ids.includes('K2.6-001')));
  assert.doesNotMatch(readFileSync(hookLogPath(cwd), 'utf8'), /PRIVATE_DOCUMENT|저장되어집니다|Update File/);
});

test('import 오류: 단계와 오류 종류만 기록하고 예외 메시지 속 본문을 저장하지 않는다', async (t) => {
  const cwd = fixture(t);
  await assert.rejects(dispatch({ cwd, hook_event_name: 'Stop', prompt: 'PRIVATE_PROMPT' }, 'chat', () => { throw new SyntaxError('PRIVATE_ERROR_BODY'); }), /PRIVATE_ERROR_BODY/);
  const [end] = ends(cwd);
  assert.equal(end.reason, 'runtime_error');
  assert.equal(end.stage, 'module_load');
  assert.equal(end.error_type, 'SyntaxError');
  assert.equal(end.fail_open, true);
  assert.equal(end.kste_intervened, false);
  assert.doesNotMatch(readFileSync(hookLogPath(cwd), 'utf8'), /PRIVATE_/);
});

test('깨진 JSON: 실제 실행기가 종료 0을 유지하고 parser 입력을 저장하지 않는다', (t) => {
  const cwd = fixture(t);
  const run = spawnSync(process.execPath, [path.join(ROOT, 'integrations/codex/hooks/kste-run-hook.mjs'), 'chat'], {
    cwd, encoding: 'utf8', input: '{"PRIVATE_JSON_SECRET":oops}', env: { ...process.env, KSTE_STATE_DIR: path.join(cwd, '.kste'), PLUGIN_DATA: path.join(cwd, 'plugin-data') },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(JSON.parse(run.stdout).systemMessage, /실행되지 않았습니다/);
  const [end] = ends(cwd);
  assert.equal(end.stage, 'input_parse');
  assert.equal(end.reason, 'runtime_error');
  assert.doesNotMatch(readFileSync(hookLogPath(cwd), 'utf8'), /PRIVATE_JSON_SECRET/);
  assert.doesNotMatch(readFileSync(path.join(cwd, 'plugin-data/hook-errors.log'), 'utf8'), /PRIVATE_JSON_SECRET/);
});

test('Cursor: 검사 시점에는 개입 없음, stop 후속 요청에서만 개입으로 기록한다', async (t) => {
  const cwd = fixture(t);
  const input = { cwd, conversation_id: 'PRIVATE_SESSION', generation_id: 'PRIVATE_TURN' };
  await cursor({ ...input, hook_event_name: 'afterAgentResponse', text: '파일이 저장되어집니다.' });
  await cursor({ ...input, hook_event_name: 'stop', status: 'completed' });
  const log = ends(cwd);
  assert.equal(log[0].host, 'cursor');
  assert.equal(log[0].event, 'afterAgentResponse');
  assert.equal(log[0].kste_intervened, false);
  assert.equal(log[1].reason, 'cursor_followup');
  assert.equal(log[1].effect, 'turn_retry_requested');
  assert.doesNotMatch(readFileSync(hookLogPath(cwd), 'utf8'), /PRIVATE_/);
});

test('동시 hook 실행은 각 프로젝트·run ID와 판정을 유지한다', async (t) => {
  const a = fixture(t), b = fixture(t);
  await Promise.all([
    withHookLog({ cwd: a, hook_event_name: 'Stop' }, {}, async () => { await new Promise((r) => setTimeout(r, 15)); hookDecision('clean'); return null; }),
    withHookLog({ cwd: b, hook_event_name: 'Stop' }, {}, async () => { hookDecision('answer_retry'); return { decision: 'block' }; }),
  ]);
  assert.equal(ends(a)[0].reason, 'clean');
  assert.equal(ends(b)[0].reason, 'answer_retry');
  assert.notEqual(ends(a)[0].run_id, ends(b)[0].run_id);
});

test('프로세스 강제 종료: start 기록은 남지만 end를 성공으로 기록하지 않는다', (t) => {
  const cwd = fixture(t);
  const module = new URL('../integrations/shared/hook-log.mjs', import.meta.url).href;
  const script = `import { withHookLog, hookPhase } from ${JSON.stringify(module)}; withHookLog({cwd:process.cwd(),hook_event_name:'Stop'}, {}, () => { hookPhase('answer_lint'); process.exit(1); });`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.deepEqual(readHookLogs(cwd).entries.map((e) => e.phase), ['start', 'progress']);
});

test('로그 회전·Git 루트·읽기 전용 logs 조회를 CLI와 MCP에서 지원한다', async (t) => {
  const cwd = fixture(t);
  mkdirSync(path.join(cwd, '.git'));
  writeFileSync(path.join(cwd, '.git/HEAD'), 'ref: refs/heads/main');
  mkdirSync(path.join(cwd, 'docs'));
  mkdirSync(path.join(cwd, '.kste'));
  const file = hookLogPath(cwd);
  writeFileSync(file, ' '.repeat(1024 * 1024 + 1));
  chat({ cwd: path.join(cwd, 'docs'), hook_event_name: 'Stop', last_assistant_message: '파일을 저장합니다.' });
  assert.equal(hookLogPath(path.join(cwd, 'docs')), file);
  assert.ok(existsSync(file + '.1'));
  assert.ok(readHookLogs(cwd).entries.some((e) => e.reason === 'clean'));
  const before = readFileSync(statePath(cwd), 'utf8');
  assert.match(setState(['logs'], cwd).text, /KSTE 수정 요청 없음/);
  const reply = await callTool('kste_state', { cwd, args: ['logs'] });
  assert.match(reply.content[0].text, /hook-events.jsonl/);
  assert.equal(readFileSync(statePath(cwd), 'utf8'), before);
  const run = spawnSync(process.execPath, [path.join(ROOT, 'bin/kste.js'), 'logs', '--cwd', cwd, '--limit', '1', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).entries.length, 1);
  assert.throws(() => readHookLogs(cwd, -1), /--limit/);
});

test('로그를 쓸 수 없어도 파일 검사 피드백 종료 코드를 바꾸지 않는다', (t) => {
  const cwd = fixture(t);
  const blocked = path.join(cwd, 'not-a-directory');
  writeFileSync(blocked, '');
  const module = new URL('../integrations/shared/hook-log.mjs', import.meta.url).href;
  const script = `import {withHookLog,hookDecision} from ${JSON.stringify(module)}; const out=withHookLog({cwd:process.cwd(),hook_event_name:'PostToolUse'},{kind:'file'},()=>{hookDecision('file_feedback');return {code:2};});process.exitCode=out.code;`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', env: { ...process.env, KSTE_LOG_DIR: blocked, PLUGIN_DATA: blocked } });
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.stderr, '');
});
