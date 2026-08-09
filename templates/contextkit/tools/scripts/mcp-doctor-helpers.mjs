/**
 * mcp-doctor-helpers.mjs — Pure utility functions shared across the
 * mcp-doctor module family (MCP-004).
 *
 * Isolated here so the three siblings (core, probe-stdio, probe-http) can
 * import from a common leaf without forming a cycle.
 *
 * Zero runtime deps — node:* not required here.
 *
 * @module mcp-doctor-helpers
 */

// ---------------------------------------------------------------------------
// extractCapabilityNames
// ---------------------------------------------------------------------------

/**
 * Extracts a flat list of capability names from a capabilities block.
 *
 * Handles two shapes returned by MCP servers:
 *   - Array of objects: `[{ name: 'read' }, { name: 'write' }]`
 *   - Array of strings: `['read', 'write']`
 *
 * Returns an empty array for any invalid / missing input (defensive I/O).
 *
 * @param {object|null} capabilities  The capabilities object from the server.
 * @param {'tools'|'resources'|'prompts'} key  Which capability list to extract.
 * @returns {string[]}
 */
export function extractCapabilityNames(capabilities, key) {
  if (!capabilities || typeof capabilities !== 'object') return [];
  const entries = capabilities[key];
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => (typeof e === 'string' ? e : (e?.name ?? String(e))))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// checkSecrets
// ---------------------------------------------------------------------------

/**
 * Checks whether all required secret env vars are present in `process.env`.
 *
 * A missing var must produce status 'skipped' (not 'fail') so the operator
 * knows the check was bypassed for a recoverable reason (just set the var),
 * not a hard failure.
 *
 * @param {string[]} requiredSecrets  Environment variable names (not values).
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkSecrets(requiredSecrets) {
  const missing = (requiredSecrets ?? []).filter((name) => !process.env[name]);
  return { ok: missing.length === 0, missing };
}
