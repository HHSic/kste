#!/usr/bin/env node
// Codex PostToolUse hook. apply_patch 가 고친 .md 파일에 KSTE T0 린터를 돌린다.
// stdin: Codex hook JSON (tool_name, tool_input.command = 패치 본문, cwd).
// 종료 코드 2 + stderr = 모델에게 피드백. 그 외 0.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../../../hooks/kste-hook.mjs';
import * as store from '../state.mjs';

/** apply_patch 본문에서 추가·수정된 파일 경로를 뽑는다. */
export function patchFiles(patch) {
  const files = [];
  for (const m of String(patch ?? '').matchAll(/^\*\*\* (?:Add|Update) File: (.+?)\s*$|^\*\*\* Move to: (.+?)\s*$/gm)) files.push(m[1] ?? m[2]);
  return [...new Set(files)];
}

export async function run(input) {
  // apply_patch의 문자열 입력과 command/patch 객체 입력을 모두 받는다.
  const patch = typeof input.tool_input === 'string' ? input.tool_input : input.tool_input?.command ?? input.tool_input?.patch;
  const files = patchFiles(patch).filter((f) => /\.md$/i.test(f));
  const errs = [];
  const notices = [];
  for (const file of files) {
    const r = await handle({ cwd: input.cwd, tool_name: 'Write', tool_input: { file_path: file } }, Date.now(), store);
    if (r.code === 2 && r.stderr) errs.push(r.stderr);
    if (r.stdout) notices.push(JSON.parse(r.stdout).systemMessage);
  }
  return errs.length ? { code: 2, stderr: errs.join('\n') }
    : { code: 0, ...(notices.length ? { stdout: JSON.stringify({ systemMessage: notices.join('\n') }) } : {}) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    input = null;
  }
  if (input) {
    try {
      const r = await run(input);
      if (r.stdout) process.stdout.write(r.stdout + '\n');
      if (r.stderr) process.stderr.write(r.stderr + '\n');
      process.exitCode = r.code;
    } catch {
      process.exitCode = 0; // 린터 고장이 작업을 막지 않게 한다
    }
  }
}
