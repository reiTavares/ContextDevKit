/**
 * Self-check — EACP Wave 4 routing economics + Fable audit (card #239).
 *
 * Asserts the routing-economics module is internally sound:
 * - Schema version constant + ROUTING_STRATEGIES shape.
 * - selectStrategy: privacySensitive, budgetExhausted, risk 'high',
 *   toolCalling, empty → 'fixed'.
 * - routingROI: quality unknown → savings null; quality-equivalent → savings > 0;
 *   quality below → savings null; skipped when cost is null.
 * - fableAudit: price.input===10, price.output===50, premium true,
 *   intentionalOnly true; accidentalRisk 'none' vs 'detected'.
 * - tierEconomics('powerful', buckets): never throws; returns skipped or
 *   {schemaVersion:'eacp-routing-economics/1', usd:number|null}.
 * - routingSummary: {} → skipped; opus in byModel → premiumModels includes it;
 *   haiku NOT in premiumModels; fable null without registry.
 * - presentRouting: skipped → 'skipped'; populated → 'Routing economics'.
 * - Zero-dep invariant on routing-economics.mjs.
 *
 * Mirrors the structure of selfcheck-eacp-pressure.mjs exactly.
 *
 * Cohesion note (constitution §1, +10% tolerance): one cohesive assertion
 * suite for a single wave — splitting ok()/bad() across files would be
 * premature abstraction with no second consumer. Kept under the 308 cap.
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — copy from selfcheck-eacp-pressure.mjs (not exported there). */
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

/**
 * Runs EACP Wave 4 routing-economics + Fable audit checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpRoutingChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 4 routing economics + Fable audit (card #239)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const routingPath   = resolve(KIT, `${econ}/routing-economics.mjs`);
  const registryPath  = resolve(KIT, `${econ}/pricing/pricing-registry.mjs`);

  let routLib, regLib;
  try {
    routLib = await import(pathToFileURL(routingPath).href);
    ok('routing-economics.mjs imports cleanly');
  } catch (err) {
    bad(`routing-economics.mjs import failed: ${err?.message ?? err}`);
    return;
  }
  try {
    regLib = await import(pathToFileURL(registryPath).href);
    ok('pricing-registry.mjs imports cleanly (routing dependency)');
  } catch (err) {
    bad(`pricing-registry.mjs import failed: ${err?.message ?? err}`);
    // Continue — routing checks that don't need the registry can still run.
    regLib = null;
  }

  // ── Schema version + ROUTING_STRATEGIES ──────────────────────────────────

  // 1. Schema version
  routLib.ROUTING_SCHEMA_VERSION === 'eacp-routing-economics/1'
    ? ok('routing: ROUTING_SCHEMA_VERSION === "eacp-routing-economics/1"')
    : bad(`routing: ROUTING_SCHEMA_VERSION is "${routLib.ROUTING_SCHEMA_VERSION}"`);

  // 2. ROUTING_STRATEGIES — 7-element frozen array
  Array.isArray(routLib.ROUTING_STRATEGIES) && routLib.ROUTING_STRATEGIES.length === 7
    ? ok('routing: ROUTING_STRATEGIES has 7 strategies')
    : bad(`routing: ROUTING_STRATEGIES length wrong: ${JSON.stringify(routLib.ROUTING_STRATEGIES)}`);

  // ── selectStrategy ────────────────────────────────────────────────────────

  // 3. privacySensitive → 'privacy-constrained'
  const sfPrivacy = routLib.selectStrategy(routLib.routingFactors({ privacySensitive: true }));
  sfPrivacy.strategy === 'privacy-constrained'
    ? ok('selectStrategy: privacySensitive → "privacy-constrained"')
    : bad(`selectStrategy: privacySensitive wrong — strategy="${sfPrivacy.strategy}"`);

  // 4. budgetExhausted → 'cost-optimized'
  const sfBudget = routLib.selectStrategy(routLib.routingFactors({ budgetExhausted: true }));
  sfBudget.strategy === 'cost-optimized'
    ? ok('selectStrategy: budgetExhausted → "cost-optimized"')
    : bad(`selectStrategy: budgetExhausted wrong — strategy="${sfBudget.strategy}"`);

  // 5. risk 'high' → 'quality-evaluated' (0.85 ≥ 0.8 threshold)
  const sfRisk = routLib.selectStrategy(routLib.routingFactors({ risk: 'high' }));
  sfRisk.strategy === 'quality-evaluated'
    ? ok('selectStrategy: risk "high" → "quality-evaluated"')
    : bad(`selectStrategy: risk "high" wrong — strategy="${sfRisk.strategy}"`);

  // 6. toolCalling → 'fallback'
  const sfTool = routLib.selectStrategy(routLib.routingFactors({ toolCalling: true }));
  sfTool.strategy === 'fallback'
    ? ok('selectStrategy: toolCalling → "fallback"')
    : bad(`selectStrategy: toolCalling wrong — strategy="${sfTool.strategy}"`);

  // 7. Empty factors → 'fixed'
  const sfEmpty = routLib.selectStrategy(routLib.routingFactors({}));
  sfEmpty.strategy === 'fixed'
    ? ok('selectStrategy: empty factors → "fixed"')
    : bad(`selectStrategy: empty wrong — strategy="${sfEmpty.strategy}"`);

  // ── routingROI ────────────────────────────────────────────────────────────

  // 8. Quality unknown (no qa signals) → savings null, qualityEquivalent null, confidence 'unknown'
  const roiUnknown = routLib.routingROI({ usd: 1 }, { usd: 0.4 }, {});
  roiUnknown.savings === null && roiUnknown.qualityEquivalent === null &&
  roiUnknown.confidence === 'unknown'
    ? ok('routingROI: no qa signals → savings null, qualityEquivalent null, confidence "unknown"')
    : bad(`routingROI: quality unknown wrong — ${JSON.stringify(roiUnknown)}`);

  // 9. Quality-equivalent (0.9/0.9) → savings > 0, qualityEquivalent true
  const roiEquiv = routLib.routingROI(
    { usd: 1 }, { usd: 0.4 },
    { baselinePassRate: 0.9, routedPassRate: 0.9 },
  );
  roiEquiv.qualityEquivalent === true && typeof roiEquiv.savings === 'number' && roiEquiv.savings > 0
    ? ok('routingROI: equivalent quality (0.9/0.9) → savings > 0, qualityEquivalent true')
    : bad(`routingROI: quality-equivalent wrong — ${JSON.stringify(roiEquiv)}`);

  // 10. Quality below baseline (0.9 baseline / 0.5 routed) → savings null
  const roiBelow = routLib.routingROI(
    { usd: 1 }, { usd: 0.4 },
    { baselinePassRate: 0.9, routedPassRate: 0.5 },
  );
  roiBelow.savings === null && roiBelow.qualityEquivalent === false
    ? ok('routingROI: quality below baseline (0.9/0.5) → savings null, qualityEquivalent false')
    : bad(`routingROI: quality-below wrong — ${JSON.stringify(roiBelow)}`);

  // 11. Skipped when baseline cost is null
  const roiSkipped = routLib.routingROI({ usd: null }, { usd: 0.4 }, {});
  roiSkipped?.status === 'skipped'
    ? ok('routingROI: null baseline cost → skipped marker')
    : bad(`routingROI: null cost should skip, got ${JSON.stringify(roiSkipped)}`);

  // ── fableAudit ────────────────────────────────────────────────────────────

  let registry = null;
  if (regLib) {
    try {
      registry = regLib.loadRegistry();
    } catch (err) {
      bad(`fableAudit: loadRegistry() threw: ${err?.message ?? err}`);
    }
  }

  if (registry === null) {
    // Degrade-to-skip path — prove fableAudit handles null registry gracefully.
    const skipVerdict = routLib.fableAudit(null, {});
    skipVerdict?.status === 'skipped'
      ? ok('fableAudit: null registry → skipped marker (degrade path)')
      : bad(`fableAudit: null registry should skip, got ${JSON.stringify(skipVerdict)}`);
    ok('fableAudit: registry absent — skipped path asserted, price checks skipped (constitution §8 degrade)');
  } else {
    // 12. Fable audit: premium true, price.input===10, price.output===50, intentionalOnly true
    const verdict = routLib.fableAudit(registry, {});
    if (verdict?.status === 'skipped') {
      // fable-5 not in registry of the installed copy — degrade-to-skip is valid
      ok('fableAudit: fable-5 absent from registry → skipped (degrade-to-skip, not false-pass)');
    } else {
      verdict.premium === true
        ? ok('fableAudit: premium === true')
        : bad(`fableAudit: premium should be true, got ${verdict.premium}`);
      verdict.price?.input === 10 && verdict.price?.output === 50
        ? ok('fableAudit: price.input===10 and price.output===50 (offline registry values)')
        : bad(`fableAudit: price wrong — input=${verdict.price?.input} output=${verdict.price?.output}`);
      verdict.intentionalOnly === true
        ? ok('fableAudit: intentionalOnly === true')
        : bad(`fableAudit: intentionalOnly should be true, got ${verdict.intentionalOnly}`);

      // 13. accidentalRisk 'none' for routedModels without fable id
      const vNone = routLib.fableAudit(registry, { routedModels: ['claude-opus-4-8'] });
      vNone.accidentalRisk === 'none'
        ? ok('fableAudit: accidentalRisk "none" for routedModels without fable id')
        : bad(`fableAudit: accidentalRisk wrong for safe list — got "${vNone.accidentalRisk}"`);

      // 14. accidentalRisk 'detected' for routedModels with a fable id
      const vDetect = routLib.fableAudit(registry, { routedModels: ['claude-fable-5'] });
      vDetect.accidentalRisk === 'detected'
        ? ok('fableAudit: accidentalRisk "detected" when routedModels contains a /fable/i id')
        : bad(`fableAudit: accidentalRisk should be "detected", got "${vDetect.accidentalRisk}"`);
    }
  }

  // ── tierEconomics ─────────────────────────────────────────────────────────

  // 15. Never throws; returns skipped OR {schemaVersion, usd}
  const buckets = { freshInput: 100, output: 50, cacheRead: 500, cacheWrite: 100, reasoning: 0 };
  let tierResult;
  let tierThrew = false;
  try {
    tierResult = await routLib.tierEconomics('powerful', buckets, {});
  } catch (err) {
    tierThrew = true;
    bad(`tierEconomics: must not throw but threw: ${err?.message ?? err}`);
  }
  if (!tierThrew) {
    const isSkipped = tierResult?.status === 'skipped';
    const isValid   = tierResult?.schemaVersion === 'eacp-routing-economics/1' &&
                      (tierResult.usd === null || typeof tierResult.usd === 'number');
    isSkipped || isValid
      ? ok('tierEconomics("powerful", buckets): returns skipped OR {schemaVersion, usd:number|null} — never throws')
      : bad(`tierEconomics: result malformed — ${JSON.stringify(tierResult)}`);
  }

  // ── routingSummary ────────────────────────────────────────────────────────

  // 16. Empty input → skipped
  const sumEmpty = routLib.routingSummary({});
  sumEmpty?.status === 'skipped'
    ? ok('routingSummary: {} → skipped marker')
    : bad(`routingSummary: {} should skip, got ${JSON.stringify(sumEmpty)}`);

  // 17. byModel with opus → premiumModels includes opus id; haiku NOT in premiumModels
  const byModel = { 'claude-opus-4-8': { turns: 2 }, 'claude-haiku-4-5': { turns: 1 } };
  const sumPop = routLib.routingSummary({ byModel });
  Array.isArray(sumPop.premiumModels) && sumPop.premiumModels.includes('claude-opus-4-8')
    ? ok('routingSummary: opus id in premiumModels')
    : bad(`routingSummary: opus should be in premiumModels, got ${JSON.stringify(sumPop.premiumModels)}`);
  !sumPop.premiumModels.includes('claude-haiku-4-5')
    ? ok('routingSummary: haiku id NOT in premiumModels')
    : bad('routingSummary: haiku should NOT be in premiumModels (not matching /opus|fable|reasoning/i)');

  // 18. fable is null when no registry passed
  sumPop.fable === null
    ? ok('routingSummary: fable is null when no registry passed')
    : bad(`routingSummary: fable should be null without registry, got ${JSON.stringify(sumPop.fable)}`);

  // ── presentRouting ────────────────────────────────────────────────────────

  // 19. Skipped → output contains 'skipped'
  const preSkipped = routLib.presentRouting(sumEmpty);
  typeof preSkipped === 'string' && preSkipped.includes('skipped')
    ? ok('presentRouting: skipped summary → string contains "skipped"')
    : bad(`presentRouting: skipped should contain "skipped", got: ${preSkipped}`);

  // 20. Populated → output contains 'Routing economics'
  const preFull = routLib.presentRouting(sumPop);
  typeof preFull === 'string' && preFull.includes('Routing economics')
    ? ok('presentRouting: populated summary → string contains "Routing economics"')
    : bad(`presentRouting: populated should contain "Routing economics", got: ${preFull.slice(0, 200)}`);

  // ── Zero-dep invariant ────────────────────────────────────────────────────

  // 21. routing-economics.mjs satisfies zero-dep contract
  // (imports cost-engine.mjs, pricing-registry.mjs, privacy.mjs — all relative)
  const result = await checkModuleZeroDep('routing-economics.mjs', routingPath);
  if (result.error) {
    bad(`zero-dep Wave 4 routing: routing-economics.mjs ${result.error}`);
  } else {
    ok('zero-dep invariant: routing-economics.mjs imports only node:/* or relative paths');
  }
}
