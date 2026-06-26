#!/usr/bin/env node
/**
 * selfcheck-arch-debt — aggregator for the WF-0057 Architecture & Technical
 * Debt Governance Gate selftests (ADR-0122).
 *
 * Runs each arch-debt analyzer selftest as a child process and aggregates the
 * verdicts. One registry entry (this file) fans out to the per-analyzer
 * selftests, keeping `tools/test-suites.mjs` a flat declarative registry
 * without one row per module. Each child stays independently runnable for
 * focused debugging (`node tools/selfcheck-arch-debt-floors.mjs`).
 *
 * Exit 0 iff every child exits 0. Zero runtime deps (node: built-ins only).
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The per-analyzer selftests this aggregator owns (WF-0057 W2). */
const CHILDREN = [
  // W2 — analyzer pipeline
  'selfcheck-arch-debt-finding.mjs',
  'selfcheck-arch-debt-signal-collector.mjs',
  'selfcheck-arch-debt-conformance.mjs',
  'selfcheck-arch-debt-classifier.mjs',
  'selfcheck-arch-debt-fragmentation.mjs',
  'selfcheck-arch-debt-floors.mjs',
  // W3 — policy, baseline, registry, intentional-debt, fitness
  'selfcheck-arch-debt-policy.mjs',
  'selfcheck-arch-debt-baseline.mjs',
  'selfcheck-arch-debt-registry.mjs',
  'selfcheck-arch-debt-intentional.mjs',
  'selfcheck-arch-debt-fitness.mjs',
  // W4 — engine end-to-end integration
  'selfcheck-arch-debt-gate.mjs',
];

let failed = 0;
for (const child of CHILDREN) {
  const run = spawnSync(process.execPath, [resolve(HERE, child)], { encoding: 'utf8' });
  const ok = run.status === 0;
  if (!ok) failed += 1;
  const tail = (run.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  console.log(`${ok ? '✓' : '✗'} ${child.replace('selfcheck-arch-debt-', '').replace('.mjs', '').padEnd(18)} ${tail}`);
  if (!ok && run.stderr) console.log(run.stderr.trim());
}

if (failed) {
  console.log(`\narch-debt aggregator: ${failed}/${CHILDREN.length} selftest(s) FAILED`);
  process.exit(1);
}
console.log(`\narch-debt aggregator: ${CHILDREN.length}/${CHILDREN.length} selftests PASS`);
