// Markdown 전처리. 보호 대상(코드·URL·HTML·표 구분선·frontmatter)을 같은 길이의 플레이스홀더로 치환한다.
// 길이를 보존하므로 masked 의 오프셋 = 원문 오프셋이다 (라인·컬럼 복원은 toLineCol).
export const PH = ''; // 인라인 보호(코드 스팬, URL, HTML 태그, 링크 대상)
export const PH_BLOCK = ''; // 코드 블록·frontmatter·표 구분선 내부

const RE_FENCE = /^\s*(```+|~~~+)/;
const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RE_HEADING = /^(\s*)(#{1,6})\s+/;
const RE_LIST = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/;
const RE_QUOTE = /^(\s*(?:>\s?)+)/;

function fill(chars, from, to, ph) {
  for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ph;
}

function maskInline(chars, lineStart, line) {
  const apply = (re, fn) => {
    for (const m of line.matchAll(re)) fn(m, lineStart + m.index);
  };
  // 인라인 코드
  apply(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (m, s) => fill(chars, s, s + m[0].length, PH));
  // 링크·이미지: [텍스트](대상) -> 텍스트만 남기고 나머지는 공백
  apply(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g, (m, s) => {
    const bang = m[0].startsWith('!') ? 1 : 0;
    for (let i = 0; i < bang + 1; i++) chars[s + i] = ' ';
    const textEnd = s + bang + 1 + m[1].length;
    fill(chars, textEnd, s + m[0].length, ' ');
  });
  // URL
  apply(/(?:https?:\/\/|www\.)[^\s)>\]]+/g, (m, s) => fill(chars, s, s + m[0].length, PH));
  // HTML 태그·주석
  apply(/<!--.*?-->|<\/?[A-Za-z][^>\n]*>/g, (m, s) => fill(chars, s, s + m[0].length, PH));
  // 강조 표식
  apply(/\*\*|__|~~/g, (m, s) => {
    chars[s] = ' ';
    chars[s + 1] = ' ';
  });
}

export function preprocess(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r(?=\n)/g, ' ').replace(/\r/g, '\n');
  const chars = text.split('');
  const rawLines = text.split('\n');
  const lines = [];
  const frontmatter = { present: false, genre: null, data: {} };

  let offset = 0;
  let inFence = null;
  let fmEnd = -1;
  if (rawLines[0]?.trim() === '---') {
    for (let i = 1; i < rawLines.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(rawLines[i])) {
        fmEnd = i;
        break;
      }
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    const info = {
      no: i + 1, start, end, kind: 'text', contentStart: start, isList: false, ordered: false, indent: 0,
    };
    lines.push(info);

    if (fmEnd >= 0 && i <= fmEnd) {
      info.kind = 'frontmatter';
      if (i > 0 && i < fmEnd) {
        const m = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
        if (m) frontmatter.data[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      fill(chars, start, end, PH_BLOCK);
      continue;
    }
    if (inFence) {
      info.kind = 'code';
      const t = line.trim();
      if (t.startsWith(inFence[0]) && /^(`+|~+)$/.test(t) && t.length >= inFence.length) inFence = null;
      fill(chars, start, end, PH_BLOCK);
      continue;
    }
    const fm = line.match(RE_FENCE);
    if (fm) {
      inFence = fm[1];
      info.kind = 'code';
      fill(chars, start, end, PH_BLOCK);
      continue;
    }
    if (line.trim() === '') {
      info.kind = 'blank';
      continue;
    }
    if (RE_HR.test(line)) {
      info.kind = 'hr';
      fill(chars, start, end, PH_BLOCK);
      continue;
    }
    if (line.includes('|') && RE_TABLE_SEP.test(line)) {
      info.kind = 'table-sep';
      fill(chars, start, end, PH_BLOCK);
      continue;
    }

    let pos = 0;
    const q = line.match(RE_QUOTE);
    if (q) {
      pos = q[0].length;
      fill(chars, start, start + pos, ' ');
    }
    const rest = line.slice(pos);
    const h = rest.match(RE_HEADING);
    const l = rest.match(RE_LIST);
    if (h) {
      info.kind = 'heading';
      pos += h[0].length;
    } else if (l) {
      info.kind = 'list';
      info.isList = true;
      info.ordered = /\d/.test(l[2]);
      info.indent = l[1].length;
      pos += l[0].length;
    } else if (rest.trim().startsWith('|')) {
      info.kind = 'table-row';
    }
    // 마커는 공백으로 가려 본문 정규식에 걸리지 않게 한다
    if (info.kind === 'heading' || info.kind === 'list') fill(chars, start, start + pos, ' ');
    info.contentStart = start + pos;
    maskInline(chars, start, line);
  }

  const masked = chars.join('');
  const lineStarts = lines.map((l) => l.start);

  function toLineCol(off) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: off - lineStarts[lo] + 1 };
  }

  if (fmEnd >= 0) frontmatter.present = true;
  if (frontmatter.data.genre) frontmatter.genre = frontmatter.data.genre;

  return { raw: text, masked, lines, frontmatter, toLineCol };
}

/** 검사 대상 줄인가 (코드·frontmatter·구분선·빈 줄 제외) */
export function isCheckableLine(line) {
  return !['code', 'frontmatter', 'hr', 'table-sep', 'blank'].includes(line.kind);
}
