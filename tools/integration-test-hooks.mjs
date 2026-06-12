#!/usr/bin/env node
/**
 * ContextDevKit integration test — HOOK ENTRYPOINTS (rule 2 as a test).
 *
 * Executes every module under `templates/contextkit/runtime/hooks/` as a child
 * process — once with a benign Claude-hook payload, once with garbage stdin —
 * and asserts exit 0 both times in a bare temp cwd. This IS the constitution's
 * rule 2 ("hooks never break real work; defensive I/O always") asserted
 * uniformly, and it exercises the real template files so the grade-4
 * self-coverage harness (ADR-0045, NODE_V8_COVERAGE over runtime/hooks/**)
 * sees every entrypoint.
 *
 * A PreToolUse gate may legitimately exit non-zero ONLY to block; with a benign
 * payload and no config present there is nothing to block, so 0 is the law.
 *
 * Run:  node tools/integration-test-hooks.mjs   (exit 0 = healthy)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KIT, reporter } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — hook entrypoints (rule 2)\n');

const HOOKS_DIR = resolve(KIT, 'templates', 'contextkit', 'runtime', 'hooks');
const bareCwd = mkdtempSync(join(tmpdir(), 'ckit-hooks-'));

/** A benign, well-formed Claude Code hook payload (PreToolUse-shaped — every
 *  hook tolerates extra fields and missing ones alike, by contract). */
const BENIGN_PAYLOAD = JSON.stringify({
  session_id: 'hooks-smoke',
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: { file_path: 'README.md' },
  cwd: bareCwd,
});

function runHook(file, stdin) {
  return spawnSync(process.execPath, [join(HOOKS_DIR, file)], {
    cwd: bareCwd,
    input: stdin,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: bareCwd },
  });
}

try {
  const hookFiles = readdirSync(HOOKS_DIR).filter((file) => file.endsWith('.mjs'));
  hookFiles.length >= 14 ? ok(`${hookFiles.length} hook modules found`) : bad(`only ${hookFiles.length} hook modules under runtime/hooks/`);
  for (const file of hookFiles) {
    const benign = runHook(file, BENIGN_PAYLOAD);
    benign.status === 0
      ? ok(`${file} exits 0 on a benign payload in a bare project`)
      : bad(`${file} exit ${benign.status} on benign payload (rule 2): ${(benign.stderr || benign.stdout || '').slice(0, 160)}`);
    const garbage = runHook(file, 'not-json{{{');
    garbage.status === 0
      ? ok(`${file} exits 0 on garbage stdin (defensive I/O)`)
      : bad(`${file} exit ${garbage.status} on garbage stdin (rule 2): ${(garbage.stderr || garbage.stdout || '').slice(0, 160)}`);
  }
} finally {
  rmSync(bareCwd, { recursive: true, force: true });
}

rep.finish('hook entrypoints (rule 2)');
