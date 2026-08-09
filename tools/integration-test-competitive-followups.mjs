#!/usr/bin/env node
/**
 * ContextDevKit integration test — WF-0041 competitive follow-ups (ADR-0118).
 *
 * Runs the two co-located selftests for the migrated, still-live competitive
 * recommendations as governed subprocess suites so they ride every `npm test`:
 *   - #354 COMP-001 claims-gate     → claims-gate.selftest.mjs
 *   - #355 COMP-003 run-journal tail → runs-follow.selftest.mjs
 *
 * A selftest exits non-zero on failure; execFileSync throws on a non-zero exit,
 * which we translate into a `bad()` so a regression turns the suite red.
 *
 * Zero runtime dependencies — node:* + it-helpers only.
 *
 * Run:  node tools/integration-test-competitive-followups.mjs   (exit 0 = healthy)
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { KIT, reporter } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🧮 ContextDevKit integration test — WF-0041 competitive follow-ups\n');

const SCRIPTS = 'templates/contextkit/tools/scripts';

/** The co-located selftests this suite guards. */
const SELFTESTS = [
  { id: '#354 claims-gate', file: 'claims-gate.selftest.mjs' },
  { id: '#355 runs-follow', file: 'runs-follow.selftest.mjs' },
];

/** Spawns one selftest; a non-zero exit (execFileSync throws) flips it red. */
function runSelftest({ id, file }) {
  const path = resolve(KIT, SCRIPTS, file);
  try {
    execFileSync(process.execPath, [path], { cwd: KIT, stdio: 'pipe' });
    ok(`${id} selftest passes (${file})`);
  } catch (err) {
    bad(`${id} selftest FAILED (${file}) — ${String(err?.stdout ?? err).slice(-240)}`);
  }
}

function main() {
  for (const selftest of SELFTESTS) runSelftest(selftest);
  rep.finish('Integration (WF-0041 competitive follow-ups)');
}

main();
