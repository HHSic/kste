// T1 통합: T0 결과 + 형태소 검사 findings. 모델이 없으면 T0 만 돌린다 (폴백).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { lintText, getDefaultRuleset } from '../engine/tier0.js';
import { preprocess } from '../engine/preprocess.js';
import { splitSentences } from '../engine/sentences.js';
import { getT1, closeT1 } from './worker.js';
import { t1Available, ROOT } from './kiwi.js';
import { loadMorphPatterns } from './morph-pattern.js';
import { runT1Checks, spaceCandidate, T1_IMPLEMENTED } from './checks.js';

export { closeT1, T1_IMPLEMENTED };

let commonCache = null;
function loadCommonLatin() {
  if (commonCache) return commonCache;
  const f = path.join(ROOT, 'lib', 't1', 'common-latin.json');
  commonCache = new Set(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).words : []);
  return commonCache;
}

let patternCache = null;
function morphPatterns(rulesDir) {
  patternCache ??= new Map();
  const key = rulesDir ?? '';
  if (!patternCache.has(key)) patternCache.set(key, rulesDir ? loadMorphPatterns(rulesDir) : loadMorphPatterns());
  return patternCache.get(key);
}

/** 장르 기준선(피동문 %): 절차문=사용자 매뉴얼, 서술문=공공·기술 보고서·개발자 문서 평균 */
export function passiveBaselines(ruleset) {
  const g = ruleset.metrics?.baselines?.genres ?? {};
  const v = (k) => g[k]?.pct_passive_sentences;
  const desc = ['A_public_good', 'C_tech_report', 'D_developer_docs'].map(v).filter((x) => x != null);
  return {
    procedural: v('B_user_manual') ?? null,
    descriptive: desc.length ? desc.reduce((a, b) => a + b, 0) / desc.length : null,
  };
}

/** T1 사용 가능 여부와 요청 모드로 실제 사용 여부를 결정한다. mode: auto|on|off */
export function resolveT1Mode(mode = 'auto') {
  if (mode === 'off') return { use: false };
  const ok = t1Available();
  if (mode === 'on' && !ok) {
    return { use: false, error: 'T1 을 켤 수 없다: models/kiwi/ 모델 또는 kiwi-nlp 가 없다. `node scripts/install-model.mjs` 와 `npm install` 을 실행한다.' };
  }
  return { use: ok };
}

/**
 * T1 포함 검사. 모델이 없으면 T0 결과를 그대로 돌려준다.
 * @param {string} text
 * @param {{genre?:string, ruleset?:object, t1?:'auto'|'on'|'off', client?:object}} [opts]
 */
export async function lintTextT1(text, opts = {}) {
  const ruleset = opts.ruleset ?? getDefaultRuleset();
  const client = opts.t1 === 'off' ? null : (opts.client ?? (await getT1()));
  if (!client) return lintText(text, { ...opts, ruleset, t1: false });

  const t0 = lintText(text, { ...opts, ruleset, t1: true });
  const pre = preprocess(text);
  const sentences = splitSentences(pre);
  const toks = await client.analyzeMany(sentences.map((s) => s.text));
  sentences.forEach((s, i) => {
    s.tokens = toks[i].map((t) => ({ ...t, pos: t.pos + s.start }));
  });

  // K7.4 후보 문장만 띄어쓰기 교정을 요청한다
  const cand = sentences.filter(spaceCandidate);
  if (cand.length) {
    const fixed = await client.spaceMany(cand.map((s) => s.text));
    cand.forEach((s, i) => { s.spaced = fixed[i]; });
  }

  const metrics = { ...(ruleset.metrics?.metrics ?? {}), __baselines: passiveBaselines(ruleset) };
  const findings = [...t0.findings];
  const seen = new Set(findings.map((f) => `${f.ruleId}|${f.line}|${f.col}`));
  const add = (f) => {
    const key = `${f.ruleId}|${f.line}|${f.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ tier: 1, show: true, ...f });
  };
  runT1Checks({
    pre, sentences, add, metrics, ruleset,
    genre: t0.meta.genre, gaejosik: t0.meta.gaejosik,
    patterns: morphPatterns(opts.rulesDir), common: loadCommonLatin(),
  });
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.col ?? 0) - (b.col ?? 0) || a.ruleId.localeCompare(b.ruleId));
  return { findings, meta: { ...t0.meta, tier: 'T0+T1', t1: true, t1Info: client.info ?? null } };
}

// ---------- K8.3 명사 집합 보존 (diff) ----------
function termMap() {
  const map = new Map();
  const dir = path.join(ROOT, 'rules');
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((n) => /^terms.*\.ya?ml$/.test(n))) {
    const doc = YAML.parse(readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''));
    for (const t of doc?.terms ?? []) for (const v of t.variants ?? []) if (!/\s/.test(v)) map.set(v, t.preferred);
  }
  return map;
}

/** NNG/NNP 형태 집합 (코드 스팬 제외). 용어 사전의 변이형은 preferred 로 센다. */
export function nounSet(tokenLists, terms = new Map()) {
  const set = new Set();
  for (const toks of tokenLists) {
    for (const t of toks) if ((t.tag === 'NNG' || t.tag === 'NNP') && !t.code) set.add(terms.get(t.form) ?? t.form);
  }
  return set;
}

export function nounPreservation(a, b) {
  const inter = [...a].filter((x) => b.has(x));
  return { ratio: a.size ? inter.length / a.size : 1, kept: inter.length, total: a.size, lost: [...a].filter((x) => !b.has(x)) };
}

/**
 * K8.3 핵심 명사 보존율. 원문 명사가 3개 미만이면 검사하지 않는다 (규칙 문서의 178쌍 기준).
 * @returns {Promise<{findings:Array, stats:object}|null>} T1 이 없으면 null
 */
export async function compareT1(original, revised, opts = {}) {
  const client = opts.client ?? (await getT1());
  if (!client) return null;
  const textsOf = (t) => splitSentences(preprocess(t)).map((s) => s.text);
  const [ta, tb] = [textsOf(original), textsOf(revised)];
  const [ra, rb] = await Promise.all([client.analyzeMany(ta), client.analyzeMany(tb)]);
  const terms = termMap();
  const A = nounSet(ra, terms);
  const B = nounSet(rb, terms);
  const pr = nounPreservation(A, B);
  const warn = opts.warn ?? 0.6;
  const findings = [];
  if (A.size >= 3 && pr.ratio < warn) {
    findings.push({
      ruleId: 'K8.3', base: 'K8.3', kind: 'preserve', tier: 1, show: true, severity: 'warn', line: null, col: null,
      match: `명사 보존율 ${pr.ratio.toFixed(2)}`,
      suggest: `핵심 명사 ${pr.kept}/${pr.total}개만 남았다 (경계 ${warn.toFixed(2)}). 사라진 명사: ${pr.lost.slice(0, 8).join(', ')}`,
      ratio: Number(pr.ratio.toFixed(3)),
    });
  }
  return { findings, stats: { nounRatio: Number(pr.ratio.toFixed(3)), nounsBefore: A.size, nounsKept: pr.kept, lost: pr.lost } };
}
