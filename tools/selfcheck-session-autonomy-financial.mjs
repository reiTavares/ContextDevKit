/**
 * Self-check — Session Autonomy Receipt: FINANCIAL ACCOUNTING block (spec §15,
 * §16, §3.3, §3.4).
 *
 * Asserts the honesty contract of receipt-financial.mjs:
 *  - subscription/unknown → all-null block, costStatus 'unavailable', NO invented
 *    savings (API list price is not a subscription-value proxy — #14, #15).
 *  - api + provider actual → observedCost = actual, costStatus 'actual', the
 *    snapshot estimate is preserved separately (#22).
 *  - api + snapshot only → costStatus 'estimated', snapshot id stored.
 *  - cost-source PRIORITY: provider-actual beats snapshot-estimate.
 *  - costPerAcceptedTask uses the FULL cost (incl. failed/retried work — #8).
 *  - multi-model executors are summed; an UNUSABLE price contributes null, not 0
 *    (#19).
 *
 * Mirrors the {ok,bad}/{KIT} reporter convention used across tools/selfcheck-*.
 * Zero runtime dependencies — node:* only.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TOL = 1e-9;
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < TOL;

/**
 * Runs the financial-block checks for the Session Autonomy Receipt.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root.
 */
export async function runSessionAutonomyFinancialChecks({ ok, bad }, { KIT }) {
  console.log('Checking Session Autonomy Receipt — financial block (spec §15/§16/§3.3/§3.4)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const finPath = resolve(KIT, `${econ}/session-autonomy/receipt-financial.mjs`);
  const regPath = resolve(KIT, `${econ}/pricing/pricing-registry.mjs`);

  let fin;
  let regLib;
  try {
    fin = await import(pathToFileURL(finPath).href);
    regLib = await import(pathToFileURL(regPath).href);
    ok('receipt-financial.mjs imports cleanly');
  } catch (err) {
    bad(`receipt-financial.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const { buildFinancialBlock, resolveObservedCost, costFromExecutors } = fin;
  const registry = regLib.loadRegistry();
  // 'opus' is a direct-confidence (usable) price in the offline registry.
  const opusExec = (mult = 1) => ({
    model: 'opus',
    buckets: { freshInput: 1_000_000 * mult, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  });

  // ── 1. Subscription → all-null, unavailable, NO invented savings ──────────
  const sub = buildFinancialBlock({
    mode: 'subscription',
    executors: [opusExec()],
    acceptedTasks: 10,
    baselineCost: 5.0, // a baseline is present, yet savings MUST stay null
    pricingRegistry: registry,
  });
  const subAllNull =
    sub.observedCost === null && sub.actualCost === null && sub.estimatedCost === null &&
    sub.estimatedSavings === null && sub.estimatedSavingsPercent === null &&
    sub.costEfficiencyMultiplier === null && sub.costPerAcceptedTask === null &&
    sub.currency === null && sub.costSource === null && sub.pricingSnapshotId === null;
  subAllNull && sub.costStatus === 'unavailable'
    ? ok('subscription: all-null block, costStatus "unavailable" (no invented savings #14/#15)')
    : bad(`subscription: expected all-null/unavailable, got ${JSON.stringify(sub)}`);
  Object.isFrozen(sub)
    ? ok('subscription: returned block is frozen')
    : bad('subscription: block should be frozen');

  // 'unknown' mode behaves like subscription (safe default).
  buildFinancialBlock({ mode: 'unknown', baselineCost: 9 }).costStatus === 'unavailable'
    ? ok('unknown mode: costStatus "unavailable" (safe default)')
    : bad('unknown mode: should be unavailable');

  // ── 2. api + provider actual → observedCost = actual, estimate preserved ──
  const apiActual = buildFinancialBlock({
    mode: 'api',
    executors: [opusExec()],          // yields a snapshot estimate of $5 (1M @ $5/MTok)
    acceptedTasks: 4,
    baselineCost: 20,
    pricingRegistry: registry,
    actualProviderCost: 3.5,          // provider truth, must win
    pricingSnapshotId: 'eacp-pricing-registry/1',
  });
  apiActual.observedCost === 3.5 && apiActual.costStatus === 'actual' &&
    apiActual.costSource === 'provider-response'
    ? ok('api+actual: observedCost = provider actual, costStatus "actual", source "provider-response"')
    : bad(`api+actual: expected actual 3.5, got ${JSON.stringify(apiActual)}`);
  near(apiActual.estimatedCost, 5) && apiActual.actualCost === 3.5
    ? ok('api+actual: estimatedCost ($5 snapshot) preserved alongside actualCost ($3.5) (#22)')
    : bad(`api+actual: both lenses should be preserved, got actual=${apiActual.actualCost} estimated=${apiActual.estimatedCost}`);
  apiActual.pricingSnapshotId === 'eacp-pricing-registry/1' && apiActual.currency === 'USD'
    ? ok('api+actual: pricingSnapshotId recorded, currency USD')
    : bad(`api+actual: snapshot id / currency wrong: ${JSON.stringify(apiActual)}`);
  near(apiActual.estimatedSavings, 16.5) && near(apiActual.estimatedSavingsPercent, 82.5)
    ? ok('api+actual: savings vs baseline 20 → $16.50 / 82.5%')
    : bad(`api+actual: savings wrong: ${apiActual.estimatedSavings} / ${apiActual.estimatedSavingsPercent}`);

  // ── 3. costPerAcceptedTask uses FULL cost incl. failed work (#8) ──────────
  // observedCost 3.5 over 4 accepted tasks → 0.875 (cost includes failed turns).
  near(apiActual.costPerAcceptedTask, 0.875)
    ? ok('api+actual: costPerAcceptedTask = full cost / accepted (0.875), failures included (#8)')
    : bad(`api+actual: costPerAcceptedTask expected 0.875, got ${apiActual.costPerAcceptedTask}`);

  // ── 4. api + snapshot only → costStatus 'estimated' + snapshot id stored ──
  const apiEstimate = buildFinancialBlock({
    mode: 'api',
    executors: [opusExec()],          // $5 snapshot, no provider actual
    acceptedTasks: 5,
    pricingRegistry: registry,
    pricingSnapshotId: 'snap-123',
  });
  near(apiEstimate.observedCost, 5) && apiEstimate.costStatus === 'estimated' &&
    apiEstimate.costSource === 'pricing-snapshot' && apiEstimate.actualCost === null
    ? ok('api+snapshot: observedCost = estimate, costStatus "estimated", actualCost null')
    : bad(`api+snapshot: expected estimated $5, got ${JSON.stringify(apiEstimate)}`);
  apiEstimate.pricingSnapshotId === 'snap-123'
    ? ok('api+snapshot: snapshot id stored')
    : bad(`api+snapshot: snapshot id should be "snap-123", got ${apiEstimate.pricingSnapshotId}`);

  // ── 5. cost-source PRIORITY ladder: actual beats estimate ─────────────────
  const ladder = resolveObservedCost({ actualProviderCost: 2, snapshotCost: 9, userSuppliedCost: 1 });
  ladder.usd === 2 && ladder.status === 'actual' && ladder.source === 'provider-response'
    ? ok('priority: actual (2) beats snapshot (9) and user-supplied (1)')
    : bad(`priority: actual should win, got ${JSON.stringify(ladder)}`);
  (() => {
    const snapWins = resolveObservedCost({ snapshotCost: 9, userSuppliedCost: 1 });
    const userWins = resolveObservedCost({ userSuppliedCost: 1 });
    const none = resolveObservedCost({});
    return snapWins.status === 'estimated' && snapWins.usd === 9 &&
      userWins.status === 'user-supplied' && userWins.usd === 1 &&
      none.status === 'unavailable' && none.usd === null && none.source === null;
  })()
    ? ok('priority: snapshot > user-supplied > unavailable, with correct status/source')
    : bad('priority: lower rungs of the ladder resolved incorrectly');

  // ── 6. Multi-model summed; unusable price → null not 0 (#19) ───────────────
  const multi = costFromExecutors([opusExec(1), opusExec(2)], registry); // $5 + $10
  near(multi, 15)
    ? ok('multi-model: costFromExecutors sums two opus executors → $15')
    : bad(`multi-model: expected $15, got ${multi}`);
  // A deterministic executor contributes a true 0 but doesn't make a result usable.
  const deterministicOnly = costFromExecutors(
    [{ kind: 'deterministic', buckets: { freshInput: 999 } }], registry);
  deterministicOnly === null
    ? ok('deterministic-only: no model spend → null (not $0) — true zero needs no fake figure')
    : bad(`deterministic-only: expected null, got ${deterministicOnly}`);
  // Unknown / unpriceable model → null, never 0 (#19).
  const unpriceable = costFromExecutors(
    [{ model: 'totally-unknown-model', buckets: { freshInput: 1_000_000 } }], registry);
  unpriceable === null
    ? ok('unusable price: unknown model → null (never 0) (#19)')
    : bad(`unusable price: expected null, got ${unpriceable}`);
  // No registry at all → null.
  costFromExecutors([opusExec()], null) === null
    ? ok('no registry: costFromExecutors(..., null) → null')
    : bad('no registry: should be null');
}

// ── Standalone runner ───────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('selfcheck-session-autonomy-financial.mjs')) {
  let failures = 0;
  const ok = (m) => console.log(`  ok   ${m}`);
  const bad = (m) => { failures++; console.error(`  BAD  ${m}`); };
  const KIT = resolve(process.argv[1], '..', '..');
  runSessionAutonomyFinancialChecks({ ok, bad }, { KIT })
    .then(() => {
      console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll financial-block checks passed');
      process.exit(failures ? 1 : 0);
    })
    .catch((err) => {
      console.error(`runner threw: ${err?.message ?? err}`);
      process.exit(1);
    });
}
