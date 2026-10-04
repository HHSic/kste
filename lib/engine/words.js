// 어절 셈법 K7.1~K7.3 (T0). 공백으로 나누되 괄호·인용·숫자+단위는 한 어절로 묶는다.
// 코드 식별자·URL 은 전처리에서 PH 로 치환되어 공백이 없으므로 자동으로 한 어절이다.
const SP = '\u0001'; // 보호된 공백 표지

const LATIN_UNITS = 'mm|cm|km|m|kg|mg|g|ml|l|L|V|W|A|Hz|kHz|MHz|GHz|KB|MB|GB|TB|kb|mb|gb|tb|bps|kbps|Mbps|Gbps|ms|s|dB|rpm|kcal|kW|kWh|bar|psi|rem|Sv|lx|lm|cc|ppm|px|pt|pcs|EA|ea';
const HANGUL_UNITS = '개월|개|명|원|건|초|분|시간|일|주|년|월|회|번|대|배|도|층|장|매|권|쪽|쪽|가지|곳|세|살|kg|리터|퍼센트|프로|단계|항|호|위|점|인분|인';

const RE_PAREN = /[(（][^()（）\n]*[)）]/g;
const RE_QUOTE = [
  /"[^"\n]{1,160}"/g,
  /“[^”\n]{1,160}”/g,
  /‘[^’\n]{1,160}’/g,
  /「[^」\n]{1,160}」/g,
  /『[^』\n]{1,160}』/g,
  /(?<![\w가-힣])'[^'\n]{1,120}'(?![\w])/g,
];
const RE_NUM_UNIT = new RegExp(
  `\\d(?:[\\d.,]*\\d)?(?:[천백만억]+)?[ \\t]+(?:(?:${LATIN_UNITS})(?![A-Za-z])|(?:${HANGUL_UNITS})(?=[은는이가을를의에도로과와만까지부터]|[^가-힣]|$))`,
  'g',
);
// 조사·어미로 끝나는 어절은 명사 연쇄에서 뺀다 (근사: 마지막 글자만 본다)
const NOT_NOUN_END = /[은는이가을를에의와과도로만다요죠까네며고서면]$/;

function protect(text) {
  let out = text;
  const guard = (re) => {
    out = out.replace(re, (m) => m.replace(/[ \t]/g, SP));
  };
  guard(RE_PAREN);
  for (const re of RE_QUOTE) guard(re);
  guard(RE_NUM_UNIT);
  return out;
}

/**
 * @param {string} text 전처리된(마스킹된) 문장 텍스트
 */
export function countWords(text) {
  const protectedText = protect(text);
  const tokens = [];
  const re = /\S+/g;
  for (const m of protectedText.matchAll(re)) {
    tokens.push({ text: m[0].replaceAll(SP, ' '), start: m.index });
  }
  const chains = nounChains(tokens.map((t) => t.text));
  return {
    count: tokens.length,
    tokens,
    nounChain: {
      max: chains.reduce((a, c) => Math.max(a, c.length), 0),
      chains,
      precision: 'low', // 형태소 분석(T1) 없이 조사·어미 끝글자만 본 근사. 동사 어간·복합명사에서 오탐/누락이 크다.
    },
  };
}

/** 조사로 끝나지 않는 2글자 이상 한글 어절의 연속 구간(길이 2 이상)을 모은다 */
export function nounChains(words) {
  const chains = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 2) chains.push(cur);
    cur = [];
  };
  for (const w of words) {
    const core = w.replace(/[,.;:!?)\]}"'”’」』]+$/u, '');
    const endsPunct = core !== w;
    const nounish = /^[가-힣]{2,}$/u.test(core) && !NOT_NOUN_END.test(core);
    if (nounish) {
      cur.push(core);
      if (endsPunct) flush();
    } else {
      flush();
    }
  }
  flush();
  return chains;
}
