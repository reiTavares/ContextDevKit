/**
 * fx-conversion — FX-snapshot application for EACP cost results (ADR-0079 §FX).
 *
 * Single responsibility: convert a USD cost result into a target currency using
 * a caller-supplied FX snapshot. All FX refusal logic lives here; cross-session
 * anchoring (originalUsd) is enforced at this boundary.
 *
 * Zero runtime dependencies: node:* or relative imports only.
 */

import { lowestConfidence } from './cost-engine.mjs';

/**
 * Applies an FX snapshot to a USD cost result; always preserves originalUsd.
 *
 * The report MUST show originalUsd alongside any converted figure so
 * cross-session comparison stays anchored to USD (ADR-0079 §FX).
 *
 * Refuses (converted: null) when costResult.usd is null, fxSnapshot fields
 * are missing, or fxSnapshot.confidence is 'unknown' (constitution §8).
 *
 * @param {{ usd: number|null, confidence: string }} costResult - From actualCost().
 * @param {{ currency: string, rate: number, timestamp: string, source: string,
 *   confidence: 'direct'|'derived'|'inferred'|'unknown' }} fxSnapshot
 *   - rate = units-of-target-currency per 1 USD.
 * @returns {{ originalUsd: number|null, converted: number|null, currency: string,
 *   fxRate: number|null, fxTimestamp: string|null, fxSource: string|null,
 *   fxConfidence: string, confidence: string }}
 */
export function applyFxSnapshot(costResult, fxSnapshot) {
  const originalUsd = costResult?.usd ?? null;
  const fxConf = fxSnapshot?.confidence ?? 'unknown';
  const canConvert =
    originalUsd !== null &&
    typeof fxSnapshot?.rate === 'number' && fxSnapshot.rate > 0 &&
    typeof fxSnapshot?.currency === 'string' &&
    fxConf !== 'unknown';

  return {
    originalUsd,
    converted: canConvert ? originalUsd * fxSnapshot.rate : null,
    currency: fxSnapshot?.currency ?? 'USD',
    fxRate: canConvert ? fxSnapshot.rate : null,
    fxTimestamp: fxSnapshot?.timestamp ?? null,
    fxSource: fxSnapshot?.source ?? null,
    fxConfidence: fxConf,
    confidence: canConvert
      ? lowestConfidence(costResult.confidence ?? 'unknown', fxConf)
      : 'unknown',
  };
}
