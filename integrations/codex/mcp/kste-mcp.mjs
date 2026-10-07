#!/usr/bin/env node
// 기존 설치 경로 호환용 진입점.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../shared/kste-mcp.mjs';
export * from '../../shared/kste-mcp.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
