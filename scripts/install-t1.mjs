#!/usr/bin/env node
// T1(Kiwi 형태소 분석) 설치: kiwi-nlp 패키지 + Kiwi 모델을 사용자 데이터 디렉터리에 둔다.
//   기본 위치: KSTE_T1_DIR 또는 ~/.kste/t1  (플러그인 폴더는 업데이트 때 통째로 바뀌므로 버전과 무관한 곳)
//   <dest>/node_modules/kiwi-nlp/   <dest>/kiwi/(모델 9개 파일)
// 옵션: --check 설치 여부만 JSON 으로 출력  --force 다시 설치  --dest <dir> 위치 지정
//       --from <dir> 모델 디렉터리 지정  --download 로컬 탐색 없이 PyPI 에서 받기
// 진행 상황은 stderr, --check 의 JSON 은 stdout. 경로는 import.meta.url 기준이라 플러그인 캐시 폴더에서도 맞다.
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { MODEL_FILES, modelInstalled, modelSize, resolveT1, userT1Dir, kiwiPackageIn } from '../lib/t1/kiwi.js';
import { parseTar, extractEntries } from '../lib/t1/tar.js';

const KIWI_NLP_RANGE = '0.24';
const log = (m) => process.stderr.write(`${m}\n`);

/** --check 결과 객체. env/home 을 주입할 수 있어 테스트에서 임시 디렉터리를 쓴다. */
export function checkReport(opts = {}) {
  const r = resolveT1(opts);
  const model = r.searched.find((c) => c.model);
  const pkg = r.searched.find((c) => c.pkg);
  const modelDir = model?.modelDir ?? r.modelDir;
  return {
    installed: r.ok,
    dir: r.dir,
    source: r.source,
    installTarget: userT1Dir(opts),
    model: { installed: !!model, dir: modelDir, sizeBytes: model ? modelSize(modelDir) : 0 },
    kiwiNlp: { installed: !!pkg, path: pkg?.pkgDir ?? null },
    searched: r.searched.map((c) => ({ source: c.source, dir: c.dir, model: c.model, kiwiNlp: c.pkg })),
  };
}

// ---- 진행률 다운로드 (stderr)
async function download(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패: HTTP ${res.status} ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0, lastStep = -1;
  const show = (final) => {
    const mb = (got / 1e6).toFixed(1);
    const msg = total ? `${label}: ${mb}/${(total / 1e6).toFixed(1)}MB (${Math.floor((got / total) * 100)}%)` : `${label}: ${mb}MB`;
    if (process.stderr.isTTY) process.stderr.write(`\r${msg}${final ? '\n' : ''}`);
    else if (final || Math.floor(got / 1e7) !== lastStep) { lastStep = Math.floor(got / 1e7); log(msg); }
  };
  for await (const c of res.body) { chunks.push(c); got += c.length; show(false); }
  show(true);
  return Buffer.concat(chunks);
}

// ---- (a) kiwi-nlp
function npmInstall(dest) {
  mkdirSync(dest, { recursive: true });
  const pj = path.join(dest, 'package.json');
  if (!existsSync(pj)) writeFileSync(pj, '{"name":"kste-t1","private":true}\n');
  const r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', dest, `kiwi-nlp@${KIWI_NLP_RANGE}`], {
    cwd: dest, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32',
  });
  return r.status === 0 && kiwiPackageIn(dest) !== null;
}

async function tarballInstall(dest) {
  log('레지스트리에서 kiwi-nlp 정보를 조회한다...');
  const meta = await (await fetch('https://registry.npmjs.org/kiwi-nlp')).json();
  const pre = `${KIWI_NLP_RANGE}.`;
  const vers = Object.keys(meta.versions).filter((v) => v.startsWith(pre) && !v.includes('-'));
  vers.sort((a, b) => parseInt(b.split('.')[2], 10) - parseInt(a.split('.')[2], 10));
  if (!vers.length) throw new Error(`kiwi-nlp ${KIWI_NLP_RANGE}.x 버전이 레지스트리에 없다`);
  const v = vers[0];
  const buf = await download(meta.versions[v].dist.tarball, `kiwi-nlp ${v}`);
  const target = path.join(dest, 'node_modules', 'kiwi-nlp');
  rmSync(target, { recursive: true, force: true });
  extractEntries(parseTar(gunzipSync(buf)), target, { strip: 1 });
  if (!kiwiPackageIn(dest)) throw new Error('kiwi-nlp tarball 에 package.json 이 없다');
}

async function installKiwiNlp(dest, force) {
  if (kiwiPackageIn(dest) && !force) { log(`kiwi-nlp 이미 설치됨: ${kiwiPackageIn(dest)}`); return; }
  log('kiwi-nlp 설치: npm install 시도...');
  if (npmInstall(dest)) { log('kiwi-nlp 설치 완료 (npm)'); return; }
  log('npm 을 쓸 수 없거나 실패했다. 레지스트리 tarball 을 직접 받는다.');
  await tarballInstall(dest);
  log('kiwi-nlp 설치 완료 (tarball)');
}

// ---- (b) 모델
function pipModelDir() {
  for (const py of ['python', 'python3', 'py']) {
    try {
      const out = execFileSync(py, ['-c', 'import kiwipiepy_model,os;print(os.path.dirname(kiwipiepy_model.__file__))'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (out && modelInstalled(out)) return out;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

function findModelDir(root) {
  if (modelInstalled(root)) return root;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = findModelDir(path.join(root, e.name));
    if (r) return r;
  }
  return null;
}

async function downloadModel() {
  log('PyPI 에서 kiwipiepy-model 정보를 조회한다...');
  const meta = await (await fetch('https://pypi.org/pypi/kiwipiepy-model/json')).json();
  const ver = meta.info.version;
  const file = meta.urls.find((u) => u.packagetype === 'bdist_wheel') ?? meta.urls.find((u) => u.packagetype === 'sdist') ?? meta.urls[0];
  if (!file) throw new Error('PyPI 에 내려받을 배포본이 없다');
  const buf = await download(file.url, `${file.filename} (v${ver})`);
  const tmp = path.join(os.tmpdir(), `kiwi-model-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  if (/\.(tar\.gz|tgz)$/.test(file.filename)) {
    const names = new Set(MODEL_FILES);
    extractEntries(parseTar(gunzipSync(buf)), tmp, { filter: (rel) => names.has(rel.split('/').pop()) });
  } else {
    const archive = path.join(tmp, file.filename);
    writeFileSync(archive, buf);
    // wheel(zip): bsdtar(Windows 10+, macOS) 또는 unzip. cwd 를 tmp 로 두어 'C:\' 가 host:path 로 읽히는 문제를 피한다.
    try { execFileSync('tar', ['-xf', file.filename], { cwd: tmp, stdio: 'ignore' }); } catch { execFileSync('unzip', ['-q', file.filename], { cwd: tmp }); }
  }
  const dir = findModelDir(tmp);
  if (!dir) throw new Error('내려받은 배포본 안에서 모델 파일을 찾지 못했다');
  return { dir, cleanup: () => rmSync(tmp, { recursive: true, force: true }), version: ver };
}

async function installModel(dest, { force, fromDir, forceDownload }) {
  const modelDir = path.join(dest, 'kiwi');
  if (modelInstalled(modelDir) && !force) { log(`모델 이미 설치됨: ${modelDir}`); return; }
  let src = null, cleanup = null, via = '';
  if (fromDir) {
    if (!modelInstalled(fromDir)) throw new Error(`--from 디렉터리에 모델 파일이 없다: ${fromDir}`);
    src = fromDir; via = '--from';
  } else if (!forceDownload) {
    src = pipModelDir();
    via = 'pip kiwipiepy_model';
  }
  if (!src) {
    const d = await downloadModel();
    src = d.dir; cleanup = d.cleanup; via = `PyPI kiwipiepy-model ${d.version}`;
  }
  mkdirSync(modelDir, { recursive: true });
  for (const f of MODEL_FILES) copyFileSync(path.join(src, f), path.join(modelDir, f));
  writeFileSync(path.join(modelDir, 'SOURCE.txt'), `via: ${via}\nfrom: ${src}\ndate: ${new Date().toISOString()}\n`);
  cleanup?.();
  log(`모델 설치 완료: ${modelDir} (${(modelSize(modelDir) / 1e6).toFixed(1)}MB, 출처 ${via})`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  if (args.includes('--check')) {
    console.log(JSON.stringify(checkReport(), null, 2));
    return 0;
  }
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : userT1Dir();
  const force = args.includes('--force');
  log(`T1 설치 위치: ${dest}`);
  await installKiwiNlp(dest, force);
  await installModel(dest, { force, fromDir: opt('--from'), forceDownload: args.includes('--download') });
  log('T1 설치 끝. 다음 검사부터 형태소 분석이 켜진다.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => { console.error(`T1 설치 실패: ${e.message}`); process.exit(1); });
}
