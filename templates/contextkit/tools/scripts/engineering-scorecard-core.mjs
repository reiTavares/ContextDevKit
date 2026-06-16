/**
 * engineering-scorecard-core.mjs — PURE scoring engine for CDK-076.
 *
 * Composes signals from seven advisory CDK-07x tools into a multi-dimension
 * engineering health scorecard. Zero I/O, zero side-effects, zero runtime deps.
 * The I/O layer (engineering-scorecard.mjs) gathers inputs and calls scoreDimensions().
 *
 * §8 Safety contract (immutable):
 *   - A NULL or absent input → status:'skipped', score:null.
 *   - A skipped dimension is NEVER scored as 0 and NEVER counted in the overall mean.
 *     Silence is honest; false-pass is forbidden.
 *
 * Band thresholds: ≥80 → 'strong', ≥60 → 'fair', else 'weak'.
 * Confidence: scoredCount ≥5 → 'high', ≥3 → 'medium', ≥1 → 'low', else 'none'.
 *
 * ADR-0072 / CDK-076. ≤ 308 lines.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} score @returns {'strong'|'fair'|'weak'} */
function scoreToBand(score) {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'fair';
  return 'weak';
}

/** @param {number} n @returns {'high'|'medium'|'low'|'none'} */
function countToConfidence(n) {
  if (n >= 5) return 'high';
  if (n >= 3) return 'medium';
  if (n >= 1) return 'low';
  return 'none';
}

/** Returns a skipped dimension record (§8: score=null, never 0). */
function skipped(key, reason) {
  return { key, score: null, band: null, status: 'skipped', detail: reason };
}

/** Returns a scored dimension record (0–100 clamped). */
function scored(key, rawScore, detail) {
  const score = Math.max(0, Math.min(100, rawScore));
  return { key, score, band: scoreToBand(score), status: 'scored', detail };
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

/**
 * lineage-completeness — % of active cards (stage ∈ working/testing/conclusion)
 * that have an 'attests' edge to a receipt node.
 *
 * @param {object|null} graph lineage-graph output
 * @returns {object} Dimension
 */
function scoreLineageCompleteness(graph) {
  const ACTIVE = new Set(['working', 'testing', 'conclusion']);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const activeIds = nodes.filter((n) => n.type === 'card' && ACTIVE.has(n.ref?.stage)).map((n) => n.id);
  if (activeIds.length === 0) return skipped('lineage-completeness', 'no active cards (stage ∈ working/testing/conclusion)');
  const attested = new Set(edges.filter((e) => e.rel === 'attests').map((e) => e.from));
  const hit = activeIds.filter((id) => attested.has(id)).length;
  return scored('lineage-completeness', (hit / activeIds.length) * 100,
    `${hit}/${activeIds.length} active cards have receipt attestation`);
}

/**
 * receipt-pass-rate — % of receipt nodes with ref.result === 'passed'.
 *
 * @param {object|null} graph lineage-graph output
 * @returns {object} Dimension
 */
function scoreReceiptPassRate(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const receipts = nodes.filter((n) => n.type === 'receipt');
  if (receipts.length === 0) return skipped('receipt-pass-rate', 'no receipt nodes in graph');
  const passed = receipts.filter((n) => n.ref?.result === 'passed').length;
  return scored('receipt-pass-rate', (passed / receipts.length) * 100,
    `${passed}/${receipts.length} receipts have result='passed'`);
}

/**
 * evidence-coverage — 100*(1 - unknownKinds.length/receipts) from CDK-075.
 * Skipped when receipts === 0 (division by zero is a false-pass vector).
 *
 * @param {object|null} taxonomyResult evidenceTaxonomy() output
 * @returns {object} Dimension
 */
function scoreEvidenceCoverage(taxonomyResult) {
  const cov = taxonomyResult?.coverage;
  const receiptCount = typeof cov?.receipts === 'number' ? cov.receipts : -1;
  if (receiptCount <= 0) return skipped('evidence-coverage', 'no receipts in taxonomy coverage (CDK-075)');
  const unknownCount = Array.isArray(cov.unknownKinds) ? cov.unknownKinds.length : 0;
  return scored('evidence-coverage', (1 - unknownCount / receiptCount) * 100,
    `${unknownCount} unknown kinds out of ${receiptCount} receipts`);
}

/**
 * rule-health — 100*pass/(pass+fail) from CDK-073 summary.
 * Skipped when pass+fail === 0 (no rules evaluated).
 *
 * @param {object|null} rulesResult runRules() output
 * @returns {object} Dimension
 */
function scoreRuleHealth(rulesResult) {
  const s = rulesResult?.summary;
  const pass = typeof s?.pass === 'number' ? s.pass : 0;
  const fail = typeof s?.fail === 'number' ? s.fail : 0;
  const evaluated = pass + fail;
  if (evaluated === 0) return skipped('rule-health', 'no rules evaluated (pass+fail === 0) in CDK-073');
  return scored('rule-health', (pass / evaluated) * 100,
    `${pass} pass / ${fail} fail out of ${evaluated} rules evaluated`);
}

/**
 * capability-compliance — 100*parity/total from compliance summarize.
 * Skipped when total === 0.
 *
 * @param {object|null} complianceSummary summarize(matrix) output
 * @returns {object} Dimension
 */
function scoreCapabilityCompliance(complianceSummary) {
  const total = typeof complianceSummary?.total === 'number' ? complianceSummary.total : 0;
  if (total === 0) return skipped('capability-compliance', 'capability registry empty or unavailable');
  const parity = typeof complianceSummary.parity === 'number' ? complianceSummary.parity : 0;
  return scored('capability-compliance', (parity / total) * 100,
    `${parity}/${total} capabilities at full host parity`);
}

/**
 * calibration — overall.accuracy*100 from CDK-072.
 * Skipped when accuracy is null (no reviewed predictions).
 *
 * @param {object|null} calibrationResult lineageCalibration() output
 * @returns {object} Dimension
 */
function scoreCalibration(calibrationResult) {
  const accuracy = calibrationResult?.overall?.accuracy;
  if (typeof accuracy !== 'number') return skipped('calibration', 'no reviewed predictions (accuracy null) in CDK-072');
  const pct = accuracy * 100;
  return scored('calibration', pct, `prediction calibration accuracy: ${pct.toFixed(1)}%`);
}

/**
 * benchmark-completion — 100*completedCount/count from CDK-065.
 * Skipped when count === 0 or ledger absent.
 *
 * @param {object|null} benchmarkSummary summarize() output from benchmark-task.mjs
 * @returns {object} Dimension
 */
function scoreBenchmarkCompletion(benchmarkSummary) {
  const total = typeof benchmarkSummary?.count === 'number' ? benchmarkSummary.count : 0;
  if (total === 0) return skipped('benchmark-completion', 'no benchmark records (count === 0 or no ledger)');
  const done = typeof benchmarkSummary.completedCount === 'number' ? benchmarkSummary.completedCount : 0;
  return scored('benchmark-completion', (done / total) * 100,
    `${done}/${total} benchmark tasks completed`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scores all dimensions from the supplied inputs object and computes an overall
 * aggregate. Missing or null inputs produce skipped dimensions — they are excluded
 * from the overall mean (§8: never scored as 0, never a false pass).
 *
 * @param {{
 *   lineageGraph?: object|null,
 *   calibration?: object|null,
 *   rules?: object|null,
 *   taxonomy?: object|null,
 *   compliance?: object|null,
 *   benchmark?: object|null
 * }} inputs plain object filled by the I/O layer; each field may be null
 * @returns {{
 *   dimensions: object[],
 *   overall: { score:number|null, band:string|null, scoredCount:number, totalCount:number, confidence:string }
 * }}
 */
export function scoreDimensions(inputs) {
  const inp = inputs && typeof inputs === 'object' ? inputs : {};

  const dimensions = [
    scoreLineageCompleteness(inp.lineageGraph ?? null),
    scoreReceiptPassRate(inp.lineageGraph ?? null),
    scoreEvidenceCoverage(inp.taxonomy ?? null),
    scoreRuleHealth(inp.rules ?? null),
    scoreCapabilityCompliance(inp.compliance ?? null),
    scoreCalibration(inp.calibration ?? null),
    scoreBenchmarkCompletion(inp.benchmark ?? null),
  ];

  const scoredDims = dimensions.filter((d) => d.status === 'scored');
  const scoredCount = scoredDims.length;
  const totalCount = dimensions.length;

  let overallScore = null;
  let overallBand = null;
  if (scoredCount > 0) {
    const mean = scoredDims.reduce((sum, d) => sum + d.score, 0) / scoredCount;
    overallScore = Math.round(mean * 10) / 10;
    overallBand = scoreToBand(overallScore);
  }

  return {
    dimensions,
    overall: { score: overallScore, band: overallBand, scoredCount, totalCount, confidence: countToConfidence(scoredCount) },
  };
}
