#!/usr/bin/env node
/**
 * Suite-list floor check (TEA-002, SPEC §12) — STANDALONE entrypoint (exit 0/1).
 *
 * WHY: `tools/test-suites.mjs` is the single source of truth for which suites
 * run. If a suite file is added to `tools/` but forgotten from that list, it
 * would silently stop running under `npm test`. This check asserts the list
 * covers EVERY `tools/selfcheck.mjs` + `tools/integration-test*.mjs` file
 * present on disk, and that the count clears a floor — mirroring selfcheck's own
 * `MIN_CHECKS` guard. Losing a suite from the list fails loudly here.
 *
 * Registered in `test-suites.mjs` as a `smoke` suite so it rides every run.
 * Does NOT touch `tools/selfcheck.mjs` (Wave 2 owns that file). Zero-dep,
 * `node:*` only, Windows-safe.
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSuites } from './test-suites.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOLS_DIR = resolve(KIT, 'tools');

/**
 * Floor for the number of on-disk suite files the list must cover. The current
 * inventory is 45 product suites (selfcheck.mjs + 44 integration-test*.mjs,
 * incl. integration-test-eacp.mjs split from token-economy in Wave 7 tech-debt,
 * integration-test-routing.mjs for ADR-0094 automatic routing, and
 * integration-test-config-migrate.mjs for ADR-0095 config-section auto-migration).
 * Lowering this requires an ADR; raise it as suites are added.
 */
const MIN_SUITES = 45;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

/**
 * Enumerate the suite ENTRYPOINT files on disk: `selfcheck.mjs` and every
 * `integration-test*.mjs`. Sibling `selfcheck-*.mjs` modules are dispatched
 * in-process by `selfcheck.mjs` and are NOT independent entrypoints, so they are
 * excluded here (matching how the legacy `test` chain invoked suites).
 * @returns {string[]} forward-slashed `tools/...mjs` paths, sorted.
 * @throws {Error} if the tools dir can't be read (fail-fast).
 */
function discoverSuiteFiles() {
  const names = readdirSync(TOOLS_DIR);
  const wanted = names.filter(
    (name) => name === 'selfcheck.mjs' || (name.startsWith('integration-test') && name.endsWith('.mjs')),
  );
  return wanted.map((name) => `tools/${name}`).sort();
}

function main() {
  console.log('\n🌀 ContextDevKit suite-list floor check\n');
  const onDisk = discoverSuiteFiles();
  const listed = new Set(allSuites().map((suite) => suite.file));

  // 1. Every on-disk suite entrypoint must appear in the list.
  const missing = onDisk.filter((file) => !listed.has(file));
  missing.length === 0
    ? ok(`every on-disk suite (${onDisk.length}) is listed in test-suites.mjs`)
    : bad(`suite(s) on disk but NOT in test-suites.mjs: ${missing.join(', ')}`);

  // 2. Count must clear the floor (a wholesale loss of suites fails loudly).
  onDisk.length >= MIN_SUITES
    ? ok(`suite count ${onDisk.length} ≥ floor ${MIN_SUITES}`)
    : bad(`only ${onDisk.length} suite file(s) on disk — below the ${MIN_SUITES} floor`);

  // 3. No listed suite may point at a vanished file (excluding the infra
  //    self-checks which are not integration/selfcheck entrypoints).
  const onDiskSet = new Set(onDisk);
  const infra = new Set([
    'tools/selfcheck-suites.mjs', 'tools/selfcheck-impact.mjs',
    // PKG-05 selfcheck entrypoints — registered suites, dispatched directly
    // (siblings, not discovered as integration-test*).
    'tools/selfcheck-pkg05-050.mjs', 'tools/selfcheck-pkg05-051.mjs', 'tools/selfcheck-pkg05-053.mjs',
    'tools/selfcheck-pkg05-054.mjs', 'tools/selfcheck-pkg05-055.mjs', 'tools/selfcheck-pkg05-056.mjs',
    // PKG-06 selfcheck entrypoints — siblings, dispatched directly (not discovered).
    'tools/selfcheck-pkg06-060.mjs', 'tools/selfcheck-pkg06-061.mjs', 'tools/selfcheck-pkg06-062.mjs',
    'tools/selfcheck-pkg06-065.mjs', 'tools/selfcheck-pkg06-068.mjs',
    // PKG-06 cost consumers (wf 0027) — siblings, dispatched directly.
    'tools/selfcheck-pkg06-063.mjs', 'tools/selfcheck-pkg06-066.mjs', 'tools/selfcheck-pkg06-067.mjs',
    // PKG-07 — lineage graph (CDK-070); sibling, dispatched directly.
    'tools/selfcheck-lineage.mjs',
    // PKG-07 — lineage consumers (CDK-071…077); siblings, dispatched directly.
    'tools/selfcheck-pkg07-071.mjs', 'tools/selfcheck-pkg07-072.mjs', 'tools/selfcheck-pkg07-073.mjs',
    'tools/selfcheck-pkg07-074.mjs', 'tools/selfcheck-pkg07-075.mjs', 'tools/selfcheck-pkg07-076.mjs',
    'tools/selfcheck-pkg07-077.mjs',
    // PKG-08 — fleet & agent platform (CDK-080/081/082); sibling, dispatched directly.
    'tools/selfcheck-pkg08-fleet.mjs',
    // WF0020 Economy Runtime — Wave 1 aggregate; sibling, dispatched directly.
    'tools/selfcheck-economy-wave1.mjs',
    // WF0020 Economy Runtime — Wave 2 aggregate; sibling, dispatched directly.
    'tools/selfcheck-economy-wave2.mjs',
  ]);
  const dangling = allSuites()
    .map((suite) => suite.file)
    .filter((file) => !onDiskSet.has(file) && !infra.has(file));
  dangling.length === 0
    ? ok('no listed suite points at a missing file')
    : bad(`listed suite(s) point at a missing file: ${dangling.join(', ')}`);

  // 4. No duplicate suite ids (the list must be a clean partition).
  const ids = allSuites().map((suite) => suite.id);
  const dupes = ids.filter((id, idx) => ids.indexOf(id) !== idx);
  dupes.length === 0 ? ok('suite ids are unique') : bad(`duplicate suite id(s): ${[...new Set(dupes)].join(', ')}`);

  console.log(failures === 0 ? '\n✅ suite-list floor check passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
