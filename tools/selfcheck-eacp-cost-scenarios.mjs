/**
 * Self-check — EACP Wave 8 cost scenarios (WF0018 / ADR-0079 §12.2).
 *
 * Drives every scenario in fixtures/cost-scenarios.json through the cost
 * engine and applyFxSnapshot to provide deterministic, fixture-pinned coverage
 * of surface 4 (fx-conversion.mjs + cost-engine.mjs).
 *
 * Scenarios covered:
 *   knownModel          — mixed buckets, opus direct confidence.
 *   unknownModel        — absent registry entry → usd null / unknown.
 *   cacheReadHeavy      — cacheRead priced at cacheRead rate (not input rate).
 *   cacheWriteTtl1h     — cacheWriteByTtl.ttl1h used when opts.cacheTtl='1h'.
 *   cacheWriteTtl5m     — default cacheWriteByTtl.ttl5m.
 *   missingRegistry     — null registry → financialSummary skipped.
 *   fxConversion        — applyFxSnapshot: converted = usd × rate; originalUsd preserved.
 *   originalUsdPreservation — unknown fxConfidence → converted null, originalUsd kept.
 *   zeroUsage           — all buckets 0, known model → usd exactly 0.
 *   mixedModels         — one known + one unknown model; unpricedModels=1.
 *
 * ADR-0079 E2 variant (b) throughout. Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TOL = 1e-9;
const near = (a, b) => Math.abs(a - b) < TOL;

/**
 * Runs EACP Wave 8 cost-scenarios fixture checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpCostScenarioChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 8 cost-scenarios (WF0018 / ADR-0079 §12.2)...');
  const econ = 'templates/contextkit/tools/scripts/economics';

  let scenarios = null;
  try {
    const raw = await readFile(resolve(KIT, `${econ}/fixtures/cost-scenarios.json`), 'utf-8');
    scenarios = JSON.parse(raw).scenarios;
    ok('cost-scenarios.json loads cleanly');
  } catch (err) {
    bad(`cost-scenarios.json failed to load: ${err?.message ?? err}`); return;
  }

  let costLib, regLib, repLib;
  try {
    costLib = await import(pathToFileURL(resolve(KIT, `${econ}/cost-engine.mjs`)).href);
    regLib  = await import(pathToFileURL(resolve(KIT, `${econ}/pricing/pricing-registry.mjs`)).href);
    repLib  = await import(pathToFileURL(resolve(KIT, `${econ}/token-report-cost.mjs`)).href);
  } catch (err) {
    bad(`cost module import failed: ${err?.message ?? err}`); return;
  }

  const reg        = regLib.loadRegistry();
  const opusEntry  = reg ? regLib.priceFor(reg, 'opus-4-8') : null;
  const unknownEntry = null; // not in registry

  // -- knownModel -----------------------------------------------------------
  const km = scenarios.knownModel;
  const kmRes = costLib.actualCost(km.buckets, opusEntry);
  near(kmRes.usd, km.expected.actualUsd)
    ? ok(`scenario knownModel: actualCost ≈ ${km.expected.actualUsd}`)
    : bad(`scenario knownModel: actualCost got ${kmRes.usd}, expected ${km.expected.actualUsd}`);
  kmRes.confidence === km.expected.confidence
    ? ok(`scenario knownModel: confidence="${km.expected.confidence}"`)
    : bad(`scenario knownModel: confidence ${kmRes.confidence} ≠ ${km.expected.confidence}`);
  kmRes.leadWithUsd === km.expected.leadWithUsd
    ? ok(`scenario knownModel: leadWithUsd=${km.expected.leadWithUsd} (subscription)`)
    : bad(`scenario knownModel: leadWithUsd ${kmRes.leadWithUsd} ≠ ${km.expected.leadWithUsd}`);

  // -- unknownModel ---------------------------------------------------------
  const um = scenarios.unknownModel;
  const umEntry = regLib.priceFor(reg, um.model); // should be null
  const umRes = costLib.actualCost(um.buckets, umEntry);
  umRes.usd === null
    ? ok('scenario unknownModel: usd null (never $0 for unknown model)')
    : bad(`scenario unknownModel: usd should be null, got ${umRes.usd}`);
  umRes.confidence === 'unknown'
    ? ok('scenario unknownModel: confidence "unknown"')
    : bad(`scenario unknownModel: confidence should be "unknown", got "${umRes.confidence}"`);

  // -- cacheReadHeavy -------------------------------------------------------
  const crh = scenarios.cacheReadHeavy;
  const crhRes = costLib.actualCost(crh.buckets, opusEntry);
  const crhNoC = costLib.noCacheCost(crh.buckets, opusEntry);
  near(crhRes.usd, crh.expected.actualUsd)
    ? ok(`scenario cacheReadHeavy: actualCost ≈ ${crh.expected.actualUsd}`)
    : bad(`scenario cacheReadHeavy: got ${crhRes.usd}`);
  near(crhNoC.usd, crh.expected.noCacheUsd)
    ? ok(`scenario cacheReadHeavy: noCacheCost ≈ ${crh.expected.noCacheUsd} (E2 variant b)`)
    : bad(`scenario cacheReadHeavy: noCacheCost got ${crhNoC.usd}`);

  // -- cacheWriteTtl1h / cacheWriteTtl5m ------------------------------------
  const cw1h = scenarios.cacheWriteTtl1h;
  const cw1hRes = costLib.actualCost(cw1h.buckets, opusEntry, { cacheTtl: '1h' });
  near(cw1hRes.usd, cw1h.expected.actualUsd)
    ? ok(`scenario cacheWriteTtl1h: actualCost ≈ ${cw1h.expected.actualUsd}`)
    : bad(`scenario cacheWriteTtl1h: got ${cw1hRes.usd}`);

  const cw5m = scenarios.cacheWriteTtl5m;
  const cw5mRes = costLib.actualCost(cw5m.buckets, opusEntry, {});
  near(cw5mRes.usd, cw5m.expected.actualUsd)
    ? ok(`scenario cacheWriteTtl5m: actualCost ≈ ${cw5m.expected.actualUsd} (default TTL)`)
    : bad(`scenario cacheWriteTtl5m: got ${cw5mRes.usd}`);

  // -- missingRegistry ------------------------------------------------------
  const mr = scenarios.missingRegistry;
  const mrRes = repLib.financialSummary(mr.attribution, { registry: null });
  mrRes?.status === 'skipped'
    ? ok('scenario missingRegistry: financialSummary → skipped (never $0)')
    : bad(`scenario missingRegistry: should be skipped, got ${JSON.stringify(mrRes)}`);

  // -- fxConversion ---------------------------------------------------------
  const fx = scenarios.fxConversion;
  const fxBase = costLib.actualCost(fx.buckets, opusEntry);
  const fxRes  = costLib.applyFxSnapshot(fxBase, fx.fxSnapshot);
  near(fxRes.originalUsd, fx.expected.originalUsd)
    ? ok(`scenario fxConversion: originalUsd preserved ≈ ${fx.expected.originalUsd}`)
    : bad(`scenario fxConversion: originalUsd got ${fxRes.originalUsd}`);
  near(fxRes.converted, fx.expected.converted)
    ? ok(`scenario fxConversion: converted ≈ ${fx.expected.converted}`)
    : bad(`scenario fxConversion: converted got ${fxRes.converted}`);
  fxRes.currency === fx.expected.currency && fxRes.confidence === fx.expected.confidence
    ? ok(`scenario fxConversion: currency=${fx.expected.currency} confidence=${fx.expected.confidence}`)
    : bad(`scenario fxConversion: currency/confidence wrong`);

  // -- originalUsdPreservation (unknown FX confidence) ----------------------
  const oup = scenarios.originalUsdPreservation;
  const oupBase = costLib.actualCost(oup.buckets, opusEntry);
  const oupRes  = costLib.applyFxSnapshot(oupBase, oup.fxSnapshot);
  near(oupRes.originalUsd, oup.expected.originalUsd)
    ? ok(`scenario originalUsdPreservation: originalUsd preserved ≈ ${oup.expected.originalUsd}`)
    : bad(`scenario originalUsdPreservation: originalUsd got ${oupRes.originalUsd}`);
  oupRes.converted === null
    ? ok('scenario originalUsdPreservation: converted null (unknown fxConfidence)')
    : bad(`scenario originalUsdPreservation: converted should be null, got ${oupRes.converted}`);
  oupRes.fxConfidence === 'unknown' && oupRes.confidence === 'unknown'
    ? ok('scenario originalUsdPreservation: confidence "unknown" (refused)')
    : bad(`scenario originalUsdPreservation: confidence should be unknown`);

  // -- fx-conversion: null usd → both null ----------------------------------
  const fxNullRes = costLib.applyFxSnapshot({ usd: null, confidence: 'unknown' }, fx.fxSnapshot);
  fxNullRes.originalUsd === null && fxNullRes.converted === null
    ? ok('fx-conversion: null usd input → originalUsd null, converted null')
    : bad(`fx-conversion: null usd should produce both null, got ${JSON.stringify(fxNullRes)}`);

  // -- fx-conversion: confidence downgrade to lowest ------------------------
  const fxDown = costLib.applyFxSnapshot(
    { usd: 0.01, confidence: 'derived' },
    { currency: 'BRL', rate: 5.0, timestamp: 'T', source: 's', confidence: 'direct' }
  );
  fxDown.confidence === 'derived'
    ? ok('fx-conversion: confidence downgrades to lowest of cost vs FX (derived wins over direct)')
    : bad(`fx-conversion: confidence should be "derived", got "${fxDown.confidence}"`);

  // -- zeroUsage ------------------------------------------------------------
  const zu = scenarios.zeroUsage;
  const zuRes = costLib.actualCost(zu.buckets, opusEntry);
  zuRes.usd === 0
    ? ok('scenario zeroUsage: actualCost === 0 exactly (known model, zero tokens)')
    : bad(`scenario zeroUsage: usd should be 0, got ${zuRes.usd}`);

  // -- mixedModels ----------------------------------------------------------
  const mm = scenarios.mixedModels;
  const mmRes = repLib.financialSummary(mm.attribution);
  mmRes.unpricedModels === mm.expected.unpricedModels
    ? ok(`scenario mixedModels: unpricedModels=${mm.expected.unpricedModels}`)
    : bad(`scenario mixedModels: unpricedModels ${mmRes.unpricedModels} ≠ ${mm.expected.unpricedModels}`);
  mmRes.confidence === mm.expected.confidence
    ? ok(`scenario mixedModels: confidence="${mm.expected.confidence}"`)
    : bad(`scenario mixedModels: confidence ${mmRes.confidence} ≠ ${mm.expected.confidence}`);
  mmRes.totals.actualUsd > 0 === mm.expected.totalActualUsdIsPositive
    ? ok('scenario mixedModels: totalActualUsd>0 for priced model contribution')
    : bad(`scenario mixedModels: totalActualUsd>0 wrong (${mmRes.totals.actualUsd})`);
  mmRes.perModel.length === mm.expected.perModelLength
    ? ok(`scenario mixedModels: perModel.length=${mm.expected.perModelLength}`)
    : bad(`scenario mixedModels: perModel.length ${mmRes.perModel.length} ≠ ${mm.expected.perModelLength}`);

  // -- fx-conversion: zero-dep (fx-conversion.mjs is now a separate file) ---
  const fxPath = resolve(KIT, `${econ}/fx-conversion.mjs`);
  let fxContent = '';
  try { fxContent = await readFile(fxPath, 'utf-8'); ok('fx-conversion.mjs readable'); }
  catch (err) { bad(`fx-conversion.mjs unreadable: ${err?.message ?? err}`); return; }
  const fxImportRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let fxMatch; let fxClean = true;
  while ((fxMatch = fxImportRegex.exec(fxContent)) !== null) {
    const spec = fxMatch[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      bad(`zero-dep Wave 8: fx-conversion.mjs imports from "${spec}"`); fxClean = false;
    }
  }
  if (fxClean) ok('zero-dep invariant: fx-conversion.mjs imports only node:/* or relative paths');
}
