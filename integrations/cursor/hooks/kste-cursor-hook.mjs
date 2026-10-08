#!/usr/bin/env node
// Cursor는 답변·파일 hook에 출력 필드가 없다. 검사 결과를 세션별로 모아 stop에서 전달한다.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as chat } from '../../shared/chat-hook.mjs';
import { run as session } from '../../shared/session-hook.mjs';
import { loadState, saveState, statePath, answerReport } from '../../shared/state.mjs';
import { handle as fileHook } from '../../../hooks/kste-hook.mjs';
import { withHookLog, hookDecision, parseHookInput } from '../../shared/hook-log.mjs';

function pendingFile(input, cwd) {
  if (!input.conversation_id && !input.session_id) return null;
  const id = createHash('sha256').update(String(input.conversation_id || input.session_id)).digest('hex');
  return path.join(path.dirname(statePath(cwd)), 'cursor', `${id}.json`);
}

function readPending(file, generation) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return saved.generation === generation ? saved : {};
  } catch { return {}; }
}

function updatePending(file, generation, patch) {
  if (!file) return;
  const saved = readPending(file, generation);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...saved, ...patch, generation }) + '\n');
}

export function run(input, options = {}) {
  const cwd = input.cwd || process.env.CURSOR_PROJECT_DIR || input.workspace_roots?.[0] || process.cwd();
  return withHookLog({ ...input, cwd }, { host: 'cursor', kind: 'cursor' }, () => runImpl(input, { ...options, host: 'cursor' }));
}

async function runImpl(input, options) {
  const cwd = input.cwd || process.env.CURSOR_PROJECT_DIR || input.workspace_roots?.[0] || process.cwd();
  const event = input.hook_event_name;
  const pending = pendingFile(input, cwd);
  const generation = input.generation_id || '';
  if (event === 'sessionStart') {
    const out = await session({ ...input, cwd, hook_event_name: 'SessionStart' }, options);
    return { additional_context: out.hookSpecificOutput.additionalContext + (out.systemMessage ? `\n${out.systemMessage}` : '') };
  }
  if (event === 'beforeSubmitPrompt') {
    hookDecision('pending_cleared');
    if (pending) rmSync(pending, { force: true });
    // 이 이벤트는 additional_context를 지원하지 않는다. 상태 명령은 스킬·MCP로 처리한다.
    return { continue: true };
  }
  if (event === 'stop') {
    const saved = pending ? readPending(pending, generation) : {};
    if (pending) rmSync(pending, { force: true });
    if (!loadState(cwd).enabled) { hookDecision('disabled'); return {}; }
    if (input.status !== 'completed') { hookDecision('turn_not_completed'); return {}; }
    if ((input.loop_count ?? 0) > 0) { hookDecision('retry_limit'); return {}; }
    const reasons = [...Object.values(saved.files || {}), saved.answer].filter(Boolean);
    hookDecision(reasons.length ? 'cursor_followup' : 'clean');
    return reasons.length ? { followup_message: `KSTE 검사에서 오류가 발견됐습니다. 아래 지적을 한 번 수정하세요. 숫자·단위·부정어·고유명사·코드·URL과 사실을 보존하세요. 검사 보고서를 답변에 붙이지 마세요.\n${reasons.join('\n\n')}` } : {};
  }
  if (event === 'afterAgentResponse') {
    const out = chat({ cwd, hook_event_name: 'Stop', last_assistant_message: input.text });
    updatePending(pending, generation, { answer: out?.decision === 'block' ? `한국어 답변의 지적된 표현을 수정하세요.\n${answerReport(loadState(cwd).chatLast)}` : null });
    return {};
  }
  if (event === 'afterFileEdit') {
    const out = await fileHook({ cwd, tool_name: 'Edit', tool_input: { file_path: input.file_path } }, Date.now(), { loadState, saveState });
    if (pending) {
      const saved = readPending(pending, generation);
      const files = { ...saved.files };
      if (out.code === 2) files[input.file_path] = out.stderr;
      else delete files[input.file_path];
      updatePending(pending, generation, { files: Object.fromEntries(Object.entries(files).slice(-5)) });
    }
    return {};
  }
  if (event === 'sessionEnd') {
    hookDecision('pending_cleared');
    if (pending) rmSync(pending, { force: true });
  }
  return {};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = parseHookInput(readFileSync(0, 'utf8'), { host: 'cursor', kind: 'cursor' });
    if (!input.hook_event_name) input.hook_event_name = process.argv[2];
    process.stdout.write(JSON.stringify(await run(input)) + '\n');
  } catch (e) {
    process.stderr.write(`KSTE Cursor hook가 실행되지 않았습니다: ${e.stack || e}\n`);
    process.stdout.write('{}\n');
  }
}
