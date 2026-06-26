#!/usr/bin/env node
/**
 * Integration suite — WF-0042 fleet-aware intake collision gate + done/ lifecycle
 * (ADR-0119).
 *
 * Runs the three behavioural selftests next to their SOURCE:
 *   1. `registry/fleet.selftest.mjs` — worktree enumeration, fleet memory roots,
 *      done-recursive numbering, localVsFleet shape;
 *   2. `intake-collision-gate.selftest.mjs` — advisory report + render, CLI exit 0;
 *   3. `workflow-done-sweep.selftest.mjs` — owned/unowned filing, idempotent moves,
 *      number kept after a `done/` move.
 *
 * Thin spawning runner (mirrors `tools/integration-test-a4-bdm.mjs`).
 * Zero-dependency, `node:*` only, Windows-safe. Exit 0 = pass, 1 = fail.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));

const SELFTESTS = [
  'templates/contextkit/tools/scripts/registry/fleet.selftest.mjs',
  'templates/contextkit/tools/scripts/intake-collision-gate.selftest.mjs',
  'templates/contextkit/tools/scripts/workflow-done-sweep.selftest.mjs',
];

console.log('\n🔢 WF-0042 — fleet-aware intake collision gate & done/ lifecycle\n');

let failures = 0;
for (const rel of SELFTESTS) {
  const child = spawnSync(process.execPath, [resolve(KIT, rel)], { cwd: KIT, encoding: 'utf-8' });
  process.stdout.write(child.stdout || '');
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) { failures += 1; console.error(`  ✗ ${rel} exited ${child.status}`); }
  else console.log(`  ✓ ${rel} passed`);
}

console.log(failures === 0 ? '\n✅ Intake-gate suite passed.\n' : `\n❌ ${failures} intake-gate selftest(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
