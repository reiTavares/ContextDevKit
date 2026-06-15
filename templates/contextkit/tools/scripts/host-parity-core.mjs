/**
 * Host-parity core (CDK-056, PKG-05) — constants, declared skip reasons, and the
 * composer-output extraction helpers shared by `host-parity.mjs`.
 *
 * Split from host-parity.mjs at the parse-vs-decide seam: this module turns a
 * composed settings object into a set of hook script basenames; the parent module
 * decides parity verdicts and renders. Pure (no I/O), fail-open.
 *
 * @module host-parity-core
 */

// ── Shared command prefix used by the Claude and Codex composers ─────────────
export const HOOK_PREFIX = 'contextkit/runtime/hooks/';

// ── Highest representative level for the comparison ──────────────────────────
export const REPRESENTATIVE_LEVEL = 5;

// ── Declared skip reasons (hook-level, not command/skill-level) ──────────────
// Two distinct categories of intentional per-host absence:
//   A) Capability Enforcement (Claude-only at L5, ADR-0072): hooks only Claude
//      can wire because Codex and agy lack the UserPromptSubmit event and the
//      direct-write reconciliation pathway.
//   B) agy architectural substitution (ADR-0049): agy routes SessionStart and Stop
//      through a single session-manager.mjs wrapper rather than the two separate
//      hooks Claude/Codex use. Both functions are present on agy; the path differs.
export const ENFORCEMENT_HOOK_REASONS = {
  // Category A — Capability Enforcement.
  'execution-contract-hook.mjs':
    'Capability Enforcement — Claude-only at L5 (ADR-0072). Codex/agy lack UserPromptSubmit event.',
  'execution-gate.mjs':
    'Capability Enforcement — Claude-only at L5 (ADR-0072). Advisory mode; codex/agy receive concurrency-guard instead.',
  'indirect-write-reconcile.mjs':
    'Capability Enforcement — Claude-only at L5 (ADR-0072). Reconciles indirect writes; codex/agy track-edits covers this.',
  // Category B — agy session-manager substitution (ADR-0049).
  'session-start.mjs':
    'agy substitution — agy uses session-manager.mjs start (antigravity/) instead of this hook (ADR-0049).',
  'check-registration.mjs':
    'agy substitution — agy uses session-manager.mjs end (antigravity/) for drift-check/Stop (ADR-0049).',
};

/**
 * @typedef {'unknown' | boolean} HostPresence
 * True = hook registered for this host at the representative level.
 * False = hook absent (no skip reason → a GAP candidate).
 * 'unknown' = host composer could not be loaded; column excluded from gap logic.
 */

/**
 * @typedef {'parity' | 'reasoned-skip' | 'GAP'} Verdict
 * parity = all comparable hosts agree; reasoned-skip = absent but explained;
 * GAP = absent on ≥1 host with no declared reason.
 */

/**
 * @typedef {{ name: string, claude: HostPresence, codex: HostPresence|'skipped', agy: HostPresence, reason?: string, verdict: Verdict }} ParityRow
 */

/**
 * @typedef {{ loads: ParityRow[], gaps: ParityRow[] }} ParityReport
 */

/**
 * Extracts script basenames from a composed Claude/Codex settings object.
 * Claude composer returns `{ hooks: { [event]: [ { hooks: [{command}] } ] } }`.
 *
 * @param {Record<string, any>} composed result of composeSettings or composeCodexHooks
 * @returns {Set<string>} script basenames like "session-start.mjs"
 */
export function extractClaudeOrCodexScripts(composed) {
  const scripts = new Set();
  const hooks = composed?.hooks;
  if (!hooks || typeof hooks !== 'object') return scripts;
  for (const eventEntries of Object.values(hooks)) {
    if (!Array.isArray(eventEntries)) continue;
    for (const group of eventEntries) {
      for (const hook of group?.hooks ?? []) {
        const cmd = String(hook?.command ?? '');
        const idx = cmd.indexOf(HOOK_PREFIX);
        if (idx === -1) continue;
        // Strip the "--host xxx" suffix; take the script name only.
        const afterPrefix = cmd.slice(idx + HOOK_PREFIX.length).split(' ')[0].trim();
        if (afterPrefix) scripts.add(afterPrefix);
      }
    }
  }
  return scripts;
}

/**
 * Extracts script basenames from a composed agy hooks object.
 * agy composer returns `{ contextdevkit: { SessionStart: [{hooks:[{command}]}], ... } }`.
 *
 * @param {Record<string, any>} composed result of composeAgentHooks
 * @returns {Set<string>} script basenames
 */
export function extractAgyScripts(composed) {
  const scripts = new Set();
  const group = composed?.contextdevkit;
  if (!group || typeof group !== 'object') return scripts;
  for (const [key, value] of Object.entries(group)) {
    if (key === 'enabled' || !Array.isArray(value)) continue;
    for (const entry of value) {
      for (const hook of entry?.hooks ?? []) {
        const cmd = String(hook?.command ?? '');
        const idx = cmd.indexOf(HOOK_PREFIX);
        if (idx === -1) continue;
        const afterPrefix = cmd.slice(idx + HOOK_PREFIX.length).split(' ')[0].trim();
        if (afterPrefix) scripts.add(afterPrefix);
      }
    }
  }
  return scripts;
}
