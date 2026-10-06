import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchFiles } from '../integrations/codex/hooks/kste-codex-hook.mjs';
import { setup, parseArgs } from '../integrations/codex/install.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODEX = path.join(ROOT, 'integrations', 'codex');
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

function mcpSession(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(CODEX, 'mcp', 'kste-mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    child.stdin.end();
  });
}

test('MCP: initialize / tools/list / tools/call 왕복', async () => {
  const res = await mcpSession([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kste_check', arguments: { text: '파일이 저장되어집니다.\n', t1: 'off' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'kste_diff', arguments: { before: '전원을 10초 이상 누르지 마세요.', after: '전원을 누르세요.', t1: 'off' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'kste_rules', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'kste_check', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'nope' },
  ]);
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  assert.equal(res.length, 7, '알림에는 응답이 없다');
  assert.equal(by[1].result.protocolVersion, '2025-06-18');
  assert.ok(by[1].result.capabilities.tools);
  assert.deepEqual(by[2].result.tools.map((t) => t.name), ['kste_check', 'kste_diff', 'kste_rules', 'kste_state']);
  const check = by[3].result;
  assert.match(check.content[0].text, /K2\.6-001/);
  const json = JSON.parse(check.content[1].text);
  assert.ok(json.summary.error >= 1);
  assert.ok(json.findings.some((f) => f.ruleId === 'K2.6-001'));
  assert.match(by[4].result.content[0].text, /KSTE diff/);
  assert.ok(JSON.parse(by[4].result.content[1].text).findings.length >= 1, '부정어 삭제를 잡는다');
  assert.match(by[5].result.content[0].text, /로드된 규칙 \d+개/);
  assert.equal(by[6].result.isError, true);
  assert.equal(by[7].error.code, -32601);
});

test('MCP: path 로 파일 검사', async () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'kste-mcp-')), 'a.md');
  writeFileSync(f, '저장되어집니다.\n');
  const res = await mcpSession([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'kste_check', arguments: { path: f, t1: 'off' } } }]);
  assert.match(res[0].result.content[0].text, /K2\.6-001/);
});

test('install.mjs --dry-run: 파일을 만들지 않고 계획만 출력', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kste-home-'));
  const r = spawnSync(process.execPath, [path.join(CODEX, 'install.mjs'), '--dry-run', '--with-hooks', '--home', home], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] 기록: AGENTS\.md KSTE 절/);
  assert.match(r.stdout, /\[dry-run\] 기록: config\.toml MCP 서버/);
  assert.match(r.stdout, /\[dry-run\] 기록: config\.toml hook/);
  assert.match(r.stdout, /\.agents[\\/]skills[\\/]kste/);
  assert.deepEqual(readdirSync(home), [], 'dry-run 은 아무것도 쓰지 않는다');
});

test('install.mjs 설치·재설치·제거 (임시 home)', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kste-home-'));
  const run = (...a) => spawnSync(process.execPath, [path.join(CODEX, 'install.mjs'), '--home', home, '--no-t1', ...a], { encoding: 'utf8' });
  const agents = path.join(home, '.codex', 'AGENTS.md');
  const cfg = path.join(home, '.codex', 'config.toml');
  mkdirSync(path.join(home, '.codex'), { recursive: true });
  writeFileSync(agents, '# 내 지침\n');
  writeFileSync(cfg, 'model = "x"\n\n[mcp_servers.other]\ncommand = "y"\n');
  assert.equal(run('--with-hooks').status, 0);
  assert.match(readFileSync(agents, 'utf8'), /^# 내 지침\n[\s\S]*kste:begin[\s\S]*kste:end/);
  const c1 = readFileSync(cfg, 'utf8');
  assert.match(c1, /\[mcp_servers\.other\]/);
  assert.match(c1, /\[mcp_servers\.kste\]/);
  assert.match(c1, /\[\[hooks\.PostToolUse\]\]/);
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) assert.match(c1, new RegExp(`\\[\\[hooks\\.${event}\\]\\]`));
  assert.ok(existsSync(path.join(home, '.agents', 'skills', 'kste', 'SKILL.md')));
  assert.match(readFileSync(path.join(home, '.agents', 'skills', 'kste', 'agents', 'openai.yaml'), 'utf8'), /default_prompt: "\$kste"/);
  assert.ok(existsSync(path.join(home, '.codex', 'prompts', 'kste-check.md')));
  assert.ok(existsSync(path.join(home, '.codex', 'prompts', 'kste.md')));
  assert.ok(readdirSync(path.join(home, '.codex')).some((n) => n.includes('kste-bak')), '백업 생성');
  run('--with-hooks'); // 재실행: 중복 없음
  assert.equal(readFileSync(agents, 'utf8').split('kste:begin').length, 2);
  assert.equal(readFileSync(cfg, 'utf8').split('[mcp_servers.kste]').length, 2);
  assert.equal(run('--uninstall').status, 0);
  assert.equal(readFileSync(agents, 'utf8').trim(), '# 내 지침');
  assert.doesNotMatch(readFileSync(cfg, 'utf8'), /kste/);
  assert.match(readFileSync(cfg, 'utf8'), /mcp_servers\.other/);
  assert.ok(!existsSync(path.join(home, '.agents', 'skills', 'kste')));
});

test('setup: 기본 설치는 Kiwi 준비 성공 후 등록하고 실패하면 기존 설정을 보존한다', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kste-setup-'));
  const cfg = path.join(home, '.codex/config.toml');
  let called = false;
  await setup({ home }, async () => {
    called = true;
    assert.equal(existsSync(cfg), false, '엔진 준비 전에 hooks를 등록하지 않는다');
  });
  assert.equal(called, true);
  const before = readFileSync(cfg, 'utf8');
  await assert.rejects(setup({ home }, async () => { throw new Error('engine unavailable'); }), /engine unavailable/);
  assert.equal(readFileSync(cfg, 'utf8'), before);
});

test('setup: dry-run·제거·no-t1은 엔진을 설치하지 않는다', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kste-setup-'));
  const fail = async () => { throw new Error('엔진 준비를 호출하면 안 된다'); };
  const log = await setup({ home, dryRun: true }, fail);
  assert.ok(log.some((line) => /Kiwi/.test(line)));
  assert.deepEqual(readdirSync(home), []);
  await setup({ home, withT1: false }, fail);
  await setup({ home, uninstall: true }, fail);
  assert.throws(() => parseArgs(['--home']), /디렉터리 경로/);
});

test('CLI: kste install codex --dry-run은 세션 자동 적용 설치 계획만 출력한다', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kste-setup-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/kste.js'), 'install', 'codex', '--dry-run', '--home', home], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /준비: Kiwi/);
  assert.match(r.stdout, /config\.toml hook/);
  assert.deepEqual(readdirSync(home), []);
});

test('Codex AGENTS.md: 1,500자 이내, 린터 사용법 포함', () => {
  const s = rd('integrations', 'codex', 'AGENTS.md');
  assert.ok([...s].length <= 1500, `길이 ${[...s].length}`);
  assert.match(s, /npx kste check/);
  assert.match(s, /error/);
});

test('Codex 스킬: 상태 제어 외 작문 지침은 원본 skills/kste 와 동기화', () => {
  // Claude Code 전용 frontmatter 키(user-invocable)는 Codex 사본에 없다.
  const src = rd('skills', 'kste', 'SKILL.md').split('\n').filter((l) => !/^user-invocable:/.test(l));
  const dst = rd('integrations', 'codex', 'skills', 'kste', 'SKILL.md')
    .replace(/\n<!-- codex:control:begin -->[\s\S]*?<!-- codex:control:end -->\n/, '').split('\n');
  assert.equal(src.length, dst.length);
  const diff = src.map((l, i) => [l, dst[i]]).filter(([a, b]) => a !== b);
  assert.equal(diff.length, 2, 'description과 린터 안내 외의 작문 지침은 같아야 한다');
  assert.match(diff[0][0], /^description:/);
  assert.match(diff[1][0], /hook/);
  assert.match(diff[1][1], /npx kste check/);
  assert.match(dst.join('\n'), /^---\nname: kste\ndescription: .+\n---/);
  assert.equal(rd('skills', 'kste', 'references', 'rules.md'), rd('integrations', 'codex', 'skills', 'kste', 'references', 'rules.md'));
});

test('package.json: bin.kste 와 files (research/models 제외)', () => {
  const p = JSON.parse(rd('package.json'));
  assert.equal(p.bin.kste, 'bin/kste.js');
  assert.ok(p.files.includes('integrations'));
  assert.ok(!p.files.some((f) => /research|models/.test(f)));
});

test('Codex hook: apply_patch 본문에서 파일 경로 추출', () => {
  const patch = '*** Begin Patch\n*** Add File: docs/a.md\n+x\n*** Update File: b.js\n*** Move to: c.md\n*** Delete File: d.md\n*** End Patch';
  assert.deepEqual(patchFiles(patch), ['docs/a.md', 'b.js', 'c.md']);
});
