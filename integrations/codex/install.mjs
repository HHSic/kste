#!/usr/bin/env node
// KSTE Codex CLI 설치 스크립트.
//   node integrations/codex/install.mjs [--dry-run] [--uninstall] [--no-hooks] [--no-t1] [--home <dir>]
// 건드리는 곳 (home 기본값 = 사용자 홈, CODEX_HOME 이 있으면 그 경로가 Codex 디렉터리):
//   <codex>/AGENTS.md          kste:begin/end 마커 사이 절만 추가·교체
//   <codex>/config.toml        [mcp_servers.kste] + 기본 파일·채팅 hooks. 변경 전 .bak 백업
//   <codex>/prompts/kste-check.md, kste.md
//   <home>/.agents/skills/kste/   (Codex 사용자 skill 위치)
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARK = {
  agents: [/<!-- kste:begin -->[\s\S]*?<!-- kste:end -->\n?/, '<!-- kste:begin -->', '<!-- kste:end -->'],
  mcp: [/# kste:mcp:begin[\s\S]*?# kste:mcp:end\n?/, '# kste:mcp:begin', '# kste:mcp:end'],
  hooks: [/# kste:hooks:begin[\s\S]*?# kste:hooks:end\n?/, '# kste:hooks:begin', '# kste:hooks:end'],
};

export function parseArgs(argv) {
  const o = { dryRun: false, uninstall: false, withHooks: true, withT1: true, home: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--uninstall') o.uninstall = true;
    else if (a === '--with-hooks') o.withHooks = true;
    else if (a === '--no-hooks') o.withHooks = false;
    else if (a === '--no-t1') o.withT1 = false;
    else if (a === '--home') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--home 뒤에 디렉터리 경로가 필요합니다');
      o.home = argv[++i];
    }
    else throw new Error(`알 수 없는 옵션: ${a}\n사용법: install.mjs [--dry-run] [--uninstall] [--no-hooks] [--no-t1] [--home <dir>]`);
  }
  return o;
}

const toml = (s) => JSON.stringify(s); // TOML 기본 문자열과 호환 (백슬래시 이스케이프)
const fwd = (p) => p.replace(/\\/g, '/');

export function mcpBlock(serverPath) {
  return `${MARK.mcp[1]}\n[mcp_servers.kste]\ncommand = "node"\nargs = [${toml(fwd(serverPath))}]\nstartup_timeout_sec = 20\ntool_timeout_sec = 60\n${MARK.mcp[2]}\n`;
}
const shellQuote = (s) => process.platform === 'win32' ? `"${s}"` : `'${s.replace(/'/g, "'\\''")}'`;

export function hooksBlock(hookPath, chatPath) {
  const command = (p) => toml(`${shellQuote(process.execPath)} ${shellQuote(fwd(p))}`);
  const chat = ['SessionStart', 'UserPromptSubmit', 'Stop'].map((event) =>
    `[[hooks.${event}]]\n\n[[hooks.${event}.hooks]]\ntype = "command"\ncommand = ${command(chatPath)}\ntimeout = 20\n${event === 'SessionStart' || event === 'UserPromptSubmit' ? 'additionalContextLimit = 5000\n' : ''}`).join('\n');
  return `${MARK.hooks[1]}\n${chat}\n[[hooks.PostToolUse]]\nmatcher = "apply_patch"\n\n[[hooks.PostToolUse.hooks]]\ntype = "command"\ncommand = ${command(hookPath)}\ntimeout = 20\n${MARK.hooks[2]}\n`;
}

function agentsBlock() {
  return readFileSync(path.join(HERE, 'AGENTS.md'), 'utf8').trimEnd() + '\n';
}

export function install(opts = {}) {
  const home = opts.home ? path.resolve(opts.home) : os.homedir();
  const codex = opts.home ? path.join(home, '.codex') : process.env.CODEX_HOME || path.join(home, '.codex');
  const log = [];
  const dry = !!opts.dryRun;
  const say = (m) => log.push(dry ? `[dry-run] ${m}` : m);
  const backedUp = new Set(); // 같은 실행에서 파일당 한 번만 (최초 원본 보존)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const backup = (file) => {
    if (!existsSync(file) || backedUp.has(file)) return;
    backedUp.add(file);
    say(`백업: ${file} -> ${file}.kste-bak-${stamp}`);
    if (!dry) copyFileSync(file, `${file}.kste-bak-${stamp}`);
  };
  const write = (file, text) => {
    if (!dry) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  };
  const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

  // 마커 블록을 넣거나(교체) 뺀다. 바뀐 게 없으면 건너뛴다.
  const editBlock = (file, key, block, label) => {
    const [re] = MARK[key];
    const cur = read(file);
    let next;
    if (opts.uninstall) {
      if (!re.test(cur)) return say(`건너뜀: ${label} 에 KSTE 항목 없음 (${file})`);
      next = cur.replace(re, '').replace(/\n{3,}/g, '\n\n');
    } else if (re.test(cur)) {
      next = cur.replace(re, () => block);
      if (next === cur) return say(`건너뜀: ${label} 이미 최신 (${file})`);
    } else {
      next = cur + (cur && !cur.endsWith('\n\n') ? (cur.endsWith('\n') ? '\n' : '\n\n') : '') + block;
    }
    backup(file);
    say(`${opts.uninstall ? '제거' : '기록'}: ${label} (${file})`);
    write(file, next);
  };

  const agentsFile = path.join(codex, 'AGENTS.md');
  const configFile = path.join(codex, 'config.toml');
  const promptNames = ['kste-check.md', 'kste.md'];
  const skillDst = path.join(home, '.agents', 'skills', 'kste');
  const serverPath = path.join(HERE, 'mcp', 'kste-mcp.mjs');
  const hookPath = path.join(HERE, 'hooks', 'kste-codex-hook.mjs');
  const chatPath = path.join(HERE, 'hooks', 'kste-chat-hook.mjs');

  editBlock(agentsFile, 'agents', agentsBlock(), 'AGENTS.md KSTE 절');
  editBlock(configFile, 'mcp', mcpBlock(serverPath), 'config.toml MCP 서버');
  if (opts.uninstall || opts.withHooks !== false) editBlock(configFile, 'hooks', hooksBlock(hookPath, chatPath), 'config.toml hook');
  else if (MARK.hooks[0].test(read(configFile))) {
    backup(configFile);
    say(`제거: config.toml KSTE hook (${configFile})`);
    write(configFile, read(configFile).replace(MARK.hooks[0], ''));
  }

  if (opts.uninstall) {
    for (const p of [...promptNames.map((name) => path.join(codex, 'prompts', name)), skillDst]) {
      if (existsSync(p)) {
        say(`삭제: ${p}`);
        if (!dry) rmSync(p, { recursive: true, force: true });
      } else say(`건너뜀: 없음 (${p})`);
    }
  } else {
    for (const name of promptNames) say(`복사: prompts/${name} -> ${path.join(codex, 'prompts', name)}`);
    say(`복사: skills/kste -> ${skillDst}`);
    if (!dry) {
      mkdirSync(path.join(codex, 'prompts'), { recursive: true });
      for (const name of promptNames) copyFileSync(path.join(HERE, 'prompts', name), path.join(codex, 'prompts', name));
      cpSync(path.join(HERE, 'skills', 'kste'), skillDst, { recursive: true });
    }
  }
  return log;
}

async function prepareT1(opts) {
  const script = path.resolve(HERE, '../../scripts/install-t1.mjs');
  const args = [script];
  if (opts.home) args.push('--dest', path.join(path.resolve(opts.home), '.kste', 't1'));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Kiwi(T1) 준비 실패 (${signal || code}). Codex 설정은 변경하지 않았습니다.`)));
  });
}

// 엔진 준비가 성공한 뒤에만 설정을 등록한다. 테스트에서는 prepare를 주입할 수 있다.
export async function setup(opts = {}, prepare = prepareT1) {
  const log = [];
  if (!opts.uninstall && opts.withT1 !== false) {
    if (opts.dryRun) log.push('[dry-run] 준비: Kiwi(T1) 엔진·모델 (기설치 파일 재사용)');
    else {
      await prepare(opts);
      log.push('준비 완료: Kiwi(T1) 엔진·모델');
    }
  }
  return [...log, ...install(opts)];
}

export function completionMessage(opts) {
  if (opts.dryRun || opts.uninstall) return '';
  return `완료. Codex를 다시 시작하세요.${opts.withHooks !== false ? ' /hooks에서 KSTE hooks를 검토하고 신뢰하면 새 세션마다 kste 스킬이 자동 적용됩니다.' : ' --no-hooks: 자동 답변 검사는 설치하지 않았습니다.'}${opts.withT1 === false ? ' --no-t1: 엔진 준비는 생략했습니다.' : ''}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const lines = await setup(opts);
    process.stdout.write(lines.join('\n') + '\n');
    const message = completionMessage(opts);
    if (message) process.stdout.write(message + '\n');
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exitCode = 2;
  }
}
