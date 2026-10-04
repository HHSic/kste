// patterns.yaml 의 morph DSL 파서·매처.
//   공백             인접한 형태소 (토큰 열에서 연속한 위치)
//   TAG              품사 태그만 지정 (NNG, XSV ...)
//   TAG:FORM         품사 + 형태.  FORM 은 정확히 일치, `*히`(끝), `시*`(앞), `*`(전부), `(ㅁ|음)` 선택
//   (A|B|...)        선택. 각 항목은 TAG 또는 TAG:FORM
//   X?               앞 항목이 있어도 되고 없어도 된다
//   !(A|B|...)       문장에 해당 품사(TAG[:FORM])가 하나도 없음 (문장 전체 조건)
//   chain(T1|T2, eojeol>=N, josa=none)   조건을 만족하는 어절이 N개 이상 연속 (어절 단위 규칙)
// 토큰 형식: {form, tag, wp, sp, pos, len}. form 은 호환 자모로 정규화돼 있어야 한다 (kiwi.js normJamo).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT } from './kiwi.js';

/** 괄호 깊이 0 에서 sep 로 나눈다 */
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 공백으로 나누되 괄호 안 공백은 유지 */
function splitItems(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function parseForm(f) {
  let body = f;
  if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1);
  const alts = splitTop(body, '|').map((x) => x.trim()).filter(Boolean);
  if (!alts.length) throw new Error(`빈 형태 지정: ${f}`);
  const res = alts.map((a) => new RegExp(`^${a.split('*').map(escapeRe).join('.*')}$`, 'u'));
  return (form) => res.some((r) => r.test(form));
}

function parseAlt(s) {
  const t = s.trim();
  const i = t.indexOf(':');
  const tag = i < 0 ? t : t.slice(0, i);
  if (!/^[A-Z][A-Z0-9_]*$/.test(tag)) throw new Error(`품사 태그가 아니다: ${s}`);
  const formOk = i < 0 ? null : parseForm(t.slice(i + 1));
  return { tag, formOk, src: t };
}

function parseAtom(item) {
  let it = item;
  let optional = false;
  if (it.endsWith('?')) {
    optional = true;
    it = it.slice(0, -1);
  }
  const alts = it.startsWith('(') && it.endsWith(')') ? splitTop(it.slice(1, -1), '|').map(parseAlt) : [parseAlt(it)];
  return { optional, alts };
}

/**
 * morph 문자열을 파싱한다.
 * @returns {{type:'seq',atoms:Array,src:string}|{type:'absent',alts:Array,src}|{type:'chain',tags:Set,min:number,src}}
 */
export function parseMorph(src) {
  const s = src.trim();
  if (s.startsWith('!(') && s.endsWith(')')) {
    return { type: 'absent', alts: splitTop(s.slice(2, -1), '|').map(parseAlt), src };
  }
  const cm = s.match(/^chain\((.*)\)$/);
  if (cm) {
    const parts = splitTop(cm[1], ',').map((x) => x.trim());
    const tags = new Set(splitTop(parts[0], '|').map((x) => x.trim()));
    const eo = parts.find((p) => /^eojeol\s*>=\s*\d+$/.test(p));
    return { type: 'chain', tags, min: eo ? Number(eo.match(/\d+/)[0]) : 2, josaNone: parts.includes('josa=none'), src };
  }
  const atoms = splitItems(s).map(parseAtom);
  if (!atoms.length) throw new Error('빈 morph 패턴');
  return { type: 'seq', atoms, src };
}

const altMatch = (alt, tok) => tok.tag === alt.tag && (!alt.formOk || alt.formOk(tok.form));
const atomMatch = (atom, tok) => atom.alts.some((a) => altMatch(a, tok));

// atoms[ai..] 가 tokens[ti..] 에 맞는지 (선택 항목은 건너뛰기 허용). 맞으면 끝 인덱스(exclusive), 아니면 -1. 긴 매치 우선.
function matchFrom(atoms, ai, tokens, ti) {
  if (ai === atoms.length) return ti;
  const atom = atoms[ai];
  if (ti < tokens.length && atomMatch(atom, tokens[ti])) {
    const r = matchFrom(atoms, ai + 1, tokens, ti + 1);
    if (r >= 0) return r;
  }
  if (atom.optional) return matchFrom(atoms, ai + 1, tokens, ti);
  return -1;
}

/**
 * seq 패턴을 토큰 열에서 찾는다. 겹치지 않게 왼쪽부터.
 * @returns {{start:number,end:number}[]} 토큰 인덱스 구간 [start,end)
 */
export function matchSeq(pattern, tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; ) {
    const end = matchFrom(pattern.atoms, 0, tokens, i);
    if (end > i) {
      out.push({ start: i, end });
      i = end;
    } else i++;
  }
  return out;
}

/** 문장에 pattern.alts 가 하나도 없으면 true */
export function matchAbsent(pattern, tokens) {
  return !tokens.some((t) => pattern.alts.some((a) => altMatch(a, t)));
}

/** 토큰 열 -> 어절 목록. 같은 (sp, wp) 가 연속하면 한 어절. */
export function toEojeols(tokens, text = null, base = 0) {
  const out = [];
  let cur = null;
  tokens.forEach((t, i) => {
    if (!cur || cur.sp !== t.sp || cur.wp !== t.wp) {
      cur = { sp: t.sp, wp: t.wp, tokens: [], first: i, last: i, start: t.pos, end: t.pos + t.len };
      out.push(cur);
    }
    cur.tokens.push(t);
    cur.last = i;
    cur.end = Math.max(cur.end, t.pos + t.len);
  });
  if (text != null) for (const e of out) e.text = text.slice(e.start - base, e.end - base);
  return out;
}

const PUNCT_TAGS = new Set(['SF', 'SP', 'SS', 'SSO', 'SSC', 'SE', 'SO', 'SW']);
const JOSA_TAGS = new Set(['JKS', 'JKC', 'JKG', 'JKO', 'JKB', 'JKV', 'JKQ', 'JX', 'JC']);
export const isJosaTag = (t) => JOSA_TAGS.has(t);

/** 어절이 tags 에 속한 형태소만으로 이뤄졌는지 (괄호·기호는 무시, 조사가 있으면 josaNone 일 때 탈락) */
export function eojeolInTags(e, tags) {
  let n = 0;
  for (const t of e.tokens) {
    if (PUNCT_TAGS.has(t.tag) && t.tag !== 'SW') continue;
    if (!tags.has(t.tag) || t.code) return false;
    n++;
  }
  return n > 0;
}

/**
 * chain 패턴: 조건을 만족하는 어절이 min 개 이상 연속하는 구간.
 * 어절에 문장부호(쉼표·마침표 등 SF/SP/SE)가 붙어 있으면 그 어절에서 연쇄를 끊는다.
 * @returns {{startEojeol:number,endEojeol:number,length:number}[]} [start,end) 어절 인덱스
 */
export function matchChain(pattern, eojeols, { min = pattern.min } = {}) {
  const out = [];
  let start = -1;
  const flush = (end) => {
    if (start >= 0 && end - start >= min) out.push({ startEojeol: start, endEojeol: end, length: end - start });
    start = -1;
  };
  eojeols.forEach((e, i) => {
    if (eojeolInTags(e, pattern.tags)) {
      if (start < 0) start = i;
      if (e.tokens.some((t) => ['SF', 'SP', 'SE'].includes(t.tag))) flush(i + 1);
    } else flush(i);
  });
  flush(eojeols.length);
  return out;
}

/** 매치 구간의 위치 정보 (문자 오프셋, 어절 번호) */
export function locate(tokens, m) {
  const a = tokens[m.start];
  const b = tokens[m.end - 1];
  return {
    pos: a.pos,
    endPos: b.pos + b.len,
    wordStart: a.wp,
    wordEnd: b.wp,
    sent: a.sp,
    line: a.line,
    forms: tokens.slice(m.start, m.end).map((t) => `${t.form}/${t.tag}`).join(' '),
  };
}

/** 한 번에: 패턴 문자열 + 토큰 열 -> 매치 목록(위치 포함) */
export function findMorph(src, tokens) {
  const p = typeof src === 'string' ? parseMorph(src) : src;
  if (p.type === 'seq') return matchSeq(p, tokens).map((m) => ({ ...m, ...locate(tokens, m) }));
  if (p.type === 'absent') return matchAbsent(p, tokens) ? [{ start: 0, end: tokens.length, absent: true }] : [];
  throw new Error('chain 패턴은 matchChain 으로 어절 목록에 적용한다');
}

/** rules/patterns.yaml 의 항목 중 morph 가 있는 것. DEP-/deprecated 는 뺀다. */
export function loadMorphPatterns(rulesDir = path.join(ROOT, 'rules')) {
  const file = path.join(rulesDir, 'patterns.yaml');
  if (!existsSync(file)) return [];
  const items = YAML.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))?.patterns ?? [];
  const out = [];
  for (const it of items) {
    if (!it.morph || it.status === 'deprecated' || String(it.id).startsWith('DEP-')) continue;
    out.push({ ...it, parsed: parseMorph(it.morph) });
  }
  return out;
}
