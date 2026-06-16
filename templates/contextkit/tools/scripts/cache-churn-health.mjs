/**
 * cache-churn-health — CDK-067 / PKG-06 advisory consumer.
 *
 * Correlates prompt-cache gross value (EACP cost-engine) with artifact churn
 * (CDK-068 wiring-drift dimensions) into a cache-health band.
 *
 * INSIGHT: frequent artifact churn (instructions/config/hooks) INVALIDATES the
 * cached prompt prefix, destroying the gross cache value. A high gross cache
 * value with high churn means money saved by caching is silently wiped out by
 * every artifact edit that shifts the prefix.
 *
 * Advisory-only: never blocks execution; surface in a dashboard or hook only.
 *
 * DETERMINISTIC: no Date.now()/Math.random() in cacheChurnHealth(). collectChurn
 * does I/O but degrades to zeros on any failure (fail-open).
 *
 * Constitution §8 (refuse-by-default): when neither signal is present, return
 * skipped(). Never fabricate 'healthy' for unknown — that is the false-negative
 * trap (mirrors session-pressure.mjs posture).
 *
 * Rule 4: no 'contextkit/' literal in resolve()/join() calls anywhere in this file.
 * Zero runtime dependencies — node:* + relative imports only.
 *
 * @module cache-churn-health
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { grossCacheValue, COST_SCHEMA_VERSION } from './economics/cost-engine.mjs';
import { priceFor, loadRegistry } from './economics/pricing/pricing-registry.mjs';
import { skipped } from './economics/privacy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for health result objects produced by this module. */
export const CACHE_CHURN_SCHEMA_VERSION = 'cdk-cache-churn/1';

// ---------------------------------------------------------------------------
// Internal policy table (CDK-067 ratified thresholds — change via ADR)
// ---------------------------------------------------------------------------
//
// | Total churn | grossCacheValueUsd | → band     |
// |-------------|-------------------|------------|
// | 0           | null              | skipped    |  (no signal at all)
// | 0–1         | any               | healthy    |
// | 2–4         | any               | watch      |
// | ≥ 5 with $  | > 0               | at-risk    |  (churn is wiping real savings)
// | ≥ 8         | any               | at-risk    |  (volume alone is alarming)
// | 2–4 or any  | null (unknown)    | watch      |  (unknown value, churn present)
//
// Thresholds reviewable; change via ADR. (mirrors session-pressure.mjs policy-table style)
//
const CHURN_WATCH_MIN     = 2;   // total churn at which we enter 'watch'
const CHURN_AT_RISK_VALUE = 5;   // total churn that risks known cache value (> 0 USD)
const CHURN_AT_RISK_FLOOR = 8;   // total churn that triggers at-risk regardless of USD value

// ---------------------------------------------------------------------------
// Pure scorer
// ---------------------------------------------------------------------------

/**
 * PURE scorer. Correlates prompt-cache value with artifact churn into a health
 * band.
 *
 * Scoring heuristic (deterministic — no I/O, no Date.now()):
 *   - Both signals absent (usd null AND total === 0) → skipped.
 *   - total ≥ CHURN_AT_RISK_FLOOR (8) regardless of value → at-risk.
 *   - total ≥ CHURN_AT_RISK_VALUE (5) AND grossCacheValueUsd > 0 → at-risk.
 *   - total in [CHURN_WATCH_MIN, CHURN_AT_RISK_VALUE-1] (2–4), or any churn
 *     with unknown USD → watch.
 *   - total ≤ 1 → healthy.
 *
 * @param {{ grossCacheValueUsd: number|null,
 *   churn: { instruction: number, config: number, wiring: number } }} input
 * @param {object} [opts] - Reserved for future overrides; currently ignored.
 * @returns {{ schemaVersion: string, costSchemaVersion: string,
 *   grossCacheValueUsd: number|null,
 *   artifactChurn: { instruction: number, config: number, wiring: number, total: number },
 *   cacheHealth: 'healthy'|'watch'|'at-risk',
 *   confidence: 'derived'|'inferred',
 *   triggers: string[],
 *   note: string }
 *   | Readonly<{ status: 'skipped', reason: string }>}
 */
export function cacheChurnHealth(input, opts) {   // eslint-disable-line no-unused-vars
  const usd = input?.grossCacheValueUsd ?? null;
  const rawChurn = input?.churn ?? {};

  const instruction = Number.isFinite(rawChurn.instruction) ? rawChurn.instruction : 0;
  const config      = Number.isFinite(rawChurn.config)      ? rawChurn.config      : 0;
  const wiring      = Number.isFinite(rawChurn.wiring)      ? rawChurn.wiring      : 0;
  const total       = instruction + config + wiring;

  // Constitution §8 false-negative guard: no signal means skipped, not healthy.
  if (usd === null && total === 0) {
    return skipped('no cache value and no churn signal');
  }

  const triggers = [];

  // Determine band
  let cacheHealth;
  if (total >= CHURN_AT_RISK_FLOOR) {
    cacheHealth = 'at-risk';
    triggers.push(`total artifact churn ${total} ≥ ${CHURN_AT_RISK_FLOOR} (volume threshold)`);
  } else if (total >= CHURN_AT_RISK_VALUE && usd !== null && usd > 0) {
    cacheHealth = 'at-risk';
    triggers.push(
      `total artifact churn ${total} ≥ ${CHURN_AT_RISK_VALUE} invalidates ` +
      `$${usd.toFixed(4)} gross cache value`
    );
  } else if (total >= CHURN_WATCH_MIN || (usd === null && total > 0)) {
    cacheHealth = 'watch';
    if (total >= CHURN_WATCH_MIN) {
      triggers.push(`artifact churn ${total} in watch range [${CHURN_WATCH_MIN}–${CHURN_AT_RISK_VALUE - 1}]`);
    }
    if (usd === null && total > 0) {
      triggers.push('churn present but cache value unknown — conservative watch');
    }
  } else {
    cacheHealth = 'healthy';
  }

  // Confidence: derived when we have a USD figure, inferred when value is unknown.
  const confidence = usd !== null ? 'derived' : 'inferred';

  return Object.freeze({
    schemaVersion:     CACHE_CHURN_SCHEMA_VERSION,
    costSchemaVersion: COST_SCHEMA_VERSION,
    grossCacheValueUsd: usd,
    artifactChurn: { instruction, config, wiring, total },
    cacheHealth,
    confidence,
    triggers,
    note: 'Advisory cache-health estimate. Thresholds reviewable; change via ADR.',
  });
}

// ---------------------------------------------------------------------------
// Async churn collector (I/O-bearing; degrades to zeros on error)
// ---------------------------------------------------------------------------

/**
 * Dynamically imports a module by absolute path. Returns null on any failure.
 *
 * @param {string} absPath
 * @returns {Promise<Record<string, any> | null>}
 */
async function tryImport(absPath) {
  try { return await import(pathToFileURL(absPath).href); }
  catch { return null; }
}

/**
 * Counts churn rows in a DriftRow[] result from one wiring-drift dimension.
 * A row is "churn" when its status is NOT 'ok' and NOT 'skipped'.
 *
 * Field mapping from wiring-drift-checks.mjs DriftRow:
 *   { dimension, item, status, detail? }
 * Statuses indicating drift: 'missing', 'unexpected', 'missing-marker', 'unknown-key'.
 *
 * @param {Array<{ status: string }>} rows - DriftRow array from a checker.
 * @returns {number} Number of non-ok, non-skipped rows.
 */
function countChurnRows(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter(r => r.status !== 'ok' && r.status !== 'skipped').length;
}

/**
 * Async helper: derive {instruction, config, wiring} churn counts from the
 * wiring-drift dimension checkers for a given root and level.
 *
 * Calls checkInstructionDrift, checkConfigDrift, checkWiringDrift from
 * wiring-drift-checks.mjs (sibling). Degrades to zeros on any error or when
 * the module cannot be loaded — fail-open so the pure scorer always gets a
 * valid numeric triple.
 *
 * @param {string} root - Project root directory.
 * @param {number} level - Active ContextDevKit level (1–7).
 * @returns {Promise<{ instruction: number, config: number, wiring: number }>}
 */
export async function collectChurn(root, level) {
  const zero = { instruction: 0, config: 0, wiring: 0 };

  const checksPath = resolve(__dirname, 'wiring-drift-checks.mjs');
  const mod = await tryImport(checksPath);
  if (!mod) return zero;

  const { checkInstructionDrift, checkConfigDrift, checkWiringDrift } = mod;
  if (
    typeof checkInstructionDrift !== 'function' ||
    typeof checkConfigDrift     !== 'function' ||
    typeof checkWiringDrift     !== 'function'
  ) {
    return zero;
  }

  try {
    const [instructionRows, configRows, wiringRows] = await Promise.all([
      Promise.resolve(checkInstructionDrift(root)),
      checkConfigDrift(root),
      checkWiringDrift(root, level),
    ]);

    return {
      instruction: countChurnRows(instructionRows),
      config:      countChurnRows(configRows),
      wiring:      countChurnRows(wiringRows),
    };
  } catch {
    return zero;
  }
}

// ---------------------------------------------------------------------------
// Convenience: price a bucket set into a grossCacheValueUsd
// ---------------------------------------------------------------------------

/**
 * Optional convenience that prices token buckets to a grossCacheValueUsd via
 * priceFor() + grossCacheValue() from the cost engine.
 *
 * Returns null when the registry is absent, the modelId is unknown, or the
 * price entry is not usable (confidence not 'direct'/'derived').
 *
 * @param {{ freshInput: number, output: number, cacheRead: number,
 *   cacheWrite: number, reasoning: number }} buckets - Token counts per category.
 * @param {string} modelId - Model canonical id or alias for registry lookup.
 * @param {{ registry?: object|null, cacheTtl?: '5m'|'1h' }} [opts] - Allows
 *   injecting a pre-loaded registry for hermetic tests.
 * @returns {number|null} USD value or null when unpriceable.
 */
export function grossCacheValueFor(buckets, modelId, opts) {
  const registry = opts?.registry !== undefined ? opts.registry : loadRegistry();
  const entry    = priceFor(registry, modelId);
  const result   = grossCacheValue(buckets, entry, opts);
  return result.usd ?? null;
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

/**
 * Human-readable multi-line block summarising the cache-health result.
 * Handles skipped gracefully (outputs the skip reason).
 *
 * @param {ReturnType<typeof cacheChurnHealth>} result
 * @returns {string}
 */
export function presentCacheHealth(result) {
  if (!result || typeof result !== 'object') {
    return '[cache-churn-health] no result to present';
  }
  if (result.status === 'skipped') {
    return `[cache-churn-health] skipped: ${result.reason}`;
  }

  const lines = [
    `[cache-churn-health] v${CACHE_CHURN_SCHEMA_VERSION}`,
    `  health : ${result.cacheHealth.toUpperCase()}  (confidence: ${result.confidence})`,
    `  cache  : grossCacheValue = ${
      result.grossCacheValueUsd !== null
        ? '$' + result.grossCacheValueUsd.toFixed(4)
        : 'unknown'
    }`,
    `  churn  : instruction=${result.artifactChurn.instruction}  ` +
      `config=${result.artifactChurn.config}  ` +
      `wiring=${result.artifactChurn.wiring}  ` +
      `(total=${result.artifactChurn.total})`,
  ];

  if (result.triggers.length > 0) {
    lines.push('  triggers:');
    for (const trigger of result.triggers) {
      lines.push(`    - ${trigger}`);
    }
  }

  lines.push(`  note: ${result.note}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Thin CLI (guarded by import.meta main check — library-safe)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('cache-churn-health.mjs');

if (isMain) {
  // Demo: score two synthetic inputs to verify the module loads correctly.
  console.log(presentCacheHealth(cacheChurnHealth({
    grossCacheValueUsd: 0.025, churn: { instruction: 0, config: 1, wiring: 0 },
  })));
  console.log(presentCacheHealth(cacheChurnHealth({
    grossCacheValueUsd: 3.5, churn: { instruction: 3, config: 2, wiring: 1 },
  })));
}
