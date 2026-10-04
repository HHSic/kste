#!/usr/bin/env node
// KSTE Codex CLI 설치 스크립트.
//   node integrations/codex/install.mjs [--dry-run] [--uninstall] [--with-hooks] [--home <dir>]
// 건드리는 곳 (home 기본값 = 사용자 홈, CODEX_HOME 이 있으면 그 경로가 Codex 디렉터리):
//   <codex>/AGENTS.md          kste:begin/end 마커 사이 절만 추가·교체
//   <codex>/config.toml        [mcp_servers.kste] (+ --with-hooks 면 PostToolUse hook). 변경 전 .bak 백업
//   <codex>/prompts/kste-check.md
//   <home>/.agents/skills/kste/   (Codex 사용자 skill 위치)
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARK = {
  agents: [/<!-- kste:begin -->[\s\S]*?<!-- kste:end -->\n?/, '<!-- kste:begin -->', '<!-- kste:end -->'],
  mcp: [/# kste:mcp:begin[\s\S]*?# kste:mcp:end\n?/, '# kste:mcp:begin', '# kste:mcp:end'],
  hooks: [/# kste:hooks:begin[\s\S]*?# kste:hooks:end\n?/, '# kste:hooks:begin', '# kste:hooks:end'],
};

export function parseArgs(argv) {
  const o = { dryRun: false, uninstall: false, withHooks: false, home: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--uninstall') o.uninstall = true;
    else if (a === '--with-hooks') o.withHooks = true;
    else if (a === '--home') o.home = argv[++i];
    else throw new Error(`알 수 없는 옵션: ${a}\n사용법: install.mjs [--dry-run] [--uninstall] [--with-hooks] [--home <dir>]`);
  }
  return o;
}

const toml = (s) => JSON.stringify(s); // TOML 기본 문자열과 호환 (백슬래시 이스케이프)
const fwd = (p) => p.replace(/\\/g, '/');

export function mcpBlock(serverPath) {
  return `${MARK.mcp[1]}\n[mcp_servers.kste]\ncommand = "node"\nargs = [${toml(fwd(serverPath))}]\nstartup_timeout_sec = 20\ntool_timeout_sec = 60\n${MARK.mcp[2]}\n`;
}
export function hooksBlock(hookPath) {
  return `${MARK.hooks[1]}\n[[hooks.PostToolUse]]\nmatcher = "apply_patch"\n\n[[hooks.PostToolUse.hooks]]\ntype = "command"\ncommand = ${toml(`node ${fwd(hookPath)}`)}\ntimeout = 20\n${MARK.hooks[2]}\n`;
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
  const promptDst = path.join(codex, 'prompts', 'kste-check.md');
  const skillDst = path.join(home, '.agents', 'skills', 'kste');
  const serverPath = path.join(HERE, 'mcp', 'kste-mcp.mjs');
  const hookPath = path.join(HERE, 'hooks', 'kste-codex-hook.mjs');

  editBlock(agentsFile, 'agents', agentsBlock(), 'AGENTS.md KSTE 절');
  editBlock(configFile, 'mcp', mcpBlock(serverPath), 'config.toml MCP 서버');
  if (opts.withHooks || opts.uninstall) editBlock(configFile, 'hooks', hooksBlock(hookPath), 'config.toml hook');

  if (opts.uninstall) {
    for (const p of [promptDst, skillDst]) {
      if (existsSync(p)) {
        say(`삭제: ${p}`);
        if (!dry) rmSync(p, { recursive: true, force: true });
      } else say(`건너뜀: 없음 (${p})`);
    }
  } else {
    say(`복사: prompts/kste-check.md -> ${promptDst}`);
    say(`복사: skills/kste -> ${skillDst}`);
    if (!dry) {
      mkdirSync(path.dirname(promptDst), { recursive: true });
      copyFileSync(path.join(HERE, 'prompts', 'kste-check.md'), promptDst);
      cpSync(path.join(HERE, 'skills', 'kste'), skillDst, { recursive: true });
    }
  }
  return log;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const lines = install(opts);
    process.stdout.write(lines.join('\n') + '\n');
    if (!opts.dryRun && !opts.uninstall) process.stdout.write('완료. Codex 를 다시 시작하세요. hook 은 첫 실행 때 trust 확인을 받습니다.\n');
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exitCode = 2;
  }
}
