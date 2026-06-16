/**
 * findings-merge-core.mjs — Pure dedup + sort logic for the findings merge
 * pipeline (WF0020, CDK-255 ECON-02).
 *
 * WHY split from findings-merge.mjs: the merge/dedup pass is the heaviest
 * concern and would push findings-merge.mjs past the 308-line constitution
 * ceiling when combined with the digest build and CLI entry point. This module
 * is purely functional (no I/O, no side effects) and has a single
 * responsibility: given N validated finding arrays, produce a deduplicated,
 * sorted artifact array.
 *
 * Dedup rule (fingerprint collision):
 *   When two findings share a fingerprint (same severity + path + line + claim),
 *   we keep the one with the HIGHER confidence score. On a tie, we keep the
 *   first-seen entry (stable, deterministic).
 *
 * Sort order:
 *   1. Severity — SEVERITY_ORDER index ascending (critical first)
 *   2. Path     — lexicographic ascending
 *   3. Line     — numeric ascending (null sorts last)
 *
 * Zero runtime dependencies — node:* only.
 */

import { fingerprintFinding, SEVERITY_ORDER } from './findings.mjs';

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/**
 * Deduplicates findings from multiple arrays by fingerprint.
 * On collision, the entry with the higher `confidence` score wins; ties keep
 * the first-seen entry.
 *
 * @param {Array<object[]>} findingArrays - Array of finding arrays from N agents
 * @returns {object[]} Flat, deduplicated finding array (order undefined — call sortFindings next)
 */
export function deduplicateFindings(findingArrays) {
  /** @type {Map<string, { finding: object, confidence: number }>} */
  const byFingerprint = new Map();

  for (const arr of findingArrays) {
    if (!Array.isArray(arr)) continue;
    for (const finding of arr) {
      if (!finding || typeof finding !== 'object') continue;
      const fp = fingerprintFinding(finding);
      const existing = byFingerprint.get(fp);
      const incomingConfidence = typeof finding.confidence === 'number' ? finding.confidence : 0;

      if (!existing) {
        byFingerprint.set(fp, { finding, confidence: incomingConfidence });
      } else if (incomingConfidence > existing.confidence) {
        // Higher confidence wins — replace.
        byFingerprint.set(fp, { finding, confidence: incomingConfidence });
      }
      // Equal or lower confidence: keep first-seen (no-op).
    }
  }

  return Array.from(byFingerprint.values()).map((entry) => entry.finding);
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

/** @type {Map<string, number>} Pre-built severity rank lookup for O(1) sort comparisons. */
const SEVERITY_RANK = new Map(SEVERITY_ORDER.map((sev, idx) => [sev, idx]));

/**
 * Sorts a finding array by severity (critical first) → path → line.
 * Non-destructive: returns a new array.
 *
 * @param {object[]} findings
 * @returns {object[]}
 */
export function sortFindings(findings) {
  return findings.slice().sort((a, b) => {
    // 1. Severity rank (lower index = higher priority).
    const rankA = SEVERITY_RANK.get(a?.severity) ?? SEVERITY_ORDER.length;
    const rankB = SEVERITY_RANK.get(b?.severity) ?? SEVERITY_ORDER.length;
    if (rankA !== rankB) return rankA - rankB;

    // 2. Path lexicographic.
    const pathA = String(a?.path ?? '');
    const pathB = String(b?.path ?? '');
    if (pathA < pathB) return -1;
    if (pathA > pathB) return  1;

    // 3. Line numeric (null sorts last).
    const lineA = typeof a?.line === 'number' ? a.line : Infinity;
    const lineB = typeof b?.line === 'number' ? b.line : Infinity;
    return lineA - lineB;
  });
}

// ---------------------------------------------------------------------------
// Backlog filter
// ---------------------------------------------------------------------------

/**
 * Extracts the actionable subset of an artifact: findings that are 'open'
 * AND have a non-empty action field.
 *
 * @param {object[]} artifact - Fully deduped + sorted findings
 * @returns {object[]}
 */
export function extractBacklog(artifact) {
  return artifact.filter(
    (f) =>
      f?.status === 'open' &&
      typeof f?.action === 'string' &&
      f.action.trim() !== ''
  );
}
