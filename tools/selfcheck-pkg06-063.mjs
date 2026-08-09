#!/usr/bin/env node
/**
 * CDK-063 self-check — host-cost.mjs per-host financial consumer (PKG-06).
 *
 * Verifies six invariants:
 *   (a) Module imports; hostCostSummary and presentHostCost are functions.
 *   (b) hostCostSummary([], {registry:{...}}) → status 'skipped' (empty events).
 *   (c) hostCostSummary([event], {registry:null}) → status 'skipped' (no registry).
 *   (d) HAPPY PATH: two events across two hosts price correctly.
 *       - perHost has 2 entries.
 *       - totals.actualUsd is a positive number.
 *       - totals.grossCacheValueUsd is a number (≥ 0).
 *       - REAL value assertion: check exact USD figure from the fixture pricing.
 *   (e) DETERMINISM: same input twice yields deep-equal output.
 *   (f) presentHostCost handles the skipped marker gracefully (no throw; string).
 *
 * Standalone runnable: node tools/selfcheck-pkg06-063.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Hermetic — reads no installed config, no filesystem side-effects.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute URL for the module under test. */
const HOST_COST_URL = pathToFileURL(
  resolve(__dirname, '../templates/contextkit/tools/scripts/host-cost.mjs'),
).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// (a) Import module under test
// ---------------------------------------------------------------------------
console.log('\n(a) module imports\n');

let hostCostSummary, presentHostCost, HOST_COST_SCHEMA_VERSION;
try {
  ({ hostCostSummary, presentHostCost, HOST_COST_SCHEMA_VERSION } =
    await import(HOST_COST_URL));
} catch (err) {
  console.error(`FATAL: cannot import host-cost.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

typeof hostCostSummary === 'function'
  ? ok('hostCostSummary is a function')
  : bad('hostCostSummary should be a function');

typeof presentHostCost === 'function'
  ? ok('presentHostCost is a function')
  : bad('presentHostCost should be a function');

HOST_COST_SCHEMA_VERSION === 'cdk-host-cost/1'
  ? ok(`HOST_COST_SCHEMA_VERSION === '${HOST_COST_SCHEMA_VERSION}'`)
  : bad(`HOST_COST_SCHEMA_VERSION should be 'cdk-host-cost/1', got '${HOST_COST_SCHEMA_VERSION}'`);

// ---------------------------------------------------------------------------
// (b) Empty events → skipped
// ---------------------------------------------------------------------------
console.log('\n(b) hostCostSummary([], {registry:{...}}) → skipped (empty events)\n');

const MINIMAL_REGISTRY = { models: [] };

let emptyResult;
try {
  emptyResult = hostCostSummary([], { registry: MINIMAL_REGISTRY });
} catch (err) {
  bad(`hostCostSummary([], ...) threw: ${err?.message ?? err}`);
  emptyResult = null;
}

emptyResult?.status === 'skipped'
  ? ok(`empty events → status 'skipped' (reason: "${emptyResult.reason}")`)
  : bad(`empty events should yield status 'skipped', got: ${JSON.stringify(emptyResult)}`);

// Also verify non-array guard
let nonArrayResult;
try {
  nonArrayResult = hostCostSummary(null, { registry: MINIMAL_REGISTRY });
} catch (err) {
  bad(`hostCostSummary(null, ...) threw: ${err?.message ?? err}`);
  nonArrayResult = null;
}

nonArrayResult?.status === 'skipped'
  ? ok("hostCostSummary(null, ...) → status 'skipped'  (non-array guard)")
  : bad(`null events should yield status 'skipped', got: ${JSON.stringify(nonArrayResult)}`);

// ---------------------------------------------------------------------------
// (c) Null registry → skipped
// ---------------------------------------------------------------------------
console.log('\n(c) hostCostSummary([event], {registry:null}) → skipped (no registry)\n');

const STUB_EVENT = {
  host: 'claude',
  modelEffective: 'some-model',
  buckets: { freshInput: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  confidence: 'direct',
};

let noRegistryResult;
try {
  noRegistryResult = hostCostSummary([STUB_EVENT], { registry: null });
} catch (err) {
  bad(`hostCostSummary([event], {registry:null}) threw: ${err?.message ?? err}`);
  noRegistryResult = null;
}

noRegistryResult?.status === 'skipped'
  ? ok(`null registry → status 'skipped' (reason: "${noRegistryResult.reason}")`)
  : bad(`null registry should yield status 'skipped', got: ${JSON.stringify(noRegistryResult)}`);

// ---------------------------------------------------------------------------
// (d) Happy path — two hosts, one priced model each
// ---------------------------------------------------------------------------
console.log('\n(d) HAPPY PATH: two events, two hosts, priced registry\n');

/**
 * Inline fixture registry for the happy-path test.
 * canonicalId 'x/m' with one alias 'm', fully priced.
 * Prices (per MTok, USD):
 *   input: 5, output: 25, reasoning: 25,
 *   cacheRead: 0.5, cacheWriteByTtl.ttl5m: 6.25, cacheWriteByTtl.ttl1h: 10
 *
 * For event with freshInput=1_000_000, output=500_000, cacheRead/Write/reasoning=0:
 *   actual = (1e6/1e6)*5 + (5e5/1e6)*25 = 5 + 12.5 = 17.5
 */
const FIXTURE_REGISTRY = {
  schemaVersion: 'eacp-pricing-registry/1',
  updated: '2026-01-01',
  models: [
    {
      canonicalId: 'x/m',
      aliases: ['m'],
      billingMode: 'api',
      input: 5,
      output: 25,
      reasoning: 25,
      cacheRead: 0.5,
      cacheWriteByTtl: { ttl5m: 6.25, ttl1h: 10 },
      currency: 'USD',
      confidence: 'direct',
    },
  ],
};

const CLAUDE_EVENT = {
  host: 'claude',
  modelEffective: 'm',
  buckets: { freshInput: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  confidence: 'direct',
};

const CODEX_EVENT = {
  host: 'codex',
  modelEffective: 'm',
  buckets: { freshInput: 500_000, output: 250_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  confidence: 'direct',
};

let happyResult;
try {
  happyResult = hostCostSummary([CLAUDE_EVENT, CODEX_EVENT], { registry: FIXTURE_REGISTRY });
} catch (err) {
  bad(`hostCostSummary threw on happy path: ${err?.message ?? err}`);
  happyResult = null;
}

if (happyResult !== null && happyResult?.status !== 'skipped') {
  ok('hostCostSummary returned a result object (not skipped)');

  // Structure checks
  Array.isArray(happyResult.perHost)
    ? ok(`perHost is an array`)
    : bad(`perHost should be an array, got ${typeof happyResult.perHost}`);

  happyResult.perHost?.length === 2
    ? ok(`perHost has 2 entries (one per host)`)
    : bad(`perHost should have 2 entries, got ${happyResult.perHost?.length}`);

  // Verify both host names appear
  const hostNames = (happyResult.perHost ?? []).map(h => h.host).sort();
  JSON.stringify(hostNames) === JSON.stringify(['claude', 'codex'])
    ? ok(`perHost hosts are ['claude', 'codex']`)
    : bad(`perHost host names should be ['claude', 'codex'], got ${JSON.stringify(hostNames)}`);

  // Verify totals are numeric and positive
  typeof happyResult.totals?.actualUsd === 'number' && happyResult.totals.actualUsd > 0
    ? ok(`totals.actualUsd = ${happyResult.totals.actualUsd} (positive number)`)
    : bad(`totals.actualUsd should be a positive number, got ${happyResult.totals?.actualUsd}`);

  typeof happyResult.totals?.grossCacheValueUsd === 'number' &&
  happyResult.totals.grossCacheValueUsd >= 0
    ? ok(`totals.grossCacheValueUsd = ${happyResult.totals.grossCacheValueUsd} (number ≥ 0)`)
    : bad(`totals.grossCacheValueUsd should be a number ≥ 0, got ${happyResult.totals?.grossCacheValueUsd}`);

  // REAL value assertion (CDK-040 lesson: silence-only tests mask crashes).
  // claude  event: freshInput=1e6 × $5/MTok + output=5e5 × $25/MTok = $5 + $12.5 = $17.5
  // codex   event: freshInput=5e5 × $5/MTok + output=2.5e5 × $25/MTok = $2.5 + $6.25 = $8.75
  // total = $26.25
  const EXPECTED_TOTAL_USD = 26.25;
  Math.abs((happyResult.totals?.actualUsd ?? NaN) - EXPECTED_TOTAL_USD) < 1e-9
    ? ok(`totals.actualUsd === ${EXPECTED_TOTAL_USD} (exact fixture value)`)
    : bad(`totals.actualUsd should be ${EXPECTED_TOTAL_USD}, got ${happyResult.totals?.actualUsd}`);

  happyResult.schemaVersion === 'cdk-host-cost/1'
    ? ok(`schemaVersion === 'cdk-host-cost/1'`)
    : bad(`schemaVersion should be 'cdk-host-cost/1', got '${happyResult.schemaVersion}'`);

  happyResult.confidence === 'direct'
    ? ok("overall confidence === 'direct' (all priced as direct)")
    : bad(`overall confidence should be 'direct', got '${happyResult.confidence}'`);

  happyResult.unpricedModels === 0
    ? ok('unpricedModels === 0')
    : bad(`unpricedModels should be 0, got ${happyResult.unpricedModels}`);
} else {
  bad(`happy path: expected a result object, got: ${JSON.stringify(happyResult)}`);
}

// ---------------------------------------------------------------------------
// (e) Determinism
// ---------------------------------------------------------------------------
console.log('\n(e) DETERMINISM: same input twice → deep-equal output\n');

let run1, run2;
try {
  run1 = hostCostSummary([CLAUDE_EVENT, CODEX_EVENT], { registry: FIXTURE_REGISTRY });
  run2 = hostCostSummary([CLAUDE_EVENT, CODEX_EVENT], { registry: FIXTURE_REGISTRY });
} catch (err) {
  bad(`determinism runs threw: ${err?.message ?? err}`);
  run1 = null;
  run2 = null;
}

JSON.stringify(run1) === JSON.stringify(run2)
  ? ok('same input twice → deep-equal JSON output  (deterministic)')
  : bad('same input twice produced DIFFERENT output — determinism violated');

// ---------------------------------------------------------------------------
// (f) presentHostCost handles skipped gracefully
// ---------------------------------------------------------------------------
console.log('\n(f) presentHostCost handles skipped marker\n');

const skippedMarker = { status: 'skipped', reason: 'test-skip' };
let displayStr;
try {
  displayStr = presentHostCost(skippedMarker);
} catch (err) {
  bad(`presentHostCost(skipped) threw: ${err?.message ?? err}`);
  displayStr = null;
}

typeof displayStr === 'string'
  ? ok(`presentHostCost(skipped) returned a string: "${displayStr}"`)
  : bad(`presentHostCost(skipped) should return a string, got ${typeof displayStr}`);

displayStr?.includes('skipped')
  ? ok('presentHostCost(skipped) output contains "skipped"')
  : bad('presentHostCost(skipped) output should contain "skipped"');

// Also verify the happy-path display produces a non-empty string
if (happyResult && happyResult.status !== 'skipped') {
  let happyDisplay;
  try {
    happyDisplay = presentHostCost(happyResult);
  } catch (err) {
    bad(`presentHostCost(happy) threw: ${err?.message ?? err}`);
    happyDisplay = null;
  }
  typeof happyDisplay === 'string' && happyDisplay.length > 0
    ? ok(`presentHostCost(happy) returned a non-empty string`)
    : bad(`presentHostCost(happy) should return a non-empty string, got: ${happyDisplay}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-063 host-cost.mjs self-check: all checks passed.\n'
    : `\n  FAIL — CDK-063 host-cost.mjs self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
