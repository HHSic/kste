// Hook diagnostics contain metadata only, never stdin, findings, or exception messages.
// Keep this module dependency-free so it can report failures loading the linter.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, rmSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const context = new AsyncLocalStorage();
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const MAX_BYTES = 1024 * 1024;
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'sessionStart', 'beforeSubmitPrompt', 'afterFileEdit', 'afterAgentResponse', 'stop', 'sessionEnd']);

export function hookLogPath(cwd = process.cwd(), env = process.env) {
  if (env.KSTE_LOG_DIR) return path.join(env.KSTE_LOG_DIR, 'hook-events.jsonl');
  if (env.KSTE_STATE_DIR) return path.join(env.KSTE_STATE_DIR, 'hook-events.jsonl');
  const start = path.resolve(cwd);
  for (let dir = start; ; dir = path.dirname(dir)) {
    const git = path.join(dir, '.git');
    if (existsSync(git) && (statSync(git).isFile() || existsSync(path.join(git, 'HEAD')))) return path.join(dir, '.kste', 'hook-events.jsonl');
    if (path.dirname(dir) === dir) return path.join(start, '.kste', 'hook-events.jsonl');
  }
}

export function errorMetadata(error) {
  // JSON parser errors and filesystem errors can contain private input. Omit messages/stacks.
  const type = /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error?.name) ? error.name : 'Error';
  const code = /^E[A-Z0-9_]{1,50}$/.test(error?.code) ? error.code : undefined;
  return { error_type: type, ...(code ? { error_code: code } : {}) };
}

function append(file, record) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      rmSync(file + '.1', { force: true });
      renameSync(file, file + '.1');
    }
    appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
    return true;
  } catch { return false; } // Logging must never change the hook's decision.
}

function record(ctx, phase, detail) {
  const entry = { at: new Date().toISOString(), version: VERSION, run_id: ctx.id, pid: process.pid, host: ctx.host, event: ctx.event, kind: ctx.kind, phase, ...detail };
  if (!append(ctx.file, entry) && ctx.fallback) append(ctx.fallback, entry);
}

export function hookPhase(phase) {
  const ctx = context.getStore();
  if (ctx) { ctx.stage = phase; record(ctx, 'progress', { stage: phase }); }
}

export function hookDecision(reason, { errors, warns, ruleIds, attempt, mode, t1, tier, error } = {}) {
  const ctx = context.getStore();
  if (!ctx) return;
  const detail = { reason };
  for (const [key, value] of Object.entries({ errors, warns, attempt })) if (Number.isFinite(value)) detail[key] = value;
  if (mode) detail.mode = mode === 'strict' ? 'strict' : 'default';
  if (typeof t1 === 'boolean') detail.t1_enabled = t1;
  if (['T0', 'T0+T1'].includes(tier)) detail.tier = tier;
  if (error) Object.assign(detail, errorMetadata(error));
  if (ruleIds) detail.rule_ids = [...new Set(ruleIds)].filter((s) => /^K\d+(?:\.\d+)*(?:-\d+)?$/.test(s)).slice(0, 80);
  ctx.last = detail;
  record(ctx, 'decision', detail);
}

export function reportMetadata(report) {
  return { errors: report.errors, warns: report.warns, mode: report.mode, tier: 'T0',
    ruleIds: report.lines.map((line) => line.match(/^(?:error|warn)\s+(K\d+(?:\.\d+)*(?:-\d+)?)\s/)?.[1]).filter(Boolean) };
}

export function parseHookInput(raw, options = {}) {
  try { return JSON.parse(raw || '{}'); }
  catch (error) {
    return withHookLog({}, options, () => { hookPhase('input_parse'); throw error; });
  }
}

export function withHookLog(input, { host = 'codex', kind = 'chat' } = {}, fn) {
  if (context.getStore()) return fn();
  const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
  let file;
  try { file = hookLogPath(cwd); } catch { file = path.join(process.cwd(), '.kste', 'hook-events.jsonl'); }
  const ctx = { id: randomUUID(), host, kind, event: EVENTS.has(input?.hook_event_name) ? input.hook_event_name : 'unknown', file,
    fallback: process.env.PLUGIN_DATA ? path.join(process.env.PLUGIN_DATA, 'hook-events.jsonl') : null, stage: 'run', last: {} };
  return context.run(ctx, () => {
    record(ctx, 'start', { node: process.version });
    const finish = (result) => {
      const code = result?.code ?? 0;
      let body = result;
      if (typeof result?.stdout === 'string') { try { body = JSON.parse(result.stdout); } catch { body = null; } }
      const effect = code === 2 ? 'tool_result_feedback' : body?.decision === 'block' || body?.followup_message ? 'turn_retry_requested' : 'none';
      record(ctx, 'end', { ...ctx.last, exit_code: code, effect, kste_intervened: effect !== 'none' });
      return result;
    };
    const fail = (error) => {
      record(ctx, 'end', { reason: 'runtime_error', stage: ctx.stage, ...errorMetadata(error), exit_code: 0, effect: 'none', kste_intervened: false, fail_open: true });
      throw error;
    };
    try {
      const result = fn();
      return result && typeof result.then === 'function' ? Promise.resolve(result).then(finish, fail) : finish(result);
    } catch (error) { return fail(error); }
  });
}

export function readHookLogs(cwd = process.cwd(), limit = 30) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit: 1..1000');
  const file = hookLogPath(cwd);
  const entries = [];
  for (const name of [file + '.1', file]) {
    try {
      for (const line of readFileSync(name, 'utf8').split('\n')) {
        try { entries.push(JSON.parse(line)); } catch { /* Interrupted writes are ignored. */ }
      }
    } catch { /* No logs yet. */ }
  }
  return { file, entries: entries.slice(-limit) };
}

export function formatHookLogs(cwd = process.cwd(), limit = 30) {
  const { file, entries: all } = readHookLogs(cwd, limit);
  const entries = all.filter((e) => e.run_id !== context.getStore()?.id); // Don't mistake this active logs command for an interrupted run.
  const names = { tool_result_feedback: '도구 결과에 KSTE 피드백 전달', turn_retry_requested: 'KSTE가 답변/작업 수정 요청', none: 'KSTE 수정 요청 없음' };
  return [`KSTE hook 로그: ${file}`, ...entries.map((e) => {
    const detail = [e.reason, e.stage, e.exit_code != null ? `exit=${e.exit_code}` : '', e.effect ? names[e.effect] : '',
      e.errors != null ? `error=${e.errors} warn=${e.warns ?? 0}` : '', e.rule_ids?.join(','), e.error_type, e.error_code].filter(Boolean).join(' · ');
    return `${e.at} ${e.host}/${e.event} ${e.phase} [${e.run_id.slice(0, 8)}] ${detail}`;
  }), ...(entries.length ? [] : ['아직 로그가 없습니다. hook 실행 후 다시 조회하세요.']),
  'runtime_error는 실행 오류입니다. start 뒤 end가 없으면 중단/시간 초과 가능성이 있으며 원인은 이 로그만으로 확정할 수 없습니다.'].join('\n');
}
