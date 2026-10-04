// rules/*.yaml 로더. deprecated / t0_enabled:false 제외, 정규식을 u 플래그로 컴파일한다.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';
import { SOURCES, baseRuleId, compileRegex, compileRules } from './compile.js';

export { baseRuleId, compileRegex };

export const DEFAULT_RULES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'rules',
);

function readYaml(file) {
  return YAML.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/**
 * @returns {{rules:Array, failures:Array, counts:Object, metrics:Object|null}}
 */
export function loadRules(rulesDir = DEFAULT_RULES_DIR) {
  const parsed = {};
  for (const src of SOURCES) {
    const file = path.join(rulesDir, src.file);
    if (existsSync(file)) parsed[src.key] = readYaml(file)?.[src.key] ?? [];
  }
  const mf = path.join(rulesDir, 'metrics.yaml');
  parsed.metrics = existsSync(mf) ? readYaml(mf) : null;
  return compileRules(parsed);
}
