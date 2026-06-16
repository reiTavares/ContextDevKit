/**
 * output-contract-core.mjs — Pure validators and the evidence-preservation
 * invariant for Economy Runtime output contracts (WF0020, ADR-0082).
 *
 * WHY split from output-contract.mjs: the two heaviest concerns —
 * validateEnvelope and applyFindingCaps — would push the parent file past
 * the 308-line constitution ceiling (§1 +10% tolerance) if kept inline.
 * Both functions are purely functional (no I/O, no side effects) and have
 * independent consumers, making this the correct cohesion seam.
 *
 * Evidence-preservation invariant (critical design rule):
 *   Findings of severity 'critical' or 'high' are NEVER subject to a cap.
 *   Findings with status 'skipped' ALWAYS survive (they are already
 *   suppressed evidence; removing them would compound the loss).
 *   Medium and low findings beyond their cap are DEFERRED (moved to a
 *   separate bucket), never deleted. Counts always reflect TRUE totals.
 *   This caps PROSE volume, not evidence.
 *
 * Zero runtime dependencies — node:* only.
 */

// ---------------------------------------------------------------------------
// Envelope shape validation
// ---------------------------------------------------------------------------

/** Allowed status values for a WorkerOutputEnvelope. */
const VALID_STATUSES = new Set(['ok', 'blocked', 'failed', 'skipped']);

/** Allowed severity values on a finding object. */
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

/** Allowed status values on a finding object. */
const VALID_FINDING_STATUSES = new Set(['open', 'skipped']);

/**
 * Validates a WorkerOutputEnvelope object for structural correctness.
 *
 * Fail-open by design: returns errors as strings rather than throwing.
 * The caller (econCheckContract) decides whether to treat errors as blocking.
 *
 * @param {unknown} obj - The object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEnvelope(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['envelope must be a non-null object'] };
  }

  // version
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
    errors.push('version must be an integer');
  }

  // status
  if (!VALID_STATUSES.has(obj.status)) {
    errors.push(`status must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }

  // changed
  if (!Array.isArray(obj.changed)) {
    errors.push('changed must be an array');
  } else {
    for (let i = 0; i < obj.changed.length; i++) {
      const entry = obj.changed[i];
      if (!entry || typeof entry !== 'object') {
        errors.push(`changed[${i}] must be an object`);
      } else {
        if (typeof entry.path !== 'string') errors.push(`changed[${i}].path must be a string`);
        if (typeof entry.why !== 'string')  errors.push(`changed[${i}].why must be a string`);
      }
    }
  }

  // verification
  if (!obj.verification || typeof obj.verification !== 'object') {
    errors.push('verification must be an object');
  } else {
    if (typeof obj.verification.command !== 'string') {
      errors.push('verification.command must be a string');
    }
    if (typeof obj.verification.exitCode !== 'number') {
      errors.push('verification.exitCode must be a number');
    }
  }

  // blockers
  if (!Array.isArray(obj.blockers)) {
    errors.push('blockers must be an array');
  } else if (obj.blockers.some(b => typeof b !== 'string')) {
    errors.push('all blockers entries must be strings');
  }

  // findings
  if (!Array.isArray(obj.findings)) {
    errors.push('findings must be an array');
  } else {
    for (let i = 0; i < obj.findings.length; i++) {
      const f = obj.findings[i];
      if (!f || typeof f !== 'object') {
        errors.push(`findings[${i}] must be an object`);
      } else {
        if (!VALID_SEVERITIES.has(f.severity)) {
          errors.push(`findings[${i}].severity must be one of: ${[...VALID_SEVERITIES].join(', ')}`);
        }
        if (!VALID_FINDING_STATUSES.has(f.status)) {
          errors.push(`findings[${i}].status must be one of: ${[...VALID_FINDING_STATUSES].join(', ')}`);
        }
      }
    }
  }

  // artifact
  if (typeof obj.artifact !== 'string') {
    errors.push('artifact must be a string');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Finding caps — the evidence-preservation invariant
// ---------------------------------------------------------------------------

/**
 * Applies per-severity finding caps according to the evidence-preservation
 * invariant. Medium/low findings beyond their cap are deferred, never deleted.
 * Critical/high findings are never capped. Skipped findings always survive.
 *
 * @param {Array<{ severity: string, status: string, [key: string]: unknown }>} findings
 * @param {{ maxFindings: { critical: number|null, high: number|null, medium: number|null, low: number|null } }} contract
 * @returns {{
 *   kept: object[],
 *   deferred: object[],
 *   counts: {
 *     total: number,
 *     bySeverity: Record<string, number>,
 *     keptCount: number,
 *     deferredCount: number
 *   }
 * }}
 */
export function applyFindingCaps(findings, contract) {
  const safeFindings = Array.isArray(findings) ? findings : [];
  const caps = contract?.maxFindings ?? {};

  // Per-severity seen counts for advisory-cap enforcement (excludes always-kept).
  const advisorySeen = { medium: 0, low: 0 };

  const kept = [];
  const deferred = [];

  // True total counts by severity (never filtered — evidence invariant).
  const bySeverity = {};

  for (const finding of safeFindings) {
    const sev = finding?.severity;
    if (typeof sev === 'string') {
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }

    const isSkipped = finding?.status === 'skipped';

    // Critical and high are ALWAYS kept (never capped, never deferred).
    if (sev === 'critical' || sev === 'high') {
      kept.push(finding);
      continue;
    }

    // Skipped findings ALWAYS survive regardless of severity.
    if (isSkipped) {
      kept.push(finding);
      continue;
    }

    // Advisory severity tiers (medium, low): apply caps.
    if (sev === 'medium' || sev === 'low') {
      const cap = caps[sev];
      // null cap means uncapped — keep everything.
      if (cap === null || cap === undefined) {
        kept.push(finding);
      } else {
        advisorySeen[sev] += 1;
        if (advisorySeen[sev] <= cap) {
          kept.push(finding);
        } else {
          deferred.push(finding);
        }
      }
      continue;
    }

    // Unknown severity — keep (fail-open: don't silently discard).
    kept.push(finding);
  }

  const total = safeFindings.length;
  const keptCount = kept.length;
  const deferredCount = deferred.length;

  return {
    kept,
    deferred,
    counts: { total, bySeverity, keptCount, deferredCount },
  };
}
