#!/usr/bin/env node
// 플러그인 설치는 코드를 실행하지 않는다. 신뢰한 첫 세션 hook에서 Kiwi를 준비한다.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as chat, controlArgs } from './chat-hook.mjs';
import { loadState } from './state.mjs';
import { checkReport } from '../../scripts/install-t1.mjs';
import { withHookLog, hookDecision, hookPhase, parseHookInput } from './hook-log.mjs';

const INSTALLER = fileURLToPath(new URL('../../scripts/install-t1.mjs', import.meta.url));

export async function prepareT1() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSTALLER], { stdio: ['ignore', 'ignore', 'inherit'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Kiwi 준비 시간 초과')); }, 150_000);
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Kiwi 준비 실패 (${signal || code})`));
    });
  });
}

export function run(input, options = {}) {
  return withHookLog(input, { host: options.host, kind: 'session' }, () => runImpl(input, options));
}

async function runImpl(input, { installed = () => checkReport().installed, prepare = prepareT1, skillFile, host } = {}) {
  const output = chat(input, Date.now(), { skillFile, host });
  const state = loadState(input.cwd || process.cwd());
  const args = input.hook_event_name === 'UserPromptSubmit' ? controlArgs(input.prompt)?.map((a) => a.toLowerCase()) : null;
  const activate = input.hook_event_name === 'SessionStart'
    || args?.length === 1 && ['on', 'default', '80', '80%'].includes(args[0])
    || args?.length === 2 && args[0] === 't1' && args[1] === 'on';
  if (!activate || !state.enabled || !state.t1 || installed()) return output;
  try {
    hookPhase('kiwi_prepare');
    await prepare();
    hookDecision('kiwi_ready', { t1: true });
    output.systemMessage = 'KSTE: Kiwi 엔진·모델 준비 완료. 파일·MCP 검사에서 형태소 분석을 사용합니다.';
    if (args) output.hookSpecificOutput.additionalContext += '\nKiwi 엔진·모델 준비가 완료됐습니다. 사용자에게 이 준비 결과를 최신 설치 상태로 알리세요.';
  } catch (e) {
    hookDecision('kiwi_prepare_failed_t0_fallback', { t1: true, error: e });
    output.systemMessage = `KSTE: ${e.message}. 채팅 T0 검사는 계속합니다. 엔진·모델 준비를 다시 시도하려면 /kste default를 실행하세요.`;
    output.hookSpecificOutput.additionalContext += '\nKiwi 엔진·모델 준비가 실패했습니다. 준비 실패를 사용자에게 알리고, T1 검사가 실행됐다고 말하지 마세요. /kste default로 다시 시도하거나 /kste t1 off로 T0만 사용할 수 있습니다.';
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = await run(parseHookInput(readFileSync(0, 'utf8'), { host: 'codex', kind: 'session' }));
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ systemMessage: `KSTE 플러그인 hook 오류: ${e.message}` }) + '\n');
  }
}
