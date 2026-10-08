#!/usr/bin/env node
// KSTE MCP 서버 (stdio, JSON-RPC 2.0, 줄 단위 JSON). 외부 의존성 없음.
// 도구: kste_check, kste_diff, kste_rules, kste_state
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules } from '../../lib/rules/load.js';
import { lintText } from '../../lib/engine/tier0.js';
import { comparePreservation } from '../../lib/engine/preserve.js';
import { lintTextT1, compareT1, resolveT1Mode, closeT1 } from '../../lib/t1/engine.js';
import { buildReport, renderMarkdown, renderJson } from '../../lib/engine/report.js';
import { applyMode } from '../../lib/engine/mode.js';
import { loadState, setState, statePath, stateContext, modeName } from './state.mjs';

const SERVER_INFO = { name: 'kste', version: '1.3.2' };
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BYTES = 2 * 1024 * 1024;

const TOOLS = [
  {
    name: 'kste_check',
    description: '한국어 문서를 KSTE 린터로 검사한다. text 또는 path 중 하나를 준다. 리포트를 Markdown과 JSON으로 돌려준다. 파일은 고치지 않는다.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '검사할 본문' },
        path: { type: 'string', description: '검사할 파일 경로 (text가 없을 때)' },
        genre: { type: 'string', enum: ['auto', 'procedural', 'descriptive'], description: '장르. 기본 auto' },
        t1: { type: 'string', enum: ['auto', 'on', 'off'], description: 'T1 형태소 검사. 생략하면 프로젝트 설정' },
        cwd: { type: 'string', description: '현재 프로젝트 작업 디렉터리. 상태·상대 경로의 기준' },
      },
    },
  },
  {
    name: 'kste_diff',
    description: '재작성 전후의 정보 보존(숫자, 단위, 부정어, 고유명사)을 비교한다. before와 after는 본문 또는 파일 경로.',
    inputSchema: {
      type: 'object',
      properties: {
        before: { type: 'string', description: '원문 본문 또는 파일 경로' },
        after: { type: 'string', description: '수정문 본문 또는 파일 경로' },
        t1: { type: 'string', enum: ['auto', 'on', 'off'], description: '생략하면 프로젝트 설정' },
        cwd: { type: 'string', description: '현재 프로젝트 작업 디렉터리' },
      },
      required: ['before', 'after'],
    },
  },
  {
    name: 'kste_rules',
    description: '로드된 KSTE 규칙 수를 돌려준다.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'kste_state',
    description: '프로젝트 KSTE 설정 조회·변경. args: on, off, default, strict, t1 on/off/status, status, last, logs. 80은 default의 별칭. 빈 배열은 조회. cwd에 현재 프로젝트 작업 디렉터리를 준다.',
    inputSchema: {
      type: 'object', properties: {
        args: { type: 'array', items: { type: 'string' }, description: '예: ["off"], ["strict"], ["t1", "on"], []' },
        cwd: { type: 'string', description: '현재 프로젝트 작업 디렉터리' },
      },
    },
  },
];

function readPath(p, cwd = process.cwd()) {
  const abs = path.resolve(cwd, p);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`파일을 찾을 수 없다: ${p}`);
  if (statSync(abs).size > MAX_BYTES) throw new Error(`파일이 너무 크다 (최대 ${MAX_BYTES} 바이트): ${p}`);
  return readFileSync(abs, 'utf8');
}

// 값이 존재하는 파일 경로면 파일 내용, 아니면 본문으로 취급한다.
function textOrPath(v, cwd) {
  if (typeof v !== 'string') throw new Error('문자열이 필요하다');
  if (!v.includes('\n') && v.length < 1024) {
    try {
      const abs = path.resolve(cwd, v);
      if (existsSync(abs) && statSync(abs).isFile()) return readPath(abs);
    } catch (e) {
      if (/너무 크다/.test(e.message)) throw e;
    }
  }
  return v;
}

function t1Of(mode = 'off') {
  if (!['auto', 'on', 'off'].includes(mode)) throw new Error(`t1 값이 잘못됐다: ${mode}`);
  const t1 = resolveT1Mode(mode);
  if (t1.error) throw new Error(t1.error);
  return t1;
}

const result = (md, json) => ({
  content: [{ type: 'text', text: md }, ...(json ? [{ type: 'text', text: json }] : [])],
});

export async function callTool(name, args = {}) {
  if (args.cwd !== undefined && (typeof args.cwd !== 'string' || !args.cwd)) throw new Error('cwd는 비어 있지 않은 디렉터리 경로여야 합니다');
  const cwd = path.resolve(args.cwd ?? process.cwd());
  if (name === 'kste_state') {
    const r = setState(args.args ?? [], cwd);
    const { enabled, mode, t1 } = r.state;
    const text = ['last', 'logs'].includes(args.args?.[0]?.toLowerCase()) ? `\`\`\`text\n${r.text}\n\`\`\`` : r.text;
    return result(text, JSON.stringify({ enabled, mode: modeName(mode), t1, changed: r.changed, path: statePath(cwd), context: stateContext(r.state) }));
  }
  if (name === 'kste_check') {
    const genre = args.genre ?? 'auto';
    if (!['auto', 'procedural', 'descriptive'].includes(genre)) throw new Error(`genre 값이 잘못됐다: ${genre}`);
    let text;
    if (typeof args.text === 'string') text = args.text;
    else if (typeof args.path === 'string') text = readPath(args.path, cwd);
    else throw new Error('text 또는 path 가 필요하다');
    const state = loadState(cwd);
    const t1 = t1Of(args.t1 ?? (state.t1 ? 'on' : 'off'));
    const ruleset = loadRules();
    const r = t1.use ? await lintTextT1(text, { genre, ruleset }) : lintText(text, { genre, ruleset });
    r.findings = applyMode(r.findings, state.mode);
    const report = buildReport(r, { ruleStats: ruleset.counts });
    report.summary.mode = modeName(state.mode);
    return result(renderMarkdown(report), renderJson(report));
  }
  if (name === 'kste_diff') {
    const a = textOrPath(args.before, cwd);
    const b = textOrPath(args.after, cwd);
    const state = loadState(cwd);
    const t1 = t1Of(args.t1 ?? (state.t1 ? 'on' : 'off'));
    const { findings, stats } = comparePreservation(a, b);
    const k83 = t1.use ? await compareT1(a, b) : null;
    if (k83) {
      findings.push(...k83.findings);
      Object.assign(stats, k83.stats);
    }
    const report = buildReport({ findings, meta: { stats, tier: k83 ? 'T0+T1' : 'T0', t1: !!k83 } }, { title: 'KSTE diff' });
    report.summary.mode = modeName(state.mode);
    return result(renderMarkdown(report), renderJson({ ...report, stats }));
  }
  if (name === 'kste_rules') {
    const c = loadRules().counts;
    return result(`로드된 규칙 ${c.loaded}개 (전체 ${c.total}: deprecated ${c.deprecated}, t0 비활성 ${c.t0Disabled}, 컴파일 실패 ${c.compileFailed})`, JSON.stringify(c, null, 2));
  }
  throw Object.assign(new Error(`알 수 없는 도구: ${name}`), { code: -32602 });
}

/** 메시지 하나를 처리한다. 응답 객체 또는 null(알림) 반환. */
export async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  const ok = (res) => ({ jsonrpc: '2.0', id, result: res });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  try {
    switch (method) {
      case 'initialize': {
        const want = params?.protocolVersion;
        return ok({
          protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      case 'ping':
        return isNotification ? null : ok({});
      case 'tools/list':
        return ok({ tools: TOOLS });
      case 'tools/call':
        try {
          return ok(await callTool(params?.name, params?.arguments ?? {}));
        } catch (e) {
          if (e.code === -32602) return fail(-32602, e.message);
          return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
        }
      default:
        if (isNotification) return null; // notifications/initialized 등
        return fail(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return isNotification ? null : fail(-32603, e.message);
  }
}

export function main() {
  let buf = '';
  let pending = 0;
  let ended = false;
  const finish = async () => {
    if (ended && pending === 0) {
      await closeT1();
      process.exit(0);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
        continue;
      }
      pending++;
      handleMessage(msg)
        .then((res) => res && process.stdout.write(JSON.stringify(res) + '\n'))
        .finally(() => {
          pending--;
          finish();
        });
    }
  });
  process.stdin.on('end', () => {
    ended = true;
    finish();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
