/**
 * code-intent.mjs — the Code Mutation Intent Score (CMIS) scorer (ADR-0128 §5).
 *
 * Answers the deterministic question ContextDevKit could not yet answer: "will
 * this request create or change code?". Pure: weights, bands and the hard trigger
 * are INJECTED (the `policy` argument) — never embedded (ADR-0129 §4). The caller
 * loads the table via policy-load and may reuse it across requests.
 *
 * Two-part rule:
 *   1. Class-A hard trigger — a real write attempt on a code path is
 *      authoritative: CMIS=100, closing textual false negatives (ADR-0128 §5).
 *   2. Class-B weighted score — Σ(matched positive + negative signal weights),
 *      clamped to [0,100], resolved to a verdict band.
 *
 * Fail-open: a missing/malformed policy returns a DEGRADED verdict with a receipt
 * reason code, never a false pass (constitution §8). Zero runtime dependencies.
 *
 * @module domain-engineering/code-intent
 */
import { hasAnyToken } from './signals.mjs';

/** Verdict returned when the policy table is unavailable (honest degrade). */
const DEGRADED_VERDICT = Object.freeze({ verdict: 'UNCERTAIN', floorReason: 'ENVELOPE_DEGRADED' });

/**
 * Scores code-mutation intent for a normalized signal object.
 *
 * @param {object} signals from buildSignals().
 * @param {object} policy the code-intent-weights table (+ optional hardTriggers).
 * @returns {{ score: number, verdict: string, reasonCodes: string[],
 *   matched: string[], degraded: boolean }}
 */
export function scoreCodeMutationIntent(signals, policy) {
  const safe = signals && typeof signals === 'object' ? signals : {};
  if (!policy || !Array.isArray(policy.bands) || !policy.positiveSignals) {
    return { score: 0, verdict: DEGRADED_VERDICT.verdict, reasonCodes: ['ENVELOPE_DEGRADED'], matched: [], degraded: true };
  }

  // 1. Class-A authoritative hard trigger — a real write attempt wins outright.
  if (safe.writeAttempt) {
    const trigger = policy.hardTrigger || { score: 100, verdict: 'CODE_CREATION_OR_STRUCTURAL_CHANGE', reasonCode: 'CMIS_HARD_TRIGGER_WRITE_ATTEMPT' };
    return {
      score: clamp(trigger.score ?? 100),
      verdict: trigger.verdict ?? 'CODE_CREATION_OR_STRUCTURAL_CHANGE',
      reasonCodes: [trigger.reasonCode ?? 'CMIS_HARD_TRIGGER_WRITE_ATTEMPT'],
      matched: ['writeAttempt'],
      degraded: false,
    };
  }

  // 2. Class-B weighted score over matched signals.
  const haystack = String(safe.text ?? '');
  const pathsBlob = Array.isArray(safe.paths) ? safe.paths.join(' ').toLowerCase() : '';
  const matched = [];
  let score = 0;
  for (const [name, signal] of Object.entries(policy.positiveSignals)) {
    if (signalFires(name, signal, haystack, pathsBlob)) { score += signal.weight; matched.push(name); }
  }
  for (const [name, signal] of Object.entries(policy.negativeSignals || {})) {
    if (hasAnyToken(haystack, signal.tokens)) { score += signal.weight; matched.push(name); }
  }
  score = clamp(score);
  const verdict = resolveVerdict(score, policy.bands);
  return { score, verdict, reasonCodes: [verdictReasonCode(verdict)], matched, degraded: false };
}

/**
 * A positive signal fires when its tokens appear in the request text. The
 * `sourcePathOrExtension` signal additionally consults the affected-paths blob
 * so path evidence never leaks into the text-only signals (avoids e.g. a path
 * `src/explainer.mjs` triggering the "explanation" negative signal).
 */
function signalFires(name, signal, haystack, pathsBlob) {
  if (hasAnyToken(haystack, signal.tokens)) return true;
  if (name === 'sourcePathOrExtension' && pathsBlob) return hasAnyToken(pathsBlob, signal.tokens);
  return false;
}

/** Resolves the verdict band for a clamped score. */
function resolveVerdict(score, bands) {
  for (const band of bands) {
    if (score <= band.max) return band.verdict;
  }
  return bands[bands.length - 1].verdict;
}

/** Maps a verdict to its stable reason code. */
function verdictReasonCode(verdict) {
  const map = {
    NO_CODE: 'CMIS_VERDICT_NO_CODE',
    UNCERTAIN: 'CMIS_VERDICT_UNCERTAIN',
    CODE_MODIFICATION: 'CMIS_VERDICT_CODE_MODIFICATION',
    CODE_CREATION_OR_STRUCTURAL_CHANGE: 'CMIS_VERDICT_CODE_CREATION',
  };
  return map[verdict] || 'CMIS_VERDICT_UNCERTAIN';
}

/** Clamps a number into [0,100]; non-numbers ⇒ 0. */
function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
