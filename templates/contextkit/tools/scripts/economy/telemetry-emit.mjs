/**
 * economy/telemetry-emit.mjs — the single telemetry seam every economy resource
 * calls (ADR-0117). Routes to the OBSERVED savings ledger (the 4 levers only) or
 * the lifecycle events ledger. `savedTokens` and `estimatedTokens` are NEVER
 * summed (honesty fence; ADR-0082 / #243 — observed, not a causal vs-no-kit
 * claim). Best-effort: never throws, returns the recorder result / a skipped
 * marker / null. Zero hot-path deps. @module economy/telemetry-emit
 */
import { join } from 'node:path';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { logSavingSync, savingsFile } from './economy-savings.mjs';
import { logEconomyEventSync, economyEventsFile } from './economy-events.mjs';
import { isKnownResource } from './registry.mjs';

/**
 * Maps a coarse action to an economy-events lifecycle stage.
 * @param {string} action @returns {string}
 */
export function mapActionToLifecycle(action) {
  switch (action) {
    case 'applied': return 'applied';
    case 'skipped': return 'skipped';
    case 'fired': return 'attempted';
    case 'deferred': return 'evaluated';
    default: return 'evaluated';
  }
}

/**
 * Records a telemetry event for an economy resource. A lever firing with an
 * OBSERVED, finite, non-negative `savedTokens` writes the savings ledger;
 * everything else writes a lifecycle event. Unknown resources are skipped.
 *
 * @param {string} root - project root.
 * @param {string} resource - a registered economy resource id.
 * @param {object} payload - `{ category, action, savedTokens, estimatedTokens,
 *   measurement, sessionId, correlationId, note }`.
 * @param {{ now?: number }} [opts] - injected epoch ms (never Date.now()).
 * @returns {object|null} recorder result, a frozen skipped marker, or null.
 */
export function emitEconomy(root, resource, payload = {}, opts = {}) {
  if (!isKnownResource(resource)) {
    return Object.freeze({ status: 'skipped', reason: `unknown economy resource: ${resource}` });
  }
  const { category, action, savedTokens, estimatedTokens, measurement, sessionId, correlationId, note } = payload;
  try {
    const isObservedLever = category === 'lever'
      && measurement === 'observed'
      && typeof savedTokens === 'number'
      && Number.isFinite(savedTokens)
      && savedTokens >= 0;
    if (isObservedLever) {
      return logSavingSync(root, { lever: resource, savedTokens, sessionId, note }, { now: opts.now });
    }
    return logEconomyEventSync(root, {
      lever: resource,
      lifecycle: mapActionToLifecycle(action),
      status: action ?? 'evaluated',
      sessionId,
      requestId: correlationId ?? null,
      estimated: Number.isFinite(estimatedTokens) ? estimatedTokens : null,
    }, { now: opts.now });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CI self-check export (aggregated by tools/selfcheck-economy-wave1.mjs)
// ---------------------------------------------------------------------------

const readJsonl = (path) => (existsSync(path)
  ? readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);

/**
 * Verifies the seam routes correctly against an isolated temp root.
 * @param {string} _root @returns {{name,pass,detail}[]}
 */
export function econCheckTelemetryEmit(_root) {
  const results = [];
  const NOW = 1750000000000;
  const base = mkdtempSync(join(tmpdir(), 'econ-emit-'));
  try {
    emitEconomy(base, 'project-map', { category: 'lever', action: 'applied', savedTokens: 1500, measurement: 'observed', sessionId: 's1' }, { now: NOW });
    const savings = readJsonl(savingsFile(base));
    results.push({ name: 'lever+observed writes a savings record', pass: savings.some((r) => r.lever === 'project-map' && r.savedTokens === 1500), detail: `${savings.length} savings row(s)` });

    emitEconomy(base, 'patch-economy', { category: 'advisory', action: 'fired', measurement: 'none', sessionId: 's1' }, { now: NOW });
    const events = readJsonl(economyEventsFile(base));
    const savingsAfter = readJsonl(savingsFile(base));
    results.push({ name: 'advisory writes an events row, not a savings row', pass: events.some((r) => r.lever === 'patch-economy') && savingsAfter.length === savings.length, detail: `${events.length} event row(s)` });

    const before = readJsonl(economyEventsFile(base)).length;
    const skipped = emitEconomy(base, 'totally-unknown', { category: 'lifecycle', action: 'fired' }, { now: NOW });
    const after = readJsonl(economyEventsFile(base)).length;
    results.push({ name: 'unknown resource is skipped (no write)', pass: Boolean(skipped) && skipped.status === 'skipped' && after === before, detail: skipped?.status ?? 'null' });
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ }
  }
  return results;
}
