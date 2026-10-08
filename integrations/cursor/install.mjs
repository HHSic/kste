#!/usr/bin/env node
// Cursor 공식 local plugin 디렉터리에 현재 소스를 복사한다. 다시 실행하면 업데이트한다.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const USAGE = '사용: kste install cursor [--home 경로] [--dry-run] [--uninstall]';

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--home' && args[i + 1]) options.home = args[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--uninstall') options.uninstall = true;
    else throw new Error(USAGE);
  }
  return options;
}

export function install(options = {}) {
  const directory = path.join(path.resolve(options.home || homedir()), '.cursor', 'plugins', 'local', 'kste');
  const log = [];
  const say = (s) => log.push(`${options.dryRun ? '[dry-run] ' : ''}${s}`);
  if (options.uninstall) {
    say(`제거: ${directory}`);
    if (!options.dryRun) rmSync(directory, { recursive: true, force: true });
    return log;
  }
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const assets = ['package.json', ...pkg.files.filter((name) => existsSync(path.join(ROOT, name))), 'node_modules/yaml'];
  if (!existsSync(path.join(ROOT, 'node_modules', 'yaml', 'package.json'))) throw new Error('yaml 의존성이 없습니다. KSTE 저장소에서 npm install을 실행하세요.');
  const staging = `${directory}.tmp-${Date.now()}-${process.pid}`;
  const backup = `${directory}.kste-bak-${Date.now()}-${process.pid}`;
  say(`복사: KSTE 플러그인 -> ${directory}`);
  if (!options.dryRun) {
    mkdirSync(staging, { recursive: true });
    try {
      for (const asset of assets) cpSync(path.join(ROOT, asset), path.join(staging, asset), { recursive: true });
      // 업데이트가 실패해도 기존 플러그인을 유지한다. 외부로 연결된 symlink는 교체하지 않는다.
      if (existsSync(directory)) {
        if (lstatSync(directory).isSymbolicLink()) throw new Error(`기존 플러그인이 symlink입니다: ${directory}`);
        renameSync(directory, backup);
        say(`백업: ${backup}`);
      }
      try { renameSync(staging, directory); }
      catch (e) { if (existsSync(backup)) renameSync(backup, directory); throw e; }
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  say('Cursor를 다시 시작하거나 Developer: Reload Window를 실행하세요. Customize에서 kste를 확인합니다.');
  return log;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(install(parseArgs(process.argv.slice(2))).join('\n') + '\n'); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
