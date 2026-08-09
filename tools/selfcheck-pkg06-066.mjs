#!/usr/bin/env node
/**
 * CDK-066 self-check — capability-roi.mjs (PKG-06, ROI per capability lens).
 *
 * Verifies six invariants:
 *   (a) byCapability and capabilityRoi are exported functions.
 *   (b) capabilityRoi([], {pricingRegistry:{models:[]}}) → skipped
 *       (empty events guard).
 *   (c) capabilityRoi([ev], {pricingRegistry:null}) → skipped
 *       (null pricing registry guard).
 *   (d) byCapability lens: known skill maps to capability id; unknown maps
 *       to 'unattributed'.
 *   (e) HAPPY PATH with inline fixture registries → perCapability has the
 *       'state' row with positive actualUsd; unattributedUsd is positive.
 *   (f) DETERMINISM: same input twice → deep-equal output.
 *
 * Standalone runnable: node tools/selfcheck-pkg06-066.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Hermetic — reads no installed config, no filesystem side-effects.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODULE_URL = pathToFileURL(
  resolve(__dirname, '../templates/contextkit/tools/scripts/capability-roi.mjs'),
).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
let byCapability, capabilityRoi, presentRoi, CAPABILITY_ROI_SCHEMA_VERSION;
try {
  ({ byCapability, capabilityRoi, presentRoi, CAPABILITY_ROI_SCHEMA_VERSION } =
    await import(MODULE_URL));
} catch (err) {
  console.error(`FATAL: cannot import capability-roi.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Inline fixtures (hermetic — no filesystem reads)
// ---------------------------------------------------------------------------

/**
 * Minimal pricing registry fixture with a single model 'm' aliased from 'x/m'.
 * Confidence 'direct' so isPriceUsable() returns true and actualCost emits USD.
 */
const FIXTURE_PRICING = {
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

/**
 * Minimal capability registry fixture with one capability ('state') whose
 * aliases.claude is '/state'. This is the join key for events with
 * attributionSkill === '/state'.
 */
const FIXTURE_CAPS = {
  version: 1,
  capabilities: [
    {
      id: 'state',
      kind: 'public',
      entrypoint: 'contextkit/tools/scripts/context-pack.mjs',
      aliases: { claude: '/state', codex: 'cdx state', agy: 'agy state' },
      minLevel: 1,
      appliesWhen: { tiers: ['*'], domains: ['*'], paths: ['*'], phases: ['*'] },
      prerequisites: [],
      requiredMoment: 'informational',
      receiptType: 'state-summary',
      bypass: 'none',
      sideEffects: [],
    },
  ],
};

/** Event whose skill maps to 'state' via FIXTURE_CAPS. */
const EV_STATE = {
  attributionSkill: '/state',
  modelEffective: 'm',
  buckets: { freshInput: 1000, output: 500, cacheRead: 200, cacheWrite: 100, reasoning: 0 },
};

/** Event whose skill has no matching capability — should fall into 'unattributed'. */
const EV_NOPE = {
  attributionSkill: '/nope',
  modelEffective: 'm',
  buckets: { freshInput: 200, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
};

// ---------------------------------------------------------------------------
// (a) Exported functions
// ---------------------------------------------------------------------------
console.log('\n(a) Exported function types\n');

typeof byCapability === 'function'
  ? ok('byCapability is a function')
  : bad(`byCapability is not a function — got ${typeof byCapability}`);

typeof capabilityRoi === 'function'
  ? ok('capabilityRoi is a function')
  : bad(`capabilityRoi is not a function — got ${typeof capabilityRoi}`);

typeof presentRoi === 'function'
  ? ok('presentRoi is a function')
  : bad(`presentRoi is not a function — got ${typeof presentRoi}`);

typeof CAPABILITY_ROI_SCHEMA_VERSION === 'string' && CAPABILITY_ROI_SCHEMA_VERSION.length > 0
  ? ok(`CAPABILITY_ROI_SCHEMA_VERSION = '${CAPABILITY_ROI_SCHEMA_VERSION}'`)
  : bad('CAPABILITY_ROI_SCHEMA_VERSION missing or empty');

// ---------------------------------------------------------------------------
// (b) Empty events → skipped
// ---------------------------------------------------------------------------
console.log('\n(b) Empty events guard → skipped\n');

let skippedEmpty;
try {
  skippedEmpty = capabilityRoi([], { pricingRegistry: { models: [] } });
} catch (err) {
  bad(`capabilityRoi([],…) threw: ${err?.message ?? err}`);
  skippedEmpty = null;
}

skippedEmpty?.status === 'skipped'
  ? ok(`capabilityRoi([],…) → skipped (reason: "${skippedEmpty.reason}")`)
  : bad(`capabilityRoi([],…) should return skipped, got: ${JSON.stringify(skippedEmpty)}`);

// ---------------------------------------------------------------------------
// (c) Null pricing registry → skipped
// ---------------------------------------------------------------------------
console.log('\n(c) Null pricing registry guard → skipped\n');

let skippedNullPricing;
try {
  skippedNullPricing = capabilityRoi([EV_STATE], { pricingRegistry: null });
} catch (err) {
  bad(`capabilityRoi(…, {pricingRegistry:null}) threw: ${err?.message ?? err}`);
  skippedNullPricing = null;
}

skippedNullPricing?.status === 'skipped'
  ? ok(`capabilityRoi(…, {pricingRegistry:null}) → skipped (reason: "${skippedNullPricing.reason}")`)
  : bad(`should return skipped when pricingRegistry is null, got: ${JSON.stringify(skippedNullPricing)}`);

// ---------------------------------------------------------------------------
// (d) byCapability lens: known and unknown skills
// ---------------------------------------------------------------------------
console.log('\n(d) byCapability lens — alias resolution and unattributed fallback\n');

let lensResult;
try {
  lensResult = byCapability([EV_STATE, EV_NOPE], FIXTURE_CAPS);
} catch (err) {
  bad(`byCapability threw: ${err?.message ?? err}`);
  lensResult = null;
}

lensResult?.confidence === 'derived'
  ? ok("byCapability confidence === 'derived'")
  : bad(`byCapability confidence should be 'derived', got '${lensResult?.confidence}'`);

const groups = lensResult?.byCapability;

'state' in (groups ?? {})
  ? ok("groups contains 'state' (aliases.claude '/state' resolved correctly)")
  : bad("groups is missing 'state' key — alias join failed");

'unattributed' in (groups ?? {})
  ? ok("groups contains 'unattributed' (unmatched '/nope' event was NOT dropped)")
  : bad("groups is missing 'unattributed' key — unmatched events were silently dropped");

// Verify the 'state' bucket accumulated EV_STATE tokens.
const stateBuckets = groups?.state?.buckets;
stateBuckets?.freshInput === EV_STATE.buckets.freshInput
  ? ok(`state.buckets.freshInput === ${EV_STATE.buckets.freshInput}`)
  : bad(`state.buckets.freshInput should be ${EV_STATE.buckets.freshInput}, got ${stateBuckets?.freshInput}`);

// Verify the 'unattributed' bucket accumulated EV_NOPE tokens.
const unattribBuckets = groups?.unattributed?.buckets;
unattribBuckets?.freshInput === EV_NOPE.buckets.freshInput
  ? ok(`unattributed.buckets.freshInput === ${EV_NOPE.buckets.freshInput}`)
  : bad(`unattributed.buckets.freshInput should be ${EV_NOPE.buckets.freshInput}, got ${unattribBuckets?.freshInput}`);

// ---------------------------------------------------------------------------
// (e) HAPPY PATH — end-to-end pricing with inline fixtures
// ---------------------------------------------------------------------------
console.log('\n(e) HAPPY PATH — inline fixture pricing → real USD values\n');

let roiResult;
try {
  roiResult = capabilityRoi([EV_STATE, EV_NOPE], {
    pricingRegistry: FIXTURE_PRICING,
    capabilityRegistry: FIXTURE_CAPS,
  });
} catch (err) {
  bad(`capabilityRoi (happy path) threw: ${err?.message ?? err}`);
  roiResult = null;
}

roiResult?.status !== 'skipped'
  ? ok('capabilityRoi returned a result (not skipped)')
  : bad(`capabilityRoi unexpectedly returned skipped: ${roiResult?.reason}`);

roiResult?.schemaVersion === CAPABILITY_ROI_SCHEMA_VERSION
  ? ok(`schemaVersion === '${CAPABILITY_ROI_SCHEMA_VERSION}'`)
  : bad(`schemaVersion should be '${CAPABILITY_ROI_SCHEMA_VERSION}', got '${roiResult?.schemaVersion}'`);

Array.isArray(roiResult?.perCapability)
  ? ok(`perCapability is an array (${roiResult.perCapability.length} entry/entries)`)
  : bad(`perCapability is not an array: ${typeof roiResult?.perCapability}`);

const stateRow = roiResult?.perCapability?.find(r => r.id === 'state');
stateRow
  ? ok("perCapability contains row with id === 'state'")
  : bad("perCapability missing row for 'state'");

if (stateRow) {
  typeof stateRow.actualUsd === 'number' && stateRow.actualUsd > 0
    ? ok(`state.actualUsd = ${stateRow.actualUsd} (positive number — correctly priced)`)
    : bad(`state.actualUsd should be a positive number, got ${stateRow.actualUsd}`);

  stateRow.confidence === 'derived'
    ? ok("state.confidence === 'derived'")
    : bad(`state.confidence should be 'derived', got '${stateRow.confidence}'`);
}

typeof roiResult?.unattributedUsd === 'number' && roiResult.unattributedUsd > 0
  ? ok(`unattributedUsd = ${roiResult.unattributedUsd} (positive — '/nope' event priced in unattributed bucket)`)
  : bad(`unattributedUsd should be a positive number (EV_NOPE priced), got ${roiResult?.unattributedUsd}`);

typeof roiResult?.totals?.actualUsd === 'number' && roiResult.totals.actualUsd > 0
  ? ok(`totals.actualUsd = ${roiResult.totals.actualUsd}`)
  : bad(`totals.actualUsd should be positive, got ${roiResult?.totals?.actualUsd}`);

// Verify presentRoi handles the result without throwing.
let presentation;
try {
  presentation = presentRoi(roiResult);
} catch (err) {
  bad(`presentRoi threw: ${err?.message ?? err}`);
  presentation = null;
}

typeof presentation === 'string' && presentation.includes('state')
  ? ok("presentRoi returns a string containing 'state'")
  : bad(`presentRoi output unexpected: ${presentation?.slice(0, 120)}`);

// Verify presentRoi handles a skipped marker gracefully.
const skippedPresentation = presentRoi(skippedEmpty);
typeof skippedPresentation === 'string' && skippedPresentation.includes('skipped')
  ? ok("presentRoi handles skipped marker gracefully")
  : bad(`presentRoi did not handle skipped correctly: ${skippedPresentation}`);

// ---------------------------------------------------------------------------
// (f) DETERMINISM — same input twice → deep-equal
// ---------------------------------------------------------------------------
console.log('\n(f) DETERMINISM — same input twice → deep-equal\n');

let roi1, roi2;
try {
  const sharedOpts = { pricingRegistry: FIXTURE_PRICING, capabilityRegistry: FIXTURE_CAPS };
  roi1 = capabilityRoi([EV_STATE, EV_NOPE], sharedOpts);
  roi2 = capabilityRoi([EV_STATE, EV_NOPE], sharedOpts);
} catch (err) {
  bad(`capabilityRoi (determinism run) threw: ${err?.message ?? err}`);
  roi1 = roi2 = null;
}

JSON.stringify(roi1) === JSON.stringify(roi2)
  ? ok('capabilityRoi is deterministic — two identical calls produce deep-equal output')
  : bad('capabilityRoi is NOT deterministic — two identical calls produced different output');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-066 capability-roi.mjs self-check: all checks passed.\n'
    : `\n  FAIL — CDK-066 capability-roi.mjs self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
