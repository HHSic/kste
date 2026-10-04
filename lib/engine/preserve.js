// 정보 보존 K8.1(숫자·단위) · K8.2(문장 수) · K8.4(부정 극성). 원문과 재작성문을 비교한다.
import { preprocess } from './preprocess.js';
import { splitSentences } from './sentences.js';

const MAG = { 억: 1e8, 만: 1e4, 천만: 1e7, 백만: 1e6, 천: 1e3, 백: 1e2 };
const LATIN_UNITS = ['kHz', 'MHz', 'GHz', 'Hz', 'kWh', 'kW', 'kcal', 'kbps', 'Mbps', 'Gbps', 'bps', 'KB', 'MB', 'GB', 'TB', 'kb', 'mb', 'gb', 'tb',
  'mm', 'cm', 'km', 'kg', 'mg', 'ml', 'ms', 'dB', 'rpm', 'px', 'V', 'W', 'A', 'm', 'g', 'l', 'L', 's', '%', '℃', '°C'];
const HANGUL_UNITS = ['개월', '시간', '가지', '퍼센트', '명', '원', '건', '초', '분', '일', '주', '년', '월', '회', '번', '대', '배', '개', '층', '장', '매', '권', '곳', '세', '단계', '항', '호', '위', '점'];

const NUM = '\\d[\\d,]*(?:\\.\\d+)?';
const MAGRE = '(?:천만|백만|억|만|천|백)';
// 숫자 + 크기 단위 연쇄 (30만 8천, 1억 3천만, 308천)
const RE_NUMBER = new RegExp(
  `(${NUM})(?:\\s*(${MAGRE})(?:\\s*(${NUM})\\s*(${MAGRE}))*)?`,
  'g',
);

function normalizeText(text) {
  let t = text;
  // 날짜 2015.5.1 / 2015. 5. 1. -> 2015-5-1
  t = t.replace(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)\.?/g, (_, y, m, d) => `\u0002${y}-${Number(m)}-${Number(d)}\u0002`);
  // 시각: 오후 3시 20분 -> 15:20, 3시 20분 -> 3:20, 13:20 -> 13:20
  t = t.replace(/(오후|오전)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/g, (_, ap, h, mi) => {
    let hh = Number(h);
    if (ap === '오후' && hh < 12) hh += 12;
    return `\u0002${hh}:${String(mi ?? 0).padStart(2, '0')}\u0002`;
  });
  t = t.replace(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g, (_, h, mi) => `\u0002${Number(h)}:${mi}\u0002`);
  return t;
}

/** 숫자 토큰 집합 추출. 쉼표 제거, 단위 공백 제거, 천/만/억 정수 환산. */
export function extractNumbers(text) {
  const t = normalizeText(text);
  const out = [];
  // 이미 정규화된 날짜·시각 토큰
  const keep = [];
  const stripped = t.replace(/\u0002([^\u0002]+)\u0002/g, (_, tok) => {
    keep.push(tok);
    return ' ';
  });
  out.push(...keep);
  for (const m of stripped.matchAll(RE_NUMBER)) {
    const whole = m[0];
    const base = Number(m[1].replace(/,/g, ''));
    let value;
    if (m[2]) {
      // 연쇄 전체를 다시 훑어 합산
      value = 0;
      for (const p of whole.matchAll(new RegExp(`(${NUM})\\s*(${MAGRE})`, 'g'))) {
        value += Number(p[1].replace(/,/g, '')) * MAG[p[2]];
      }
    } else {
      value = base;
    }
    const after = stripped.slice(m.index + whole.length);
    let unit = '';
    const lu = after.match(/^\s*([A-Za-z%℃°][A-Za-z°℃]*)(?![A-Za-z])/);
    if (lu && LATIN_UNITS.includes(lu[1])) unit = lu[1];
    else {
      const hu = HANGUL_UNITS.find((u) => after.trimStart().startsWith(u));
      if (hu) unit = hu;
    }
    out.push(String(value) + unit);
  }
  return out;
}

const RE_NEG = /않|(?<![가-힣])안(?=\s)|(?<![가-힣])못(?=\s|[가-힣])|없|아니|금지|마(?:세요|십시오|시오|라)|말(?:아|라|것|고|지|며|도록)/g;

export function countNegations(text) {
  return (text.match(RE_NEG) ?? []).length;
}

export function sentenceCount(text) {
  return splitSentences(preprocess(text)).filter((s) => !s.isHeading).length;
}

/**
 * @returns {{findings:Array, stats:Object}}
 */
export function comparePreservation(original, revised) {
  const findings = [];
  const a = extractNumbers(original);
  const b = extractNumbers(revised);
  const setB = new Set(b);
  const setA = new Set(a);
  const missing = [...new Set(a)].filter((x) => !setB.has(x));
  const added = [...new Set(b)].filter((x) => !setA.has(x));

  for (const n of missing) {
    findings.push({ ruleId: 'K8.1', severity: 'error', line: null, col: null, match: n, suggest: `원문 숫자 "${n}" 가 수정문에 없다`, tier: 0, show: true });
  }
  for (const n of added) {
    findings.push({ ruleId: 'K8.1', severity: 'info', line: null, col: null, match: n, suggest: `수정문에 원문에 없던 숫자 "${n}" 가 생겼다`, tier: 0, show: true });
  }

  const sa = sentenceCount(original);
  const sb = sentenceCount(revised);
  if (sb < sa) {
    findings.push({ ruleId: 'K8.2', severity: 'warn', line: null, col: null, match: `${sa} -> ${sb}`, suggest: `문장 수가 ${sa}개에서 ${sb}개로 줄었다 (삭제·병합 의심)`, tier: 0, show: true });
  }

  const na = countNegations(original);
  const nb = countNegations(revised);
  if (Math.abs(na - nb) % 2 === 1) {
    findings.push({ ruleId: 'K8.4', severity: 'warn', line: null, col: null, match: `${na} -> ${nb}`, suggest: `부정 표현 수가 ${na}개에서 ${nb}개로 바뀌었다 (극성 변화 의심, 사람 확인)`, tier: 0, show: true });
  }

  return {
    findings,
    stats: { numbersOriginal: a, numbersRevised: b, missing, added, sentences: [sa, sb], negations: [na, nb] },
  };
}
