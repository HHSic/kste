// Tier 0 검사: 정규식·표면형만 쓴다 (형태소 분석 없음).
import { loadRules } from '../rules/load.js';
import { preprocess } from './preprocess.js';
import { splitSentences } from './sentences.js';
import { countWords } from './words.js';

let cachedRuleset = null;
export function getDefaultRuleset() {
  if (!cachedRuleset) cachedRuleset = loadRules();
  return cachedRuleset;
}

const FALLBACK_METRICS = {
  procedural_words: { warn: 16, strong: 20 },
  descriptive_words: { warn: 20, strong: 25 },
  paragraph_sentences: { warn: 6 },
  noun_chain_words: { warn: 4, error: 6 },
};

// T1 이 정밀하게 대신하는 규칙 (T1 활성 시 T0 의 근사·정규식 항목을 끈다)
export const T1_REPLACES = new Set(['K2.6-001', 'K2.9-001']);

export const IMPERATIVE_RATIO_PROCEDURAL = 0.15; // 매뉴얼 명령형 17.9%, 개발자 문서 8.0%, 보고서 0.7% (metrics.yaml 기준선)
const RE_IMPERATIVE = /(?:세요|십시오|시오|하라|마라|주세요|으세요)[\s.!)"'”’]*$/;
const RE_GAEJOSIK_END = /(?:함|됨|음|임)$/;
// 명사로 굳은 -음/-임/-함 어휘 (문장 끝에 와도 개조식 종결로 보지 않는다)
const GAEJOSIK_EXCEPT = /(?:책임|소음|얼음|웃음|발음|화음|울음|걸음|죽음|젊음|믿음|보관함|우편함|도구함|서랍함|담임|겸임|역임|포함|결함|임금|경험|침묵|고함|장함|기록함|보호함|수신함|발신함|휴지함|설정함|메모리음)$/;

const GENRE_ALIASES = {
  procedural: 'procedural', 절차문: 'procedural', 절차: 'procedural',
  descriptive: 'descriptive', 서술문: 'descriptive', 서술: 'descriptive',
  개조식: 'gaejosik', gaejosik: 'gaejosik',
};

const trunc = (s, n = 40) => (s.length > n ? s.slice(0, n) + '…' : s);
const clean = (s) => s.replace(/[]/g, '▒');

function resolveGenre(opt, pre, sentences) {
  const ratioBase = sentences.filter((s) => !s.isHeading && !s.isTableCell);
  const imperative = ratioBase.filter((s) => RE_IMPERATIVE.test(s.text)).length;
  const ratio = ratioBase.length ? imperative / ratioBase.length : 0;
  const fmRaw = pre.frontmatter.genre;
  const fm = fmRaw ? GENRE_ALIASES[fmRaw.trim()] : null;
  let genre;
  let source;
  let gaejosik = false;
  if (opt && opt !== 'auto') {
    genre = GENRE_ALIASES[opt] ?? opt;
    source = 'option';
  } else if (fm) {
    genre = fm;
    source = 'frontmatter';
  } else {
    genre = ratio >= IMPERATIVE_RATIO_PROCEDURAL ? 'procedural' : 'descriptive';
    source = 'auto';
  }
  if (genre === 'gaejosik') {
    gaejosik = true;
    genre = 'descriptive';
  }
  if (fm === 'gaejosik') gaejosik = true;
  return { genre, source, gaejosik, imperativeRatio: Number(ratio.toFixed(3)) };
}

/**
 * @param {string} text Markdown 원문
 * @param {{genre?:string, ruleset?:object, nounChain?:boolean, t1?:boolean}} [opts] t1:true 이면 T1 이 활성이라 K2.1 근사·명사 연쇄 근사·T1 대체 규칙을 끈다
 * @returns {{findings:Array, meta:Object}}
 */
export function lintText(text, opts = {}) {
  const ruleset = opts.ruleset ?? getDefaultRuleset();
  const metrics = { ...FALLBACK_METRICS, ...(ruleset.metrics?.metrics ?? {}) };
  const pre = preprocess(text);
  const sentences = splitSentences(pre);
  const g = resolveGenre(opts.genre, pre, sentences);
  const findings = [];
  const seen = new Set();

  const add = (f) => {
    const key = `${f.ruleId}|${f.line}|${f.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ tier: 0, show: true, ...f });
  };

  // (a) 사전 규칙: banned / refined / patterns(fallback_regex)
  const lineKind = (line) => pre.lines[line - 1]?.kind;
  for (const rule of ruleset.rules) {
    if (opts.t1 === true && T1_REPLACES.has(rule.id)) continue;
    for (const m of pre.masked.matchAll(rule.regex)) {
      if (m[0].length === 0) continue;
      const { line, col } = pre.toLineCol(m.index);
      if (['code', 'frontmatter', 'hr', 'table-sep'].includes(lineKind(line))) continue;
      const severity = rule.severityByGenre?.[g.genre] ?? rule.severity;
      add({
        ruleId: rule.id,
        base: rule.base,
        kind: 'dict',
        source: rule.kind,
        severity,
        line,
        col,
        match: clean(m[0]).trim() || clean(m[0]),
        suggest: rule.suggest,
        show: rule.showByDefault,
      });
    }
  }

  // (b) 길이 K4.4 / K5.1
  const lenMetric = g.genre === 'procedural' ? metrics.procedural_words : metrics.descriptive_words;
  const lenRule = g.genre === 'procedural' ? 'K4.4' : 'K5.1';
  const wordInfo = new Map();
  for (const s of sentences) {
    const w = countWords(s.text);
    wordInfo.set(s, w);
    if (s.isHeading || s.isTableCell) continue;
    if (w.count > lenMetric.warn) {
      const strong = w.count > lenMetric.strong;
      add({
        ruleId: lenRule, base: lenRule, kind: 'length', severity: 'warn', strong,
        line: s.line, col: s.col, match: trunc(clean(s.text)),
        suggest: `${w.count}어절 (제한 ${lenMetric.warn}${strong ? `, 강한 경고 ${lenMetric.strong} 초과` : ''}). 두 문장으로 나눈다`,
        words: w.count,
      });
    }
  }

  // (c) 세미콜론 K3.3, 쉼표 나열 K3.5, 단락 문장 수 K5.2
  for (const ln of pre.lines) {
    if (['code', 'frontmatter', 'hr', 'table-sep', 'blank'].includes(ln.kind)) continue;
    const seg = pre.masked.slice(ln.contentStart, ln.end);
    for (const m of seg.matchAll(/;/g)) {
      if (/&#?\w+$/.test(seg.slice(Math.max(0, m.index - 8), m.index))) continue; // HTML 엔티티
      const { line, col } = pre.toLineCol(ln.contentStart + m.index);
      add({
        ruleId: 'K3.3', base: 'K3.3', kind: 'punct', severity: 'warn', line, col,
        match: clean(seg.slice(Math.max(0, m.index - 6), m.index + 7)).trim(),
        suggest: '세미콜론 대신 두 문장으로 나눈다',
      });
    }
  }
  for (const s of sentences) {
    if (s.isHeading || s.isTableCell) continue;
    const segs = s.text.split(/,\s+/);
    if (segs.length >= 3) {
      const shortCount = segs.slice(0, -1).filter((x) => countWords(x).count <= 3).length;
      if (shortCount >= 2) {
        add({
          ruleId: 'K3.5', base: 'K3.5', kind: 'list', severity: 'info', line: s.line, col: s.col,
          match: trunc(clean(s.text)), suggest: `쉼표 나열 ${segs.length}개. 세로 목록으로 쓴다`,
        });
      }
    }
  }
  if (g.genre === 'descriptive') {
    const byPara = new Map();
    for (const s of sentences) if (s.para >= 0) (byPara.get(s.para) ?? byPara.set(s.para, []).get(s.para)).push(s);
    for (const arr of byPara.values()) {
      if (arr.length > metrics.paragraph_sentences.warn) {
        add({
          ruleId: 'K5.2', base: 'K5.2', kind: 'paragraph', severity: 'info', line: arr[0].line, col: arr[0].col,
          match: trunc(clean(arr[0].text)), suggest: `단락 ${arr.length}문장 (권장 ${metrics.paragraph_sentences.warn} 이하). 한 주제만 남기고 나눈다`,
        });
      }
    }
  }

  // (d) 개조식 종결 K2.1 (목록 항목·제목·표 셀 면제). T1 활성 시 형태소 기반 정밀판이 대신한다.
  for (const s of opts.t1 === true ? [] : sentences) {
    if (s.isListItem || s.isHeading || s.isTableCell) continue;
    const core = s.text.replace(/[\s.!?)"'”’\]」』]+$/u, '');
    if (!RE_GAEJOSIK_END.test(core) || GAEJOSIK_EXCEPT.test(core)) continue;
    if (countWords(core).count < 2) continue;
    const tail = core.slice(-8);
    add({
      ruleId: 'K2.1', base: 'K2.1', kind: 'ending', severity: g.gaejosik ? 'warn' : 'error',
      line: s.line, col: s.col + Math.max(0, s.text.indexOf(core) + core.length - 4),
      match: clean(tail), suggest: '서술어로 끝맺는다 (-합니다/-한다). 개조식 종결 -함/-됨/-음/-임',
    });
  }

  // 명사 연쇄 K2.7 (T0 근사, 기본 꺼짐)
  if (opts.nounChain && opts.t1 !== true) {
    for (const s of sentences) {
      if (s.isHeading || s.isTableCell || s.isListItem) continue;
      const nc = wordInfo.get(s).nounChain;
      if (nc.max >= metrics.noun_chain_words.warn) {
        const longest = nc.chains.reduce((a, c) => (c.length > a.length ? c : a), []);
        add({
          ruleId: 'K2.7', base: 'K2.7', kind: 'nounchain', severity: 'warn', precision: 'low',
          line: s.line, col: s.col, match: longest.join(' '),
          suggest: `명사 연쇄 ${nc.max}어절 (T0 근사, 정밀도 낮음). 조사를 넣어 푼다`,
        });
      }
    }
  }

  findings.sort((a, b) => a.line - b.line || a.col - b.col || a.ruleId.localeCompare(b.ruleId));
  return {
    findings,
    meta: {
      genre: g.genre,
      genreSource: g.source,
      gaejosik: g.gaejosik,
      imperativeRatio: g.imperativeRatio,
      sentenceCount: sentences.length,
      charCount: text.length,
      tier: 'T0',
      t1: false,
    },
  };
}
