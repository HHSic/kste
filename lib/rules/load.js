// rules/*.yaml 로더. deprecated / t0_enabled:false 제외, 정규식을 u 플래그로 컴파일한다.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

export const DEFAULT_RULES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'rules',
);

const SOURCES = [
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

function readYaml(file) {
  return YAML.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/**
 * @returns {{rules:Array, failures:Array, counts:Object, metrics:Object|null}}
 */
export function loadRules(rulesDir = DEFAULT_RULES_DIR) {
  const rules = [];
  const failures = [];
  const counts = { files: {}, total: 0, loaded: 0, deprecated: 0, t0Disabled: 0, compileFailed: 0 };

  for (const src of SOURCES) {
    const file = path.join(rulesDir, src.file);
    const c = { total: 0, loaded: 0, deprecated: 0, t0Disabled: 0, compileFailed: 0 };
    counts.files[src.file] = c;
    if (!existsSync(file)) continue;
    const items = readYaml(file)?.[src.key] ?? [];
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

  let metrics = null;
  const mf = path.join(rulesDir, 'metrics.yaml');
  if (existsSync(mf)) metrics = readYaml(mf);

  return { rules, failures, counts, metrics };
}
