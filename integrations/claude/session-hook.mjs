#!/usr/bin/env node
// Claude의 기본 command hook에서도 세션 자동 적용·Kiwi 준비를 제공한다.
import { readFileSync } from 'node:fs';
import { parseHookInput } from '../shared/hook-log.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run as session } from '../shared/session-hook.mjs';

const skillFile = fileURLToPath(new URL('../../skills/kste/SKILL.md', import.meta.url));
export function run(input, options = {}) {
  return session({ ...input, cwd: input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd() }, { ...options, skillFile, host: 'claude' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = await run(parseHookInput(readFileSync(0, 'utf8'), { host: 'claude', kind: 'session' }));
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ systemMessage: `KSTE 세션 hook 오류: ${e.message}` }) + '\n');
  }
}
