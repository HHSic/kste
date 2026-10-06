#!/usr/bin/env node
// 시작 시 import 실패도 명시적으로 알린다. 입력이나 문서 본문은 오류 로그에 저장하지 않는다.
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRIES = { session: './kste-plugin-hook.mjs', chat: './kste-chat-hook.mjs', file: './kste-codex-hook.mjs' };

export async function run(input, kind, importer = (url) => import(url)) {
  if (!ENTRIES[kind]) throw new Error(`KSTE hook 종류 오류: ${kind}`);
  const hook = await importer(new URL(ENTRIES[kind], import.meta.url));
  const output = await hook.run(input);
  if (kind === 'file') return output;
  return { code: 0, ...(output ? { stdout: JSON.stringify(output) } : {}) };
}

export function failure(error, env = process.env) {
  const detail = String(error?.stack || error);
  let log = '';
  if (env.PLUGIN_DATA) {
    try {
      mkdirSync(env.PLUGIN_DATA, { recursive: true });
      log = path.join(env.PLUGIN_DATA, 'hook-errors.log');
      appendFileSync(log, `${new Date().toISOString()} Node ${process.version}\n${detail}\n\n`);
    } catch { log = ''; }
  }
  return { code: 0, stdout: JSON.stringify({ systemMessage: `KSTE hook가 실행되지 않았습니다: ${error?.message || error}${log ? `\n오류 로그: ${log}` : ''}` }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = await run(JSON.parse(readFileSync(0, 'utf8') || '{}'), process.argv[2]);
  } catch (error) {
    result = failure(error);
  }
  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exitCode = result.code;
}
