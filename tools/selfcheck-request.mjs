#!/usr/bin/env node
/**
 * Standalone request-orchestration self-check suite (WF0025 / ADR-0113).
 *
 * WHY: the request-orchestration checks (W1–W7) used to be runnable ONLY inside
 * the `selfcheck.mjs` monolith, so editing `runtime/execution/*` forced the whole
 * ~8-min selfcheck run. This thin entrypoint runs JUST that block as its own
 * selectable suite (registered in `test-suites-infra.mjs`), so `test:impact` can
 * pick it in seconds. `selfcheck.mjs` STILL runs the same block inline — this is
 * the fast selective path, the monolith stays the full floor (ADR-0113 §1).
 *
 * Zero runtime dependencies — node:* only (relative import of the aggregator).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAllRequestOrchestrationChecks } from './selfcheck-request-all.mjs';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

async function main() {
  console.log('\n🌀 ContextDevKit request-orchestration self-check\n');
  await runAllRequestOrchestrationChecks({ ok, bad }, { KIT });
  console.log(failures === 0 ? '\n✅ request-orchestration checks passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('selfcheck-request crashed:', err);
  process.exit(1);
});
