#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseHookInput } from '../../shared/hook-log.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../shared/chat-hook.mjs';
export * from '../../shared/chat-hook.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = run(parseHookInput(readFileSync(0, 'utf8'), { host: 'codex', kind: 'chat' }));
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ systemMessage: `KSTE 채팅 hook 오류: ${e.message}` }) + '\n');
  }
}
