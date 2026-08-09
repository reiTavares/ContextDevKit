/**
 * Economic report — fleet aggregation and metadata-only export packaging.
 *
 * Responsibility seam: this module owns the CROSS-REPO and OUTBOUND concerns:
 *   - aggregateFleetEconomics: merges per-repo summaries into a k-anon fleet view.
 *   - buildExportPackage: packages a metadata-only export bundle for external send.
 *
 * The per-repo view (buildRepoEconomicSummary, buildTrendSlice, consent guard)
 * lives in economic-report.mjs. This split was made when aggregation and export
 * packaging reached a distinct second responsibility (outbound boundary) while the
 * main file crossed the 308-line budget. Both concerns operate on the same privacy
 * contract (ADR-0081) but have different threat surfaces.
 *
 * Privacy invariants (ADR-0081):
 *   - Unconsented repos produce an explicit skip record in `skippedRepos`; they are
 *     NEVER silently dropped from the denominator.
 *   - Aggregate fields withheld below MIN_COHORT_SIZE (k-anonymity).
 *   - assertNoForbiddenFields + assertNoTranscriptContent called at the fleet and
 *     export boundary before any record contributes to aggregates or is emitted.
 *   - externalSendAllowed() is the gate for buildExportPackage; explicit refusal
 *     when consent is not recorded — never a silent downgrade.
 *
 * Zero runtime dependencies — node:* or relative imports only.
 * DETERMINISTIC — no Date.now() / Math.random() calls. Callers inject `nowMs`.
 */

import { resolvePrivacyConfig, externalSendAllowed, skipped } from './privacy.mjs';
import { assertNoForbiddenFields, assertNoTranscriptContent } from './privacy-field-policy.mjs';
import { ECONOMIC_REPORT_SCHEMA_VERSION, MIN_COHORT_SIZE } from './economic-report.mjs';

// ---------------------------------------------------------------------------
// Fleet aggregator (multi-repo)
// ---------------------------------------------------------------------------

/**
 * Aggregates per-repo economic summaries into a cross-fleet view.
 *
 * Privacy invariants enforced here:
 *   - Repos with `status === 'skipped'` are listed in `skippedRepos` with their
 *     reasons. They are NEVER dropped from the denominator — `totalRepos` always
 *     reflects the full input size.
 *   - Cross-repo aggregate fields (totalActualUsd, avgMultiplier) are only
 *     populated when at least MIN_COHORT_SIZE consented repos contribute. Below
 *     that threshold the field is `null` and `kAnonWithheld` is `true`.
 *   - No raw path, content, or transcript field may appear in the output.
 *     assertNoForbiddenFields is called on each consented record before it
 *     contributes to aggregates.
 *
 * @param {Array<Readonly<object>>} repoSummaries
 *   Array of buildRepoEconomicSummary() return values (mix of summaries + skipped).
 * @returns {Readonly<{
 *   schemaVersion: string,
 *   totalRepos: number,
 *   consentedRepos: number,
 *   skippedRepos: Array<{repoId:string, reason:string}>,
 *   kAnonWithheld: boolean,
 *   totals: { totalActualUsd: number|null, avgMultiplierOrNull: number|null },
 *   note: string,
 * }>}
 */
export function aggregateFleetEconomics(repoSummaries) {
  const totalRepos = Array.isArray(repoSummaries) ? repoSummaries.length : 0;

  if (totalRepos === 0) {
    return Object.freeze({
      schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION,
      totalRepos: 0,
      consentedRepos: 0,
      skippedRepos: [],
      kAnonWithheld: true,
      totals: { totalActualUsd: null, avgMultiplierOrNull: null },
      note: 'No repos provided to aggregator.',
    });
  }

  const skippedRepos = [];
  const consented = [];

  for (const summary of repoSummaries) {
    if (summary?.status === 'skipped') {
      skippedRepos.push({
        repoId: String(summary.repoId ?? '(unknown)'),
        reason: String(summary.reason ?? 'skipped'),
      });
    } else {
      // Shallow forbidden-field check before contributing to aggregates.
      try {
        assertNoForbiddenFields(summary);
        assertNoTranscriptContent(summary);
        consented.push(summary);
      } catch (err) {
        // A forbidden field slipped through — treat as skipped, never aggregate.
        skippedRepos.push({
          repoId: String(summary.repoId ?? '(unknown)'),
          reason: `privacy violation at aggregate boundary: ${err.message}`,
        });
      }
    }
  }

  const consentedCount = consented.length;

  // K-anonymity: withhold aggregates when below minimum cohort.
  if (consentedCount < MIN_COHORT_SIZE) {
    return Object.freeze({
      schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION,
      totalRepos,
      consentedRepos: consentedCount,
      skippedRepos,
      kAnonWithheld: true,
      totals: { totalActualUsd: null, avgMultiplierOrNull: null },
      note: `Cross-repo aggregates withheld: ${consentedCount} consented repo(s) < minimum cohort size ${MIN_COHORT_SIZE} (k-anonymity, ADR-0081).`,
    });
  }

  // Aggregate USD — null until at least one repo contributes a real figure.
  let totalActualUsd = null;
  let multiplierSum = 0;
  let multiplierCount = 0;

  for (const summary of consented) {
    const fin = summary.financial;
    if (fin && fin.status !== 'skipped' && typeof fin.totals?.actualUsd === 'number') {
      totalActualUsd = (totalActualUsd ?? 0) + fin.totals.actualUsd;
    }

    const mult = summary.multiplier;
    if (mult && mult.status !== 'skipped' && mult.multiplier && mult.multiplier.status !== 'skipped') {
      const ratio = mult.multiplier?.multiplier;
      if (typeof ratio === 'number' && Number.isFinite(ratio)) {
        multiplierSum += ratio;
        multiplierCount += 1;
      }
    }
  }

  const avgMultiplierOrNull = multiplierCount > 0
    ? multiplierSum / multiplierCount
    : null;

  return Object.freeze({
    schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION,
    totalRepos,
    consentedRepos: consentedCount,
    skippedRepos,
    kAnonWithheld: false,
    totals: { totalActualUsd, avgMultiplierOrNull },
    note: 'USD is estimated API-equivalent; subscription billing is not metered. Original USD always shown.',
  });
}

// ---------------------------------------------------------------------------
// Metadata-only export package builder
// ---------------------------------------------------------------------------

/**
 * Builds a metadata-only export package.
 *
 * Enforces the external-send consent guard from the privacy config BEFORE
 * producing any output. If externalSend is not explicitly enabled, returns a
 * skipped() marker — never silently produces an exportable record.
 *
 * All records are run through assertNoForbiddenFields + assertNoTranscriptContent
 * at this final export boundary. Any record that fails is listed in `violations`
 * rather than silently dropped or included.
 *
 * @param {{
 *   config: object|null,
 *   repoSummary?: object|null,
 *   fleetSummary?: object|null,
 *   trend?: object|null,
 *   nowMs?: number,
 * }} input
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function buildExportPackage(input) {
  const resolved = resolvePrivacyConfig(input?.config);

  // External-send guard — explicit refusal when consent not recorded.
  if (!externalSendAllowed(resolved)) {
    return skipped(
      'external send not enabled (economics.privacy.externalSend: false). ' +
      'Set externalSend: true in config to enable export. (ADR-0081, LGPD processor transfer)'
    );
  }

  const violations = [];

  /**
   * Validates one sub-record at the export boundary.
   * Returns the record unchanged on pass; replaces with skipped on violation.
   *
   * @param {object|null} record
   * @param {string} label
   * @returns {object|null}
   */
  function validateRecord(record, label) {
    if (!record || record.status === 'skipped') return record;
    try {
      assertNoForbiddenFields(record);
      assertNoTranscriptContent(record);
      return record;
    } catch (err) {
      violations.push({ label, reason: err.message });
      return skipped(`export boundary violation: ${err.message}`);
    }
  }

  const repoSummary  = validateRecord(input?.repoSummary  ?? null, 'repoSummary');
  const fleetSummary = validateRecord(input?.fleetSummary ?? null, 'fleetSummary');
  const trend        = validateRecord(input?.trend        ?? null, 'trend');

  return Object.freeze({
    schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION,
    exportedAt: typeof input?.nowMs === 'number' ? input.nowMs : null,
    mode: 'metadata-only',
    lgpdNote: 'This export is a processor transfer under LGPD art. 7 / art. 37. ' +
      'Run privacy-lgpd review before any cross-border transmission.',
    violations,
    repoSummary,
    fleetSummary,
    trend,
  });
}
