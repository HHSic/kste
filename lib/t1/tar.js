// 최소 tar 파서(ustar + GNU 긴 이름 + pax path). 의존성 없이 .tgz 를 풀기 위한 것이다.
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const str = (buf, off, len) => {
  const s = buf.subarray(off, off + len);
  const z = s.indexOf(0);
  return s.subarray(0, z < 0 ? s.length : z).toString('utf8');
};
const oct = (buf, off, len) => parseInt(str(buf, off, len).trim() || '0', 8);

/** tar 바이트(압축 해제된)를 [{name, type, data, mode}] 로 읽는다. type: 'file' | 'dir' | 'other' */
export function parseTar(buf) {
  const out = [];
  let off = 0;
  let longName = null;
  let paxPath = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let name = str(h, 0, 100);
    const size = oct(h, 124, 12);
    const flag = h[156] ? String.fromCharCode(h[156]) : '0';
    if (str(h, 257, 5) === 'ustar') {
      const prefix = str(h, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (flag === 'L') { longName = str(data, 0, data.length); continue; }
    if (flag === 'x') {
      const m = data.toString('utf8').match(/(?:^|\n)\d+ path=([^\n]*)\n/);
      if (m) paxPath = m[1];
      continue;
    }
    if (flag === 'g') continue;
    name = paxPath ?? longName ?? name;
    longName = paxPath = null;
    const type = flag === '0' || flag === '7' ? 'file' : flag === '5' ? 'dir' : 'other';
    out.push({ name, type, data, mode: oct(h, 100, 8) });
  }
  return out;
}

/** .tgz(또는 .tar.gz) 바이트를 항목 배열로. */
export const parseTgz = (buf) => parseTar(gunzipSync(buf));

/**
 * 파일 항목을 dest 아래에 쓴다.
 * @param {{strip?:number, filter?:(rel:string)=>boolean}} opts strip: 앞쪽 경로 성분 제거 수(npm 은 'package/' 1)
 * @returns {string[]} 쓴 파일의 상대 경로
 */
export function extractEntries(entries, dest, { strip = 0, filter } = {}) {
  const written = [];
  const root = path.resolve(dest);
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const rel = e.name.split('/').filter((p) => p && p !== '.').slice(strip).join('/');
    if (!rel || (filter && !filter(rel))) continue;
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) throw new Error(`tar 경로가 대상 밖으로 나간다: ${e.name}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, e.data);
    written.push(rel);
  }
  return written;
}
