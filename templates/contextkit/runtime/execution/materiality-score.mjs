/**
 * materiality-score.mjs — deterministic integer materiality scorer for the B2
 * decision-need classifier (BIZ-0001 / WF-0037 Wave B2, ADR-0102).
 *
 * Computes Σ(weight_i for every true need-signal i) over a fixed closed signal
 * set. The weights and band thresholds are read from `policy/decision-intelligence.json`
 * at call time (caller may pre-load and pass the policy directly). No fallback
 * "guess" logic here — the caller owns fail-open wrapping.
 *
 * Design ref: B2-design-decision-table.md §2.1 / §2.2.
 * The policy block is the single source of truth; no magic numbers in this file.
 *
 * Zero runtime dependencies. Pure integer arithmetic. Deterministic.
 *
 * @module materiality-score
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * Embedded fallback policy — byte-equivalent to `policy/decision-intelligence.json`
 * so scoring never crashes when the policy file is absent. Frozen to prevent
 * mutation (immutable rule 2).
 * @type {Readonly<object>}
 */
export const DEFAULT_DECISION_POLICY = Object.freeze({
  schemaVersion: 1,
  materialityWeights: Object.freeze({
    tierArchitectural:      5,
    tierFeature:            2,
    tierTrivial:            0,
    regulatedDomain:        4,
    materialKind:           3,
    routineKind:           -4,
    emergencyKind:          1,
    scopePlatform:          3,
    scopeBusiness:          2,
    scopeOperationWorkflow: 1,
    crossContext:           3,
    irreversible:           3,
    reviewableData:         3,
    lowConfidence:          1,
  }),
  materialityBands: Object.freeze({ required: 6, recommended: 3, none: 2 }),
  routineCeilingDefault: 3,
  regulatedDomains: Object.freeze(['lgpd', 'fintech', 'healthcare']),
  materialKinds: Object.freeze([
    'ARCHITECTURE', 'POLICY', 'COMPLIANCE',
    'BUSINESS_AUTHORIZATION', 'OPERATION_AUTHORIZATION', 'LIFECYCLE',
  ]),
  irreversibleTokens: Object.freeze([
    'migrate', 'migration', 'breaking', 'rewrite', 'replace', 'deprecate',
    'rename public', 'schema', 'data model', 'protocol', 'encryption',
    'delete data', 'drop column', 'irreversible', 'one-way',
  ]),
  reviewableDataTokens: Object.freeze([
    'price', 'pricing', 'model list', 'threshold', 'quota',
    'budget', 'policy', 'retention', 'naming',
  ]),
  crossContextTokens: Object.freeze([
    'across modules', 'across the repo', 'kit-wide', 'fleet',
  ]),
  emergencyEnvelope: Object.freeze({
    restoreSafety:    Object.freeze(['revert', 'rollback', 'restore', 'roll back']),
    productionHotfix: Object.freeze(['hotfix', 'production incident', 'prod down', 'outage']),
    updaterSafety:    Object.freeze(['updater', '--update', 'defer update']),
  }),
  lifecycleTokens: Object.freeze([
    'supersede', 'deprecate', 'transfer ownership', 'replace adr',
  ]),
});

/**
 * Returns true iff `text` (already lowercased) contains at least one token in
 * `tokens`. Uses substring matching (design §2.1 — same `includes` rule as A2).
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
 * Evaluates every need-signal boolean for the given context and returns the named
 * signal flags. This is the structured decomposition of §2.1 — every signal is
 * individually labeled so reasons can reference it by name.
 *
 * @param {object} params
 * @param {object} params.signals - the full `signals` object from `intake()`.
 * @param {string} params.decisionKind - the derived `decisionKind` string.
 * @param {string} params.decisionScope - the derived `decisionScope` string.
 * @param {string} params.objectiveLower - lowercased raw objective text.
 * @param {object} params.policy - the loaded (or fallback) decision-intelligence policy.
 * @returns {Record<string, boolean>} one boolean per signal name.
 */
export function evaluateNeedSignals({ signals, decisionKind, decisionScope, objectiveLower, policy }) {
  const tier = signals?.tier ?? 'trivial';
  // `signals.domain` is the authoritative regulated-domain lookup (intake stores it
  // as a sibling of the flat-string `signals.tier`, not as `tier.domain`).
  const domain = signals?.domain ?? 'general';
  const work = signals?.work ?? {};
  const p = policy ?? DEFAULT_DECISION_POLICY;

  return {
    tierArchitectural:      tier === 'architectural',
    tierFeature:            tier === 'feature',
    tierTrivial:            tier === 'trivial',
    regulatedDomain:        Array.isArray(p.regulatedDomains) && p.regulatedDomains.includes(domain),
    materialKind:           Array.isArray(p.materialKinds) && p.materialKinds.includes(decisionKind),
    routineKind:            decisionKind === 'ROUTINE_OPERATION_GOVERNANCE',
    emergencyKind:          decisionKind === 'EMERGENCY_GOVERNANCE',
    scopePlatform:          decisionScope === 'platform',
    scopeBusiness:          decisionScope === 'business',
    scopeOperationWorkflow: decisionScope === 'operation' || decisionScope === 'workflow',
    crossContext:           work.executionMode === 'workflow'
                            || hasAny(objectiveLower, p.crossContextTokens ?? []),
    irreversible:           hasAny(objectiveLower, p.irreversibleTokens ?? []),
    reviewableData:         hasAny(objectiveLower, p.reviewableDataTokens ?? []),
    lowConfidence:          work.confidence === 'low',
  };
}

/**
 * Computes the integer materiality score and resolves the band verdict.
 * The interface contract from the frozen spec:
 *
 * ```
 * export function materialityScore(signals) { return { score, band }; }
 * ```
 *
 * `signals` here is the EXTENDED object after `deriveTriple` has been called —
 * it must include `signals.tier`, `signals.domain`, `signals.work`, plus the
 * caller-derived `decisionKind`, `decisionScope`, `objectiveLower`, and optionally
 * a pre-loaded `policy`. If the extended fields are missing the function
 * degrades gracefully to `{ score: 0, band: 'none' }`.
 *
 * @param {{ tier?: string, domain?: string, work?: object,
 *            decisionKind?: string, decisionScope?: string,
 *            objectiveLower?: string, policy?: object }} signals
 * @returns {{ score: number, band: 'required'|'recommended'|'none',
 *             needSignals: Record<string, boolean> }}
 */
export function materialityScore(signals) {
  try {
    const policy = signals?.policy ?? DEFAULT_DECISION_POLICY;
    const weights = policy.materialityWeights ?? DEFAULT_DECISION_POLICY.materialityWeights;
    const bands = policy.materialityBands ?? DEFAULT_DECISION_POLICY.materialityBands;

    const needSignals = evaluateNeedSignals({
      signals,
      decisionKind:    signals?.decisionKind ?? '',
      decisionScope:   signals?.decisionScope ?? '',
      objectiveLower:  signals?.objectiveLower ?? '',
      policy,
    });

    let score = 0;
    for (const [signalName, isTrue] of Object.entries(needSignals)) {
      if (isTrue && Object.prototype.hasOwnProperty.call(weights, signalName)) {
        score += weights[signalName];
      }
    }
    // score is an integer (all weights integers)
    const band = score >= bands.required
      ? 'required'
      : score >= bands.recommended
        ? 'recommended'
        : 'none';

    return { score, band, needSignals };
  } catch {
    // Fail-open: never throw, degrade to safe defaults (constitution §8).
    return { score: 0, band: 'none', needSignals: {} };
  }
}
