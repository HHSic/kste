#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../shared/chat-hook.mjs';
export * from '../../shared/chat-hook.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = run(JSON.parse(readFileSync(0, 'utf8') || '{}'));
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ systemMessage: `KSTE 채팅 hook 오류: ${e.message}` }) + '\n');
  }
}
