#!/usr/bin/env node
// SessionStart/UserPromptSubmit: 현재 설정 주입. Stop: 한국어 답변 검사와 1회 수정 요청.
// transcript 파일을 읽지 않는다. 공식 last_assistant_message 필드만 검사한다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintAnswer } from '../../../lib/engine/chat.js';
import { loadState, saveState, setState, stateContext, answerReport } from '../state.mjs';

const SKILL_FILE = fileURLToPath(new URL('../skills/kste/SKILL.md', import.meta.url));

function skillContext() {
  const body = readFileSync(SKILL_FILE, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  return `\nKSTE kste 스킬을 이 세션에 자동 적용합니다. 별도 /kste 호출 없이 한국어 답변과 문서에 다음 지침을 따릅니다. 스킬 파일: ${SKILL_FILE}. 상대 참조는 이 파일의 디렉터리를 기준으로 읽습니다.\n${body}`;
}

export function controlArgs(prompt) {
  // 문장 속 명령 예시나 여러 줄 요청을 설정 변경으로 해석하지 않는다.
  if (typeof prompt !== 'string') return null;
  const m = prompt.trim().match(/^(?:\/kste(?::kste)?|\$kste(?::kste)?|\/prompts:kste)(?:[ \t]+([^\r\n]*))?$/);
  if (!m) return null;
  const args = m[1]?.trim().split(/[ \t]+/).filter(Boolean) ?? [];
  // $kste README.md 같은 작문 스킬 요청은 상태 명령이 아니다.
  return !args.length || ['on', 'off', 'default', '80', '80%', 'strict', 't1', 'status', 'last'].includes(args[0].toLowerCase()) ? args : null;
}

export function run(input, now = Date.now()) {
  const cwd = input.cwd || process.cwd();
  const event = input.hook_event_name;
  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    let commandContext = '';
    let activate = event === 'SessionStart';
    if (event === 'UserPromptSubmit') {
      const args = controlArgs(input.prompt);
      if (args !== null) {
        try {
          const r = setState(args, cwd);
          activate = ['on', 'default', '80', '80%'].includes(args[0]?.toLowerCase());
          const text = args[0]?.toLowerCase() === 'last' ? `\`\`\`text\n${r.text}\n\`\`\`` : r.text;
          commandContext = `\nKSTE 명령은 hook에서 처리했습니다. 같은 명령을 다시 실행하지 말고 다음 결과만 사용자에게 알리세요. 검사 리포트는 코드 블록을 유지하세요:\n${text}`;
        } catch (e) {
          commandContext = `\nKSTE 설정을 바꾸지 않았습니다. 사용자에게 다음 사용법을 알리세요:\n${e.message}`;
        }
      }
    }
    const state = loadState(cwd);
    return { hookSpecificOutput: { hookEventName: event, additionalContext: stateContext(state) + (activate && state.enabled ? skillContext() : '') + commandContext } };
  }
  if (event !== 'Stop') return null;
  const state = loadState(cwd);
  if (!state.enabled || typeof input.last_assistant_message !== 'string') return null;
  const answer = input.last_assistant_message;
  if (Buffer.byteLength(answer, 'utf8') > 300 * 1024) return { systemMessage: 'KSTE: 답변이 300 KiB를 넘어 자동 검사를 건너뛰었습니다.' };
  const report = lintAnswer(answer, state.mode, now);
  if (!report) return null;
  saveState(cwd, { ...state, chatLast: report });
  if (!report.errors) return null;
  // Stop이 만든 재개 요청에서는 다시 재개하지 않아 무한 수정 루프를 막는다.
  if (input.stop_hook_active) return { systemMessage: `KSTE: 자동 수정 후 오류 ${report.errors}건이 남았습니다.\n${answerReport(report)}` };
  return {
    decision: 'block',
    reason: `KSTE가 방금 한국어 답변에서 오류를 발견했습니다. 원래 요청에 대한 수정된 답변을 한 번 작성하세요. 지적된 표현만 고치고 숫자, 단위, 부정어, 고유명사, 코드, 명령어, URL과 사실을 보존하세요. 파일을 수정하거나 추가 작업을 하지 마세요. 검사 보고서는 답변에 붙이지 마세요.\n${answerReport(report)}`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = run(JSON.parse(readFileSync(0, 'utf8') || '{}'));
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
  } catch (e) {
    // 검사나 상태 저장 실패를 조용히 숨기지 않되, 원래 턴은 계속한다.
    process.stdout.write(JSON.stringify({ systemMessage: `KSTE 채팅 hook 오류: ${e.message}` }) + '\n');
  }
}
