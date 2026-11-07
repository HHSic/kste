// 규칙 컴파일(순수 함수). 파일·YAML 을 읽지 않으므로 Claude Code mod 환경에서도 쓴다.
export const SOURCES = [
  { file: 'banned.yaml', key: 'banned', kind: 'banned', field: 'surface' },
  { file: 'refined.yaml', key: 'refined', kind: 'refined', field: 'surface' },
  { file: 'patterns.yaml', key: 'patterns', kind: 'pattern', field: 'fallback_regex' },
];

/** 규칙 ID "K1.3-001" -> "K1.3" */
export function baseRuleId(id) {
  return String(id).replace(/^DEP-/, '').replace(/-\d+$/, '');
}

export function compileRegex(source, flagsField) {
  const flags = 'gu' + (flagsField === 'M' ? 'm' : '');
  return new RegExp(source, flags);
}

/**
 * 파싱된 규칙 객체({banned, refined, patterns, metrics})를 컴파일한다.
 * @returns {{rules:Array, failures:Array, counts:Object, metrics:Object|null}}
 */
export function compileRules(parsed) {
  const rules = [];
  const failures = [];
  const counts = { files: {}, total: 0, loaded: 0, deprecated: 0, t0Disabled: 0, compileFailed: 0 };

  for (const src of SOURCES) {
    const c = { total: 0, loaded: 0, deprecated: 0, t0Disabled: 0, compileFailed: 0 };
    counts.files[src.file] = c;
    const items = parsed?.[src.key];
    if (!items) continue;
    for (const it of items) {
      c.total++;
      if (it.status === 'deprecated') { c.deprecated++; continue; }
      if (it.t0_enabled === false) { c.t0Disabled++; continue; }
      const source = it[src.field];
      let regex;
      try {
        regex = compileRegex(source, it.flags);
      } catch (e) {
        c.compileFailed++;
        failures.push({ id: it.id, file: src.file, source, error: e.message });
        continue;
      }
      rules.push({
        id: it.id,
        base: baseRuleId(it.id),
        file: src.file,
        kind: src.kind,
        category: it.category ?? it.name ?? '',
        surface: source,
        flags: it.flags ?? '',
        regex,
        suggest: it.suggest ?? it.message ?? '',
        severity: it.severity ?? 'info',
        severityByGenre: it.severity_by_genre ?? null,
        showByDefault: it.show_by_default !== false,
        precision: it.precision ?? null,
        examples: it.examples ?? null,
        note: it.note ?? '',
        corpusHits: it.corpus_hits ?? null,
      });
      c.loaded++;
    }
    for (const k of ['total', 'loaded', 'deprecated', 't0Disabled', 'compileFailed']) counts[k] += c[k];
  }


  return { rules, failures, counts, metrics: parsed?.metrics ?? null };
}

// ---------- K1.1 용어 통일표 (terms.yaml) ----------
// 규칙 문서 K1.1: 용어 통일표에 등록된 변이형만 검사한다. 변이형마다 T0 규칙 하나를 만든다.
// 한글로 끝나는 명사 변이형의 오른쪽 경계는 refined.yaml 의 표면형과 같다.
const TERM_NOUN_END = '(?=하|해|했|한|함|할|합|되|돼|[은는이가을를의에도와과로만]|으로|에서|[^가-힣]|$)';
const TERM_PRED_POS = new Set(['VV', 'VA', 'XSV', 'XSA']);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termBody(word, pos) {
  let w = String(word ?? '').trim();
  if (TERM_PRED_POS.has(pos) && w.length > 1 && w.endsWith('다')) w = w.slice(0, -1); // 어간
  return w;
}

/**
 * 변이형 하나의 정규식 원문. 앞뒤가 다른 글자와 붙어 있으면 매치하지 않는다.
 * 같은 자리에서 preferred 로 읽히면 매치하지 않는다 (예: preferred '설정값', 변이형 '설정').
 */
export function termVariantSource(variant, { pos = 'NNG', preferred = '' } = {}) {
  const v = termBody(variant, pos);
  const toRe = (w) => w.split(/\s+/).map(escapeRegex).join('\\s+');
  const head = /^[가-힣]/.test(v) ? '(?<![가-힣])' : '(?<![A-Za-z0-9_])';
  const p = termBody(preferred, pos);
  const guard = p ? `(?!${toRe(p)})` : '';
  let tail;
  if (/[가-힣]$/.test(v)) tail = TERM_PRED_POS.has(pos) ? '(?=[가-힣])' : TERM_NOUN_END;
  else tail = '(?![A-Za-z0-9_])';
  return head + guard + toRe(v) + tail;
}

/**
 * 용어 통일표 항목을 K1.1 규칙으로 컴파일한다. example:true(템플릿 예시)와 deprecated 항목은 뺀다.
 * 등급: approved 변이형은 error(규칙 문서 K1.1), 그 밖(proposed)은 warn.
 * @param {Array<{preferred:string, variants:string[], pos?:string, status?:string, example?:boolean, scope?:string, file?:string}>} entries
 * @returns {{rules:Array, failures:Array, counts:Object}}
 */
export function compileTerms(entries = []) {
  const rules = [];
  const failures = [];
  const counts = { files: {}, total: 0, loaded: 0, deprecated: 0, t0Disabled: 0, compileFailed: 0 };
  let n = 0;
  for (const t of entries) {
    if (t?.example === true) continue;
    const file = t.file ?? 'terms.yaml';
    const c = (counts.files[file] ??= { total: 0, loaded: 0, deprecated: 0, t0Disabled: 0, compileFailed: 0 });
    const preferred = String(t.preferred ?? '').trim();
    for (const variant of t.variants ?? []) {
      c.total++;
      if (t.status === 'deprecated') { c.deprecated++; continue; }
      const id = `K1.1-${String(++n).padStart(3, '0')}`;
      const source = termVariantSource(variant, { pos: t.pos, preferred });
      let regex;
      try {
        regex = compileRegex(source);
      } catch (e) {
        c.compileFailed++;
        failures.push({ id, file, source, error: e.message });
        continue;
      }
      rules.push({
        id,
        base: 'K1.1',
        file,
        kind: 'terms',
        category: '용어 통일',
        surface: source,
        flags: '',
        regex,
        suggest: `${preferred} (용어 통일표 ${file})`,
        severity: t.status === 'approved' ? 'error' : 'warn',
        severityByGenre: null,
        showByDefault: true,
        precision: null,
        examples: null,
        note: t.scope ?? '',
        corpusHits: null,
      });
      c.loaded++;
    }
  }
  for (const c of Object.values(counts.files)) for (const k of ['total', 'loaded', 'deprecated', 't0Disabled', 'compileFailed']) counts[k] += c[k];
  return { rules, failures, counts };
}
