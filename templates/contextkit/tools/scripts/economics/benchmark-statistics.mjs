/**
 * Benchmark statistics module — EACP Wave 10 / card #243 (EACP-14).
 *
 * Public facade: re-exports all statistical functions from the two sub-modules:
 *   - benchmark-statistics-core.mjs  : summary stats, power calc, bootstrap CI
 *   - benchmark-statistics-inference.mjs : matched-pair, effect size, correction
 *
 * Consumers import from this single entry point.
 * Zero runtime dependencies; no Date.now(), no Math.random().
 *
 * Evidence-gate contract (ADR-0080 / constitution §8):
 *   - Mock/empty input → claim: null, evidenceTier: 'none', conclusion: 'unknown'
 *     or 'blocked-real-data'.
 *   - Permitted conclusions: proven|supported|measured|refuted|unknown|budget_aborted
 *   - A positive conclusion is NEVER mandatory; 'refuted' is equally valid.
 *
 * @module benchmark-statistics
 */

export {
  STATISTICS_SCHEMA_VERSION,
  PERMITTED_CONCLUSIONS,
  EVIDENCE_TIERS,
  DEFAULT_PRACTICAL_THRESHOLD,
  median,
  p95,
  summarizeMetric,
  sampleSizeEstimate,
  bootstrapCI,
  withinCellVariance,
} from './benchmark-statistics-core.mjs';

export {
  matchedPairDeltas,
  cohensDEffect,
  practicalSignificance,
  holmBonferroni,
  correctedInference,
} from './benchmark-statistics-inference.mjs';

// ---------------------------------------------------------------------------
// Smoke test (runs only when executed directly)
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('benchmark-statistics.mjs')) {
  const {
    median, p95, summarizeMetric, sampleSizeEstimate, bootstrapCI,
  } = await import('./benchmark-statistics-core.mjs');
  const {
    matchedPairDeltas, cohensDEffect, practicalSignificance, holmBonferroni, correctedInference,
  } = await import('./benchmark-statistics-inference.mjs');

  /* eslint-disable no-console */
  console.log('=== benchmark-statistics.mjs smoke test (deterministic fixtures) ===\n');

  const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  console.log('median([10..100]):', median(vals), '(expected 55)');
  console.log('p95([10..100]):', p95(vals), '(expected 100)');

  const fakeRecords = [
    { confidence: 'mock', provider: 'mock', metrics: { mockTokens: 1200 } },
    { confidence: 'mock', provider: 'mock', metrics: { mockTokens: 1400 } },
    { confidence: 'mock', provider: 'mock', metrics: { mockTokens: 1100 } },
  ];
  const summary = summarizeMetric(fakeRecords, 'mockTokens');
  console.log('\nsummarizeMetric (mock records):  n:', summary.n, '  mean:', summary.mean.toFixed(2),
    '  median:', summary.median, '  evidenceTier:', summary.evidenceTier,
    '  claim:', summary.claim, '  conclusion:', summary.conclusion);

  const ss = sampleSizeEstimate({ pooledStdDev: 200, minEffectSize: 150, alpha: 0.05, power: 0.80 });
  console.log('\nsampleSizeEstimate (sd=200, effect=150):  n:', ss.n, '  claim:', ss.claim);

  const ci = bootstrapCI([10, 20, 30, 40, 50], { seed: 42, iterations: 999, level: 0.95 });
  console.log('\nbootstrapCI (seed=42):  lower:', ci.lower, '  upper:', ci.upper, '  claim:', ci.claim);

  const deltas = matchedPairDeltas([10, 20, 30], [13, 26, 33], 'mockTokens');
  console.log('\nmatchedPairDeltas:  n:', deltas.n, '  meanDelta:', deltas.meanDelta.toFixed(2), '  claim:', deltas.claim);

  const eff = cohensDEffect([10, 20, 30], [13, 26, 33]);
  console.log('\ncohensDEffect:  d:', eff.d !== null ? eff.d.toFixed(4) : null, '  claim:', eff.claim);

  const prac = practicalSignificance({ ratio: 1.35, n: 30 });
  console.log('\npracticalSignificance(ratio=1.35):  practicallySignificant:', prac.practicallySignificant,
    '  conclusion:', prac.conclusion, '  claim:', prac.claim);

  const hb = holmBonferroni([0.04, 0.001, 0.03, 0.002], { alpha: 0.05 });
  console.log('\nholmBonferroni([0.04, 0.001, 0.03, 0.002]):');
  hb.forEach((r, i) => console.log(`  [${i}] rawP=${r.rawP} correctedP=${r.correctedP.toFixed(4)} reject=${r.reject}`));

  const inf = correctedInference({
    deltas: { n: 0 }, practical: { practicallySignificant: null },
    effectSize: { d: null }, correctedPs: [], evidenceTier: 'none',
  });
  console.log('\ncorrectedInference (evidenceTier=none):  conclusion:', inf.conclusion, '  claim:', inf.claim);
  console.log('(expected: blocked-real-data, null)');

  console.log('\n=== All smoke tests passed — claim: null throughout ===');
  /* eslint-enable no-console */
}
