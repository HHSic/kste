// KSTE 모드·언어 판정(순수 함수). hook(kste-hook.mjs)과 Claude Code mod(hooks/kste-mod.js)가 같이 쓴다.
// Node 모듈을 쓰지 않는다: mod 환경은 상대 경로 import 만 허용한다.
// 0.3이면 "TCP 3-way handshake를 설명해 줘"(0.25) 같은 영문 용어 많은 한국어가 빠진다.
export const MIN_KO_RATIO = 0.2;
const MIN_KO_CHARS = 3;

// strict 모드: 규칙 문서 §10 표에서 "엄격에서 오류"인 항목 중 T0/T1 이 내는 것
export const STRICT_ERROR_BASES = new Set(['K1.5', 'K1.6', 'K2.4', 'K2.7', 'K3.3', 'K3.4', 'K4.1', 'K6.3']);
export const STRICT_STRONG_BASES = new Set(['K4.4', 'K5.1']); // 강한 경고(21/26어절 이상) -> 오류

/** 코드 블록·인라인 코드·URL 을 뺀 뒤 한글/(한글+라틴 글자) 비율 */
export function koreanRatio(text) {
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/https?:\/\/\S+/g, '');
  const ko = (body.match(/[가-힣]/g) ?? []).length;
  const en = (body.match(/[A-Za-z]/g) ?? []).length;
  if (ko < MIN_KO_CHARS) return 0;
  return ko / (ko + en);
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


export const USAGE = '사용: on | off | 80 | strict | t1 on | t1 off | t1 install | status';

/**
 * `/kste` 인자를 상태에 적용한다. hook CLI(`kste-hook.mjs set`)와 mod 가 같은 판정을 쓴다.
 * @returns {{ok:boolean, changed:boolean, state:object, error?:string}}
 */
export function applyStateArgs(state, args) {
  const next = { ...state };
  const [a, b] = args.map((x) => String(x).toLowerCase());
  if (a === 'on') next.enabled = true;
  else if (a === 'off') next.enabled = false;
  else if (a === '80' || a === '80%') next.mode = '80';
  else if (a === 'strict') next.mode = 'strict';
  else if (a === 't1' && b === 'install') return { ok: true, changed: false, state, action: 't1-install' };
  else if (a === 't1' && (b === 'on' || b === 'off')) next.t1 = b === 'on';
  else if (a && a !== 'status') return { ok: false, changed: false, state, error: `알 수 없는 인자: ${args.join(' ')}\n${USAGE}` };
  return { ok: true, changed: Boolean(a) && a !== 'status', state: next };
}

export function statusLine(state, where) {
  return `KSTE hook: ${state.enabled ? 'on' : 'off'} · 모드 ${state.mode === 'strict' ? 'strict' : '80%'} · T1 ${state.t1 ? 'on' : 'off'} · 상태 파일 ${where}`;
}

/** install-t1.mjs --check 결과(JSON 객체)를 한 줄로. mod 에서도 쓰므로 Node 모듈을 쓰지 않는다. */
export function t1StatusLine(rep) {
  if (!rep) return 'T1: 확인 못 함 (node scripts/install-t1.mjs --check 로 확인)';
  if (rep.installed) {
    const mb = ((rep.model?.sizeBytes ?? 0) / 1e6).toFixed(0);
    return `T1 설치됨(${rep.source}): ${rep.dir} · 모델 ${mb}MB · kiwi-nlp ${rep.kiwiNlp?.path ?? '-'}`;
  }
  const have = [rep.model?.installed ? '모델 있음' : '모델 없음', rep.kiwiNlp?.installed ? 'kiwi-nlp 있음' : 'kiwi-nlp 없음'].join(', ');
  return `T1 미설치 (${have}). 설치 위치 ${rep.installTarget} · 설치: /kste t1 install (약 110MB)`;
}
