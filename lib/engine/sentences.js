// 문장 분리: 마침표·물음표·느낌표·줄바꿈. 약어·소수·버전·날짜 오분할을 막는다.
import { isCheckableLine } from './preprocess.js';

const ABBR = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'fig', 'no', 'vol', 'approx',
  'e.g', 'i.e', 'cf', 'jr', 'sr', 'ca', 'al', 'ex', 'pp', 'ver', 'rev',
]);
const CLOSERS = /[)\]}"'”’」』>»]/;

/** text 안에서 문장 경계(끝 오프셋, exclusive) 목록을 구한다. */
export function splitBoundaries(text) {
  const ends = [];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c !== '.' && c !== '?' && c !== '!' && c !== '。') continue;
    if (i + 1 < n && /[.?!]/.test(text[i + 1])) continue; // 연속 부호는 마지막에서 처리
    let j = i + 1;
    while (j < n && CLOSERS.test(text[j])) j++;
    if (j < n && !/\s/.test(text[j])) continue; // 3.5, v2.0, a.md, 다.그래서 -> 분리 안 함
    if (j >= n) {
      ends.push(n);
      continue;
    }
    if (c === '.') {
      const before = text.slice(Math.max(0, i - 12), i);
      const after = text.slice(j).trimStart();
      // 날짜·번호: 2019. 3. 9.  /  숫자 뒤 마침표 + 공백 + 숫자
      if (/\d$/.test(before) && /^\d/.test(after)) continue;
      // 날짜 끝 마침표 뒤에 조사·후치어가 이어지면 문장 끝이 아니다: 2019. 3. 9. 에 출시
      if (/\d\.\s*\d{1,2}$/.test(before) && /^(?:에|부터|까지|의|은|는|이|가|을|를|과|와|로|경|현재|기준|이후|이전|이내)(?:\s|$)/.test(after)) continue;
      const m = before.match(/([A-Za-z][A-Za-z.]*)$/);
      if (m) {
        const w = m[1].toLowerCase();
        if (ABBR.has(w)) continue; // Dr. Kim, vs. etc.
        if (/^[A-Za-z]$/.test(m[1]) && /^[A-Z]/.test(after)) continue; // J. Kim
        if (/^[a-z]/.test(after)) continue; // 소문자로 이어지면 약어로 본다
      }
    }
    ends.push(j);
    i = j - 1;
  }
  return ends;
}

function splitSegment(masked, from, to) {
  const seg = masked.slice(from, to);
  const ends = splitBoundaries(seg);
  const out = [];
  let s = 0;
  const push = (a, b) => {
    const piece = seg.slice(a, b);
    const lead = piece.length - piece.trimStart().length;
    const t = piece.trim();
    if (t) out.push({ text: t, start: from + a + lead });
  };
  for (const e of ends) {
    push(s, e);
    s = e;
  }
  if (s < seg.length) push(s, seg.length);
  return out;
}

/**
 * @param pre preprocess() 결과
 * @returns {{text,start,line,col,isListItem,isHeading,isTableCell,para,endsWithColon}[]}
 */
export function splitSentences(pre) {
  const { masked, lines, toLineCol } = pre;
  const result = [];
  let para = 0;
  let prevText = false;

  for (const ln of lines) {
    if (!isCheckableLine(ln)) {
      if (ln.kind === 'blank' || ln.kind === 'code') prevText = false;
      continue;
    }
    if (ln.kind !== 'text') prevText = false;
    else if (!prevText) {
      para++;
      prevText = true;
    }

    let pieces = [];
    if (ln.kind === 'heading') {
      const seg = masked.slice(ln.contentStart, ln.end);
      const t = seg.trim();
      if (t) pieces = [{ text: t, start: ln.contentStart + (seg.length - seg.trimStart().length) }];
    } else if (ln.kind === 'table-row') {
      let p = ln.contentStart;
      for (const cell of masked.slice(ln.contentStart, ln.end).split('|')) {
        const lead = cell.length - cell.trimStart().length;
        const t = cell.trim();
        if (t) pieces.push({ text: t, start: p + lead, cell: true });
        p += cell.length + 1;
      }
    } else {
      pieces = splitSegment(masked, ln.contentStart, ln.end);
    }

    for (const pc of pieces) {
      if (/^[\s]*$/.test(pc.text)) continue; // 보호 영역만 있는 조각은 제외
      const { line, col } = toLineCol(pc.start);
      result.push({
        text: pc.text,
        start: pc.start,
        line,
        col,
        isListItem: ln.isList,
        isHeading: ln.kind === 'heading',
        isTableCell: !!pc.cell,
        para: ln.kind === 'text' ? para : -1,
        endsWithColon: /[:：]$/.test(pc.text),
      });
    }
  }
  return result;
}
