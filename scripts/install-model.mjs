#!/usr/bin/env node
// Kiwi 모델 설치 -> models/kiwi/
// 1순위: 이 PC 의 kiwipiepy_model(pip) 패키지에서 복사.  2순위: PyPI 의 kiwipiepy-model 배포본(현재 sdist tar.gz 약 88MB, wheel 이 있으면 wheel)을 내려받아 압축 해제.
// 옵션: --force 덮어쓰기, --from <dir> 모델 디렉터리 지정, --download 로컬 탐색 없이 다운로드, --dest <dir> 설치 위치(기본 models/kiwi)
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const destIdx = args.indexOf('--dest');
const DEST = destIdx >= 0 ? path.resolve(args[destIdx + 1]) : path.join(ROOT, 'models', 'kiwi');
export const MODEL_FILES = ['combiningRule.txt', 'default.dict', 'dialect.dict', 'extract.mdl', 'multi.dict', 'nounchr.mdl', 'sj.morph', 'typo.dict', 'cong.mdl'];

const force = args.includes('--force');
const fromIdx = args.indexOf('--from');
const fromDir = fromIdx >= 0 ? args[fromIdx + 1] : null;

const complete = (dir) => MODEL_FILES.every((f) => existsSync(path.join(dir, f)));

function pipModelDir() {
  for (const py of ['python', 'python3', 'py']) {
    try {
      const out = execFileSync(py, ['-c', 'import kiwipiepy_model,os;print(os.path.dirname(kiwipiepy_model.__file__))'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (out && complete(out)) return out;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

function findModelDir(root) {
  if (complete(root)) return root;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = findModelDir(path.join(root, e.name));
    if (r) return r;
  }
  return null;
}

async function downloadPackage() {
  console.log('PyPI 에서 kiwipiepy-model 정보를 조회한다...');
  const meta = await (await fetch('https://pypi.org/pypi/kiwipiepy-model/json')).json();
  const ver = meta.info.version;
  const file = meta.urls.find((u) => u.packagetype === 'bdist_wheel') ?? meta.urls.find((u) => u.packagetype === 'sdist') ?? meta.urls[0];
  if (!file) throw new Error('PyPI 에 내려받을 배포본이 없다');
  console.log(`내려받기: ${file.filename} (${(file.size / 1e6).toFixed(0)}MB, v${ver})`);
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`다운로드 실패: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `kiwi-model-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const archive = path.join(tmp, file.filename);
  writeFileSync(archive, buf);
  // tar.gz 와 wheel(zip) 모두 Windows 10+ 의 bsdtar / Linux·macOS 의 tar 로 푼다. 실패하면 unzip.
  // GNU tar 는 'C:\...' 를 host:path 로 읽으므로 cwd 를 tmp 로 두고 상대 경로를 쓴다.
  try { execFileSync('tar', ['-xf', file.filename], { cwd: tmp, stdio: 'ignore' }); } catch { execFileSync('unzip', ['-q', file.filename], { cwd: tmp }); }
  const dir = findModelDir(tmp);
  if (!dir) throw new Error('내려받은 배포본 안에서 모델 파일을 찾지 못했다');
  return { dir, cleanup: () => rmSync(tmp, { recursive: true, force: true }), version: ver };
}

async function main() {
  if (complete(DEST) && !force) {
    console.log(`이미 설치됨: ${DEST}`);
    return;
  }
  let src = null, cleanup = null, via = '';
  if (fromDir) {
    if (!complete(fromDir)) throw new Error(`--from 디렉터리에 모델 파일이 없다: ${fromDir}`);
    src = fromDir; via = '--from';
  } else if (!args.includes('--download')) {
    src = pipModelDir();
    via = 'pip kiwipiepy_model';
  }
  if (!src) {
    const d = await downloadPackage();
    src = d.dir; cleanup = d.cleanup; via = `PyPI kiwipiepy-model ${d.version}`;
  }
  mkdirSync(DEST, { recursive: true });
  let total = 0;
  for (const f of MODEL_FILES) {
    copyFileSync(path.join(src, f), path.join(DEST, f));
    total += statSync(path.join(DEST, f)).size;
  }
  writeFileSync(path.join(DEST, 'SOURCE.txt'), `via: ${via}\nfrom: ${src}\ndate: ${new Date().toISOString()}\n`);
  cleanup?.();
  console.log(`설치 완료: ${DEST} (${(total / 1e6).toFixed(1)}MB, 출처 ${via})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
