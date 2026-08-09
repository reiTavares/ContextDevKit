/**
 * decision-search-match.mjs — B2-T2: existing-ADR search + link/recommend
 * resolution (BIZ-0001 / WF-0037, Wave B2).
 *
 * Public entry point: exports `searchDecisions(registry, need)` per the frozen
 * interface contract. Imports scoring primitives from `decision-search-score.mjs`
 * (same directory) and uses B1 `resolveDecision` for HR-1 explicit-ref lookup.
 *
 * Responsibility: apply HR-1..HR-7 in precedence order, determine band, and
 * resolve to one DECISION_COVERAGE_MODES value with explainable reasons.
 * All score arithmetic lives in `decision-search-score.mjs`.
 *
 * Fail-open contract: no input error ever throws. Malformed input → NEEDS_DECISION.
 * Recommend-not-block (HR-6): B2 emits a verdict; B3 gates; humans accept.
 *
 * Zero runtime dependencies. No embeddings, no Math.random, no Date.now.
 */

import { resolveDecision } from './registry/decision.mjs';
import {
  MATCH_POLICY,
  isEligible,
  primaryContextEqual,
  primaryContextTypeEqual,
  scoreMatch,
  candidateComparator,
  coverageModeFromCandidate,
} from './decision-search-score.mjs';

// ---------------------------------------------------------------------------
// Public API — frozen interface contract (B2-T2)
// ---------------------------------------------------------------------------

/**
 * Searches `registry` for existing ADRs that cover the given work `need`,
 * scores candidates, and resolves to ONE coverage mode.
 *
 * Implements HR-1..HR-7 in precedence order (design §7), band thresholds (§4.3),
 * and the LINK/SURFACE/RECOMMEND/SUPERSEDED verdict rules (§4.4/§4.5).
 *
 * @param {object} registry - the parsed decision-registry object
 *   (from `buildDecisionRegistry`).
 * @param {object} need - the B2-T1 need object:
 *   `{ triple: { primaryContext, decisionKind, decisionScope },
 *      objective, work, signals, materialityScore, needVerdict }`.
 * @returns {{
 *   coverageMode: string,
 *   candidates: object[],
 *   topMatch: object|null,
 *   linkTarget: string|null,
 *   relatedHistory: object[],
 *   reasons: string[],
 *   flags: object,
 *   matchScore: number,
 * }}
 */
export function searchDecisions(registry, need) {
  if (!registry || !need) {
    return _needsDecision('Missing registry or need object.', [], {});
  }

  const objective = String((need && need.objective) || '');
  const work = (need && need.work) || {};
  const triple = (need && need.triple) || {};
  const reasons = [];
  const flags = {};

  // -------------------------------------------------------------------------
  // HR-1: Explicit ADR ref in objective → force LINK if eligible (§7 HR-1).
  // -------------------------------------------------------------------------
  const hr1Result = _applyHR1(registry, objective, reasons);
  if (hr1Result !== null) return { ...hr1Result, flags };

  // -------------------------------------------------------------------------
  // Collect eligible candidates — HR-2/HR-3 (§4.1 gate, applied in isEligible).
  // -------------------------------------------------------------------------
  const decisions = Array.isArray(registry.decisions) ? registry.decisions : [];

  // -------------------------------------------------------------------------
  // SUPERSEDED_NOT_GOVERNING: only triple-match candidates are superseded (HR-2).
  // Must be checked BEFORE the eligible-empty short-circuit so a superseded-only
  // registry correctly surfaces SUPERSEDED_NOT_GOVERNING instead of NEEDS_DECISION.
  // -------------------------------------------------------------------------
  const supersededCheck = _checkSupersededOnly(decisions, triple);
  if (supersededCheck) {
    reasons.push('Only triple-matching candidate(s) are superseded → SUPERSEDED_NOT_GOVERNING.');
    return { coverageMode: 'SUPERSEDED_NOT_GOVERNING', candidates: supersededCheck.slice(0, MATCH_POLICY.candidateCap), topMatch: supersededCheck[0] || null, linkTarget: null, relatedHistory: [], reasons, flags, matchScore: 0 };
  }

  const eligible = decisions.filter(isEligible);

  if (eligible.length === 0) {
    reasons.push('No eligible candidates (accepted/legacy) found in registry.');
    return _needsDecision(null, reasons, flags);
  }

  // -------------------------------------------------------------------------
  // Score all eligible candidates (§4.2).
  // -------------------------------------------------------------------------
  const scored = eligible.map((row) => {
    const { score, breakdown } = scoreMatch(work, objective, row, need);
    return { row, score, breakdown };
  });
  scored.sort(candidateComparator);

  // -------------------------------------------------------------------------
  // Top candidate and score (§4.3).
  // -------------------------------------------------------------------------
  const top = scored[0] || null;
  const topScore = top ? top.score : 0;
  reasons.push(`Top candidate: ${top ? top.row.id : 'none'} (score ${topScore}).`);

  // -------------------------------------------------------------------------
  // HR-7: dedup violation — two accepted candidates share exact triple (§7 HR-7).
  // -------------------------------------------------------------------------
  const exactAccepted = scored.filter((c) => c.breakdown.tripleExact != null && c.row.status === 'accepted');
  if (exactAccepted.length >= 2) {
    flags.dedupViolationSuspected = true;
    exactAccepted.sort((a, b) => String(a.row.id).localeCompare(String(b.row.id)));
    reasons.push('HR-7: dedup violation suspected. Linking to lexicographically first accepted id.');
  }

  // -------------------------------------------------------------------------
  // Band resolution (§4.3/§4.4): LINK | SURFACE | RECOMMEND.
  // -------------------------------------------------------------------------
  if (topScore >= MATCH_POLICY.strongThreshold) {
    return _buildLinkResult(scored, top, exactAccepted, flags, reasons, triple);
  }

  if (topScore >= MATCH_POLICY.possibleThreshold) {
    return _buildSurfaceResult(scored, top, topScore, flags, reasons, triple);
  }

  // No qualifying match.
  return _buildRecommendResult(scored, top, topScore, decisions, triple, flags, reasons);
}

// ---------------------------------------------------------------------------
// Internal helpers — sub-steps of the verdict chain
// ---------------------------------------------------------------------------

/**
 * HR-1: explicit ADR ref check. Returns a complete result object or null.
 *
 * @param {object} registry
 * @param {string} objective
 * @param {string[]} reasons
 * @returns {object|null}
 */
function _applyHR1(registry, objective, reasons) {
  const adrRefMatch = /\bADR-(\d{4})\b/.exec(objective);
  if (!adrRefMatch) return null;
  const refId = `ADR-${adrRefMatch[1]}`;
  const refRow = resolveDecision(registry, refId);
  if (!refRow) {
    reasons.push(`HR-1: explicit ref ${refId} not found in registry — continuing scoring.`);
    return null;
  }
  if (refRow.status === 'superseded' || refRow.supersededBy != null) {
    reasons.push(`HR-1: explicit ref ${refId} is superseded → SUPERSEDED_NOT_GOVERNING.`);
    return { coverageMode: 'SUPERSEDED_NOT_GOVERNING', candidates: [{ row: refRow, score: 0, breakdown: {} }], topMatch: { row: refRow, score: 0, breakdown: {} }, linkTarget: null, relatedHistory: [], reasons, matchScore: 0 };
  }
  if (isEligible(refRow)) {
    const mode = coverageModeFromCandidate({ row: refRow });
    reasons.push(`HR-1: explicit ref ${refId} resolved and eligible → LINK (${mode}).`);
    return { coverageMode: mode, candidates: [{ row: refRow, score: 100, breakdown: { hr1Explicit: 100 } }], topMatch: { row: refRow, score: 100, breakdown: { hr1Explicit: 100 } }, linkTarget: refId, relatedHistory: [], reasons, matchScore: 100 };
  }
  reasons.push(`HR-1: explicit ref ${refId} found but not eligible (${refRow.status}) — continuing scoring.`);
  return null;
}

/**
 * Checks whether ALL decisions matching the exact triple are superseded (HR-2).
 * Returns scored-candidate array (for SUPERSEDED_NOT_GOVERNING) or null.
 *
 * @param {object[]} decisions - all registry rows.
 * @param {object} triple - the work triple.
 * @returns {object[]|null}
 */
function _checkSupersededOnly(decisions, triple) {
  const exactTripleAll = decisions.filter((row) => {
    const tc = triple.primaryContext;
    const rc = row.primaryContext;
    return row.decisionKind === triple.decisionKind &&
      row.decisionScope === triple.decisionScope &&
      primaryContextEqual(tc, rc);
  });
  if (exactTripleAll.length > 0 && exactTripleAll.every((r) => r.status === 'superseded' || r.supersededBy != null)) {
    return exactTripleAll.map((r) => ({ row: r, score: 0, breakdown: {} }));
  }
  return null;
}

/**
 * Builds the LINK result for the strong-match band (score >= strongThreshold).
 */
function _buildLinkResult(scored, top, exactAccepted, flags, reasons, _triple) {
  const winner = flags.dedupViolationSuspected && exactAccepted.length >= 2 ? exactAccepted[0] : top;
  const relatedHistory = scored
    .filter((c) => c !== winner && (c.row.format === 'legacy' || c.row.status === 'legacy'))
    .slice(0, MATCH_POLICY.candidateCap);
  const mode = coverageModeFromCandidate(winner);
  reasons.push(`Strong match (>=${MATCH_POLICY.strongThreshold}) → LINK to ${winner.row.id} (${mode}).`);
  for (const [key, val] of Object.entries(winner.breakdown || {})) {
    reasons.push(`  - ${key}: ${val > 0 ? '+' : ''}${val}`);
  }
  return { coverageMode: mode, candidates: scored.slice(0, MATCH_POLICY.candidateCap), topMatch: winner, linkTarget: winner.row.id, relatedHistory, reasons, flags, matchScore: winner.score };
}

/**
 * Builds the SURFACE result for the possible-match band (possibleThreshold..strongThreshold-1).
 */
function _buildSurfaceResult(scored, top, topScore, flags, reasons, triple) {
  if (top.breakdown.tripleExact != null) {
    flags.linkLeaning = true;
    reasons.push(`Possible match with exact triple (score ${topScore}) — link-leaning; recommend human confirm-link.`);
  } else {
    reasons.push(`Possible match (score ${topScore}) — surface candidate; recommend human confirm-link or new ADR.`);
  }
  if (triple.primaryContext && triple.primaryContext.id == null) {
    flags.provisionalContext = true;
    reasons.push('Provisional context (id=null) — triple cannot be exact; match is partial credit only.');
  }
  return { coverageMode: 'NEEDS_DECISION', candidates: scored.slice(0, MATCH_POLICY.candidateCap), topMatch: top, linkTarget: null, relatedHistory: [], reasons, flags, matchScore: topScore };
}

/**
 * Builds the RECOMMEND-new result when top score is below possibleThreshold.
 */
function _buildRecommendResult(scored, top, topScore, decisions, triple, flags, reasons) {
  reasons.push(`No qualifying match (top score ${topScore} < ${MATCH_POLICY.possibleThreshold}) → RECOMMEND new ADR.`);
  const proposalPending = decisions.some((r) =>
    r.status === 'proposed' &&
    r.decisionKind === triple.decisionKind &&
    r.decisionScope === triple.decisionScope &&
    primaryContextTypeEqual(r.primaryContext, triple.primaryContext),
  );
  if (proposalPending) {
    flags.proposalPending = true;
    reasons.push('HR-3 informational: a proposed ADR for the same triple exists (not coverage).');
  }
  if (triple.primaryContext && triple.primaryContext.id == null) {
    flags.provisionalContext = true;
  }
  return { coverageMode: 'NEEDS_DECISION', candidates: scored.slice(0, MATCH_POLICY.candidateCap), topMatch: top || null, linkTarget: null, relatedHistory: [], reasons, flags, matchScore: topScore };
}

/** Fail-open NEEDS_DECISION result. */
function _needsDecision(message, reasons, flags) {
  return { coverageMode: 'NEEDS_DECISION', candidates: [], topMatch: null, linkTarget: null, relatedHistory: [], reasons: message ? [...reasons, message] : [...reasons], flags, matchScore: 0 };
}
