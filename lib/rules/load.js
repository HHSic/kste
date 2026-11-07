// rules/*.yaml 로더. deprecated / t0_enabled:false 제외, 정규식을 u 플래그로 컴파일한다.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';
import { SOURCES, baseRuleId, compileRegex, compileRules, compileTerms } from './compile.js';

export { baseRuleId, compileRegex };

export const DEFAULT_RULES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'rules',
);

function readYaml(file) {
  return YAML.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/** 프로젝트 루트: CLAUDE_PROJECT_DIR, 없으면 현재 폴더. */
export function defaultProjectDir(env = process.env) {
  return env.CLAUDE_PROJECT_DIR || process.cwd();
}

const TERMS_FILE = /^terms.*\.ya?ml$/;
const TEMPLATE_FILE = /\.template\./;

/**
 * 프로젝트 용어 통일표 <projectDir>/rules/terms*.yaml 을 읽는다. 템플릿(terms.template.yaml)은 읽지 않는다.
 * @returns {{entries:Array, failures:Array}} entries 의 file 은 프로젝트 기준 상대 경로
 */
export function loadProjectTerms(projectDir) {
  const entries = [];
  const failures = [];
  const dir = path.join(projectDir, 'rules');
  if (!existsSync(dir)) return { entries, failures };
  for (const name of readdirSync(dir).filter((n) => TERMS_FILE.test(n) && !TEMPLATE_FILE.test(n)).sort()) {
    const file = `rules/${name}`;
    try {
      for (const t of readYaml(path.join(dir, name))?.terms ?? []) entries.push({ ...t, file });
    } catch (e) {
      failures.push({ id: file, file, source: '', error: e.message });
    }
  }
  return { entries, failures };
}

/**
 * @param {string} [rulesDir] 플러그인 규칙 폴더
 * @param {{projectDir?:string|null}} [opts] 용어 통일표를 읽을 프로젝트 루트. null 이면 읽지 않는다.
 * @returns {{rules:Array, failures:Array, counts:Object, metrics:Object|null}}
 */
export function loadRules(rulesDir = DEFAULT_RULES_DIR, { projectDir = defaultProjectDir() } = {}) {
  const parsed = {};
  for (const src of SOURCES) {
    const file = path.join(rulesDir, src.file);
    if (existsSync(file)) parsed[src.key] = readYaml(file)?.[src.key] ?? [];
  }
  const mf = path.join(rulesDir, 'metrics.yaml');
  parsed.metrics = existsSync(mf) ? readYaml(mf) : null;
  const rs = compileRules(parsed);
  if (!projectDir) return rs;

  // K1.1: 프로젝트 용어 통일표의 변이형을 T0 규칙으로 더한다.
  const pt = loadProjectTerms(projectDir);
  const tc = compileTerms(pt.entries);
  rs.rules.push(...tc.rules);
  rs.failures.push(...pt.failures, ...tc.failures);
  for (const [f, c] of Object.entries(tc.counts.files)) rs.counts.files[f] = c;
  for (const k of ['total', 'loaded', 'deprecated', 't0Disabled', 'compileFailed']) rs.counts[k] += tc.counts[k];
  rs.counts.compileFailed += pt.failures.length;
  return rs;
}
