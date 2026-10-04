// Kiwi WASM 로더 (kiwi-nlp). 모델(models/kiwi/)이 없거나 kiwi-nlp 가 없으면 null 을 돌려 T0 로 폴백한다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_MODEL_DIR = path.join(ROOT, 'models', 'kiwi');
export const MODEL_FILES = ['combiningRule.txt', 'default.dict', 'dialect.dict', 'extract.mdl', 'multi.dict', 'nounchr.mdl', 'sj.morph', 'typo.dict', 'cong.mdl'];

export function modelInstalled(dir = DEFAULT_MODEL_DIR) {
  return MODEL_FILES.every((f) => existsSync(path.join(dir, f)));
}

/** kiwi-nlp 패키지 위치(없으면 null). 선택 의존성이라 import 대신 resolve 로 확인한다. */
export function kiwiPackagePath() {
  try {
    const require = createRequire(import.meta.url);
    return path.dirname(require.resolve('kiwi-nlp/package.json'));
  } catch {
    const p = path.join(ROOT, 'node_modules', 'kiwi-nlp');
    return existsSync(path.join(p, 'package.json')) ? p : null;
  }
}

export function t1Available(dir = DEFAULT_MODEL_DIR) {
  return modelInstalled(dir) && kiwiPackagePath() !== null;
}

// ---- 자모 정규화: Kiwi 는 받침 어미를 조합형 종성(U+11A8~11C2)으로 돌려준다 (ᆸ니다, ᆫ다, ᆷ). 호환 자모로 바꾼다.
const JONG = 'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
export function normJamo(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    out += c >= 0x11a8 && c <= 0x11c2 ? JONG[c - 0x11a8] : ch;
  }
  return out;
}

export const normTag = (tag) => tag.split('-')[0];

/**
 * UTF-8 바이트 오프셋 -> JS 문자열(UTF-16) 인덱스 변환기.
 * Kiwi splitIntoSents 의 스팬은 바이트 오프셋이다. 토큰의 position 은 UTF-16 인덱스다.
 */
export function makeByteToChar(str) {
  const map = new Map();
  let b = 0;
  for (let i = 0; i < str.length; ) {
    map.set(b, i);
    const cp = str.codePointAt(i);
    b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  map.set(b, str.length);
  return (byteOffset) => {
    const v = map.get(byteOffset);
    if (v === undefined) throw new RangeError(`UTF-8 문자 경계가 아닌 바이트 오프셋: ${byteOffset}`);
    return v;
  };
}
export function byteToCharOffset(str, byteOffset) {
  return makeByteToChar(str)(byteOffset);
}
export function utf8Length(str) {
  return Buffer.byteLength(str, 'utf8');
}

// 전처리 플레이스홀더(U+E000, U+E001): 코드·URL 등 보호 영역
const RE_PH = /^[]+$/u;

/**
 * Kiwi TokenInfo -> 규칙 코드가 쓰는 토큰.
 * @returns {{form,tag,wp,sp,line,pos,len,code}}
 */
export function toToken(t, base = 0) {
  return {
    form: normJamo(t.str),
    tag: normTag(t.tag),
    wp: t.wordPosition,
    sp: t.sentPosition,
    line: t.lineNumber,
    pos: base + t.position,
    len: t.length,
    code: RE_PH.test(t.str),
  };
}

/** 토큰을 sentPosition 으로 묶는다 (splitIntoSents 스팬 대신 쓰는 방법). */
export function groupBySentence(tokens) {
  const out = [];
  let cur = null;
  let last = null;
  for (const t of tokens) {
    if (t.sp !== last) {
      cur = [];
      out.push(cur);
      last = t.sp;
    }
    cur.push(t);
  }
  return out;
}

/** rules/terms*.yaml 의 preferred 를 Kiwi userWords 로 만든다. 공백이 든 용어는 건너뛴다. */
export function loadUserWords(rulesDir = path.join(ROOT, 'rules')) {
  const words = [];
  if (!existsSync(rulesDir)) return words;
  for (const f of readdirSync(rulesDir).filter((n) => /^terms.*\.ya?ml$/.test(n)).sort()) {
    let doc;
    try {
      doc = YAML.parse(readFileSync(path.join(rulesDir, f), 'utf8').replace(/^﻿/, ''));
    } catch {
      continue;
    }
    for (const t of doc?.terms ?? []) {
      let word = String(t.preferred ?? '').trim();
      if (!word || /\s/.test(word)) continue;
      const tag = t.pos ?? 'NNG';
      if ((tag === 'VV' || tag === 'VA') && word.endsWith('다')) word = word.slice(0, -1); // 어간
      if (!words.some((w) => w.word === word && w.tag === tag)) words.push({ word, tag });
    }
  }
  return words;
}

/**
 * Kiwi 인스턴스를 만든다 (로딩 약 5초). 가용하지 않으면 null.
 * @returns {Promise<null|{kiwi, Match, version:string, loadMs:number, userWords:Array}>}
 */
export async function loadKiwi({ modelDir = DEFAULT_MODEL_DIR, userWords = loadUserWords() } = {}) {
  const pkg = kiwiPackagePath();
  if (!pkg || !modelInstalled(modelDir)) return null;
  const t0 = Date.now();
  const mod = await import(pathToFileURL(path.join(pkg, 'dist', 'index.js')).href);
  const builder = await mod.KiwiBuilder.create(path.join(pkg, 'dist', 'kiwi-wasm.wasm'));
  const modelFiles = {};
  for (const n of MODEL_FILES) modelFiles[n] = readFileSync(path.join(modelDir, n));
  const kiwi = await builder.build({ modelFiles, modelType: 'cong', userWords });
  return { kiwi, Match: mod.Match, version: builder.version(), loadMs: Date.now() - t0, userWords };
}

/** 한 문자열을 분석해 토큰 배열을 돌려준다. 선택 인자에 undefined 를 넘기면 WASM 이 abort 하므로 Match 를 명시한다. */
export function analyzeText(k, text, base = 0) {
  const r = k.kiwi.analyze(text, k.Match.allWithNormalizing);
  return r.tokens.map((t) => toToken(t, base));
}
