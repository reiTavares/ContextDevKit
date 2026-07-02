/**
 * ground-truth.mjs — label provenance schema & confusion-matrix builder
 * (ADR-0129 §2). The classifier can NEVER generate the labels that grant it
 * authority. Each calibration label records its source tier; self-report
 * (Tier D) is telemetry only and NEVER promotes enforcement.
 *
 * Pure + zero runtime dependencies. WF-0063 ships the schema + builders; no
 * promotion happens here (that is the Predictive Rule Evolution Controller in a
 * later workflow). Confusion matrices apply to PREDICTIVE rules only.
 *
 * @module domain-engineering/ground-truth
 */

/** Provenance tiers in descending authority (ADR-0129 §2). */
export const PROVENANCE_TIERS = Object.freeze({
  humanAdjudicated: { tier: 'A', authority: 4, promotes: true },
  behaviorObserved: { tier: 'B', authority: 3, promotes: true },
  deterministicPostHoc: { tier: 'C', authority: 2, promotes: true },
  selfReported: { tier: 'D', authority: 0, promotes: false },
});

/** Evidence fidelity tiers for receipts (ADR-0129 §3). */
export const EVIDENCE_TIERS = Object.freeze(['absent', 'inferred', 'self-reported', 'host-observed', 'deterministic-verified']);

/**
 * Builds a validated ground-truth label record. Throws on an unknown provenance
 * (fail-fast at the boundary, constitution §4) — labels are authority-granting
 * and must never be silently coerced.
 *
 * @param {object} params
 * @param {string} params.ruleId the predictive rule the label calibrates.
 * @param {string} params.provenance one of PROVENANCE_TIERS' keys.
 * @param {boolean} params.predictedPositive the classifier's prediction.
 * @param {boolean} params.actualPositive the observed ground truth.
 * @param {string} [params.note]
 * @returns {object} label record.
 */
export function buildLabel(params) {
  const p = params && typeof params === 'object' ? params : {};
  const provenance = PROVENANCE_TIERS[p.provenance];
  if (!provenance) throw new Error(`ground-truth: unknown provenance "${p.provenance}"`);
  return {
    ruleId: String(p.ruleId ?? 'unknown'),
    provenance: p.provenance,
    tier: provenance.tier,
    promotes: provenance.promotes,
    predictedPositive: Boolean(p.predictedPositive),
    actualPositive: Boolean(p.actualPositive),
    note: typeof p.note === 'string' ? p.note : '',
  };
}

/**
 * Returns the promotion-authorized labels — those whose tier may grant authority.
 * Self-report (Tier D) is excluded by contract (ADR-0129 §2): it NEVER promotes.
 *
 * @param {object[]} labels label records from buildLabel().
 * @returns {object[]}
 */
export function promotionAuthorizedLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.filter((label) => label && label.promotes === true);
}

/**
 * Aggregates provenance counts for a label set (the §2 receipt shape).
 *
 * @param {object[]} labels
 * @returns {{ humanAdjudicated: number, behaviorObserved: number,
 *   deterministicPostHoc: number, selfReported: number }}
 */
export function provenanceCounts(labels) {
  const counts = { humanAdjudicated: 0, behaviorObserved: 0, deterministicPostHoc: 0, selfReported: 0 };
  if (!Array.isArray(labels)) return counts;
  for (const label of labels) {
    if (label && counts[label.provenance] !== undefined) counts[label.provenance] += 1;
  }
  return counts;
}

/**
 * Builds a confusion matrix for a PREDICTIVE rule from its labels. Refuses to
 * build for a non-predictive rule (returns null) — confusion matrices apply to
 * Class B only (ADR-0129 §2). Self-reported labels are excluded from the matrix
 * counts (they never establish truth).
 *
 * @param {string} ruleId
 * @param {object[]} labels
 * @param {object} ruleClassesTable for the Class-B guard.
 * @param {(id: string, table: object) => boolean} isClassA the rule-classes guard.
 * @returns {object|null} confusion matrix + provenance, or null when not predictive.
 */
export function buildConfusionMatrix(ruleId, labels, ruleClassesTable, isClassA) {
  if (typeof isClassA === 'function' && isClassA(ruleId, ruleClassesTable)) return null;
  const authorized = promotionAuthorizedLabels(labels).filter((label) => label.ruleId === ruleId);
  const matrix = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (const label of authorized) {
    if (label.predictedPositive && label.actualPositive) matrix.truePositive += 1;
    else if (label.predictedPositive && !label.actualPositive) matrix.falsePositive += 1;
    else if (!label.predictedPositive && !label.actualPositive) matrix.trueNegative += 1;
    else matrix.falseNegative += 1;
  }
  return { ruleId, matrix, labels: provenanceCounts(labels.filter((label) => label.ruleId === ruleId)) };
}
