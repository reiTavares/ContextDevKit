#!/usr/bin/env node
/**
 * PKG-08 self-check — fleet-compliance (CDK-080) + agent-registry (CDK-081) +
 * policy-distribution (CDK-082).
 *
 * Asserts the safety-critical invariants of all three advisory tools:
 *   CDK-080 — empty fleet registry ⇒ repos:[] and avgComplianceParityPct is
 *             NULL (never 0); the pure core aggregates an empty / all-null
 *             per-repo array to a null average (§8 honesty).
 *   CDK-081 — every agent row carries costUsd:null + costConfidence
 *             'unattributable' + a non-empty top-level costNote (the load-bearing
 *             §8 invariant: per-agent cost is unattributable, never fabricated);
 *             the pure core buckets a resolved tier correctly.
 *   CDK-082 — the pure additive-diff plan flags baseline-only keys in wouldAdd,
 *             never puts a shared key in wouldAdd, and the CLI runs read-only
 *             (exit 0, writes nothing).
 *
 * Standalone runnable: node tools/selfcheck-pkg08-fleet.mjs
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');

const urlFor = (file) => pathToFileURL(resolve(SCRIPTS, file)).href;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// CDK-080 — fleet-compliance
// ---------------------------------------------------------------------------
console.log('\n[CDK-080] fleet-compliance — empty fleet ⇒ avg NULL, fail-open\n');
try {
  const { buildFleetCompliance } = await import(urlFor('fleet-compliance.mjs'));
  const { aggregateFleet } = await import(urlFor('fleet-compliance-core.mjs'));
  ok('fleet-compliance + core import cleanly');

  const tmpDir = mkdtempSync(join(tmpdir(), 'cdk080-'));
  const fleetFile = join(tmpDir, 'fleet.json');
  writeFileSync(fleetFile, JSON.stringify({ repos: [] }), 'utf-8');
  const saved = process.env.CONTEXT_FLEET_FILE;
  process.env.CONTEXT_FLEET_FILE = fleetFile;
  try {
    const summary = await buildFleetCompliance();
    summary.totals.repos === 0
      ? ok('empty fleet: totals.repos === 0')
      : bad(`empty fleet: expected repos 0, got ${summary.totals.repos}`);
    summary.totals.avgComplianceParityPct === null
      ? ok('empty fleet: avgComplianceParityPct is null (not 0)')
      : bad(`empty fleet: expected null avg, got ${summary.totals.avgComplianceParityPct}`);
    summary.schemaVersion === 'cdk-fleet-compliance/1'
      ? ok('schemaVersion stamp present')
      : bad(`unexpected schemaVersion ${summary.schemaVersion}`);
  } finally {
    if (saved === undefined) delete process.env.CONTEXT_FLEET_FILE;
    else process.env.CONTEXT_FLEET_FILE = saved;
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const emptyAgg = aggregateFleet([]);
  emptyAgg.totals.avgComplianceParityPct === null
    ? ok('core: empty array avg is null')
    : bad('core: empty array avg should be null');

  const allNullAgg = aggregateFleet([
    { path: '/repo/a', ok: false, compliance: null, scorecard: null, readiness: null },
    { path: '/repo/b', ok: false, compliance: null, scorecard: null, readiness: null },
  ]);
  allNullAgg.totals.avgComplianceParityPct === null
    ? ok('core: all-null compliance avg is null (never 0)')
    : bad('core: all-null avg should be null, never 0');
  allNullAgg.totals.repos === 2
    ? ok('core: repos count equals input length')
    : bad(`core: expected repos 2, got ${allNullAgg.totals.repos}`);
} catch (err) {
  bad(`CDK-080 threw: ${err?.message ?? err}`);
}

// ---------------------------------------------------------------------------
// CDK-081 — agent-registry
// ---------------------------------------------------------------------------
console.log('\n[CDK-081] agent-registry — cost ALWAYS null (§8), tier bucketing\n');
try {
  const { buildAgentRegistry } = await import(urlFor('agent-registry.mjs'));
  const { assembleRegistry, COST_NOTE } = await import(urlFor('agent-registry-core.mjs'));
  ok('agent-registry + core import cleanly');

  const registry = await buildAgentRegistry();
  const allCostNull = registry.agents.every(
    (a) => a.costUsd === null && a.costConfidence === 'unattributable',
  );
  allCostNull
    ? ok(`all ${registry.agents.length} agent rows: costUsd null + unattributable`)
    : bad('SAFETY: some agent row has a non-null costUsd or wrong confidence');
  (typeof registry.costNote === 'string' && registry.costNote.length > 0)
    ? ok(`top-level costNote present (${registry.costNote.length} chars)`)
    : bad('expected non-empty top-level costNote');
  (typeof COST_NOTE === 'string' && COST_NOTE.length > 0)
    ? ok('core COST_NOTE export non-empty')
    : bad('core COST_NOTE should be a non-empty string');

  const assembled = assembleRegistry(
    [{ name: 'demo', squad: 'devteam', hasBriefing: true, mentions: 3 }],
    () => ({ model: 'claude-sonnet-4-6', tier: 'sonnet' }),
  );
  assembled.totals.byTier.sonnet === 1
    ? ok('core: assembleRegistry buckets resolved tier (sonnet:1)')
    : bad(`core: expected byTier.sonnet 1, got ${JSON.stringify(assembled.totals.byTier)}`);
  assembled.agents[0].costUsd === null
    ? ok('core: assembled agent costUsd null')
    : bad('core: assembled agent costUsd must be null');
} catch (err) {
  bad(`CDK-081 threw: ${err?.message ?? err}`);
}

// ---------------------------------------------------------------------------
// CDK-082 — policy-distribution
// ---------------------------------------------------------------------------
console.log('\n[CDK-082] policy-distribution — additive plan + read-only CLI\n');
try {
  const { additivePlan, versionDelta } = await import(urlFor('policy-distribution-core.mjs'));
  ok('policy-distribution-core imports cleanly');

  const planA = additivePlan({ a: 1, nested: { x: 1 } }, { a: 1 });
  planA.wouldAdd.some((p) => p === 'nested' || p.startsWith('nested.'))
    ? ok("baseline-only 'nested' subtree flagged in wouldAdd")
    : bad(`expected 'nested' in wouldAdd, got ${JSON.stringify(planA.wouldAdd)}`);
  planA.untouched.includes('a')
    ? ok("shared key 'a' in untouched")
    : bad(`expected 'a' in untouched, got ${JSON.stringify(planA.untouched)}`);
  !planA.wouldAdd.includes('a')
    ? ok("shared key 'a' NOT in wouldAdd (user value wins)")
    : bad("SAFETY: shared key 'a' must never appear in wouldAdd");

  const planB = additivePlan({ a: 1 }, { a: 1 });
  planB.wouldAdd.length === 0
    ? ok('identical stores ⇒ empty wouldAdd')
    : bad(`expected empty wouldAdd, got ${JSON.stringify(planB.wouldAdd)}`);

  versionDelta(2, 1) === 'newer' && versionDelta(null, 1) === 'unknown'
    ? ok('versionDelta: newer / unknown correct')
    : bad('versionDelta mismatch');

  // CLI runs read-only and exits 0.
  const ioPath = resolve(SCRIPTS, 'policy-distribution.mjs');
  const cli = spawnSync(process.execPath, [ioPath, '--json', '.'], {
    cwd: KIT, encoding: 'utf-8', timeout: 30_000,
  });
  cli.status === 0
    ? ok('CLI: exit 0')
    : bad(`CLI: expected exit 0, got ${cli.status}; stderr ${cli.stderr?.slice(0, 160)}`);
  let parsed = null;
  try { parsed = JSON.parse(cli.stdout); ok('CLI: stdout valid JSON'); }
  catch (e) { bad(`CLI: stdout not JSON: ${e?.message ?? e}`); }
  if (parsed) {
    typeof parsed.dryRunNote === 'string' && parsed.dryRunNote.length > 0
      ? ok('CLI JSON: dryRunNote present')
      : bad('CLI JSON: expected dryRunNote');
  }
} catch (err) {
  bad(`CDK-082 threw: ${err?.message ?? err}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — PKG-08 fleet self-check: all checks passed.\n'
    : `\n  FAIL — PKG-08 fleet self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
