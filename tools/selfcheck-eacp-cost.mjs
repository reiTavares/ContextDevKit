/**
 * Self-check — EACP Wave 2 cost layer (WF0018, ADR-0079).
 *
 * Asserts the pricing + cost engine + report-v2 pipeline is internally sound:
 * - Pricing registry load, alias resolution, usability gate, drift detection.
 * - Cost-engine golden numbers (E2 variant b), unknown-price guards.
 * - Financial summary (financialSummary / presentFinancial), schema version.
 * - Zero-dep invariant on the three new modules.
 *
 * Mirrors the structure of selfcheck-eacp.mjs exactly.
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — copy from selfcheck-eacp.mjs (not exported there). */
async function checkModuleZeroDep(name, modPath) {
  let content = '';
  try {
    content = await readFile(modPath, 'utf-8');
  } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

const TOL = 1e-9;
const near = (a, b) => Math.abs(a - b) < TOL;

/**
 * Runs EACP Wave 2 (pricing + cost engine + report-v2) checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpCostChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 2 cost layer (WF0018 / ADR-0079)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const modDefs = [
    ['pricing-registry.mjs', resolve(KIT, `${econ}/pricing/pricing-registry.mjs`)],
    ['cost-engine.mjs',      resolve(KIT, `${econ}/cost-engine.mjs`)],
    ['token-report-cost.mjs', resolve(KIT, `${econ}/token-report-cost.mjs`)],
  ];

  const libs = {};
  for (const [name, path] of modDefs) {
    try {
      libs[name] = await import(pathToFileURL(path).href);
      ok(`${name} imports cleanly`);
    } catch (err) {
      bad(`${name} import failed: ${err?.message ?? err}`);
      return; // Cannot assert anything without the modules.
    }
  }

  const regLib  = libs['pricing-registry.mjs'];
  const costLib = libs['cost-engine.mjs'];
  const repLib  = libs['token-report-cost.mjs'];

  // ── Registry assertions ───────────────────────────────────────────────────

  // 1. Schema version constant
  regLib.REGISTRY_SCHEMA_VERSION === 'eacp-pricing-registry/1'
    ? ok('registry: REGISTRY_SCHEMA_VERSION === "eacp-pricing-registry/1"')
    : bad(`registry: REGISTRY_SCHEMA_VERSION is "${regLib.REGISTRY_SCHEMA_VERSION}"`);

  // 2. Default load: 4 models, inferredCount=1, usableCount=3
  let reg = null;
  try {
    reg = regLib.loadRegistry();
    const summary = regLib.registrySummary(reg);
    reg?.models?.length === 4
      ? ok('registry: loadRegistry() returns 4 models')
      : bad(`registry: expected 4 models, got ${reg?.models?.length}`);
    summary.inferredCount === 1
      ? ok('registry: inferredCount === 1 (fable-5)')
      : bad(`registry: inferredCount is ${summary.inferredCount}, expected 1`);
    summary.usableCount === 3
      ? ok('registry: usableCount === 3 (direct models)')
      : bad(`registry: usableCount is ${summary.usableCount}, expected 3`);
  } catch (err) {
    bad(`registry: loadRegistry() threw unexpectedly: ${err?.message ?? err}`);
  }

  // 3. Missing file → null (degrade-to-skip, no throw)
  (() => {
    try {
      const r = regLib.loadRegistry(resolve(KIT, '__nonexistent__.json'));
      return r === null;
    } catch { return false; }
  })()
    ? ok('registry: loadRegistry(<missing>) returns null (degrade-to-skip)')
    : bad('registry: loadRegistry(<missing>) should return null, not throw');

  // 4. Alias resolution + entry shape
  const opusCanonical = regLib.resolveModelId(reg, 'opus');
  opusCanonical?.endsWith('claude-opus-4-8')
    ? ok('registry: resolveModelId(reg,"opus") → ...claude-opus-4-8')
    : bad(`registry: resolveModelId(reg,"opus") → "${opusCanonical}"`);
  const opusEntry = reg ? regLib.priceFor(reg, 'opus') : null;
  (typeof opusEntry?.input === 'number' && typeof opusEntry?.output === 'number'
    && typeof opusEntry?.cacheRead === 'number' && opusEntry?.cacheWriteByTtl)
    ? ok('registry: priceFor(reg,"opus") has numeric input/output/cacheRead + cacheWriteByTtl')
    : bad(`registry: priceFor(reg,"opus") entry shape wrong: ${JSON.stringify(opusEntry)}`);

  // 5. isPriceUsable: direct=true, inferred=false
  const fableEntry = reg ? regLib.priceFor(reg, 'fable-5') : null;
  regLib.isPriceUsable(opusEntry) === true
    ? ok('registry: isPriceUsable(opus) === true (direct)')
    : bad('registry: isPriceUsable(opus) should be true');
  regLib.isPriceUsable(fableEntry) === false
    ? ok('registry: isPriceUsable(fable-5) === false (inferred gate)')
    : bad('registry: isPriceUsable(fable-5) should be false for inferred price');

  // 6. Drift detection
  const driftHit = reg
    ? regLib.detectDrift(reg, [{ canonicalId: 'anthropic/claude-opus-4-8', input: 999, output: 25 }])
    : [];
  (driftHit.length >= 1 && driftHit.some(r => r.field === 'input'))
    ? ok('registry: detectDrift reports input mismatch')
    : bad(`registry: detectDrift should report input drift, got: ${JSON.stringify(driftHit)}`);
  const driftNone = reg
    ? regLib.detectDrift(reg, [{ canonicalId: 'anthropic/claude-opus-4-8', input: opusEntry?.input, output: opusEntry?.output }])
    : [{ dummy: true }];
  driftNone.length === 0
    ? ok('registry: detectDrift returns [] when prices match')
    : bad(`registry: detectDrift should return [] when equal, got: ${JSON.stringify(driftNone)}`);

  // 7. registrySummary(null) → skipped marker
  const sumNull = regLib.registrySummary(null);
  sumNull?.status === 'skipped'
    ? ok('registry: registrySummary(null) returns skipped marker')
    : bad(`registry: registrySummary(null) should return {status:"skipped"}, got: ${JSON.stringify(sumNull)}`);

  // ── Cost-engine assertions ────────────────────────────────────────────────

  // 8. Cost schema version
  costLib.COST_SCHEMA_VERSION === 'eacp-cost/1'
    ? ok('cost-engine: COST_SCHEMA_VERSION === "eacp-cost/1"')
    : bad(`cost-engine: COST_SCHEMA_VERSION is "${costLib.COST_SCHEMA_VERSION}"`);

  // Load the golden fixture
  let golden = null;
  try {
    const raw = await readFile(resolve(KIT, `${econ}/fixtures/cost-golden.json`), 'utf-8');
    golden = JSON.parse(raw);
  } catch (err) {
    bad(`cost-engine: could not load cost-golden.json: ${err?.message ?? err}`);
  }

  if (golden) {
    const { buckets } = golden.scenario;
    const { expected } = golden;

    // 9. Golden numbers (tolerance < 1e-9)
    const actualRes = costLib.actualCost(buckets, opusEntry);
    near(actualRes.usd, expected.actualUsd)
      ? ok(`cost-engine: actualCost golden ≈ ${expected.actualUsd}`)
      : bad(`cost-engine: actualCost got ${actualRes.usd}, expected ${expected.actualUsd}`);

    const noCacheRes = costLib.noCacheCost(buckets, opusEntry);
    near(noCacheRes.usd, expected.noCacheUsd)
      ? ok(`cost-engine: noCacheCost golden ≈ ${expected.noCacheUsd} (E2 variant b)`)
      : bad(`cost-engine: noCacheCost got ${noCacheRes.usd}, expected ${expected.noCacheUsd}`);

    const grossRes = costLib.grossCacheValue(buckets, opusEntry);
    near(grossRes.usd, expected.grossCacheValueUsd) && grossRes.usd > 0
      ? ok(`cost-engine: grossCacheValue golden ≈ ${expected.grossCacheValueUsd} and > 0`)
      : bad(`cost-engine: grossCacheValue got ${grossRes.usd}, expected > 0 and ≈ ${expected.grossCacheValueUsd}`);

    // 10. Inferred entry → null/unknown (never $0)
    const fableCost = costLib.actualCost(buckets, fableEntry);
    fableCost.usd === null && fableCost.confidence === 'unknown'
      ? ok('cost-engine: actualCost(buckets, inferred-fable) → usd null, confidence unknown')
      : bad(`cost-engine: fable cost should be null/unknown, got usd=${fableCost.usd} conf=${fableCost.confidence}`);

    // 11. null entry → null/unknown (never $0)
    const nullCost = costLib.actualCost(buckets, null);
    nullCost.usd === null
      ? ok('cost-engine: actualCost(buckets, null) → usd null (missing price → unknown, not $0)')
      : bad(`cost-engine: actualCost(buckets,null) should be null, got ${nullCost.usd}`);

    // 12. subscription billing → leadWithUsd false
    actualRes.leadWithUsd === false
      ? ok('cost-engine: opus actualCost.leadWithUsd === false (subscription)')
      : bad(`cost-engine: leadWithUsd should be false for subscription, got ${actualRes.leadWithUsd}`);
  }

  // 13. routingSavings quality gate + happy path
  const routeGated = costLib.routingSavings(
    { usd: 1, confidence: 'direct' }, { usd: 0.6, confidence: 'direct' }, false
  );
  routeGated.usd === null && routeGated.qualityGated === true
    ? ok('cost-engine: routingSavings(qualityEquivalent=false) → usd null, qualityGated true')
    : bad(`cost-engine: quality gate wrong: ${JSON.stringify(routeGated)}`);
  const routeSavings = costLib.routingSavings(
    { usd: 1, confidence: 'direct' }, { usd: 0.6, confidence: 'direct' }, true
  );
  near(routeSavings.usd, 0.4)
    ? ok('cost-engine: routingSavings(true) ≈ 0.4')
    : bad(`cost-engine: routingSavings expected ≈ 0.4, got ${routeSavings.usd}`);

  // 14. costPerQaGreenTask: zero denominator → null; 4 tasks → 0.25
  costLib.costPerQaGreenTask(1.0, 0).usd === null
    ? ok('cost-engine: costPerQaGreenTask(1.0, 0) → usd null (zero denominator)')
    : bad('cost-engine: costPerQaGreenTask(1.0, 0) should be null');
  costLib.costPerQaGreenTask(1.0, 4).usd === 0.25
    ? ok('cost-engine: costPerQaGreenTask(1.0, 4).usd === 0.25')
    : bad(`cost-engine: costPerQaGreenTask(1.0,4) got ${costLib.costPerQaGreenTask(1.0, 4).usd}`);

  // 15. projectTierCost — no throw; usd null/unknown or skipped marker
  await (async () => {
    try {
      const buckets = { freshInput: 200, output: 100, cacheRead: 1000, cacheWrite: 1000, reasoning: 0 };
      const res = await costLib.projectTierCost('powerful', buckets);
      (res?.usd === null || res?.status === 'skipped')
        ? ok('cost-engine: projectTierCost("powerful") → usd null/skipped (matrix illustrative)')
        : bad(`cost-engine: projectTierCost unexpected result: ${JSON.stringify(res)}`);
    } catch (err) {
      bad(`cost-engine: projectTierCost threw unexpectedly: ${err?.message ?? err}`);
    }
  })();

  // ── Report v2 assertions ──────────────────────────────────────────────────

  // 16. Report schema version
  repLib.REPORT_SCHEMA_VERSION === 'eacp-token-report/2'
    ? ok('report-v2: REPORT_SCHEMA_VERSION === "eacp-token-report/2"')
    : bad(`report-v2: REPORT_SCHEMA_VERSION is "${repLib.REPORT_SCHEMA_VERSION}"`);

  // 17. financialSummary with forced null registry → skipped
  const forcedSkip = repLib.financialSummary({ byModel: {} }, { registry: null });
  forcedSkip?.status === 'skipped'
    ? ok('report-v2: financialSummary({}, {registry:null}) returns skipped marker')
    : bad(`report-v2: forced-null registry should yield skipped, got: ${JSON.stringify(forcedSkip)}`);

  // 18. financialSummary with real registry + priced model
  const pricedSummary = repLib.financialSummary({
    byModel: { 'claude-opus-4-8': { input: 200, output: 100, cacheRead: 1000, cacheCreate: 1000, turns: 1 } },
  });
  pricedSummary?.confidence === 'direct'
    ? ok('report-v2: financialSummary with opus → confidence "direct"')
    : bad(`report-v2: expected confidence "direct", got "${pricedSummary?.confidence}"`);
  pricedSummary?.totals?.actualUsd > 0
    ? ok(`report-v2: financialSummary totals.actualUsd > 0 (${pricedSummary.totals.actualUsd})`)
    : bad(`report-v2: totals.actualUsd should be > 0, got ${pricedSummary?.totals?.actualUsd}`);
  pricedSummary?.perModel?.length === 1
    ? ok('report-v2: financialSummary perModel.length === 1')
    : bad(`report-v2: perModel.length should be 1, got ${pricedSummary?.perModel?.length}`);
  pricedSummary?.unpricedModels === 0
    ? ok('report-v2: unpricedModels === 0 for all-priced attribution')
    : bad(`report-v2: unpricedModels should be 0, got ${pricedSummary?.unpricedModels}`);

  // 19. Unknown model → unpricedModels≥1, actualUsd null, confidence "unknown"
  const unknownSummary = repLib.financialSummary({
    byModel: { 'totally-unknown-model': { input: 100, output: 50, cacheRead: 0, cacheCreate: 0, turns: 1 } },
  });
  unknownSummary?.unpricedModels >= 1
    ? ok('report-v2: unknown model → unpricedModels >= 1')
    : bad(`report-v2: unpricedModels should be >= 1 for unknown model, got ${unknownSummary?.unpricedModels}`);
  unknownSummary?.totals?.actualUsd === null
    ? ok('report-v2: unknown model → totals.actualUsd null (never $0)')
    : bad(`report-v2: totals.actualUsd should be null for unknown model, got ${unknownSummary?.totals?.actualUsd}`);
  unknownSummary?.confidence === 'unknown'
    ? ok('report-v2: unknown model → confidence "unknown"')
    : bad(`report-v2: confidence should be "unknown", got "${unknownSummary?.confidence}"`);

  // 20. presentFinancial on a skipped marker contains "skipped"
  const pf = repLib.presentFinancial({ status: 'skipped', reason: 'unit test' });
  typeof pf === 'string' && pf.includes('skipped')
    ? ok('report-v2: presentFinancial(skipped) returns string containing "skipped"')
    : bad(`report-v2: presentFinancial(skipped) should contain "skipped", got: ${pf}`);

  // 21. Zero-dep invariant on the three new modules
  let zeroDepsOk = true;
  for (const [name, path] of modDefs) {
    const result = await checkModuleZeroDep(name, path);
    if (result.error) {
      bad(`zero-dep Wave 2: ${name} ${result.error}`);
      zeroDepsOk = false;
    }
  }
  if (zeroDepsOk) ok('zero-dep invariant: all Wave 2 modules import only node:/* or relative paths');
}
