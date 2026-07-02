/**
 * telemetry.mjs — shadow calibration telemetry (ADR-0128 §28, ADR-0129 §4).
 *
 * The initial calibration STATE UNIT is `rule × host × policyVersion` — NOT
 * `rule × host × profile × project × policyVersion`. Profile and project are
 * recorded as telemetry DIMENSIONS and only become independent state once real
 * drift evidence appears (§4, prevents premature fleet complexity).
 *
 * WF-0063 is shadow-only: this records samples and never blocks. Sample builders
 * are pure; `appendSample` persists defensively (never throws — rule 2).
 *
 * Zero runtime dependencies beyond `node:*` + the safe-io primitive.
 *
 * @module domain-engineering/telemetry
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';
import { pathsFor } from '../config/paths.mjs';

/** Telemetry schema version. */
export const TELEMETRY_SCHEMA_VERSION = 1;

/**
 * Builds the canonical calibration key. Profile/project are deliberately NOT in
 * the key (they are recorded in the sample body as dimensions only).
 *
 * @param {object} params { ruleId, host, policyVersion }
 * @returns {string} `ruleId::host::policyVersion`
 */
export function calibrationKey(params) {
  const p = params && typeof params === 'object' ? params : {};
  return [p.ruleId ?? 'unknown', p.host ?? 'unknown', p.policyVersion ?? '0.0.0'].join('::');
}

/**
 * Builds one shadow calibration sample (the §28 record). Captures the prediction,
 * whether a real write occurred, the FP/FN flags, the evidence fidelity tier and
 * the telemetry dimensions (profile, project) outside the calibration key.
 *
 * @param {object} params
 * @param {string} params.ruleId
 * @param {string} params.host
 * @param {string} params.policyVersion
 * @param {number} [params.predictedScore]
 * @param {string} [params.predictedVerdict]
 * @param {boolean} [params.realWriteOccurred]
 * @param {boolean} [params.falsePositive]
 * @param {boolean} [params.falseNegative]
 * @param {string} [params.evidenceTier] one of EVIDENCE_TIERS.
 * @param {string} [params.profile] telemetry dimension (not in the key).
 * @param {string} [params.project] telemetry dimension (not in the key).
 * @param {string} [params.observedAt] ISO timestamp (injectable for tests).
 * @returns {object} sample record.
 */
export function buildSample(params) {
  const p = params && typeof params === 'object' ? params : {};
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    key: calibrationKey(p),
    ruleId: p.ruleId ?? 'unknown',
    host: p.host ?? 'unknown',
    policyVersion: p.policyVersion ?? '0.0.0',
    shadow: true,
    prediction: {
      score: Number.isFinite(Number(p.predictedScore)) ? Number(p.predictedScore) : null,
      verdict: p.predictedVerdict ?? null,
    },
    realWriteOccurred: Boolean(p.realWriteOccurred),
    falsePositive: Boolean(p.falsePositive),
    falseNegative: Boolean(p.falseNegative),
    evidenceTier: p.evidenceTier ?? 'inferred',
    dimensions: { profile: p.profile ?? null, project: p.project ?? null },
    observedAt: p.observedAt ?? new Date().toISOString(),
  };
}

/** Absolute path of the shadow telemetry log (co-located with execution state). */
export function telemetryPathFor(root) {
  return join(pathsFor(root).pipeline, 'state', 'domain-engineering', 'shadow-telemetry.json');
}

/**
 * Appends a sample to the shadow telemetry log. Never throws (rule 2): returns
 * false on any I/O error. Caps the log at `maxSamples` (FIFO) to bound growth.
 *
 * @param {string} root project root.
 * @param {object} sample from buildSample().
 * @param {number} [maxSamples] retention cap (default 5000).
 * @returns {boolean}
 */
export function appendSample(root, sample, maxSamples = 5000) {
  try {
    const file = telemetryPathFor(root);
    mkdirSync(join(pathsFor(root).pipeline, 'state', 'domain-engineering'), { recursive: true });
    const existing = readJsonSafe(file, { schemaVersion: TELEMETRY_SCHEMA_VERSION, samples: [] });
    const samples = Array.isArray(existing.samples) ? existing.samples : [];
    samples.push(sample);
    const bounded = samples.length > maxSamples ? samples.slice(samples.length - maxSamples) : samples;
    writeFileAtomicSync(file, JSON.stringify({ schemaVersion: TELEMETRY_SCHEMA_VERSION, samples: bounded }, null, 2));
    return true;
  } catch {
    return false;
  }
}
