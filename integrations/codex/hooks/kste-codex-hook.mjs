#!/usr/bin/env node
// Codex PostToolUse hook. apply_patch 가 고친 .md 파일에 KSTE T0 린터를 돌린다.
// stdin: Codex hook JSON (tool_name, tool_input.command = 패치 본문, cwd).
// 종료 코드 2 + stderr = 모델에게 피드백. 그 외 0.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../../../hooks/kste-hook.mjs';

/** apply_patch 본문에서 추가·수정된 파일 경로를 뽑는다. */
export function patchFiles(patch) {
  const files = [];
  for (const m of String(patch ?? '').matchAll(/^\*\*\* (?:Add|Update) File: (.+?)\s*$|^\*\*\* Move to: (.+?)\s*$/gm)) files.push(m[1] ?? m[2]);
  return [...new Set(files)];
}

export async function run(input) {
  const files = patchFiles(input.tool_input?.command).filter((f) => /\.md$/i.test(f));
  const errs = [];
  for (const file of files) {
    const r = await handle({ cwd: input.cwd, tool_name: 'Write', tool_input: { file_path: file } });
    if (r.code === 2 && r.stderr) errs.push(r.stderr);
  }
  return errs.length ? { code: 2, stderr: errs.join('\n') } : { code: 0 };
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
      if (r.stderr) process.stderr.write(r.stderr + '\n');
      process.exitCode = r.code;
    } catch {
      process.exitCode = 0; // 린터 고장이 작업을 막지 않게 한다
    }
  }
}
