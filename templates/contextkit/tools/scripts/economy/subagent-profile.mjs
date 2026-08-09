#!/usr/bin/env node
/**
 * subagent-profile.mjs — resolves the bounded context profile applied when a
 * sub-agent is dispatched (WF0020 lifecycle resource, instrumented under
 * OP-0001 / WF-0039 / ADR-0117).
 *
 * WHY: economy mode tells the agent to dispatch sub-agents under the `subagent`
 * context profile (≤120 lines). That budget lived only as a number inside
 * context-profiles.mjs with no runnable surface and no telemetry. This module
 * gives it one: resolve the subagent profile + emit a `subagent-profile` row
 * when the profile is actually resolved for a dispatch.
 *
 * Honesty + scope: pure resolver + a thin CLI. NOT wired into any hook — it
 * fires only when invoked. `applied` here means the bounded budget was resolved
 * to govern a real dispatch, not a mere recommendation.
 *
 * Zero runtime dependencies — node:* and sibling economy modules only.
 * @module economy/subagent-profile
 */
import { profileFor } from './context-profiles.mjs';
import { emitEconomy } from './telemetry-emit.mjs';

/** Schema id for the resolved subagent-profile object. */
export const SUBAGENT_PROFILE_SCHEMA_VERSION = 'cdk-subagent-profile/1';

/**
 * Resolves the bounded context profile for a sub-agent dispatch. Fail-open: a
 * missing/broken context-profiles sibling degrades the budget to null rather
 * than throwing.
 *
 * @returns {Readonly<{ schemaVersion: string, profile: 'subagent', budget: number|null }>}
 */
export function resolveSubagentProfile() {
  let budget = null;
  try { budget = profileFor('subagent'); } catch { budget = null; }
  return Object.freeze({ schemaVersion: SUBAGENT_PROFILE_SCHEMA_VERSION, profile: 'subagent', budget });
}

/**
 * Resolves the subagent profile AND records the application telemetry. The emit
 * is the side-effecting wrapper; `resolveSubagentProfile` stays pure for tests.
 *
 * @param {string} root - project root for the ledger
 * @param {{ now?: number }} [opts={}]
 * @returns {ReturnType<typeof resolveSubagentProfile>}
 */
export function applySubagentProfile(root, opts = {}) {
  const resolved = resolveSubagentProfile();
  emitEconomy(root, 'subagent-profile', { category: 'lifecycle', action: 'applied', measurement: 'none' }, { now: opts.now });
  return resolved;
}

/**
 * Self-check: the resolver returns the frozen subagent shape and the apply path
 * writes exactly one events row (no savings row — lifecycle has no token delta).
 *
 * @param {string} _root @returns {Promise<{name,pass,detail}[]>}
 */
export async function econCheckSubagentProfile(_root) {
  const { mkdtempSync, rmSync, existsSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { economyEventsFile } = await import('./economy-events.mjs');
  const { savingsFile } = await import('./economy-savings.mjs');
  const results = [];
  const base = mkdtempSync(join(tmpdir(), 'subagent-prof-'));
  const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  try {
    const resolved = resolveSubagentProfile();
    results.push({ name: 'resolveSubagentProfile: frozen subagent shape', pass: resolved.profile === 'subagent' && Object.isFrozen(resolved), detail: `budget=${resolved.budget}` });
    applySubagentProfile(base, { now: 1750000000000 });
    const events = readJsonl(economyEventsFile(base)).filter((r) => r.lever === 'subagent-profile');
    const savings = readJsonl(savingsFile(base)).filter((r) => r.lever === 'subagent-profile');
    results.push({ name: 'applySubagentProfile: one events row, no savings row', pass: events.length === 1 && savings.length === 0, detail: `events=${events.length} savings=${savings.length}` });
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ }
  }
  return results;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('subagent-profile.mjs')) {
  const resolved = applySubagentProfile(process.cwd(), { now: Date.now() });
  process.stdout.write(JSON.stringify(resolved, null, 2) + '\n');
}
