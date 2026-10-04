// T1 규칙 구현 (형태소 분석 결과 사용). 입력은 문장별 토큰이 붙은 ctx, 출력은 add(finding) 호출.
// 규칙 문서 docs/KSTE-규칙.md 의 T1 규칙: K1.7 K2.1(정밀) K2.3 K2.5 K2.6 K2.7 K2.9 K3.1 K3.2 K3.4 K4.1 K4.2 K4.3 K4.5 K6.2 K7.4
// (K8.3 은 두 문서를 비교하는 diff 모드라 engine.js 의 diffT1 에 있다.)
import { findMorph, parseMorph, matchChain, toEojeols, eojeolInTags } from './morph-pattern.js';

// ---------- 공통 보조 ----------
const NOUN_TAGS = new Set(['NNG', 'NNP', 'NR', 'SL', 'SN', 'XPN', 'XSN']);
const PRED_TAGS = new Set(['VV', 'VA', 'XSV', 'XSA']);
const PASSIVE_VV = new Set(['보이', '쓰이', '닫히', '열리', '먹히', '잡히', '읽히', '놓이', '쌓이', '불리', '풀리', '밀리', '끊기', '안기', '감기']);

export const isImperativeEf = (form) => /(?:세요|시오)$/.test(form) || /^(?:으|어|아|여)?라$/.test(form);
/** 명령형 계열: 세요 / 십시오 / 라(하라·어라·마라) */
export function imperativeFamily(form) {
  if (/세요$/.test(form)) return 'sae';
  if (/시오$/.test(form)) return 'sio';
  if (/^(?:으|어|아|여)?라$/.test(form)) return 'ra';
  return null;
}

const COND_EC = /^(?:으?면|거든|으?려면|이?라면|다면|으?ㄹ라치면)$/;
/** 조건 표지 토큰 인덱스: 조건 EC(면/거든/려면) 또는 ETM + 때/경우 */
export function condMarkers(tokens) {
  const out = [];
  tokens.forEach((t, i) => {
    if ((t.tag === 'EC' || t.tag === 'EF') && COND_EC.test(t.form)) out.push({ i, kind: 'ec', form: t.form });
    else if (t.tag === 'ETM' && tokens[i + 1] && ['NNG', 'NNB'].includes(tokens[i + 1].tag) && ['때', '경우'].includes(tokens[i + 1].form)) {
      out.push({ i: i + 1, kind: tokens[i + 1].form, form: tokens[i + 1].form });
    }
  });
  return out;
}

const lastContentToken = (tokens) => {
  for (let i = tokens.length - 1; i >= 0; i--) if (!['SF', 'SP', 'SS', 'SSO', 'SSC', 'SE', 'SO', 'SW'].includes(tokens[i].tag)) return i;
  return -1;
};

const EF_LABEL = { sae: '세요', sio: '십시오', ra: '하라/어라' };
const trunc = (s, n = 40) => (s.length > n ? s.slice(0, n) + '…' : s);
const clean = (s) => s.replace(/[]/g, '▒');

/** 문장의 어절 목록 (절대 오프셋 기준) */
function sentEojeols(s) {
  if (!s._eo) s._eo = toEojeols(s.tokens, s.text, s.start);
  return s._eo;
}

/** 피동 서술어 개수. measure.py analyze_sentence 와 같은 규칙. */
export function countPassive(tokens) {
  let passive = 0;
  for (let i = 0; i < tokens.length; i++) {
    const { form, tag } = tokens[i];
    if (tag === 'XSV' && form === '되') passive++;
    else if (tag === 'VV' && (form === '받' || form === '당하') && i > 0 && tokens[i - 1].tag === 'NNG') passive++;
    else if (tag === 'VV' && PASSIVE_VV.has(form)) passive++;
    else if (tag === 'VX' && form === '지' && i > 1 && tokens[i - 1].tag === 'EC' && ['어', '아'].includes(tokens[i - 1].form)) {
      if (tokens[i - 2].tag === 'VV' && !PASSIVE_VV.has(tokens[i - 2].form)) passive++;
    }
  }
  return passive;
}

const isBodySentence = (s) => !s.isHeading && !s.isTableCell;

// ---------- 개별 규칙 ----------
// K2.6 이중피동, K2.9 -시키다: patterns.yaml 의 morph DSL 을 그대로 돌린다. K2.1/K2.7 은 아래에서 따로 쓴다.
const DSL_SPECIAL = new Set(['K2.1-001', 'K2.1-002', 'K2.7-001']);
function checkMorphPatterns(ctx) {
  const { sentences, patterns, add, pre } = ctx;
  for (const p of patterns) {
    if (DSL_SPECIAL.has(p.id) || p.parsed.type !== 'seq') continue;
    for (const s of sentences) {
      if (s.isHeading && p.id.startsWith('K2.9')) continue;
      for (const m of findMorph(p.parsed, s.tokens)) {
        const { line, col } = pre.toLineCol(m.pos);
        const e = sentEojeols(s).find((x) => x.start <= m.pos && m.pos < x.end);
        add({
          ruleId: p.id, base: p.id.replace(/-\d+$/, ''), kind: 'morph', severity: p.severity, line, col,
          match: clean(e?.text ?? m.forms), suggest: p.message, detail: m.forms, wordPosition: m.wordStart, sentence: m.sent,
        });
      }
    }
  }
}

// K2.1 정밀판: (a) -함/-됨/-음/-임 종결 (ETN ㅁ|음 이 문장 끝), (b) 서술어 없는 문장
function checkK21(ctx) {
  const { sentences, patterns, add, pre, gaejosik } = ctx;
  const p1 = patterns.find((p) => p.id === 'K2.1-001');
  const p2 = patterns.find((p) => p.id === 'K2.1-002');
  const sev = gaejosik ? 'warn' : 'error';
  // 패턴 끝의 SF(마침표)는 떼고, 앞 품사에 VX(않음)·VCN(아님)을 더한다 (fallback_regex 가 겨냥한 '않음/아님').  대신 "문장 마지막 내용 형태소"에서 끝나는지 본다 (마침표 없는 문장도 잡는다)
  const p1Core = p1 ? parseMorph(p1.morph.replace(/\s+SF\s*$/, '').replace('(XSV|', '(XSV|VX|VCN|')) : null;
  for (const s of sentences) {
    if (s.isListItem || s.isHeading || s.isTableCell) continue;
    const toks = s.tokens;
    if (!toks.length) continue;
    if (p1) {
      const last = lastContentToken(toks);
      const hit = findMorph(p1Core, toks).find((m) => m.end - 1 === last);
      if (hit) {
        const { line, col } = pre.toLineCol(hit.pos);
        add({
          ruleId: 'K2.1-001', base: 'K2.1', kind: 'ending', severity: sev, line, col,
          match: clean(s.text.slice((sentEojeols(s).find((e) => e.start <= hit.pos && hit.pos < e.end)?.start ?? hit.pos) - s.start, toks[last].pos + toks[last].len - s.start)),
          suggest: p1.message,
        });
        continue;
      }
    }
    if (p2) {
      const eo = sentEojeols(s);
      const hangul = /[가-힣]/.test(s.text.replace(/[]/g, ''));
      const terminal = /[.?!。]["'”’)\]」』]*$/.test(s.text);
      const plain = s.text.replace(/[\s]/g, '');
      const hangulRatio = (plain.match(/[가-힣]/g) ?? []).length / Math.max(1, plain.length);
      if (!hangul || s.endsWithColon || eo.length < 2 || !terminal) continue;
      if (hangulRatio < 0.5 || /[‥…·]{3,}|\.{4,}/.test(s.text)) continue; // 목차 점선·URL·숫자 위주 줄(PDF 추출 잔재)은 문장이 아니다
      if (findMorph(p2.parsed, toks).length) {
        const { line, col } = pre.toLineCol(s.start + (toks[0].pos - s.start));
        add({
          ruleId: 'K2.1-002', base: 'K2.1', kind: 'nopredicate', severity: sev, line, col,
          match: clean(trunc(s.text)), suggest: p2.message,
        });
      }
    }
  }
}

// K2.3 조사 누락 (근사): 조사 없는 명사 어절이 둘 이상 이어지고 바로 용언 어절이 온다.
//   용언 어절 = 첫 형태소가 NNG+XSV/XSA(-하다/-되다 파생) 이거나 VV/VA.
function checkK23(ctx) {
  const { sentences, add, pre } = ctx;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    const eo = sentEojeols(s);
    let run = 0;
    for (let j = 0; j < eo.length; j++) {
      const e = eo[j];
      const noun = eojeolInTags(e, new Set(['NNG', 'NNP', 'NR'])) && !e.tokens.some((t) => ['SP', 'SF', 'SE'].includes(t.tag));
      if (noun) {
        run++;
        continue;
      }
      if (run >= 2) {
        const t0 = e.tokens[0];
        const t1 = e.tokens[1];
        // 동작 동사만 본다: NNG+XSV(하/시키) 또는 VV. 형용사(-하다 XSA, VA)와 피동(-되다)은 조사 복원 대상이 아니거나 오탐이 많아 뺀다
        const impEf = e.tokens.some((t) => t.tag === 'EF' && isImperativeEf(t.form)); // Kiwi 가 명령형 '설정하세요'의 하를 XSA 로 보기도 한다
        const predEojeol = (t0.tag === 'NNG' && t1 && ['하', '시키'].includes(t1.form) && (['XSV', 'VV'].includes(t1.tag) || (t1.tag === 'XSA' && impEf))) || t0.tag === 'VV';
        if (predEojeol) {
          const first = eo[j - run];
          const { line, col } = pre.toLineCol(first.start);
          add({
            ruleId: 'K2.3', base: 'K2.3', kind: 'josa', severity: 'warn', precision: 'low', line, col,
            match: clean(eo.slice(j - run, j + 1).map((x) => x.text).join(' ')),
            suggest: `명사 ${run}개 뒤에 조사 없이 용언이 온다. 을/를·에·으로 등 조사를 복원한다 (근사 검사)`,
          });
        }
      }
      run = 0;
    }
  }
}

// K2.5 호응: 같은 절에서 JKO(을/를) 뒤에 NNG+XSV 되 (피동)
function checkK25(ctx) {
  const { sentences, add, pre } = ctx;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    let jko = null;
    s.tokens.forEach((t, i) => {
      if (['EC', 'EF', 'ETM', 'SF'].includes(t.tag)) jko = null;
      else if (t.tag === 'JKO') jko = t;
      else if (jko && t.tag === 'XSV' && t.form === '되' && s.tokens[i - 1] && ['NNG', 'XR'].includes(s.tokens[i - 1].tag)) {
        const { line, col } = pre.toLineCol(jko.pos);
        add({
          ruleId: 'K2.5', base: 'K2.5', kind: 'agreement', severity: 'warn', line, col,
          match: clean(s.text.slice((sentEojeols(s).find((e) => e.start <= jko.pos && jko.pos < e.end)?.start ?? jko.pos) - s.start, t.pos + t.len - s.start)),
          suggest: '을/를 목적어에 피동 서술어(-되다)가 호응하지 않는다. 능동(-하다)으로 쓰거나 조사를 이/가로 바꾼다',
        });
        jko = null;
      }
    });
  }
}

// K2.7 명사 연쇄: 조사 없는 명사-only 어절의 연속 수 (형태소 수가 아니라 어절 수)
function checkK27(ctx) {
  const { sentences, patterns, add, pre, metrics, genre, gaejosik } = ctx;
  const p = patterns.find((x) => x.id === 'K2.7-001');
  const tags = p?.parsed.tags ?? new Set(['NNG', 'NNP', 'SL', 'SN', 'NR', 'XPN', 'XSN']);
  const nc = metrics.noun_chain_words ?? { warn: 4, error: 6 };
  // 규칙 문서 K2.7: 절차문·개발자 문서 한도 3어절(4어절부터 경고), 보고서·공공 지침 한도 4어절(5어절부터). 개조식 선언 문서를 후자로 본다.
  const warnAt = genre === 'procedural' ? nc.warn : gaejosik ? nc.warn + 1 : nc.warn;
  for (const s of sentences) {
    if (s.isHeading || s.isTableCell || s.isListItem) continue;
    const eo = sentEojeols(s);
    for (const c of matchChain({ tags, min: 2 }, eo)) {
      if (c.length < warnAt) continue;
      const first = eo[c.startEojeol];
      const { line, col } = pre.toLineCol(first.start);
      const err = c.length >= nc.error;
      add({
        ruleId: 'K2.7-001', base: 'K2.7', kind: 'nounchain', severity: err ? 'error' : 'warn', line, col,
        match: clean(eo.slice(c.startEojeol, c.endEojeol).map((x) => x.text).join(' ')),
        suggest: `명사 연쇄 ${c.length}어절 (한도 ${warnAt - 1}). 조사·'-의'·동사로 푼다`,
        words: c.length, wordPosition: first.wp, sentence: first.sp,
      });
    }
  }
}

// K3.1 연결어미 수
function checkK31(ctx) {
  const { sentences, add, pre, metrics } = ctx;
  const limit = metrics.clause_connectors?.info ?? 3;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    const n = s.tokens.filter((t) => t.tag === 'EC').length;
    if (n >= limit) {
      const { line, col } = pre.toLineCol(s.start);
      add({
        ruleId: 'K3.1', base: 'K3.1', kind: 'connector', severity: 'info', show: false, line, col, match: clean(trunc(s.text)),
        suggest: `연결어미 ${n}개. 한 문장에 한 가지 생각만 담도록 나눈다 (정보)`, count: n,
      });
    }
  }
}

// K3.2 피동 밀도: 문서의 피동문 비율이 장르 기준선보다 10%p 이상 높을 때 (문서 단위, 서술어 있는 문장 5개 이상)
function checkK32(ctx) {
  const { sentences, add, pre, metrics, genre } = ctx;
  const g = metrics.__baselines ?? {};
  const base = genre === 'procedural' ? g.procedural : g.descriptive;
  if (base == null) return;
  let preds = 0;
  let pass = 0;
  let first = null;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    if (!s.tokens.some((t) => PRED_TAGS.has(t.tag) || t.tag === 'VCP')) continue;
    preds++;
    if (countPassive(s.tokens) > 0) {
      pass++;
      first ??= s;
    }
  }
  if (preds < 5) return;
  const ratio = (100 * pass) / preds;
  if (ratio >= base + 10) {
    const { line, col } = pre.toLineCol(first.start);
    add({
      ruleId: 'K3.2', base: 'K3.2', kind: 'passive', severity: 'info', line, col, match: clean(trunc(first.text)),
      suggest: `피동문 비율 ${ratio.toFixed(1)}% (${pass}/${preds}). ${genre} 기준선 ${base.toFixed(1)}%보다 10%p 이상 높다. 행위자가 있으면 능동으로 쓴다`,
      ratio: Number(ratio.toFixed(1)), baseline: Number(base.toFixed(1)),
    });
  }
}

// K3.4 종결체 혼용: 평서(-다)와 존대(-ㅂ니다/-요)를 한 문서에서 섞음. 합쇼체(-ㅂ니다)와 해요체(-요, -세요)는 한 체계로 본다 (규칙 문서 §3.4, §9.2).
export function efClass(form) {
  if (/(?:니다|니까|시오)$/.test(form)) return 'formal';
  if (/(?:요|죠)$/.test(form)) return 'polite';
  if (/^(?:으|어|아|여)?라$/.test(form)) return 'plain'; // 하라/어라: 평서체 명령
  if (/다$/.test(form)) return 'plain';
  return null;
}
function checkK34(ctx) {
  const { sentences, add, pre } = ctx;
  const by = { plain: [], polite: [] };
  let total = 0;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    const idx = lastContentToken(s.tokens);
    const t = s.tokens[idx];
    if (!t || t.tag !== 'EF') continue;
    const c = efClass(t.form);
    if (!c) continue;
    total++;
    by[c === 'formal' ? 'polite' : c].push({ s, t });
  }
  if (total < 4 || !by.plain.length || !by.polite.length) return;
  const minor = by.plain.length <= by.polite.length ? 'plain' : 'polite';
  if (by[minor].length < 2) return;
  const sub = by[minor][0];
  const { line, col } = pre.toLineCol(sub.t.pos);
  const forms = (arr) => [...new Set(arr.map((x) => x.t.form))].slice(0, 4).join('/');
  add({
    ruleId: 'K3.4', base: 'K3.4', kind: 'formality', severity: 'warn', line, col, match: clean(trunc(sub.s.text)),
    suggest: `종결체 혼용: 평서 -다 ${by.plain.length}문장(${forms(by.plain)})과 존대 ${by.polite.length}문장(${forms(by.polite)}). 한 문서에서는 한 체계만 쓴다`,
  });
}

// K4.1 지시 종결 -세요 통일
function checkK41(ctx) {
  const { sentences, add, pre, genre } = ctx;
  const items = [];
  for (const s of sentences) {
    if (s.isHeading || s.isTableCell) continue;
    for (const t of s.tokens) {
      if (t.tag !== 'EF') continue;
      const fam = imperativeFamily(t.form);
      if (fam) items.push({ s, t, fam });
    }
  }
  const saeItems = items.filter((x) => x.fam === 'sae');
  const old = items.filter((x) => x.fam !== 'sae');
  const sae = saeItems.length;
  if (!old.length) return;
  const mixed = sae > 0;
  // 문서 전체가 -십시오 체계로 일관되면(K3.4 가 인정하는 두 번째 체계) 정보로 낮춘다
  const consistentOld = !mixed && old.length >= 3;
  if (!mixed && genre !== 'procedural') return;
  // 섞였을 때는 적은 쪽을 짚는다: -세요가 같거나 많으면 -십시오/-하라를, -십시오 쪽이 더 많으면 소수인 -세요를 -십시오 체계에 맞추도록 알린다
  const flagged = mixed && old.length > sae ? saeItems : old;
  for (const x of flagged) {
    const { line, col } = pre.toLineCol(x.t.pos);
    let suggest;
    if (!mixed) suggest = `절차문 지시는 -세요가 표준이다 (-${EF_LABEL[x.fam]}). 문서 전체를 -십시오 체계로 쓴다면 일관성만 지킨다`;
    else if (x.fam === 'sae') suggest = `한 문서에 -십시오 계열(${old.length}회)과 -세요 혼용. 문서의 주된 체계(-십시오)에 맞추거나 전체를 -세요로 통일한다`;
    else suggest = `한 문서에 -세요(${sae}회)와 -${EF_LABEL[x.fam]} 혼용. 지시는 -세요로 통일한다`;
    add({
      ruleId: 'K4.1', base: 'K4.1', kind: 'imperative', severity: consistentOld ? 'info' : 'warn', line, col,
      match: clean(trunc(x.s.text)), suggest,
    });
  }
}

const SEQ_EC = new Set(['고', '고서', '며', '으며', '면서', '으면서']);
// K4.2 항목당 동작 수: 명령형 문장에서 (연결 동사 수 + 1) > 2
function checkK42(ctx) {
  const { sentences, add, pre } = ctx;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    const toks = s.tokens;
    const efIdx = toks.findIndex((t) => t.tag === 'EF' && isImperativeEf(t.form));
    if (efIdx < 0) continue;
    if (toks.some((t) => t.tag === 'VX' && t.form === '말')) continue; // -지 마세요 (금지+방법 묶음 허용)
    let n = 1;
    for (let i = 0; i < efIdx; i++) {
      const t = toks[i];
      if (t.tag === 'EC' && SEQ_EC.has(t.form) && toks[i + 1]?.tag !== 'VX') n++;
      else if (t.tag === 'ETM' && ['NNG', 'NNB'].includes(toks[i + 1]?.tag) && ['후', '뒤', '다음', '이후'].includes(toks[i + 1].form)) n++;
    }
    if (n > 2) {
      const { line, col } = pre.toLineCol(s.start);
      add({
        ruleId: 'K4.2', base: 'K4.2', kind: 'actions', severity: 'warn', line, col, match: clean(trunc(s.text)),
        suggest: `한 문장에 동작 ${n}개 (한도 2). 항목을 나눈다`, count: n,
      });
    }
  }
}

// K4.3 조건 선행: 명령형 EF 뒤에 조건 표지가 오면 경고
function checkK43(ctx) {
  const { sentences, add, pre } = ctx;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    const toks = s.tokens;
    const efIdx = toks.findIndex((t) => t.tag === 'EF' && isImperativeEf(t.form));
    if (efIdx < 0) continue;
    const m = condMarkers(toks).find((c) => c.i > efIdx);
    if (m) {
      const { line, col } = pre.toLineCol(toks[m.i].pos);
      add({
        ruleId: 'K4.3', base: 'K4.3', kind: 'condition', severity: 'warn', line, col, match: clean(trunc(s.text)),
        suggest: `조건(-${m.form})이 지시 뒤에 왔다. 조건을 앞에, 지시를 뒤에 쓴다`,
      });
    }
  }
}

// K4.5 조건 연결어미: 한 문장에 조건은 하나만 (규칙 문서 "한 문장에 조건은 하나만 씁니다")
function checkK45(ctx) {
  const { sentences, add, pre } = ctx;
  for (const s of sentences) {
    if (!isBodySentence(s)) continue;
    const ms = condMarkers(s.tokens);
    if (ms.length >= 2) {
      const { line, col } = pre.toLineCol(s.tokens[ms[1].i].pos);
      add({
        ruleId: 'K4.5', base: 'K4.5', kind: 'condition-count', severity: 'info', line, col, match: clean(trunc(s.text)),
        suggest: `한 문장에 조건 ${ms.length}개 (${ms.map((m) => m.form).join(', ')}). 조건은 하나만 쓰고 나눈다. 상황은 -ㄹ 때, 상태는 -ㄴ 경우, 사건은 -면, 목적은 -려면`,
      });
    }
  }
}

// K6.2 경고문 순서: 라벨(경고/주의/위험/⚠)로 시작하거나 경고 절 아래에 있는 문장이 조건·지시로 시작하지 않으면 경고
const WARN_LABEL = /^[⚠△▲※\s]*\[?(?:경고|주의|위험|Warning|WARNING|Caution|CAUTION|Danger|DANGER)\]?\s*[:：)\]]\s*/u;
const WARN_HEADING = /^(?:경고|주의|위험|경고문|안전\s*주의\s*사항|주의\s*사항|안전\s*수칙|Warnings?|Cautions?)\s*$/u;
function checkK62(ctx) {
  const { sentences, add, pre } = ctx;
  let inWarn = false;
  for (const s of sentences) {
    if (s.isHeading) {
      inWarn = WARN_HEADING.test(s.text.replace(/[]/g, '').trim());
      continue;
    }
    if (s.isTableCell) continue;
    const labelled = WARN_LABEL.test(s.text);
    if (!labelled && !inWarn) continue;
    let toks = s.tokens;
    if (labelled) {
      const labelEnd = s.start + s.text.match(WARN_LABEL)[0].length;
      toks = toks.filter((t) => t.pos >= labelEnd);
    }
    if (!toks.some((t) => PRED_TAGS.has(t.tag) || t.tag === 'VCP' || t.tag === 'EF')) continue;
    const firstBoundary = toks.find((t) => t.tag === 'EC' || t.tag === 'EF');
    const condFirst = condMarkers(toks)[0] && (!firstBoundary || condMarkers(toks)[0].i <= toks.indexOf(firstBoundary) + 1);
    const hasImp = toks.some((t) => t.tag === 'EF' && isImperativeEf(t.form));
    if (hasImp || condFirst) continue;
    const { line, col } = pre.toLineCol(s.start);
    add({
      ruleId: 'K6.2', base: 'K6.2', kind: 'warning-order', severity: 'warn', line, col, match: clean(trunc(s.text)),
      suggest: '경고문은 [조건] → 지시 → 결과 순서다. 조건이나 지시(-세요, -지 마세요)로 시작하고 결과는 뒤에 쓴다',
    });
  }
}

// K7.4 띄어쓰기 보조: 한 어절 안의 명사+명사 경계에서 Kiwi space() 가 띄어쓰기를 넣으라고 한 경우
const HANGUL2 = (t) => /^[가-힣]{2,}$/.test(t.form);
export function nounPairsInEojeol(e) {
  const out = [];
  for (let i = 0; i + 1 < e.tokens.length; i++) {
    const a = e.tokens[i];
    const b = e.tokens[i + 1];
    if (['NNG', 'NNP'].includes(a.tag) && ['NNG', 'NNP'].includes(b.tag) && HANGUL2(a) && HANGUL2(b)) out.push({ a, b });
  }
  return out;
}
/** space() 교정 후보가 될 문장인가 (명사 둘이 한 어절에 붙어 있음) */
export function spaceCandidate(s) {
  return isBodySentence(s) && sentEojeols(s).some((e) => nounPairsInEojeol(e).length);
}
const nonSpaceBreaks = (str) => {
  const set = new Set();
  let k = 0;
  for (const ch of str) {
    if (/\s/.test(ch)) set.add(k);
    else k++;
  }
  return { set, stripped: str.replace(/\s+/g, '') };
};
function checkK74(ctx) {
  const { sentences, add, pre } = ctx;
  // 문서 안에서 같은 붙여 쓴 합성어가 두 번 이상 나오면 의도한 용어로 보고 건너뛴다 (정보시스템, 개인정보 같은 통용 복합어의 오탐을 줄인다)
  const attached = new Map();
  for (const s of sentences) {
    for (const e of sentEojeols(s)) {
      for (const { a, b } of nounPairsInEojeol(e)) attached.set(a.form + b.form, (attached.get(a.form + b.form) ?? 0) + 1);
    }
  }
  for (const s of sentences) {
    if (s.spaced == null) continue;
    const o = nonSpaceBreaks(s.text);
    const n = nonSpaceBreaks(s.spaced);
    if (o.stripped !== n.stripped) continue; // 글자가 달라졌으면 교정 결과를 믿지 않는다
    const inserted = new Set([...n.set].filter((k) => !o.set.has(k)));
    if (!inserted.size) continue;
    for (const e of sentEojeols(s)) {
      for (const { a, b } of nounPairsInEojeol(e)) {
        if ((attached.get(a.form + b.form) ?? 0) >= 2) continue;
        const k = [...s.text.slice(0, b.pos - s.start)].filter((c) => !/\s/.test(c)).length;
        if (!inserted.has(k)) continue;
        const { line, col } = pre.toLineCol(e.start);
        const split = e.text.slice(0, b.pos - e.start) + ' ' + e.text.slice(b.pos - e.start);
        add({
          ruleId: 'K7.4', base: 'K7.4', kind: 'spacing', severity: 'info', show: false, line, col, match: clean(e.text),
          suggest: `띄어쓰기 점검: '${clean(split)}' (Kiwi space 보조 검사)`,
        });
        break;
      }
    }
  }
}

// K1.7 약어: 대문자 약어 첫 출현에 병기가 없고 통용 목록 밖이면 정보
function checkK17(ctx) {
  const { sentences, add, pre, common } = ctx;
  const seen = new Set();
  const masked = pre.masked;
  for (const s of sentences) {
    s.tokens.forEach((t, i) => {
      if (t.tag !== 'SL' || t.code || !/^[A-Z][A-Z0-9]{1,7}$/.test(t.form)) return;
      if (seen.has(t.form)) return;
      seen.add(t.form);
      if (common.has(t.form)) return;
      const prev = s.tokens[i - 1];
      const next = s.tokens[i + 1];
      if ((prev && prev.tag === 'SSO') || (next && next.tag === 'SSO')) return; // 병기 중
      if (masked.includes(`(${t.form})`) || masked.includes(`${t.form}(`)) return; // 문서 어디선가 병기함
      const { line, col } = pre.toLineCol(t.pos);
      add({
        ruleId: 'K1.7', base: 'K1.7', kind: 'abbr', severity: 'info', line, col, match: t.form,
        suggest: `낯선 약어 '${t.form}'가 처음 나온다. 처음 한 번 '한글 풀이(${t.form})' 형식으로 병기한다`,
      });
    });
  }
}

export const CHECKS = [checkMorphPatterns, checkK21, checkK23, checkK25, checkK27, checkK31, checkK32, checkK34, checkK41, checkK42, checkK43, checkK45, checkK62, checkK74, checkK17];

/** 구현된 T1 규칙 ID */
export const T1_IMPLEMENTED = ['K1.7', 'K2.1(정밀)', 'K2.3', 'K2.5', 'K2.6', 'K2.7', 'K2.9', 'K3.1', 'K3.2', 'K3.4', 'K4.1', 'K4.2', 'K4.3', 'K4.5', 'K6.2', 'K7.4', 'K8.3'];

export function runT1Checks(ctx) {
  for (const c of CHECKS) c(ctx);
}

