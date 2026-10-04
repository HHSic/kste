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
