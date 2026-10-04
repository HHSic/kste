// 리포트: 설계안 §4.2 형식 Markdown + JSON.
export const SEVERITY_ORDER = { error: 3, warn: 2, info: 1 };

// 규칙 문서 §11 + 계층이 LLM/사람인 규칙. 매 리포트 끝에 고정 출력한다.
export const OUT_OF_SCOPE = [
  { id: 'K1.1', note: '통일표에 없는 변이형' },
  { id: 'K1.5', note: '사전 밖 한자어 교체' },
  { id: 'K1.6', note: '사전 밖 외래어 교체' },
  { id: 'K1.9', note: '지시어 대상 확인' },
  { id: 'K2.3', note: '조사 누락의 정확한 판정' },
  { id: 'K2.8', note: '주어 복원' },
  { id: 'K4.7', note: '참고 블록 안의 지시' },
  { id: 'K5.2', note: '단락 주제' },
  { id: 'K5.4', note: '핵심어 반복' },
  { id: 'K6.5', note: '위험 수준' },
  { id: 'K8.4', note: '부정 극성 판정' },
  { id: '중의성', note: '한 문장이 두 뜻으로 읽히는지' },
];

// T1(형태소 분석)이 있어야 검사되는 규칙. T0 만 돌 때 미검사로 알린다.
export const T1_ONLY = ['K1.7', 'K2.3', 'K2.5', 'K2.6(정밀)', 'K2.7(정밀)', 'K2.9', 'K3.1', 'K3.2', 'K3.4', 'K4.1', 'K4.2', 'K4.3', 'K4.5', 'K6.2', 'K7.4', 'K8.3'];

// T1 이 켜져 있어도 근사로만 검사하는 규칙 (정밀 판정은 아님)
export const T1_PARTIAL = ['K2.3(근사: 명사 연속 뒤 조사 없는 용언)', 'K4.5(한 문장 조건 하나만)', 'K6.2(라벨·경고 절의 문장만)', 'K7.4(Kiwi space 보조)'];

export function filterFindings(findings, { all = false } = {}) {
  return all ? findings : findings.filter((f) => f.show !== false);
}

export function countBySeverity(findings) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const f of findings) c[f.severity] = (c[f.severity] ?? 0) + 1;
  return c;
}

export function buildReport(result, { all = false, ruleStats = null, title = 'KSTE' } = {}) {
  const visible = filterFindings(result.findings, { all });
  const hidden = result.findings.length - visible.length;
  const counts = countBySeverity(visible);
  return {
    summary: {
      total: visible.length,
      hidden,
      ...counts,
      tier: result.meta?.tier ?? 'T0',
      t1: !!result.meta?.t1,
      t1Findings: visible.filter((f) => f.tier === 1).length,
      mode: '80%',
      genre: result.meta?.genre ?? null,
      genreSource: result.meta?.genreSource ?? null,
    },
    findings: visible,
    meta: result.meta ?? {},
    t1Skipped: ruleStats ? ruleStats.t0Disabled : null,
    t1Only: result.meta?.t1 ? [] : T1_ONLY,
    t1Partial: result.meta?.t1 ? T1_PARTIAL : [],
    outOfScope: OUT_OF_SCOPE,
    title,
  };
}

function fmtLoc(f) {
  return f.line == null ? '—' : `L${f.line}:${f.col}`;
}

export function renderMarkdown(report) {
  const s = report.summary;
  const out = [];
  const genreNote = s.genre ? ` · 장르 ${s.genre}(${s.genreSource})` : '';
  if (s.t1) out.push(`[${report.title}] ${s.total} findings (T0 ${s.total - s.t1Findings} + T1 ${s.t1Findings}) · T1 active · mode ${s.mode}${genreNote}`);
  else out.push(`[${report.title}] ${s.total} findings (T0 ${s.total}) · T1 inactive · mode ${s.mode}${genreNote}`);
  out.push(`error ${s.error} · warn ${s.warn} · info ${s.info}` + (s.hidden ? ` · 숨김 ${s.hidden}건 (--all 로 표시)` : ''));
  const sorted = [...report.findings].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || (a.line ?? 0) - (b.line ?? 0) || (a.col ?? 0) - (b.col ?? 0),
  );
  for (const f of sorted) {
    const sev = f.severity.padEnd(5);
    const id = f.ruleId.padEnd(8);
    const loc = fmtLoc(f).padEnd(7);
    const hid = f.show === false ? ' [숨김 대상]' : '';
    const low = f.precision === 'low' ? ' [정밀도 낮음]' : '';
    const strong = f.strong ? ' [강한 경고]' : '';
    out.push(`${sev}  ${id} ${loc} "${f.match}" → ${f.suggest}${strong}${low}${hid}`);
  }
  out.push('--- 린터 범위 밖 (사람 확인) ---');
  out.push(report.outOfScope.map((o) => (o.id === '중의성' ? '중의성 일반' : `${o.id} ${o.note}`)).join(', '));
  if (s.t1) {
    out.push('--- T1 미검사 규칙 없음 (아래 규칙은 근사 검사) ---');
    if (report.t1Partial.length) out.push(report.t1Partial.join(', '));
  } else {
    out.push(`--- T1 미설치로 미검사 (규칙 ${report.t1Only.length}개) ---`);
    out.push(report.t1Only.join(', ') + (report.t1Skipped ? ` · YAML T0 비활성 패턴 ${report.t1Skipped}개` : ''));
  }
  return out.join('\n') + '\n';
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2) + '\n';
}

/** fail-on 이상 등급이 하나라도 있으면 true */
export function shouldFail(findings, failOn = 'error') {
  const th = SEVERITY_ORDER[failOn] ?? SEVERITY_ORDER.error;
  return findings.some((f) => (SEVERITY_ORDER[f.severity] ?? 0) >= th);
}
