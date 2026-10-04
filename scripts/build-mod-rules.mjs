#!/usr/bin/env node
// rules/*.yaml -> lib/rules/bundle.js. Claude Code mod 은 Node 모듈(fs, yaml)을 못 쓰므로, 규칙을 JS 데이터로 미리 구워 둔다.
// deprecated / t0_enabled:false 규칙은 뺀다. 규칙 YAML 을 고치면 `npm run build-mod-rules` 를 다시 돌린다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { SOURCES } from '../lib/rules/compile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = ['id', 'category', 'name', 'surface', 'fallback_regex', 'flags', 'suggest', 'message', 'severity', 'severity_by_genre', 'show_by_default', 'precision', 'examples', 'note', 'corpus_hits'];

const readYaml = (f) => YAML.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));

export function buildBundle(rulesDir = path.join(root, 'rules')) {
  const out = {};
  for (const src of SOURCES) {
    const file = path.join(rulesDir, src.file);
    const items = existsSync(file) ? readYaml(file)?.[src.key] ?? [] : [];
    out[src.key] = items
      .filter((it) => it.status !== 'deprecated' && it.t0_enabled !== false)
      .map((it) => Object.fromEntries(KEEP.filter((k) => it[k] !== undefined).map((k) => [k, it[k]])));
  }
  const mf = path.join(rulesDir, 'metrics.yaml');
  out.metrics = existsSync(mf) ? readYaml(mf) : null;
  return out;
}

export function renderBundle(bundle) {
  return `// 자동 생성: scripts/build-mod-rules.mjs. 직접 고치지 않는다.\n// rules/*.yaml 의 T0 규칙(deprecated·t0_enabled:false 제외)을 데이터로 구운 것. mod 가 Node 없이 읽는다.\nexport default ${JSON.stringify(bundle)};\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(root, 'lib', 'rules', 'bundle.js');
  writeFileSync(target, renderBundle(buildBundle()));
  console.log(`wrote ${target}`);
}
