#!/usr/bin/env node
/**
 * Antigravity Boot Context Loader — runs the standard session-start hook
 * without needing interactive stdin wait.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PLATFORM_DIR } from '../config/paths.mjs';

const ROOT = process.cwd();
const hookPath = resolve(ROOT, PLATFORM_DIR, 'runtime/hooks/session-start.mjs');

const child = spawn('node', [hookPath], {
  cwd: ROOT,
  stdio: ['pipe', 'inherit', 'inherit']
});

child.stdin.write('{}');
child.stdin.end();

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
