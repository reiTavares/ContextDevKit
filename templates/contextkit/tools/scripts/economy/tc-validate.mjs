/**
 * Task-Compiler: result validator (WF0022 / ADR-0087..0090).
 *
 * Single responsibility: confirm that a cheap-model result is a VALID
 * ADR-0083 Worker Output Envelope. Prose results are rejected immediately.
 * Structural failures are collected via validateEnvelope and returned as
 * reasons so the gate can escalate rather than silently discard.
 *
 * Design invariants:
 *   - PURE BY DEFAULT: validateResult and reobserveClaims perform zero I/O.
 *     Disk reads are only possible when opts.fsCheck is explicitly true.
 *   - WRAPS, NOT REIMPLEMENTS: envelope field checks are fully delegated to
 *     validateEnvelope from output-contract-core; this module only adds
 *     prose-rejection and claim-reobservation concerns.
 *   - SKIPPED-NOT-PASSED: when a claim cannot be verified (no fsCheck, or
 *     file missing), it is marked 'unverified' — never 'passed' by assumption.
 *   - FROZEN-SAFE: accepts frozen envelopes (Object.freeze'd inputs are ok).
 *
 * // consumes: economy/output-contract
 * [task-compiler] [token-economy] [WF0022]
 */
import { existsSync } from 'node:fs';
import { validateEnvelope } from './output-contract-core.mjs';
import { emptyEnvelope }    from './output-contract.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for validation results produced by this module. */
export const TC_VALIDATE_SCHEMA_VERSION = 'cdk-tc-validate/1';

// ---------------------------------------------------------------------------
// Prose detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the raw value is definitely prose (string) or any
 * non-object type — not a candidate for envelope validation.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
function isProse(raw) {
  return typeof raw === 'string' || raw === null || raw === undefined ||
    typeof raw !== 'object' || Array.isArray(raw);
}

// ---------------------------------------------------------------------------
// validateResult
// ---------------------------------------------------------------------------

/**
 * Validates a cheap-model result against the ADR-0083 Worker Output Envelope.
 *
 * If `raw` is a string, null, undefined, or array → immediate prose rejection.
 * If `raw` is an object → delegate to validateEnvelope; collect its errors.
 *
 * @param {unknown} raw       - The raw result to validate (string or object).
 * @param {object}  [opts={}] - Reserved for future extension (e.g. strictMode).
 * @returns {{
 *   valid:            boolean,
 *   envelope:         object | null,
 *   reasons:          string[],
 *   rejectedAsProse:  boolean
 * }}
 */
export function validateResult(raw, opts = {}) {
  void opts; // reserved; not used in Phase 1

  if (isProse(raw)) {
    return {
      valid:           false,
      envelope:        null,
      reasons:         ['result is not an envelope object (prose or non-object received)'],
      rejectedAsProse: true,
    };
  }

  const { valid, errors } = validateEnvelope(raw);

  return {
    valid,
    envelope:        valid ? raw : null,
    reasons:         errors,
    rejectedAsProse: false,
  };
}

// ---------------------------------------------------------------------------
// reobserveClaims
// ---------------------------------------------------------------------------

/**
 * Re-observes declared claims in an envelope by checking whether the files
 * and exports it claims to have changed are plausible.
 *
 * Pure by default (no I/O). When `opts.fsCheck` is explicitly true, uses
 * existsSync to verify that declared changed-file paths exist on disk.
 * Unverifiable claims are marked 'unverified' — never 'passed' by assumption.
 *
 * @param {object} envelope - A validated WorkerOutputEnvelope.
 * @param {{
 *   fsCheck?: boolean,
 *   root?:    string
 * }} [opts={}]
 * @returns {{
 *   observable:   Array<{ claim: string, status: 'verified' | 'unverified', note: string }>,
 *   unverified:   string[],
 *   advisoryOnly: boolean
 * }}
 */
export function reobserveClaims(envelope, opts = {}) {
  const fsCheck = opts?.fsCheck === true;
  const root    = (typeof opts?.root === 'string' && opts.root) ? opts.root : '';

  const observable = [];
  const unverified = [];

  const changedFiles = Array.isArray(envelope?.changed)
    ? envelope.changed.map(c => (typeof c?.path === 'string' ? c.path : null)).filter(Boolean)
    : [];

  for (const filePath of changedFiles) {
    const claim = `changed: ${filePath}`;

    if (!fsCheck) {
      observable.push({ claim, status: 'unverified', note: 'fsCheck disabled — no disk read' });
      unverified.push(claim);
      continue;
    }

    const absolutePath = root ? `${root}/${filePath}` : filePath;
    const exists = existsSync(absolutePath);

    if (exists) {
      observable.push({ claim, status: 'verified', note: 'file exists on disk' });
    } else {
      observable.push({ claim, status: 'unverified', note: 'file not found on disk' });
      unverified.push(claim);
    }
  }

  return {
    observable,
    unverified,
    advisoryOnly: true, // claim re-observation is always advisory; never blocking
  };
}

// ---------------------------------------------------------------------------
// presentValidation
// ---------------------------------------------------------------------------

/**
 * Renders a validateResult result as a human-readable string.
 *
 * @param {{
 *   valid:            boolean,
 *   envelope:         object | null,
 *   reasons:          string[],
 *   rejectedAsProse:  boolean
 * }} result
 * @returns {string}
 */
export function presentValidation(result) {
  if (!result || typeof result !== 'object') {
    return `tc-validate [${TC_VALIDATE_SCHEMA_VERSION}]: invalid result object`;
  }

  const header = `tc-validate [${TC_VALIDATE_SCHEMA_VERSION}]`;
  const verdict = result.valid ? 'VALID' : 'INVALID';
  const proseTag = result.rejectedAsProse ? ' (rejected as prose)' : '';

  const lines = [
    `${header}: ${verdict}${proseTag}`,
  ];

  if (!result.valid && result.reasons?.length > 0) {
    lines.push('  reasons:');
    for (const reason of result.reasons) {
      lines.push(`    - ${reason}`);
    }
  }

  if (result.valid && result.envelope) {
    lines.push(`  status  : ${result.envelope.status ?? '(none)'}`);
    lines.push(`  version : ${result.envelope.version ?? '(none)'}`);
    lines.push(`  artifact: ${result.envelope.artifact || '(empty)'}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Convenience re-export for callers that want emptyEnvelope without a second
// import (reduces per-file import surface for the gate layer).
// ---------------------------------------------------------------------------
export { emptyEnvelope };
