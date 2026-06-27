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
 * inventory is 60 product suites (selfcheck.mjs + 59 integration-test*.mjs). The
 * 3.1.2 updater-safety hotfix (ADR-0099, WF0034) added eleven across RUN 1 + RUN 2:
 * vibekit-compat, session-safety, safe-writes, update-preflight, update-snapshot,
 * projmap-defer, sync-conflict, session-adversarial, vibekit-adversarial,
 * update-idempotency, update-failure. Lowering this requires an ADR; raise it as
 * suites are added.
 */
const MIN_SUITES = 60;

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
    (name) => name === 'selfcheck.mjs'
      || (name.startsWith('integration-test') && name.endsWith('.mjs') && !name.endsWith('-helpers.mjs')),
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
    // WF0025 request-orchestration shard + telemetry-summary self-test (ADR-0113,
    // task 301) — sibling selfcheck-*, dispatched directly as their own suites.
    'tools/selfcheck-request.mjs', 'tools/selfcheck-telemetry.mjs',
    // WF0025/TEA-008 run-suites pool self-test (ADR-0114) — sibling, dispatched directly.
    'tools/selfcheck-run-pool.mjs',
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
    // OP-0001 economy telemetry completeness gate (ADR-0117).
    'tools/selfcheck-economy-completeness.mjs',
    // OP-0001 economy instrumentation behavioral check (ADR-0117).
    'tools/selfcheck-economy-instrumentation.mjs',
    // WF0020 Economy Runtime — Wave 2 aggregate; sibling, dispatched directly.
    'tools/selfcheck-economy-wave2.mjs',
    // WF0033 project-map auto-baseline (PMB-02/03); siblings, dispatched directly.
    'tools/selfcheck-projmap-onboarding.mjs', 'tools/selfcheck-boot-signals-projmap.mjs',
    // WF-0057 W1.1 (ADR-0122) — project-map structural signals; sibling, dispatched directly.
    'tools/selfcheck-projmap-signals.mjs',
    // WF-0057 W2 (ADR-0122) — arch-debt analyzer pipeline aggregator (fans out to the
    // 6 per-analyzer selftests); sibling, dispatched directly.
    'tools/selfcheck-arch-debt.mjs',
    // WF-0057 W5.2 (ADR-0122) — gate config block + legacy line-budget migration;
    // sibling selfcheck, dispatched directly (not an integration-test* entrypoint).
    'tools/selfcheck-arch-debt-config.mjs',
    // WF-0057 W6.1 (ADR-0122) — MASTER acceptance suite: §35 headline invariants +
    // engine-level §34 GAP rows; sibling selfcheck, dispatched directly.
    'tools/selfcheck-arch-debt-acceptance.mjs',
    // WF-0057 (BIZ-0001 ownership rule 3) — owned-workflow placement gate; sibling
    // selfcheck, dispatched directly (not an integration-test* entrypoint).
    'tools/selfcheck-workflow-ownership.mjs',
    // BIZ-0001 / WF-0036 Wave A1 static wiring; sibling selfcheck, dispatched directly.
    'tools/selfcheck-bdm.mjs',
    // Session Autonomy Receipt aggregate; sibling selfcheck, dispatched directly.
    'tools/selfcheck-session-autonomy-all.mjs',
    // WF0022 TC-14 content cache (ADR-0089); sibling, dispatched via selfcheck-economy-all.mjs.
    'tools/selfcheck-tc-cache.mjs',
    // WF0022 TC-12 deterministic transforms (ADR-0089); sibling, dispatched via selfcheck-economy-all.mjs.
    'tools/selfcheck-tc-transform.mjs',
    // WF0022 TC-13 scaffold-from-pattern (ADR-0089); sibling, dispatched via selfcheck-economy-all.mjs.
    'tools/selfcheck-tc-scaffold.mjs',
    // WF0022 TC-15 recipe-runner DAG (ADR-0089); sibling, dispatched via selfcheck-economy-all.mjs.
    'tools/selfcheck-tc-recipe-runner.mjs',
    // WF0022 TC-16 ephemeral dispatch (ADR-0111); sibling, dispatched via selfcheck-economy-all.mjs.
    'tools/selfcheck-tc-dispatch.mjs',
    // BIZ-0001 / WF-0037 Wave B4 — adr-tooling + legacy-coexistence selftests live
    // under templates/ (engine source), registered as suites, dispatched directly.
    'templates/contextkit/tools/scripts/adr-index.selftest.mjs',
    'templates/contextkit/tools/scripts/b4-legacy-coexistence.selftest.mjs',
    // BIZ-0001 / WF-0037 Wave B5 — program-governance selftest (fixture-based), under templates/.
    'templates/contextkit/tools/scripts/program-governance.selftest.mjs',
    // Session-4 internal bug-hunt regression locks (BIZ-0001 + #243 fixes), under templates/.
    'templates/contextkit/tools/scripts/economics/session4-bugfix-regression.selftest.mjs',
    // DOC-007 / WF0016 — docs enforcement gate selfcheck; sibling, dispatched directly.
    'tools/selfcheck-docs.mjs',
    // WF0014 MCP integration-layer selfcheck siblings — standalone selfcheck
    // entrypoints (NOT integration-test*, so excluded from discovery), registered
    // in test-suites-mcp.mjs (MCP_SUITES) and dispatched directly. Each ticket's
    // selfcheck was split into focused sub-suites (constitution §1); *-helpers are
    // imported, not run. selfcheck-mcp-002.mjs aggregates its 4 sub-files.
    'tools/selfcheck-mcp.mjs',
    'tools/selfcheck-mcp-002.mjs',
    'tools/selfcheck-mcp-004-deny.mjs', 'tools/selfcheck-mcp-004-pass.mjs',
    'tools/selfcheck-mcp-004-pure.mjs', 'tools/selfcheck-mcp-004-report.mjs',
    'tools/selfcheck-mcp-006-e2e.mjs', 'tools/selfcheck-mcp-006-handlers.mjs',
    'tools/selfcheck-mcp-006-imports.mjs',
    'tools/selfcheck-mcp-007-engine.mjs', 'tools/selfcheck-mcp-007-shape.mjs',
    'tools/selfcheck-mcp-012.mjs', 'tools/selfcheck-mcp-012b.mjs',
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
