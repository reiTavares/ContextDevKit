#!/usr/bin/env node
/**
 * Integration suite — BIZ-0001 / WF-0036 Wave A4 (Workflow nesting & compatibility).
 *
 * Backs Gate G-A4 by running the two A4 behavioural selftests next to their SOURCE:
 *   1. `registry/workflow-resolver.selftest.mjs` — global cross-root resolution
 *      (new WF-#### + legacy NNNN-slug), workflowRoots, allocateWorkflowId scanning
 *      all roots, duplicate-id/path collision detection;
 *   2. `migration-plan.selftest.mjs` — discover→…→receipt, dry-run-by-default
 *      (applies nothing), human-gated ownership transfer, deterministic receipt.
 *
 * Thin spawning runner (mirrors `tools/run-suites.mjs`). Zero-dependency, `node:*`
 * only, Windows-safe. Exit 0 = pass, 1 = fail.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));

const SELFTESTS = [
  'templates/contextkit/tools/scripts/registry/workflow-resolver.selftest.mjs',
  'templates/contextkit/tools/scripts/migration-plan.selftest.mjs',
];

console.log('\n🌀 WF-0036 A4 — workflow nesting & compatibility\n');

let failures = 0;
for (const rel of SELFTESTS) {
  const child = spawnSync(process.execPath, [resolve(KIT, rel)], { cwd: KIT, encoding: 'utf-8' });
  process.stdout.write(child.stdout || '');
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) { failures += 1; console.error(`  ✗ ${rel} exited ${child.status}`); }
  else console.log(`  ✓ ${rel} passed`);
}

console.log(failures === 0 ? '\n✅ A4 resolver/migration suite passed.\n' : `\n❌ ${failures} A4 selftest(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
