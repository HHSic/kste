import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, symlinkSync, cpSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run } from '../integrations/codex/hooks/kste-plugin-hook.mjs';
import { run as dispatch, failure } from '../integrations/codex/hooks/kste-run-hook.mjs';
import { saveState } from '../integrations/codex/state.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const POWERSHELL = process.env.KSTE_PWSH_PATH || (process.platform === 'win32' ? 'powershell.exe' : null);
const fixture = (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kste-plugin-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
};

test('Codex 플러그인: marketplace·스킬·MCP·hooks 경로가 패키지 안에서 연결된다', () => {
  const json = (file) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
  const manifest = json('.codex-plugin/plugin.json');
  const marketplace = json('.agents/plugins/marketplace.json');
  assert.equal(manifest.name, marketplace.plugins[0].name);
  assert.equal(manifest.version, json('package.json').version);
  assert.equal(marketplace.plugins[0].source.path, './');
  assert.ok(existsSync(path.join(ROOT, manifest.skills, 'kste/SKILL.md')));
  assert.ok(existsSync(path.join(ROOT, manifest.mcpServers.kste.args[0])));
  assert.equal(manifest.mcpServers.kste.cwd, './', 'MCP 상대 경로는 설치된 플러그인 루트 기준');
  const hooks = json(manifest.hooks).hooks;
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'Stop', 'PostToolUse']);
  for (const group of Object.values(hooks)) {
    const file = group[0].hooks[0].command.match(/\$\{PLUGIN_ROOT\}\/([^"\n]+)/)[1];
    assert.ok(existsSync(path.join(ROOT, file)));
    const windowsFile = group[0].hooks[0].commandWindows.match(/\$\{PLUGIN_ROOT\}\/([^"\n]+)/)[1];
    assert.ok(existsSync(path.join(ROOT, windowsFile)));
  }
  assert.ok(json('package.json').files.includes('.codex-plugin'));
});

test('hook 실행기: 초기 import 오류를 기록하며 입력 본문은 로그에 남기지 않는다', async (t) => {
  const cwd = fixture(t);
  const input = { hook_event_name: 'SessionStart', prompt: 'private-input' };
  const importFailure = () => { throw new Error('missing hook dependency'); };
  await assert.rejects(dispatch(input, 'session', importFailure), /missing hook dependency/);
  const report = failure(new Error('missing hook dependency'), { PLUGIN_DATA: cwd });
  assert.equal(report.code, 0);
  assert.match(JSON.parse(report.stdout).systemMessage, /실행되지 않았습니다/);
  const log = readFileSync(path.join(cwd, 'hook-errors.log'), 'utf8');
  assert.match(log, /missing hook dependency/);
  assert.doesNotMatch(log, /private-input/);
  const blocked = await dispatch(input, 'file', async () => ({ run: async () => ({ code: 2, stderr: 'rule feedback' }) }));
  assert.equal(blocked.code, 2, '규칙 위반 피드백은 실행 오류와 구분한다');
});

test('POSIX 실행기: GUI PATH에 Node가 없어도 nvm 설치 경로와 공백을 처리한다', { skip: process.platform === 'win32' }, (t) => {
  const cwd = fixture(t);
  const home = path.join(cwd, 'user home');
  const nodeDir = path.join(home, '.nvm/versions/node/v24-test/bin');
  mkdirSync(nodeDir, { recursive: true });
  symlinkSync(process.execPath, path.join(nodeDir, 'node'));
  const root = path.join(cwd, 'plugin with spaces');
  cpSync(path.join(ROOT, 'integrations/codex/hooks'), path.join(root, 'integrations/codex/hooks'), { recursive: true });
  // 탐색 순서에 시스템 Node가 없는 환경에서도 nvm 후보를 검증한다.
  const script = path.join(root, 'integrations/codex/hooks/kste-launch.sh');
  const original = readFileSync(script, 'utf8');
  writeFileSync(script, original.replace('/opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node /opt/local/bin/node', ''));
  const bin = path.join(cwd, 'minimal-bin');
  mkdirSync(bin);
  const dirname = spawnSync('/bin/sh', ['-c', 'command -v dirname'], { encoding: 'utf8' }).stdout.trim();
  symlinkSync(dirname, path.join(bin, 'dirname'));
  const env = { ...process.env, HOME: home, PATH: bin, KSTE_NODE_PATH: '', PLUGIN_DATA: path.join(cwd, 'logs') };
  // 설치 내용 누락을 일부러 만들어 Node가 실행되고 import 진단까지 도달하는지 확인한다.
  const result = spawnSync('/bin/sh', [script, 'chat'], { env, encoding: 'utf8', input: '{}' });
  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse(result.stdout).systemMessage;
  assert.match(message, /Cannot find module/);
  assert.ok(existsSync(path.join(cwd, 'logs/hook-errors.log')));
});

test('POSIX 실행기: 명시적인 Node 경로로 한국어 hook JSON을 전달한다', { skip: process.platform === 'win32' }, (t) => {
  const cwd = fixture(t);
  const result = spawnSync('/bin/sh', [path.join(ROOT, 'integrations/codex/hooks/kste-launch.sh'), 'chat'], {
    env: { ...process.env, KSTE_NODE_PATH: process.execPath }, encoding: 'utf8',
    input: JSON.stringify({ cwd, hook_event_name: 'UserPromptSubmit', prompt: '/kste off' }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /현재 설정: off/);
});

function runPowerShell(cwd, script, kind, input) {
  const wrapper = path.join(cwd, 'legacy.ps1');
  const literal = script.replace(/'/g, "''");
  writeFileSync(wrapper, `$PSNativeCommandArgumentPassing = 'Legacy'\n& '${literal}' -Kind ${kind}\nexit $LASTEXITCODE\n`);
  return spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, KSTE_NODE_PATH: process.execPath, PLUGIN_DATA: path.join(cwd, 'logs'),
      XDG_CACHE_HOME: path.join(cwd, 'cache'), XDG_CONFIG_HOME: path.join(cwd, 'config'), XDG_DATA_HOME: path.join(cwd, 'data') },
  });
}

test('PowerShell legacy: Node를 발견하고 한국어 JSON을 왕복 전달한다', { skip: !POWERSHELL }, (t) => {
  const cwd = fixture(t);
  const result = runPowerShell(cwd, path.join(ROOT, 'integrations/codex/hooks/kste-launch.ps1'), 'chat', {
    cwd, hook_event_name: 'UserPromptSubmit', prompt: '/kste off', extra: '한글 입력',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /현재 설정: off/);
});

test('PowerShell legacy: 공백 경로·UTF-8 stdin과 큰 stderr의 종료 코드 2를 보존한다', { skip: !POWERSHELL }, (t) => {
  const cwd = fixture(t);
  const plugin = path.join(cwd, 'plugin with spaces');
  mkdirSync(plugin);
  const script = path.join(plugin, 'kste-launch.ps1');
  cpSync(path.join(ROOT, 'integrations/codex/hooks/kste-launch.ps1'), script);
  writeFileSync(path.join(plugin, 'kste-run-hook.mjs'), `import { readFileSync } from 'node:fs';\nconst input = JSON.parse(readFileSync(0, 'utf8'));\nprocess.stdout.write(JSON.stringify({ received: input.text }) + '\\n');\nprocess.stderr.write('KSTE 수정 지적: ' + 'x'.repeat(128 * 1024));\nprocess.exitCode = 2;\n`);
  const result = runPowerShell(cwd, script, 'file', { text: '한국어와 😀 입력' });
  assert.equal(result.status, 2, result.stderr.slice(0, 300));
  assert.equal(JSON.parse(result.stdout).received, '한국어와 😀 입력');
  assert.match(result.stderr, /^KSTE 수정 지적:/);
  assert.ok(result.stderr.length > 128 * 1024, '동시 읽기로 pipe 정체를 방지한다');
  assert.equal(existsSync(path.join(cwd, 'logs/hook-errors.log')), false, '규칙 지적을 실행 오류 로그에 저장하지 않는다');
});

test('PowerShell: Node 시작 전 실패도 단계·로그를 알리고 입력은 기록하지 않는다', { skip: !POWERSHELL }, (t) => {
  const cwd = fixture(t);
  const script = path.join(cwd, 'broken-launch.ps1');
  const source = readFileSync(path.join(ROOT, 'integrations/codex/hooks/kste-launch.ps1'), 'utf8');
  writeFileSync(script, source.replace("$stage = 'stdin'", "throw 'simulated initialization failure'\n    $stage = 'stdin'"));
  const result = runPowerShell(cwd, script, 'chat', { private: 'PRIVATE_BODY' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).systemMessage, /KSTE did not run \(encoding\).*simulated initialization failure.*Log:/);
  const log = readFileSync(path.join(cwd, 'logs/hook-errors.log'), 'utf8');
  assert.match(log, /stage=encoding kind=chat/);
  assert.doesNotMatch(log, /PRIVATE_BODY/);
});

test('PowerShell: Node의 예기치 않은 종료 코드 1을 실행 실패로 알린다', { skip: !POWERSHELL }, (t) => {
  const cwd = fixture(t);
  const script = path.join(cwd, 'kste-launch.ps1');
  cpSync(path.join(ROOT, 'integrations/codex/hooks/kste-launch.ps1'), script);
  writeFileSync(path.join(cwd, 'kste-run-hook.mjs'), 'process.exitCode = 1;\n');
  const result = runPowerShell(cwd, script, 'chat', {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).systemMessage, /node-exit.*exited with code 1/);
  assert.match(readFileSync(path.join(cwd, 'logs/hook-errors.log'), 'utf8'), /stage=node-exit/);
});

test('플러그인 첫 세션: 엔진이 없으면 준비하고 스킬 본문을 자동 적용한다', async (t) => {
  const cwd = fixture(t);
  let prepared = 0;
  const result = await run({ cwd, hook_event_name: 'SessionStart' }, {
    installed: () => false, prepare: async () => { prepared++; },
  });
  assert.equal(prepared, 1);
  assert.match(result.hookSpecificOutput.additionalContext, /## 통제 동사 17/);
  assert.match(result.systemMessage, /준비 완료/);
});

test('플러그인 준비: 기설치·off·t1 off·일반 프롬프트에서는 다운로드하지 않는다', async (t) => {
  const cwd = fixture(t);
  const fail = async () => { throw new Error('준비를 호출하면 안 된다'); };
  const active = await run({ cwd, hook_event_name: 'SessionStart' }, { installed: () => true, prepare: fail });
  assert.equal(active.systemMessage, undefined);
  for (const state of [{ enabled: false, t1: true }, { enabled: true, t1: false }]) {
    saveState(cwd, state);
    const result = await run({ cwd, hook_event_name: 'SessionStart' }, { installed: () => false, prepare: fail });
    assert.equal(result.systemMessage, undefined);
  }
  saveState(cwd, { enabled: true, t1: true });
  const result = await run({ cwd, hook_event_name: 'UserPromptSubmit', prompt: '문서를 작성해 주세요.' }, { installed: () => false, prepare: fail });
  assert.equal(result.systemMessage, undefined);
});

test('플러그인 준비 실패: 채팅 T0과 스킬 지침은 유지하고 실패를 알린다', async (t) => {
  const cwd = fixture(t);
  const result = await run({ cwd, hook_event_name: 'SessionStart' }, {
    installed: () => false, prepare: async () => { throw new Error('download failed'); },
  });
  assert.match(result.systemMessage, /download failed/);
  assert.match(result.hookSpecificOutput.additionalContext, /준비가 실패/);
  assert.match(result.hookSpecificOutput.additionalContext, /## 통제 동사 17/);
});

test('플러그인 상태 제어: default와 t1 on은 엔진 준비를 다시 시도한다', async (t) => {
  const cwd = fixture(t);
  let prepared = 0;
  for (const prompt of ['/kste default', '/kste 80', '/kste on', '$kste t1 on']) {
    saveState(cwd, { enabled: true, t1: true });
    const result = await run({ cwd, hook_event_name: 'UserPromptSubmit', prompt }, { installed: () => false, prepare: async () => { prepared++; } });
    assert.match(result.hookSpecificOutput.additionalContext, /최신 설치 상태/);
  }
  assert.equal(prepared, 4);
});
