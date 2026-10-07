// Codex·Claude Code·Cursor의 스킬·MCP·hooks·CLI가 같은 프로젝트 상태를 쓴다.
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { applyStateArgs, statusLine } from '../../lib/engine/mode.js';
import { directiveOf, reportOf } from '../../lib/engine/chat.js';
import { checkReport } from '../../scripts/install-t1.mjs';

export const modeName = (mode) => mode === 'strict' ? 'strict' : 'default';
export const answerReport = (report) => reportOf(report).replace('80% 모드', 'default 모드');

function engineStatus(state) {
  const r = checkReport();
  return `Kiwi 형태소 분석(T1): 설정 ${state.t1 ? 'on' : 'off'} · 엔진/모델 ${r.installed ? '설치됨' : '미설치'}${r.installed ? ` · ${r.dir}` : '\n설치: KSTE 저장소에서 node scripts/install-t1.mjs'}. 채팅 자동 검사는 T0이며, T1은 파일·MCP 검사에 적용됩니다.`;
}

export function projectRoot(cwd = process.cwd()) {
  const start = path.resolve(cwd);
  for (let dir = start; ; dir = path.dirname(dir)) {
    const git = path.join(dir, '.git');
    // 빈 sandbox 마운트나 이름만 .git인 폴더는 저장소로 취급하지 않는다.
    if (existsSync(git) && (statSync(git).isFile() || existsSync(path.join(git, 'HEAD')))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

export function statePath(cwd) {
  return path.join(process.env.KSTE_STATE_DIR || path.join(projectRoot(cwd), '.kste'), 'state.json');
}

export function loadState(cwd) {
  let s;
  try { s = JSON.parse(readFileSync(statePath(cwd), 'utf8')); } catch { /* 기본값 */ }
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  return {
    ...s, enabled: s.enabled !== false, mode: s.mode === 'strict' ? 'strict' : '80',
    t1: s.t1 !== false, retries: s.retries && typeof s.retries === 'object' ? s.retries : {},
  };
}

export function saveState(cwd, state) {
  const file = statePath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

export function stateContext(state) {
  const status = `KSTE 현재 설정: ${state.enabled ? 'on' : 'off'}, 모드 ${modeName(state.mode)}, T1 ${state.t1 ? 'on' : 'off'}.`;
  if (!state.enabled) return `${status}\n이후 KSTE 작문 지시와 자동 검사를 적용하지 않습니다. 사용자의 명시적 검사 요청은 실행합니다.`;
  return `${status}\n${directiveOf(state.mode)}\n문서 검사 시 kste_check의 t1은 "${state.t1 ? 'on' : 'off'}"으로 설정합니다.`;
}

export const CONTROL_USAGE = '사용: on | off | default | strict | t1 on | t1 off | t1 status | status | last (80은 default의 별칭)';

export function setState(args = [], cwd = process.cwd()) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error(CONTROL_USAGE);
  const lower = args.map((a) => a.toLowerCase());
  const valid = !lower.length || (lower.length === 1 && ['on', 'off', 'default', '80', '80%', 'strict', 'status', 'last'].includes(lower[0]))
    || (lower.length === 2 && lower[0] === 't1' && ['on', 'off', 'status'].includes(lower[1]));
  if (!valid) throw new Error(CONTROL_USAGE);
  const state = loadState(cwd);
  if (lower[0] === 'last') return { state, text: answerReport(state.chatLast ?? null), changed: false };
  if (lower[0] === 't1' && lower[1] === 'status') return { state, text: engineStatus(state), changed: false };
  const useDefault = ['default', '80', '80%'].includes(lower[0]);
  if (lower[0] === 'default') lower[0] = '80'; // 공유 상태 형식은 Claude와 호환되도록 유지한다.
  const r = applyStateArgs(state, lower);
  if (useDefault) r.state = { ...r.state, enabled: true, t1: true };
  if (r.changed) saveState(cwd, r.state);
  const status = statusLine(r.state, statePath(cwd)).replace('모드 80%', '모드 default');
  const detail = !lower.length || lower[0] === 'status' || lower[0] === 't1';
  return { state: r.state, changed: r.changed, text: status + (detail ? '\n' + engineStatus(r.state) : '') };
}
