#!/usr/bin/env node
// KSTE hook + 상태 관리 CLI.
//   hook 모드 (stdin 에 PostToolUse JSON):  node kste-hook.mjs
//   상태 모드:                              node kste-hook.mjs set <on|off|80|strict|t1 on|t1 off|status>
// 종료 코드: 0 통과(경고만 있으면 stdout JSON systemMessage 로 사용자에게만 알림), 2 오류 있음(stderr 가 모델에게 전달됨).
// hook 은 T0 만 돌린다(빠름). T1 은 상태 파일의 t1:true 일 때만 켠다(로딩 5~8초, 메모리 ~1GB).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FIX = 3; // 모델에게 수정 기회를 주는 횟수. 이를 넘으면 통과시킨다.
const STALE_MS = 30 * 60 * 1000; // 마지막 시도가 30분 지났으면 재시도 횟수를 새로 센다.
const MAX_BYTES = 300 * 1024;
const MIN_KO_RATIO = 0.3;
const DEFAULT_STATE = { enabled: true, mode: '80', t1: false, retries: {} };

// strict 모드: 규칙 문서 §10 표에서 "엄격에서 오류"인 항목 중 T0/T1 이 내는 것
const STRICT_ERROR_BASES = new Set(['K1.5', 'K1.6', 'K2.4', 'K2.7', 'K3.3', 'K3.4', 'K4.1', 'K6.3']);
const STRICT_STRONG_BASES = new Set(['K4.4', 'K5.1']); // 강한 경고(21/26어절 이상) -> 오류

export function stateDir(cwd) {
  return process.env.KSTE_STATE_DIR || path.join(process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd(), '.kste');
}
export function statePath(cwd) {
  return path.join(stateDir(cwd), 'state.json');
}
export function loadState(cwd) {
  try {
    const s = JSON.parse(readFileSync(statePath(cwd), 'utf8'));
    return { ...DEFAULT_STATE, ...s, retries: s.retries ?? {} };
  } catch {
    return { ...DEFAULT_STATE, retries: {} };
  }
}
export function saveState(cwd, state) {
  mkdirSync(stateDir(cwd), { recursive: true });
  writeFileSync(statePath(cwd), JSON.stringify(state, null, 2) + '\n');
}

/** 코드 블록·인라인 코드·URL 을 뺀 뒤 한글/(한글+라틴 글자) 비율 */
export function koreanRatio(text) {
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/https?:\/\/\S+/g, '');
  const ko = (body.match(/[가-힣]/g) ?? []).length;
  const en = (body.match(/[A-Za-z]/g) ?? []).length;
  return ko + en === 0 ? 0 : ko / (ko + en);
}

export function applyMode(findings, mode) {
  if (mode !== 'strict') return findings;
  return findings.map((f) => {
    const base = f.base ?? f.ruleId.replace(/-\d+$/, '');
    if (f.severity === 'warn' && (STRICT_ERROR_BASES.has(base) || (STRICT_STRONG_BASES.has(base) && f.strong))) return { ...f, severity: 'error' };
    if (f.severity === 'info' && (base === 'K1.7' || base === 'K1.9')) return { ...f, severity: 'warn' };
    return f;
  });
}

const line = (f) => `${f.severity.padEnd(5)} ${f.ruleId} L${f.line ?? '-'}${f.col != null ? ':' + f.col : ''} "${f.match}" -> ${f.suggest}`;

export function renderFeedback({ file, errors, warns, attempt, mode }) {
  const out = [];
  out.push(`[KSTE] ${path.basename(file)}: error ${errors.length}건, warn ${warns.length}건 (${mode === 'strict' ? '엄격' : '80%'} 모드, 수정 ${attempt}/${MAX_FIX}회차)`);
  for (const f of errors) out.push(line(f));
  const rep = warns.slice(0, 3);
  for (const f of rep) out.push(line(f));
  if (warns.length > rep.length) out.push(`(warn ${warns.length - rep.length}건 더 있음. 대표 ${rep.length}건만 표시)`);
  out.push('지적된 줄만 고치세요. 문서 전체를 다시 쓰지 마세요. 숫자, 부정어, 고유명사, 문장을 지우지 마세요. 오류는 모두 고치고 warn은 대표 항목만 고칩니다.');
  return out.join('\n');
}

async function runLint(text, state) {
  if (state.t1) {
    const { lintTextT1, resolveT1Mode, closeT1 } = await import('../lib/t1/engine.js');
    const t1 = resolveT1Mode('auto');
    if (t1.use) {
      try {
        return await lintTextT1(text, { genre: 'auto' });
      } finally {
        await closeT1();
      }
    }
  }
  const { lintText, getDefaultRuleset } = await import('../lib/engine/tier0.js');
  return lintText(text, { genre: 'auto', ruleset: getDefaultRuleset() });
}

/** 판정 함수. {code, stderr, stdout} 반환. 테스트와 main 이 같이 쓴다. */
export async function handle(input, now = Date.now()) {
  const cwd = input.cwd || process.cwd();
  const state = loadState(cwd);
  if (!state.enabled) return { code: 0 };
  const tool = input.tool_name;
  if (tool && !['Write', 'Edit', 'MultiEdit'].includes(tool)) return { code: 0 };
  const file = input.tool_input?.file_path;
  if (!file || !/\.md$/i.test(file)) return { code: 0 };
  const abs = path.resolve(cwd, file);
  if (/[\\/](node_modules|\.kste|\.git)[\\/]/.test(abs)) return { code: 0 };
  if (!existsSync(abs) || statSync(abs).size > MAX_BYTES) return { code: 0 };
  const text = readFileSync(abs, 'utf8');
  if (koreanRatio(text) < MIN_KO_RATIO) return { code: 0 };

  const result = await runLint(text, state);
  const findings = applyMode(result.findings.filter((f) => f.show !== false), state.mode);
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  const key = abs;
  const prev = state.retries[key];
  const fresh = !prev || now - prev.at > STALE_MS;

  if (errors.length === 0) {
    delete state.retries[key];
    saveState(cwd, state);
    if (warns.length === 0) return { code: 0 };
    const msg = `KSTE: ${path.basename(abs)} 경고 ${warns.length}건 (${warns.slice(0, 3).map((f) => f.ruleId).join(', ')}). /kste-check 로 자세히 봅니다.`;
    return { code: 0, stdout: JSON.stringify({ systemMessage: msg }) };
  }

  const count = (fresh ? 0 : prev.count) + 1;
  if (count > MAX_FIX) {
    delete state.retries[key];
    saveState(cwd, state);
    const msg = `KSTE: ${MAX_FIX}회 수정 후 남은 위반 ${errors.length}건 (${path.basename(abs)}). 직접 확인하세요.\n${errors.slice(0, 5).map(line).join('\n')}`;
    return { code: 0, stdout: JSON.stringify({ systemMessage: msg }) };
  }
  state.retries[key] = { count, at: now };
  saveState(cwd, state);
  return { code: 2, stderr: renderFeedback({ file: abs, errors, warns, attempt: count, mode: state.mode }) };
}

export function setCommand(args, cwd = process.cwd()) {
  const state = loadState(cwd);
  const [a, b] = args.map((x) => String(x).toLowerCase());
  if (a === 'on') state.enabled = true;
  else if (a === 'off') state.enabled = false;
  else if (a === '80' || a === '80%') state.mode = '80';
  else if (a === 'strict') state.mode = 'strict';
  else if (a === 't1' && (b === 'on' || b === 'off')) state.t1 = b === 'on';
  else if (a && a !== 'status') return { ok: false, text: `알 수 없는 인자: ${args.join(' ')}\n사용: on | off | 80 | strict | t1 on | t1 off | status` };
  if (a && a !== 'status') saveState(cwd, state);
  return { ok: true, text: `KSTE hook: ${state.enabled ? 'on' : 'off'} · 모드 ${state.mode === 'strict' ? 'strict' : '80%'} · T1 ${state.t1 ? 'on' : 'off'} · 상태 파일 ${statePath(cwd)}` };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'set') {
    const r = setCommand(argv.slice(1));
    (r.ok ? process.stdout : process.stderr).write(r.text + '\n');
    return r.ok ? 0 : 1;
  }
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return 0;
  }
  try {
    const r = await handle(input);
    if (r.stdout) process.stdout.write(r.stdout + '\n');
    if (r.stderr) process.stderr.write(r.stderr + '\n');
    return r.code;
  } catch (e) {
    if (process.env.KSTE_DEBUG) process.stderr.write(`KSTE hook 내부 오류: ${e.stack}\n`);
    return 0; // 린터 고장이 작업을 막지 않게 한다
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
