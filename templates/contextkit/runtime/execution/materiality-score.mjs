/**
 * materiality-score.mjs — deterministic integer materiality scorer for the B2
 * decision-need classifier (BIZ-0001 / WF-0037 Wave B2, ADR-0125).
 *
 * Computes Σ(weight_i for every true need-signal_i) over a fixed closed signal
 * set derived from token detection on the lowercased objective text (§28 TABLE 4).
 * Weights and band thresholds are read from `policy/decision-intelligence.json`
 * at call time; the caller may pre-load and pass the policy directly. No fallback
 * "guess" logic — the caller owns fail-open wrapping.
 *
 * The DEFAULT_DECISION_POLICY lives in `./materiality-policy-default.mjs` (split
 * to respect the 280-line budget while keeping a large but cohesive token table).
 * It is re-exported here for backward compat with all downstream importers.
 *
 * Zero runtime dependencies. Pure integer arithmetic. Deterministic.
 *
 * @module materiality-score
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DECISION_POLICY } from './materiality-policy-default.mjs';

export { DEFAULT_DECISION_POLICY } from './materiality-policy-default.mjs';

/** Relative policy path from the platform root (PLATFORM_DIR). */
const POLICY_FILENAME = 'policy/decision-intelligence.json';

/**
 * Loads the decision-intelligence policy from `platformRoot`. Returns null on any
 * failure — the caller must fail-open. Strips UTF-8 BOM before parsing.
 *
 * @param {string} platformRoot - absolute path to the contextkit/ platform dir.
 * @returns {object|null}
 */
export function loadDecisionPolicy(platformRoot) {
  try {
    const policyPath = join(platformRoot, POLICY_FILENAME);
    if (!existsSync(policyPath)) return null;
    const raw = readFileSync(policyPath, 'utf-8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    return parsed && parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns true iff `text` (already lowercased) contains at least one token in
 * `tokens`. Uses substring matching (design §28 — same `includes` rule as A2).
 *
 * @param {string} text - lowercased objective.
 * @param {readonly string[]} tokens - token list.
 * @returns {boolean}
 */
function hasAny(text, tokens) {
  if (!Array.isArray(tokens)) return false;
  return tokens.some((t) => text.includes(t));
}

/**
 * Evaluates every need-signal boolean via §28 token detection on the objective
 * text. Returns the named signal flags — one boolean per TABLE 4 dimension.
 *
 * All positive signals use token-list substring matching. The special
 * `coveredByAcceptedAdr` signal derives from `signals.decisionMatch.coverageMode`
 * (set by the search stage upstream); `localReversible` is always false (weight 0,
 * present in the table only to make the closed set explicit).
 *
 * @param {object} params
 * @param {string} params.objectiveLower - lowercased raw objective text.
 * @param {object} params.policy - the loaded (or fallback) decision-intelligence policy.
 * @param {object} [params.signals] - full signals object (used for coverageMode check).
 * @returns {Record<string, boolean>} one boolean per TABLE 4 signal name.
 */
export function evaluateNeedSignals({ objectiveLower, policy, signals }) {
  const p = policy ?? DEFAULT_DECISION_POLICY;
  const text = objectiveLower ?? '';
  const coverageMode = signals?.decisionMatch?.coverageMode ?? '';

  return {
    publicContractChange: hasAny(text, p.publicContractTokens  ?? []),
    breakingChange:       hasAny(text, p.breakingTokens         ?? []),
    crossCuttingArch:     hasAny(text, p.crossCuttingArchTokens ?? []),
    dataMigration:        hasAny(text, p.dataMigrationTokens    ?? []),
    authChange:           hasAny(text, p.authTokens             ?? []),
    invariantChange:      hasAny(text, p.invariantTokens        ?? []),
    materialCompliance:   hasAny(text, p.materialComplianceTokens ?? []),
    newBoundary:          hasAny(text, p.newBoundaryTokens      ?? []),
    newPersistence:       hasAny(text, p.persistenceTokens      ?? []),
    structuralVendor:     hasAny(text, p.vendorTokens           ?? []),
    complexRollout:       hasAny(text, p.rolloutTokens          ?? []),
    expensiveReversal:    hasAny(text, p.reversalTokens         ?? []),
    multiTeam:            hasAny(text, p.multiTeamTokens        ?? []),
    reusableStandard:     hasAny(text, p.reusableStandardTokens ?? []),
    importantPerf:        hasAny(text, p.perfTokens             ?? []),
    localReversible:      false,
    coveredByAcceptedAdr: coverageMode === 'COVERED_BY_ACCEPTED'
                          || coverageMode === 'LEGACY_GRANDFATHERED',
  };
}

/**
 * Computes the integer materiality score and resolves the band verdict.
 * Interface contract (frozen — downstream tests pin this shape):
 *
 * ```
 * export function materialityScore(signals) { return { score, band, needSignals }; }
 * ```
 *
 * `signals` is the extended object available after the search stage — it should
 * include at minimum `signals.objectiveLower` (or `signals.objective`) for token
 * detection to fire. If absent, every signal is false and score = 0.
 *
 * Optional `signals.policy` / `signals.decisionMatch.coverageMode` are used when
 * present. The function always degrades gracefully to `{ score: 0, band: 'none' }`.
 *
 * @param {{ objectiveLower?: string, objective?: string,
 *            policy?: object, decisionMatch?: object }} signals
 * @returns {{ score: number, band: 'required'|'recommended'|'none',
 *             needSignals: Record<string, boolean> }}
 */
export function materialityScore(signals) {
  try {
    const policy = signals?.policy ?? DEFAULT_DECISION_POLICY;
    const weights = policy.materialityWeights ?? DEFAULT_DECISION_POLICY.materialityWeights;
    const bands = policy.materialityBands ?? DEFAULT_DECISION_POLICY.materialityBands;

    const objectiveLower = signals?.objectiveLower
      ?? (signals?.objective ? String(signals.objective).toLowerCase() : '');

    const needSignals = evaluateNeedSignals({ objectiveLower, policy, signals });

    let score = 0;
    for (const [signalName, isTrue] of Object.entries(needSignals)) {
      if (isTrue && Object.prototype.hasOwnProperty.call(weights, signalName)) {
        score += weights[signalName];
      }
    }

    const bandRequired    = bands.required    ?? 8;
    const bandRecommended = bands.recommended ?? 4;
    const band = score >= bandRequired
      ? 'required'
      : score >= bandRecommended
        ? 'recommended'
        : 'none';

    return { score, band, needSignals };
  } catch {
    // Fail-open: never throw, degrade to safe defaults (constitution §8).
    return { score: 0, band: 'none', needSignals: {} };
  }
}
