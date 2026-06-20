#!/usr/bin/env node
/**
 * Integration suite — BIZ-0001 / WF-0037 Wave B3 (Lifecycle integration).
 *
 * Backs Gate G-B3 by running the two B3 behavioural selftests next to their SOURCE:
 *   1. `work-decision-supersede.selftest.mjs` — approval mirroring (one accepted
 *      ADR, AI cannot accept), supersession (superseded → non-governing), human-
 *      gated ownership transfer;
 *   2. `decision-coverage.selftest.mjs` — decision-coverage gates, workflow
 *      decisionRefs validation, required-decision gate (recommend-not-block).
 *
 * Thin spawning runner (mirrors `tools/run-suites.mjs`). Zero-dependency, `node:*`
 * only, Windows-safe. Exit 0 = pass, 1 = fail.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));

const SELFTESTS = [
  'templates/contextkit/tools/scripts/work-decision-supersede.selftest.mjs',
  'templates/contextkit/tools/scripts/decision-coverage.selftest.mjs',
];

console.log('\n🌀 WF-0037 B3 — lifecycle integration\n');

let failures = 0;
for (const rel of SELFTESTS) {
  const child = spawnSync(process.execPath, [resolve(KIT, rel)], { cwd: KIT, encoding: 'utf-8' });
  process.stdout.write(child.stdout || '');
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) { failures += 1; console.error(`  ✗ ${rel} exited ${child.status}`); }
  else console.log(`  ✓ ${rel} passed`);
}

console.log(failures === 0 ? '\n✅ B3 lifecycle-integration suite passed.\n' : `\n❌ ${failures} B3 selftest(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
