// 채팅 답변용 KSTE: 시스템 프롬프트 지시문과 답변 T0 검사. Claude Code mod(hooks/kste-mod.js)가 쓴다.
// Node 모듈을 쓰지 않는다. 규칙은 lib/rules/bundle.js(YAML 을 구운 데이터)에서 읽는다.
import { lintText } from './tier0-core.js';
import { compileRules } from '../rules/compile.js';
import bundle from '../rules/bundle.js';
import { koreanRatio, applyMode, MIN_KO_RATIO } from './mode.js';

export const DIRECTIVE_MAX_CHARS = 1200;
export const MAX_REPORT_LINES = 40;

const BASE = `KSTE 한국어 작문 규칙. 한국어로 답할 때 적용합니다. 코드, 명령어, 파일명, URL은 그대로 둡니다.
제1원칙: 독자가 추론할 것을 남기지 않습니다. 조사와 서술어를 채우고, 어려운 말을 풀고, 한 문장에 한 뜻만 담습니다. 짧게 쓰는 것이 목적이 아닙니다.
오류(쓰지 않음): 이중피동(되어지다), 서술어 없는 문장, -할 것·-바람 지시, 에 있어서 같은 번역투, 같은 뜻 겹침, 용어 불일치, 숫자 누락.
경고(되도록 피함): 절차문 17어절·서술문 21어절 이상, 명사 연쇄 4어절 이상, 조건 후행, 한 항목에 동작 3개 이상.
- 지시는 -세요(금지는 -지 마세요), 설명은 -ㅂ니다로 씁니다. 한 답변에 한 체계만 씁니다.
- 조건은 앞, 지시는 뒤에 둡니다. 한 문장에 조건 하나만 둡니다.
- 항목당 동작은 2개 이하로 합니다. 셋이면 항목을 나눕니다.
- 같은 동작은 한 동사로 통일하고, 행위자가 있으면 능동으로 씁니다.
- 3개 이상 나열은 목록으로, 순서가 있으면 번호 목록으로 씁니다.
실무 기준: 에 대하여, 을 통해, N 시, 업로드 같은 통용 표현은 고치지 않습니다. 틀린 것만 고칩니다.
정보 보존: 숫자, 단위, 부정어, 고유명사를 빼거나 바꾸지 않습니다. 짧게 줄이려고 내용을 지우지 않습니다.`;

const STRICT = `
엄격 모드: 다음은 경고가 아니라 오류입니다. 절차문 21어절 이상, 서술문 26어절 이상의 문장. 세미콜론(;) 사용. 한 답변에서 종결체 혼용. 지시를 -세요로 쓰지 않음. 명사 연쇄 4어절 이상.`;

/** 시스템 프롬프트에 넣는 지시문. skills/kste/SKILL.md 본문을 압축한 것이다. */
export function directiveOf(mode) {
  return mode === 'strict' ? BASE + STRICT : BASE;
}

let ruleset = null;
function getRuleset() {
  if (!ruleset) ruleset = compileRules(bundle);
  return ruleset;
}

const line = (f) => `${f.severity.padEnd(5)} ${f.ruleId} L${f.line ?? '-'}${f.col != null ? ':' + f.col : ''} "${f.match}" -> ${f.suggest}`;

/**
 * 답변을 T0 로 검사한다. 한국어가 아니면(비율 < 0.3) null.
 * @returns {null | {errors:number, warns:number, mode:string, lines:string[], at:number}}
 */
export function lintAnswer(text, mode = '80', at = 0) {
  if (!text || koreanRatio(text) < MIN_KO_RATIO) return null;
  const result = lintText(text, { genre: 'auto', ruleset: getRuleset() });
  const findings = applyMode(result.findings.filter((f) => f.show !== false), mode);
  const errs = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  const ordered = [...errs, ...warns];
  return { errors: errs.length, warns: warns.length, mode, at, lines: ordered.slice(0, MAX_REPORT_LINES).map(line), more: Math.max(0, ordered.length - MAX_REPORT_LINES) };
}

export const toastOf = (r) => `KSTE: error ${r.errors} · warn ${r.warns}`;

export function reportOf(r) {
  if (!r) return 'KSTE: 검사한 답변이 없습니다. 한국어 답변이 나온 뒤에 다시 보세요.';
  const head = `${toastOf(r)} (${r.mode === 'strict' ? '엄격' : '80%'} 모드, T0)`;
  if (r.errors + r.warns === 0) return `${head}\n지적 없음.`;
  return [head, ...r.lines, ...(r.more ? [`(${r.more}건 더 있음)`] : [])].join('\n');
}
