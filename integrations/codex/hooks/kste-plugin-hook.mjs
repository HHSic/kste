#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../shared/session-hook.mjs';
export * from '../../shared/session-hook.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = await run(JSON.parse(readFileSync(0, 'utf8') || '{}'));
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ systemMessage: `KSTE 플러그인 hook 오류: ${e.message}` }) + '\n');
  }
}
