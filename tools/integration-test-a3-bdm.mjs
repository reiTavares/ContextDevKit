#!/usr/bin/env node
/**
 * Integration suite — BIZ-0001 / WF-0036 Wave A3 (Business lifecycle & Growth).
 *
 * Backs Gate G-A3 by running the two A3 behavioural selftests that live next to
 * their SOURCE modules under `templates/contextkit/tools/scripts/`:
 *   1. `business-growth-validator.selftest.mjs` — causal-chain + KPI completeness
 *      + no-invented-baseline rules, and defensive (never throws on hostile input);
 *   2. `work-business-gate.selftest.mjs` — Business Gate (accepted-ADR + matching
 *      decisionHash), the AI-cannot-self-approve invariant, and revision-hash change.
 *
 * Thin spawning runner (mirrors `tools/run-suites.mjs`): each selftest is a
 * standalone `process.exit(0|1)` script; we spawn both and fail if any fails.
 * Zero-dependency, `node:*` only, Windows-safe (array-arg spawnSync, no shell).
 * Exit 0 = pass, 1 = fail.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');

const SELFTESTS = [
  'business-growth-validator.selftest.mjs',
  'work-business-gate.selftest.mjs',
];

console.log('\n🌀 WF-0036 A3 — Business lifecycle & Growth\n');

let failures = 0;
for (const rel of SELFTESTS) {
  const child = spawnSync(process.execPath, [resolve(SCRIPTS, rel)], {
    cwd: KIT,
    encoding: 'utf-8',
  });
  process.stdout.write(child.stdout || '');
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) {
    failures += 1;
    console.error(`  ✗ ${rel} exited ${child.status}`);
  } else {
    console.log(`  ✓ ${rel} passed`);
  }
}

console.log(failures === 0 ? '\n✅ A3 lifecycle/Growth suite passed.\n' : `\n❌ ${failures} A3 selftest(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
