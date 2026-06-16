/**
 * autonomy-readiness-v2-core.mjs — PURE composer for CDK-077.
 *
 * Takes pre-gathered inputs (v1 marker + scorecard) and emits a composite
 * readiness verdict. Zero I/O, zero side-effects, zero runtime deps.
 *
 * §8 Safety contract (immutable):
 *   - `ready:true` is emitted ONLY when EVERY gating signal is BOTH present
 *     AND passing. A null or missing input → `present:false` → `ready:false`.
 *   - Graceful degradation refuses to a FALSE-NEGATIVE: unproven autonomy stays
 *     unproven. A false-positive (ready:true on missing data) is forbidden.
 *
 * Gating signals (all four must be present+pass for ready:true):
 *   v1-coverage       — v1 marker exists and coverageGreen === true
 *   v1-attribution    — v1 marker exists and attributionPresent === true
 *   scorecard-health  — scorecard.overall.score >= 60 (not 'weak')
 *   capability-compliance — scorecard capability-compliance dimension score >= 80
 *
 * CDK-077 / ADR-0072. ≤ 308 lines.
 */

// ---------------------------------------------------------------------------
// Types (JSDoc only — zero runtime overhead)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ coverageGreen: boolean, attributionPresent: boolean }} V1Marker
 * @typedef {{ overall: { score: number|null, band: string|null }, dimensions: Array<{ key: string, score: number|null, status: string }> }} ScorecardInput
 * @typedef {{ key: string, present: boolean, pass: boolean, value: unknown, detail: string }} Signal
 * @typedef {{ ready: boolean, signals: Signal[], confidence: 'high'|'medium'|'low'|'none' }} ReadinessResult
 */

// ---------------------------------------------------------------------------
// Signal builders
// ---------------------------------------------------------------------------

/**
 * Builds the `v1-coverage` signal from the v1 marker.
 *
 * @param {V1Marker|null} v1 parsed v1 marker or null when absent/unparseable
 * @returns {Signal}
 */
function buildCoverageSignal(v1) {
  const present = v1 !== null && typeof v1.coverageGreen === 'boolean';
  const pass = present && v1.coverageGreen === true;
  return {
    key: 'v1-coverage',
    present,
    pass,
    value: present ? v1.coverageGreen : null,
    detail: present
      ? (pass ? 'v1 coverage green' : 'v1 coverage not green')
      : 'v1 marker absent or unparseable — coverage unknown',
  };
}

/**
 * Builds the `v1-attribution` signal from the v1 marker.
 *
 * @param {V1Marker|null} v1 parsed v1 marker or null when absent/unparseable
 * @returns {Signal}
 */
function buildAttributionSignal(v1) {
  const present = v1 !== null && typeof v1.attributionPresent === 'boolean';
  const pass = present && v1.attributionPresent === true;
  return {
    key: 'v1-attribution',
    present,
    pass,
    value: present ? v1.attributionPresent : null,
    detail: present
      ? (pass ? 'v1 attribution present' : 'v1 attribution not present')
      : 'v1 marker absent or unparseable — attribution unknown',
  };
}

/**
 * Builds the `scorecard-health` signal from the scorecard overall score.
 * Pass threshold: score >= 60 (i.e. band is not 'weak').
 *
 * @param {ScorecardInput|null} scorecard or null when unavailable
 * @returns {Signal}
 */
function buildScorecardHealthSignal(scorecard) {
  const rawScore = scorecard?.overall?.score;
  const present = typeof rawScore === 'number';
  const pass = present && rawScore >= 60;
  return {
    key: 'scorecard-health',
    present,
    pass,
    value: present ? rawScore : null,
    detail: present
      ? (pass ? `overall score ${rawScore} >= 60 (not weak)` : `overall score ${rawScore} < 60 (weak)`)
      : 'scorecard unavailable or overall score is null',
  };
}

/**
 * Builds the `capability-compliance` signal from the scorecard's dimension of
 * the same key. Reuses the scorecard's pre-computed dimension (CDK-076 §8:
 * never re-derive; compose only). Pass threshold: score >= 80.
 *
 * @param {ScorecardInput|null} scorecard or null when unavailable
 * @returns {Signal}
 */
function buildCapabilityComplianceSignal(scorecard) {
  const dimensions = Array.isArray(scorecard?.dimensions) ? scorecard.dimensions : [];
  const dim = dimensions.find((d) => d.key === 'capability-compliance');
  const present = dim !== undefined && dim.status === 'scored' && typeof dim.score === 'number';
  const pass = present && dim.score >= 80;
  return {
    key: 'capability-compliance',
    present,
    pass,
    value: present ? dim.score : null,
    detail: present
      ? (pass ? `capability-compliance score ${dim.score} >= 80` : `capability-compliance score ${dim.score} < 80`)
      : 'capability-compliance dimension unavailable or skipped in scorecard',
  };
}

// ---------------------------------------------------------------------------
// Confidence derivation
// ---------------------------------------------------------------------------

/**
 * Derives a confidence level based on how many of the four signals are present.
 * High = all 4, medium = ≥2, low = ≥1, none = 0.
 *
 * @param {Signal[]} signals all four gate signals
 * @returns {'high'|'medium'|'low'|'none'}
 */
function deriveConfidence(signals) {
  const presentCount = signals.filter((s) => s.present).length;
  if (presentCount >= 4) return 'high';
  if (presentCount >= 2) return 'medium';
  if (presentCount >= 1) return 'low';
  return 'none';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assesses composite autonomy readiness from pre-gathered inputs. PURE function.
 *
 * Returns `ready:true` ONLY when all four gate signals are BOTH present AND
 * passing — never on absent or partial data (§8: default-to-refuse).
 *
 * @param {{ v1: V1Marker|null, scorecard: ScorecardInput|null }} inputs
 * @returns {ReadinessResult}
 */
export function assessReadiness(inputs) {
  const safeInputs = inputs && typeof inputs === 'object' ? inputs : {};
  const v1 = safeInputs.v1 ?? null;
  const scorecard = safeInputs.scorecard ?? null;

  const signals = [
    buildCoverageSignal(v1),
    buildAttributionSignal(v1),
    buildScorecardHealthSignal(scorecard),
    buildCapabilityComplianceSignal(scorecard),
  ];

  // §8: ready only when EVERY signal is BOTH present AND pass.
  // Default is false; a single absent/failing signal keeps it false.
  const ready = signals.every((s) => s.present && s.pass);

  return {
    ready,
    signals,
    confidence: deriveConfidence(signals),
  };
}
