#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { loadRules } from '../lib/rules/load.js';
import { lintText } from '../lib/engine/tier0.js';
import { comparePreservation } from '../lib/engine/preserve.js';
import { lintTextT1, compareT1, resolveT1Mode, closeT1 } from '../lib/t1/engine.js';
import { buildReport, renderMarkdown, renderJson, shouldFail, filterFindings } from '../lib/engine/report.js';

const USAGE = `사용법:
  kste check <file|-> [--genre procedural|descriptive|auto] [--all] [--json] [--fail-on error|warn] [--noun-chain] [--t1 auto|on|off]
  kste diff <원문> <수정문> [--json] [--t1 auto|on|off] [--fail-on error|warn]
  kste rules
종료 코드: 0 정상, 1 fail-on 이상 위반 있음, 2 사용법 오류`;

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-') pos.push(a);
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (['genre', 'fail-on', 't1'].includes(k)) opt[k] = v ?? argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readInput(arg, { literalOk = false } = {}) {
  if (arg === '-') return readStdin();
  if (existsSync(arg)) return readFileSync(arg, 'utf8');
  if (literalOk) return arg;
  throw new Error(`파일을 찾을 수 없다: ${arg}`);
}

function out(s) {
  process.stdout.write(s);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const failOn = opt['fail-on'] ?? 'error';
  const t1Mode = opt.t1 ?? 'auto';
  if (!['auto', 'on', 'off'].includes(t1Mode)) {
    console.error(`--t1 값이 잘못됐다: ${t1Mode}`);
    return 2;
  }
  const t1 = resolveT1Mode(t1Mode);
  if (t1.error && (cmd === 'check' || cmd === 'diff')) {
    console.error(t1.error);
    return 2;
  }
  if (!['error', 'warn', 'info'].includes(failOn)) {
    console.error(`--fail-on 값이 잘못됐다: ${failOn}`);
    return 2;
  }

  if (cmd === 'check') {
    if (pos.length !== 1) {
      console.error(USAGE);
      return 2;
    }
    const genre = opt.genre ?? 'auto';
    if (!['auto', 'procedural', 'descriptive'].includes(genre)) {
      console.error(`--genre 값이 잘못됐다: ${genre}`);
      return 2;
    }
    const text = readInput(pos[0]);
    const ruleset = loadRules();
    const result = t1.use
      ? await lintTextT1(text, { genre, ruleset, nounChain: !!opt['noun-chain'] })
      : lintText(text, { genre, ruleset, nounChain: !!opt['noun-chain'] });
    const report = buildReport(result, { all: !!opt.all, ruleStats: ruleset.counts });
    out(opt.json ? renderJson(report) : renderMarkdown(report));
    return shouldFail(report.findings, failOn) ? 1 : 0;
  }

  if (cmd === 'diff') {
    if (pos.length !== 2) {
      console.error(USAGE);
      return 2;
    }
    const a = readInput(pos[0], { literalOk: true });
    const b = readInput(pos[1], { literalOk: true });
    const { findings, stats } = comparePreservation(a, b);
    const k83 = t1.use ? await compareT1(a, b) : null;
    if (k83) {
      findings.push(...k83.findings);
      Object.assign(stats, k83.stats);
    }
    const report = buildReport({ findings, meta: { stats, tier: k83 ? 'T0+T1' : 'T0', t1: !!k83 } }, { title: 'KSTE diff' });
    out(opt.json ? renderJson({ ...report, stats }) : renderMarkdown(report));
    return shouldFail(filterFindings(findings), failOn) ? 1 : 0;
  }

  if (cmd === 'rules') {
    const rs = loadRules();
    const c = rs.counts;
    out(`로드된 규칙 ${c.loaded}개 (전체 ${c.total}: deprecated ${c.deprecated}, t0 비활성 ${c.t0Disabled}, 컴파일 실패 ${c.compileFailed})\n`);
    for (const [f, v] of Object.entries(c.files)) out(`  ${f.padEnd(14)} 로드 ${v.loaded} / 전체 ${v.total}\n`);
    out(`컴파일 실패 ${rs.failures.length}건\n`);
    for (const f of rs.failures) out(`  ${f.id} (${f.file}): ${f.error}\n`);
    return 0;
  }

  console.error(USAGE);
  return 2;
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  await closeT1();
}
