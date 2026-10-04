// T1 상주 워커. 메인 스레드는 getT1() 로 클라이언트를 얻고, 첫 호출 때 워커를 띄워 모델을 한 번만 로딩한다.
// 같은 파일이 워커 본체도 겸한다 (isMainThread 로 분기).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadKiwi, analyzeText, t1Available, DEFAULT_MODEL_DIR, loadUserWords } from './kiwi.js';

if (!isMainThread && workerData?.kiwiWorker) {
  // ---------------- 워커 본체 ----------------
  const k = await loadKiwi({ modelDir: workerData.modelDir, userWords: workerData.userWords });
  if (!k) {
    parentPort.postMessage({ type: 'ready', ok: false });
  } else {
    parentPort.postMessage({ type: 'ready', ok: true, loadMs: k.loadMs, version: k.version, userWords: k.userWords.length });
    parentPort.on('message', (m) => {
      try {
        let result;
        if (m.op === 'analyze') {
          result = m.texts.map((t) => (t && t.trim() ? analyzeText(k, t) : []));
        } else if (m.op === 'space') {
          result = m.texts.map((t) => k.kiwi.space(t));
        } else {
          throw new Error(`알 수 없는 op: ${m.op}`);
        }
        parentPort.postMessage({ type: 'result', id: m.id, result });
      } catch (e) {
        parentPort.postMessage({ type: 'result', id: m.id, error: String(e?.message ?? e) });
      }
    });
  }
}

// ---------------- 메인 쪽 클라이언트 ----------------
const CHUNK = 400; // 한 메시지에 실을 문장 수

class T1Client {
  constructor(worker, info) {
    this.worker = worker;
    this.info = info; // {loadMs, version, userWords}
    this.nextId = 1;
    this.pending = new Map();
    worker.on('message', (m) => {
      if (m.type !== 'result') return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (this.pending.size === 0) this.worker.unref();
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    });
    worker.on('error', (e) => {
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    });
  }

  _call(op, texts) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.ref(); // 응답을 기다리는 동안만 이벤트 루프를 붙든다
      this.worker.postMessage({ id, op, texts });
    });
  }

  async _chunked(op, texts) {
    const parts = [];
    for (let i = 0; i < texts.length; i += CHUNK) parts.push(this._call(op, texts.slice(i, i + CHUNK)));
    return (await Promise.all(parts)).flat();
  }

  /** 문자열 배열 -> 토큰 배열의 배열. 토큰 pos 는 각 문자열 안의 UTF-16 인덱스. */
  analyzeMany(texts) {
    return this._chunked('analyze', texts);
  }

  /** 단일 문자열 -> 토큰 배열 */
  async analyze(text) {
    return (await this.analyzeMany([text]))[0];
  }

  /** 띄어쓰기 교정 결과 문자열 배열 */
  spaceMany(texts) {
    return this._chunked('space', texts);
  }

  async close() {
    await this.worker.terminate();
  }
}

let singleton = null; // Promise<T1Client|null>

/**
 * T1 클라이언트(프로세스당 하나). 모델이 없으면 null.
 * 로딩은 첫 호출에서만 일어난다.
 */
export function getT1(opts = {}) {
  const modelDir = opts.modelDir ?? DEFAULT_MODEL_DIR;
  if (singleton) return singleton;
  if (!t1Available(modelDir)) return Promise.resolve(null);
  singleton = new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: { kiwiWorker: true, modelDir, userWords: opts.userWords ?? loadUserWords() },
      stderr: true, // Kiwi 가 찍는 'Quantization is not supported' 안내를 부모 stderr 로 흘리지 않는다
    });
    worker.once('error', (e) => { singleton = null; reject(e); });
    worker.once('message', (m) => {
      if (m.type === 'ready' && m.ok) {
        worker.unref(); // 유휴일 때는 CLI 종료를 막지 않는다
        resolve(new T1Client(worker, m));
      }
      else { singleton = null; resolve(null); }
    });
  });
  return singleton;
}

export async function closeT1() {
  if (!singleton) return;
  const c = await singleton;
  singleton = null;
  await c?.close();
}
