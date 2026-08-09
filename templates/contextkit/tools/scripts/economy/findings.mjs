/**
 * findings.mjs — Canonical finding schema, validation, fingerprinting, and
 * severity utilities for Economy Runtime (WF0020, CDK-255 ECON-02).
 *
 * WHY this is its own module: the finding schema is a shared protocol —
 * consumed by the merge pipeline, the CI gate, the FinOps team, and future
 * attribution consumers. Keeping validation + fingerprinting here (rather than
 * inline in findings-merge.mjs) lets each consumer import a single authority
 * without pulling in merge logic.
 *
 * Canonical finding schema (this card OWNS it):
 *   {
 *     id         : string              — caller-assigned identifier
 *     severity   : 'critical'|'high'|'medium'|'low'
 *     path       : string              — file path (may be empty for project-wide)
 *     line       : number|null         — 1-based line number; null = file-level
 *     claim      : string              — human-readable description of the finding
 *     evidence   : string              — REQUIRED for critical/high: verbatim
 *                                        snippet + "path:line" reference
 *     action     : string              — suggested remediation
 *     confidence : number              — 0.0–1.0 confidence score
 *     status     : 'open'|'skipped'
 *     agent      : string              — producing agent id (join key for ledger)
 *   }
 *
 * Evidence-required invariant: critical and high findings MUST carry non-empty
 * `evidence`. A finding without evidence at those severities is invalid and
 * must not enter the merge pipeline.
 *
 * Zero runtime dependencies — node:crypto only (built-in).
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Ordered severity tiers from most to least critical.
 * Used for sorting within the merge output (higher severity first).
 * @type {readonly string[]}
 */
export const SEVERITY_ORDER = Object.freeze(['critical', 'high', 'medium', 'low']);

/** @type {ReadonlySet<string>} */
const VALID_SEVERITIES = new Set(SEVERITY_ORDER);

/** @type {ReadonlySet<string>} */
const VALID_STATUSES = new Set(['open', 'skipped']);

// ---------------------------------------------------------------------------
// evidenceRequired
// ---------------------------------------------------------------------------

/**
 * Returns true when the given severity tier requires non-empty evidence.
 * Critical and high findings must carry verbatim evidence (snippet + path:line)
 * to satisfy the evidence-preservation invariant.
 *
 * @param {string} severity
 * @returns {boolean}
 */
export function evidenceRequired(severity) {
  return severity === 'critical' || severity === 'high';
}

// ---------------------------------------------------------------------------
// validateFinding
// ---------------------------------------------------------------------------

/**
 * Validates a single finding against the canonical schema.
 * Fail-open: returns errors as strings rather than throwing, so the caller
 * decides whether to reject or log-and-skip.
 *
 * @param {unknown} finding - The object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateFinding(finding) {
  const errors = [];

  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    return { valid: false, errors: ['finding must be a non-null object'] };
  }

  const f = /** @type {Record<string, unknown>} */ (finding);

  // id
  if (typeof f.id !== 'string' || f.id.trim() === '') {
    errors.push('id must be a non-empty string');
  }

  // severity
  if (!VALID_SEVERITIES.has(/** @type {string} */ (f.severity))) {
    errors.push(`severity must be one of: ${SEVERITY_ORDER.join(', ')}`);
  }

  // path — allow empty string (project-wide finding)
  if (typeof f.path !== 'string') {
    errors.push('path must be a string');
  }

  // line — null or non-negative integer
  if (f.line !== null && f.line !== undefined) {
    if (typeof f.line !== 'number' || !Number.isInteger(f.line) || f.line < 1) {
      errors.push('line must be null or a positive integer');
    }
  }

  // claim
  if (typeof f.claim !== 'string' || f.claim.trim() === '') {
    errors.push('claim must be a non-empty string');
  }

  // evidence — required for critical/high
  const severityIsValid = VALID_SEVERITIES.has(/** @type {string} */ (f.severity));
  if (severityIsValid && evidenceRequired(/** @type {string} */ (f.severity))) {
    if (typeof f.evidence !== 'string' || f.evidence.trim() === '') {
      errors.push(`evidence is required and must be non-empty for severity '${f.severity}'`);
    }
  }

  // action
  if (typeof f.action !== 'string') {
    errors.push('action must be a string');
  }

  // confidence
  if (
    typeof f.confidence !== 'number' ||
    !isFinite(f.confidence) ||
    f.confidence < 0 ||
    f.confidence > 1
  ) {
    errors.push('confidence must be a number between 0.0 and 1.0');
  }

  // status
  if (!VALID_STATUSES.has(/** @type {string} */ (f.status))) {
    errors.push(`status must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }

  // agent
  if (typeof f.agent !== 'string' || f.agent.trim() === '') {
    errors.push('agent must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// fingerprintFinding
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic SHA-256 fingerprint for deduplication across agents.
 *
 * The fingerprint is a function of: severity + normalized path + line +
 * normalized claim. "Normalized" means: trim, lowercase, collapse all
 * whitespace runs to a single space. This catches same-finding reports from
 * different agents even when they use slightly different casing or spacing.
 *
 * NOT included in fingerprint: id, evidence, action, confidence, status, agent.
 * Those fields may legitimately differ between duplicates; the fingerprint
 * identifies the *defect location*, not the *report metadata*.
 *
 * @param {{ severity?: unknown, path?: unknown, line?: unknown, claim?: unknown }} finding
 * @returns {string} Lowercase hex SHA-256 digest (64 chars)
 */
export function fingerprintFinding(finding) {
  const norm = (s) =>
    String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  const linePart = (finding?.line != null) ? String(finding.line) : 'null';

  const input = [
    norm(finding?.severity),
    norm(finding?.path),
    linePart,
    norm(finding?.claim),
  ].join('\x00'); // NUL delimiter — cannot appear in normalized strings

  return createHash('sha256').update(input, 'utf8').digest('hex');
}
