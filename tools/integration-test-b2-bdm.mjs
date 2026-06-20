#!/usr/bin/env node
/**
 * Integration suite — BIZ-0001 / WF-0037 Wave B2 (Decision intelligence).
 *
 * Backs Gate G-B2 by running the two B2 behavioural selftests next to their
 * SOURCE modules under `templates/contextkit/`:
 *   1. `runtime/execution/decision-need-classifier.selftest.mjs` — deterministic
 *      decision-need classifier + materiality score (bands 6/3/2) + routine
 *      coverage + hard rules, all from the frozen B2 design table (no embeddings);
 *   2. `tools/scripts/decision-search-match.selftest.mjs` — deterministic existing-
 *      ADR search/match (strong 55 / possible 40), LINK-vs-RECOMMEND, supersession.
 *
 * Thin spawning runner (mirrors `tools/run-suites.mjs`). Zero-dependency, `node:*`
 * only, Windows-safe. Exit 0 = pass, 1 = fail.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));

const SELFTESTS = [
  'templates/contextkit/runtime/execution/decision-need-classifier.selftest.mjs',
  'templates/contextkit/tools/scripts/decision-search-match.selftest.mjs',
];

console.log('\n🌀 WF-0037 B2 — decision intelligence\n');

let failures = 0;
for (const rel of SELFTESTS) {
  const child = spawnSync(process.execPath, [resolve(KIT, rel)], { cwd: KIT, encoding: 'utf-8' });
  process.stdout.write(child.stdout || '');
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) { failures += 1; console.error(`  ✗ ${rel} exited ${child.status}`); }
  else console.log(`  ✓ ${rel} passed`);
}

console.log(failures === 0 ? '\n✅ B2 decision-intelligence suite passed.\n' : `\n❌ ${failures} B2 selftest(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
