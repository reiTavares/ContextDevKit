/**
 * Architecture-debt gate — the human REPORT renderer (WF-0057 W4, ADR-0122).
 *
 * Render-ONLY: turns the policy `GateOutcome` + bucketed findings + positive
 * evidence into a concise, deterministic text report. It owns NO verdict logic
 * and NO I/O — the engine hands it the already-decided result and prints what it
 * returns. Split from the composition root so the engine stays a thin orchestrator
 * under the §1 line budget (cohesive seam: verdict vs presentation).
 *
 * The report leads with the single whole-gate verdict (the one CI consumes),
 * then the blocking / review / advisory buckets, then the positive (repayment)
 * evidence so a clean run still SHOWS the protections that passed (§26) — a gate
 * that only ever shouts about failures teaches people to ignore it.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

import { isApproval } from './finding.mjs';

/** One-line location string for a finding (path + optional line). */
const loc = (f) => `${f && f.path}${f && f.line ? `:${f.line}` : ''}`;

/** Render one finding as a single report bullet (machine-stable reason codes kept). */
function renderFinding(finding) {
  const codes = Array.isArray(finding.reasonCodes) && finding.reasonCodes.length > 0
    ? ` [${finding.reasonCodes.join(', ')}]`
    : '';
  return `  - ${loc(finding)} — ${finding.ruleId}: ${finding.message || ''}${codes}`.trimEnd();
}

/** Render a labelled bucket section, or nothing when the bucket is empty. */
function renderBucket(title, findings) {
  const list = Array.isArray(findings) ? findings : [];
  if (list.length === 0) return [];
  return [`${title} (${list.length}):`, ...list.map(renderFinding), ''];
}

/** Render the positive (repayment) evidence section, or nothing when none. */
function renderPositive(positive) {
  const list = Array.isArray(positive) ? positive : [];
  if (list.length === 0) return [];
  return [
    `Positive evidence — debt repaid (${list.length}):`,
    ...list.map((p) => `  - ${p.path || '(module)'} — ${p.ruleId}: ${p.delta}`),
    '',
  ];
}

/**
 * Render the whole-gate report. Pure — same input, same string.
 *
 * @param {Object} result
 * @param {string} result.outcome      the single GateOutcome (§23).
 * @param {Object[]} [result.blocking]  blocking VIOLATION findings.
 * @param {Object[]} [result.review]    review-required findings.
 * @param {Object[]} [result.advisory]  advisory/observation findings.
 * @param {Object[]} [result.positive]  repayment evidence entries (§26).
 * @param {string[]} [result.reasons]   machine-stable policy reason codes.
 * @param {string[]} [result.skipped]   fitness ids skipped (DISABLED / no config).
 * @param {number}  [result.fileCount]  files analysed (context line).
 * @returns {string} the report text (newline-terminated).
 */
export function renderReport(result = {}) {
  const outcome = result.outcome || 'UNKNOWN';
  const verdict = isApproval(outcome) ? 'PASS' : 'NON-PASSING';
  const out = [
    'Architecture & Technical-Debt Gate',
    '==================================',
    `Verdict: ${outcome} (${verdict})`,
    `Files analysed: ${typeof result.fileCount === 'number' ? result.fileCount : 'n/a'}`,
    '',
  ];
  out.push(...renderBucket('BLOCKING', result.blocking));
  out.push(...renderBucket('REVIEW REQUIRED', result.review));
  out.push(...renderBucket('ADVISORY / OBSERVATION', result.advisory));
  out.push(...renderPositive(result.positive));

  if (Array.isArray(result.skipped) && result.skipped.length > 0) {
    out.push(`Skipped (no config / disabled): ${result.skipped.join(', ')}`, '');
  }
  if (Array.isArray(result.reasons) && result.reasons.length > 0) {
    out.push(`Reasons: ${result.reasons.join(' · ')}`);
  }
  // A clean gate still prints something reassuring.
  if (isApproval(outcome)
      && (result.blocking || []).length === 0
      && (result.review || []).length === 0) {
    out.push('No blocking or review findings. Architecture protections satisfied.');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
