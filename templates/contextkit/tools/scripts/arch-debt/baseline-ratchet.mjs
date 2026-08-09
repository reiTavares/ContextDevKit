/**
 * Architecture-debt gate — the BASELINE & RATCHET classifier (WF-0057 W3,
 * ADR-0122). This is the mechanism that makes the gate evaluate the DELTA
 * (changed work) rather than the absolute debt total, so unchanged legacy debt
 * never blocks unrelated work and repayment is measured as positive evidence.
 *
 * Spec: W0-contracts.md §6.2 + spec.md §25 (baseline/ratchet) + §26 (positive
 * evidence). It imports the ONE finding contract from `finding.mjs`
 * (`BaselineClass`, `baselineDisposition`, `makeFinding`) — no second shape.
 *
 * Pure by contract: callers inject `current`, `baseline`, and the `changedSet`;
 * this module touches no filesystem and no git. Zero runtime deps, ESM,
 * `node:`/relative imports only (immutable rule #1). Fail-soft on malformed
 * input (defensive I/O, immutable rule #2) — a missing baseline classifies
 * everything as INTRODUCED, never crashes the gate.
 */

import { BaselineClass, baselineDisposition } from './finding.mjs';

/**
 * Severity-ish ordering used to decide WORSENED vs PRE_EXISTING when the same
 * key recurs. Higher status = worse. Absent statuses sort as 0 so an unknown
 * status never silently registers as "improved".
 */
const STATUS_WEIGHT = Object.freeze({
  PASS: 0, OBSERVATION: 1, SKIPPED: 1, UNKNOWN: 2, WARNING: 3, VIOLATION: 4,
});

const weightOf = (finding) => STATUS_WEIGHT[finding && finding.status] ?? 1;

/**
 * Stable IDENTITY key for matching a finding across baseline ↔ current. A finding
 * is "the same debt" when its rule, file, and (when present) SYMBOL anchor agree.
 *
 * Crucially `line` is NOT part of identity — it is the *measure* that feeds
 * WORSENED detection (a file growing from 600→900 lines is the same finding that
 * got worse, not a brand-new one). Anchoring identity on line would make every
 * line shift read as a new INTRODUCED finding (the §34.16 trap). When a finding
 * has no symbol it is file-level, keyed on `ruleId::path` alone.
 *
 * Path is normalised to forward slashes (immutable rule #4 — config paths are
 * forward-slash, and baselines may be authored on either OS).
 *
 * @param {Object} finding  a Finding (or partial with ruleId/path).
 * @returns {string} the stable identity key.
 */
export function stableKey(finding) {
  if (!finding || typeof finding !== 'object') return 'unknown::unknown';
  const path = typeof finding.path === 'string' ? finding.path.replaceAll('\\', '/') : 'unknown';
  const ruleId = typeof finding.ruleId === 'string' ? finding.ruleId : 'unknown';
  return finding.symbol ? `${ruleId}::${path}::${finding.symbol}` : `${ruleId}::${path}`;
}

/** Rule+symbol identity, ignoring path — used to detect a TRANSFERRED (moved) finding. */
const moveKey = (finding) => {
  if (!finding || typeof finding !== 'object') return null;
  const ruleId = typeof finding.ruleId === 'string' ? finding.ruleId : 'unknown';
  const symbol = finding.symbol;
  // Only a finding with a real symbol anchor can be tracked across a move;
  // a bare file-level finding that "moved" is indistinguishable from a new one.
  return symbol ? `${ruleId}::${symbol}` : null;
};

/** Normalise a changed-set (array | Set | undefined) into a Set of forward-slash paths. */
const toChangedSet = (changedSet) => {
  const out = new Set();
  if (!changedSet) return out;
  const items = changedSet instanceof Set ? [...changedSet] : Array.isArray(changedSet) ? changedSet : [];
  for (const raw of items) {
    if (typeof raw === 'string') out.add(raw.replaceAll('\\', '/'));
  }
  return out;
};

const normPath = (path) => (typeof path === 'string' ? path.replaceAll('\\', '/') : '');

/**
 * Classify each CURRENT finding against the BASELINE set, assigning a
 * `BaselineClass` delta (§25). Pure: no FS/git. Also synthesises REDUCED/PAID
 * entries for baseline findings that have DISAPPEARED in the current set (so
 * repayment is visible to `positiveEvidence`, §26).
 *
 * Matching ladder per current finding (by `stableKey`):
 *   - no baseline match → INTRODUCED (new); unless it moved → TRANSFERRED.
 *   - baseline match, same-or-better status → PRE_EXISTING / UNCHANGED.
 *   - baseline match, worse status → WORSENED.
 * Baseline findings absent from current → REDUCED (improved) / PAID (file gone).
 *
 * @param {Object[]} current   the Finding[] from analysing the proposed/result tree.
 * @param {Object[]} baseline  the Finding[] recorded for the pre-change tree.
 * @returns {{ delta: string, finding: Object }[]} every current finding plus
 *   synthesised repayment entries, each tagged with its BaselineClass delta.
 */
export function classifyAgainstBaseline(current, baseline) {
  const currentList = Array.isArray(current) ? current.filter(Boolean) : [];
  const baselineList = Array.isArray(baseline) ? baseline.filter(Boolean) : [];

  const baselineByKey = new Map(baselineList.map((f) => [stableKey(f), f]));
  const baselineByMove = new Map();
  for (const f of baselineList) {
    const mk = moveKey(f);
    if (mk) baselineByMove.set(mk, f);
  }
  const matchedBaselineKeys = new Set();

  const classified = currentList.map((finding) => {
    const key = stableKey(finding);
    const prior = baselineByKey.get(key);
    if (prior) {
      matchedBaselineKeys.add(key);
      const delta = weightOf(finding) > weightOf(prior)
        ? BaselineClass.WORSENED
        : BaselineClass.PRE_EXISTING;
      return { delta, finding };
    }
    // No same-key match. Did this finding MOVE (same rule+symbol, new path)?
    const mk = moveKey(finding);
    const moved = mk ? baselineByMove.get(mk) : null;
    if (moved && normPath(moved.path) !== normPath(finding.path)) {
      matchedBaselineKeys.add(stableKey(moved));
      return { delta: BaselineClass.TRANSFERRED, finding };
    }
    return { delta: BaselineClass.INTRODUCED, finding };
  });

  // Baseline findings the current set no longer reports → repayment evidence.
  for (const prior of baselineList) {
    if (matchedBaselineKeys.has(stableKey(prior))) continue;
    // PAID when the whole file is gone from the analysis; REDUCED otherwise.
    const fileStillAnalysed = currentList.some((f) => normPath(f.path) === normPath(prior.path));
    classified.push({
      delta: fileStillAnalysed ? BaselineClass.REDUCED : BaselineClass.PAID,
      finding: prior,
    });
  }
  return classified;
}

/**
 * The default ratchet policy (§25). Annotates each classified entry with its
 * `deltaFromBaseline` + a `disposition` (REPORT/BLOCK/REVIEW/POSITIVE/ANALYZE)
 * via the shared `baselineDisposition`. Scope is honoured: a finding on a file
 * outside `changedSet` is forced to a non-blocking disposition — unchanged
 * legacy debt can RAISE (REPORT) but never BLOCK unrelated work (§25, test
 * §34.15). A floor breach is scope-independent and stays whatever the caller's
 * acceptability says (security/data-integrity floors are evaluated upstream).
 *
 * @param {{delta:string, finding:Object}[]} classified  output of classifyAgainstBaseline.
 * @param {Object} [policy]  optional overrides.
 * @param {(finding:Object)=>boolean} [policy.acceptable]  is the finding within
 *   policy (no floor breach, dimension-satisfied)? Defaults to: anything that is
 *   not a VIOLATION is acceptable.
 * @param {Array|Set} [policy.changedSet]  the changed file paths; out-of-scope
 *   findings are demoted away from BLOCK/REVIEW (kept as REPORT).
 * @returns {{delta:string, disposition:string, inScope:boolean, finding:Object}[]}
 */
export function applyRatchet(classified, policy = {}) {
  const entries = Array.isArray(classified) ? classified.filter(Boolean) : [];
  const changed = toChangedSet(policy.changedSet);
  const scopeActive = changed.size > 0;
  const isAcceptable = typeof policy.acceptable === 'function'
    ? policy.acceptable
    : (finding) => !finding || finding.status !== 'VIOLATION';

  return entries.map(({ delta, finding }) => {
    const inScope = !scopeActive || changed.has(normPath(finding && finding.path));
    let disposition = baselineDisposition(delta, isAcceptable(finding));
    // Scope guard: a finding outside the changed set must not block unrelated
    // work. Demote BLOCK/REVIEW → REPORT; POSITIVE/ANALYZE/REPORT are untouched.
    if (!inScope && (disposition === 'BLOCK' || disposition === 'REVIEW')) {
      disposition = 'REPORT';
    }
    const annotated = finding && typeof finding === 'object'
      ? { ...finding, deltaFromBaseline: delta }
      : finding;
    return { delta, disposition, inScope, finding: annotated };
  });
}

/**
 * Extract the repayment evidence (§26) — the REDUCED/PAID improvements that prove
 * the gate measures repayment, not only accumulation. A cycle removed, a boundary
 * restored, a wrapper deleted all surface here as positive evidence.
 *
 * @param {{delta:string, finding:Object}[]} classified  output of classifyAgainstBaseline.
 * @returns {{delta:string, ruleId:string, path:(string|undefined), message:(string|undefined)}[]}
 *   one entry per repaid finding (empty array when nothing was repaid).
 */
export function positiveEvidence(classified) {
  const entries = Array.isArray(classified) ? classified.filter(Boolean) : [];
  return entries
    .filter(({ delta }) => delta === BaselineClass.REDUCED || delta === BaselineClass.PAID)
    .map(({ delta, finding }) => ({
      delta,
      ruleId: finding && finding.ruleId,
      path: finding && finding.path,
      message: finding && finding.message,
    }));
}

/**
 * Scope helper (§25) — limit a finding list to those touching the changed set.
 * Pure convenience for callers that want to pre-filter before classification.
 * A finding with no path, or an empty changed set, is treated as IN scope (the
 * caller asked for no scoping) — fail-open to REPORT, never fail-closed to a
 * false negative (constitution §8).
 *
 * @param {Object[]} findings    the Finding[] to scope.
 * @param {Array|Set} changedSet the changed file paths.
 * @returns {Object[]} the in-scope subset.
 */
export function scopeToChanged(findings, changedSet) {
  const list = Array.isArray(findings) ? findings.filter(Boolean) : [];
  const changed = toChangedSet(changedSet);
  if (changed.size === 0) return list;
  return list.filter((finding) => changed.has(normPath(finding && finding.path)));
}
