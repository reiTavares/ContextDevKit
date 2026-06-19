/**
 * Economic report aggregator — EACP-15 / card #244 / ADR-0077 §I
 *
 * Single responsibility: compose the economics summaries already produced by
 * the individual EACP modules (financial, quota, autonomy, routing, advisories)
 * into a dashboard-ready data record. This is a pure data aggregator; it does
 * NOT read files, call Date.now(), or produce HTML.
 *
 * Cohesion note (per-repo boundary): all per-repo concerns live here —
 * consent guard, single-repo summary builder, and trend slice. Cross-repo
 * aggregation and outbound export packaging are the second responsibility and
 * live in economic-report-fleet.mjs. The seam is the per-repo / cross-repo
 * boundary, each with a distinct threat surface (ADR-0081).
 *
 * Privacy invariants (ADR-0081, card #244 panel hardening):
 *   1. CONSENT per-repo — assertConsentRecorded() throws when the consent flag
 *      is absent or false. Unconsented repos produce an EXPLICIT skip record;
 *      they are NEVER silently dropped from the denominator.
 *   2. K-ANONYMITY — cross-repo aggregate fields are withheld when fewer than
 *      MIN_COHORT_SIZE consented repos contribute (enforced in fleet module).
 *   3. METADATA-ONLY — assertNoForbiddenFields + assertNoTranscriptContent are
 *      called on every outbound record at the export boundary (fleet module).
 *   4. NO RAW PATHS — redactPath() is applied to any path-bearing field before
 *      it reaches the outbound record.
 *   5. EXTERNAL SEND — externalSendAllowed() is checked before producing an
 *      export package (fleet module). Unconsented → explicit refusal.
 *
 * Zero runtime dependencies — node:* or relative imports only.
 * DETERMINISTIC — no Date.now() / Math.random() calls. Callers inject `nowMs`.
 */

import { resolvePrivacyConfig, skipped, redactPath } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for economic-report data objects. */
export const ECONOMIC_REPORT_SCHEMA_VERSION = 'eacp-economic-report/1';

/**
 * Minimum number of consented repos required before cross-repo aggregate fields
 * are released. Fewer contributors could re-identify a single project.
 * K-anonymity rule: any aggregate that could narrow to a single entity is withheld.
 *
 * @type {number}
 */
export const MIN_COHORT_SIZE = 3;

// ---------------------------------------------------------------------------
// Consent enforcement (throws — constitution §8)
// ---------------------------------------------------------------------------

/**
 * Throws a TypeError when the consent record is absent or false.
 *
 * Per ADR-0081 and card #244 panel hardening: consent must be recorded
 * explicitly in the repo's config. An absent consent key is NOT treated as
 * granted. Any external send of economics data requires this guard to have
 * passed for every contributing repo.
 *
 * @param {{ economics?: { reporting?: { consent?: unknown } } } | null | undefined} config
 *   The repo's parsed config object (from readConfig / CONFIG_FILE).
 * @param {string} repoId Human-readable repo identifier for the error message.
 * @throws {TypeError} When consent is missing or not exactly `true`.
 */
export function assertConsentRecorded(config, repoId) {
  const consent = config?.economics?.reporting?.consent;
  if (consent !== true) {
    throw new TypeError(
      `economics reporting consent not recorded for repo "${repoId}". ` +
      `Set economics.reporting.consent: true in that repo's config to opt in. ` +
      `(ADR-0081, card #244)`
    );
  }
}

// ---------------------------------------------------------------------------
// Single-repo summary builder
// ---------------------------------------------------------------------------

/**
 * Builds a single-repo economics dashboard summary.
 *
 * Accepts the pre-computed module summaries for one repo and produces a
 * metadata-only, provenance-stamped record. Returns a skipped() marker when
 * consent is not recorded — the caller MUST count it in the skipped denominator.
 *
 * @param {{
 *   repoId: string,
 *   config: object|null,
 *   financial: object|null,
 *   quota: object|null,
 *   multiplier: object|null,
 *   routing: object|null,
 *   pressure: object|null,
 *   mapEffectiveness: object|null,
 *   nowMs?: number,
 * }} input
 * @returns {Readonly<object>|Readonly<{status:'skipped', reason:string, repoId:string}>}
 */
export function buildRepoEconomicSummary(input) {
  const { repoId, config } = input ?? {};

  // Consent guard — explicit skip record when not consented. Never silent drop.
  try {
    assertConsentRecorded(config, repoId ?? '(unknown)');
  } catch (err) {
    return Object.freeze({
      status: 'skipped',
      reason: `consent not recorded: ${err.message}`,
      repoId: repoId ?? '(unknown)',
    });
  }

  const resolved = resolvePrivacyConfig(config);

  // Collect each summary, preserving skipped() markers as-is.
  // Never promote a skipped marker to a value, never promote null to a pass.
  const financial      = input.financial      ?? skipped('financial summary not provided');
  const quota          = input.quota          ?? skipped('quota summary not provided');
  const multiplier     = input.multiplier     ?? skipped('autonomy multiplier not provided');
  const routing        = input.routing        ?? skipped('routing summary not provided');
  const pressure       = input.pressure       ?? skipped('session pressure not provided');
  const mapEff         = input.mapEffectiveness ?? skipped('map effectiveness not provided');

  // Derive a top-level confidence: 'direct' only when all priced models direct;
  // 'inferred' when at least one priced; 'unknown' when all skipped/unpriced.
  const financialConfidence = financial?.status === 'skipped'
    ? 'unknown'
    : (financial?.confidence ?? 'unknown');

  const record = {
    schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION,
    repoId: redactPath(String(repoId ?? ''), resolved),
    consentRecorded: true,
    generatedAt: typeof input.nowMs === 'number' ? input.nowMs : null,
    confidence: financialConfidence,
    financial,
    quota,
    multiplier,
    routing,
    advisories: { pressure, mapEffectiveness: mapEff },
  };

  return Object.freeze(record);
}

// ---------------------------------------------------------------------------
// Trend slice builder
// ---------------------------------------------------------------------------

/**
 * Builds a trend snapshot from an ordered array of per-period economic records.
 *
 * Each period should be a `{ period: string, financial?, quota?, multiplier? }`
 * object. The function extracts a time-ordered slice and computes simple
 * delta values (last vs. first). Periods with skipped/null financials are
 * counted but their USD is listed as null — never treated as zero.
 *
 * @param {Array<{
 *   period: string,
 *   financial?: object|null,
 *   quota?: object|null,
 *   multiplier?: object|null,
 * }>} periods - Array of per-period records, ordered ascending by period string.
 * @param {{ maxPeriods?: number }} [opts]
 * @returns {Readonly<{
 *   schemaVersion: string,
 *   periodCount: number,
 *   periods: Array<{period:string, actualUsdOrNull:number|null, confidence:string}>,
 *   delta: {actualUsdOrNull:number|null, direction:'up'|'down'|'flat'|'unknown'},
 *   note: string,
 * }>|Readonly<{status:'skipped',reason:string}>}
 */
export function buildTrendSlice(periods, opts) {
  if (!Array.isArray(periods) || periods.length === 0) {
    return skipped('no period data for trend');
  }

  const maxPeriods = (typeof opts?.maxPeriods === 'number' && opts.maxPeriods > 0)
    ? opts.maxPeriods
    : 12;

  const slice = periods.slice(-maxPeriods);

  const mapped = slice.map(p => {
    const fin = p.financial;
    const actualUsdOrNull = (fin && fin.status !== 'skipped' && fin.totals?.actualUsd != null)
      ? fin.totals.actualUsd
      : null;
    const confidence = (fin && fin.status !== 'skipped')
      ? (fin.confidence ?? 'unknown')
      : 'unknown';
    return { period: String(p.period ?? ''), actualUsdOrNull, confidence };
  });

  // Compute delta only when both ends have a real USD value.
  const first = mapped.find(p => p.actualUsdOrNull !== null);
  const last = [...mapped].reverse().find(p => p.actualUsdOrNull !== null);

  let delta;
  if (!first || !last || first === last) {
    delta = { actualUsdOrNull: null, direction: 'unknown' };
  } else {
    const diff = last.actualUsdOrNull - first.actualUsdOrNull;
    delta = {
      actualUsdOrNull: diff,
      direction: Math.abs(diff) < 0.0001 ? 'flat' : diff > 0 ? 'up' : 'down',
    };
  }

  return Object.freeze({
    schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION,
    periodCount: mapped.length,
    periods: mapped,
    delta,
    note: 'USD shown is estimated API-equivalent; subscription billing is not metered.',
  });
}

// ---------------------------------------------------------------------------
// Re-exports from fleet module (preserves the public surface of this file)
// ---------------------------------------------------------------------------

// Consumers that import aggregateFleetEconomics or buildExportPackage from
// this module continue to work without change. The implementations live in
// economic-report-fleet.mjs (cross-repo / outbound responsibility seam).
export { aggregateFleetEconomics, buildExportPackage } from './economic-report-fleet.mjs';
