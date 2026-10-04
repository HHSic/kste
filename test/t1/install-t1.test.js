// install-t1: --check 출력, 경로 탐색 우선순위, tar 파서 (네트워크 다운로드는 테스트하지 않는다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_FILES, resolveT1, userT1Dir } from '../../lib/t1/kiwi.js';
import { parseTar, parseTgz, extractEntries } from '../../lib/t1/tar.js';
import { checkReport } from '../../scripts/install-t1.mjs';
import { t1StatusLine } from '../../lib/engine/mode.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'install-t1.mjs');
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'kste-t1-'));

function fakeModel(dir) {
  mkdirSync(dir, { recursive: true });
  for (const f of MODEL_FILES) writeFileSync(path.join(dir, f), 'x');
}
function fakePkg(base) {
  const p = path.join(base, 'node_modules', 'kiwi-nlp');
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, 'package.json'), '{}');
  return p;
}

// ---- tar: 최소 ustar 작성기(테스트용)
function tarEntry(name, data, type = '0') {
  const body = Buffer.from(data);
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.fill(0x20, 148, 156);
  h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
const tar = (...es) => Buffer.concat([...es, Buffer.alloc(1024)]);

test('--check: JSON 형식', () => {
  const home = tmp();
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home, KSTE_T1_DIR: path.join(home, 'none') } });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  for (const k of ['installed', 'dir', 'source', 'installTarget', 'model', 'kiwiNlp', 'searched']) assert.ok(k in j, k);
  assert.equal(typeof j.installed, 'boolean');
  assert.equal(j.installed, false);
  assert.equal(j.installTarget, path.join(home, 'none'));
  assert.deepEqual(Object.keys(j.model).sort(), ['dir', 'installed', 'sizeBytes']);
  assert.deepEqual(Object.keys(j.kiwiNlp).sort(), ['installed', 'path']);
});

test('checkReport: 설치된 임시 디렉터리를 찾고 모델 크기를 센다', () => {
  const home = tmp();
  const dir = path.join(home, '.kste', 't1');
  fakeModel(path.join(dir, 'kiwi'));
  fakePkg(dir);
  const rep = checkReport({ env: {}, home, localRoot: tmp(), localPkg: null });
  assert.equal(rep.installed, true);
  assert.equal(rep.source, 'home');
  assert.equal(rep.model.sizeBytes, MODEL_FILES.length);
  assert.match(t1StatusLine(rep), /T1 설치됨\(home\)/);
  assert.match(t1StatusLine({ ...rep, installed: false, installTarget: dir }), /T1 미설치/);
});

test('경로 탐색: KSTE_T1_DIR > ~/.kste/t1 > 로컬', () => {
  const home = tmp(), envDir = tmp(), local = tmp();
  const homeDir = path.join(home, '.kste', 't1');
  // 아무것도 없으면 설치 대상은 홈
  let r = resolveT1({ env: {}, home, localRoot: local, localPkg: null });
  assert.equal(r.ok, false);
  assert.equal(r.dir, homeDir);
  assert.equal(userT1Dir({ env: {}, home }), homeDir);
  // 로컬만
  fakeModel(path.join(local, 'models', 'kiwi'));
  const localPkg = fakePkg(local);
  r = resolveT1({ env: {}, home, localRoot: local, localPkg });
  assert.equal(r.source, 'local');
  // 홈이 로컬을 이긴다
  fakeModel(path.join(homeDir, 'kiwi'));
  fakePkg(homeDir);
  r = resolveT1({ env: {}, home, localRoot: local, localPkg });
  assert.equal(r.source, 'home');
  assert.equal(r.modelDir, path.join(homeDir, 'kiwi'));
  // 환경변수가 홈을 이긴다
  fakeModel(path.join(envDir, 'kiwi'));
  fakePkg(envDir);
  r = resolveT1({ env: { KSTE_T1_DIR: envDir }, home, localRoot: local, localPkg });
  assert.equal(r.source, 'env');
  assert.equal(r.dir, path.resolve(envDir));
  // 환경변수 쪽이 불완전하면 다음 후보로 넘어간다
  r = resolveT1({ env: { KSTE_T1_DIR: tmp() }, home, localRoot: local, localPkg });
  assert.equal(r.source, 'home');
});

test('tar 파서: tgz 왕복 + strip', () => {
  const buf = tar(tarEntry('package/', '', '5'), tarEntry('package/package.json', '{"a":1}'), tarEntry('package/dist/x.wasm', Buffer.alloc(1000, 7)));
  const entries = parseTgz(gzipSync(buf));
  assert.deepEqual(entries.map((e) => [e.name, e.type]), [['package/', 'dir'], ['package/package.json', 'file'], ['package/dist/x.wasm', 'file']]);
  assert.equal(entries[2].data.length, 1000);
  const dest = tmp();
  const written = extractEntries(entries, dest, { strip: 1 });
  assert.deepEqual(written, ['package.json', 'dist/x.wasm']);
  assert.equal(readFileSync(path.join(dest, 'package.json'), 'utf8'), '{"a":1}');
  assert.equal(readFileSync(path.join(dest, 'dist', 'x.wasm')).length, 1000);
});

test('tar 파서: 긴 이름(GNU L), filter, 경로 탈출 차단', () => {
  const long = 'pkg/' + 'd'.repeat(120) + '/file.txt';
  const buf = tar(tarEntry('././@LongLink', long + '\0', 'L'), tarEntry('trunc', 'hi'), tarEntry('pkg/other.txt', 'no'));
  const entries = parseTar(buf);
  assert.equal(entries[0].name, long);
  const dest = tmp();
  assert.deepEqual(extractEntries(entries, dest, { filter: (r) => r.endsWith('file.txt') }), [long]);
  assert.ok(existsSync(path.join(dest, long)));
  assert.throws(() => extractEntries(parseTar(tar(tarEntry('../evil.txt', 'x'))), dest), /대상 밖/);
});
