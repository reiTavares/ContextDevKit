/**
 * integration-test-mcp-009-helpers.mjs — Shared fixtures and module loader
 * for the MCP-009 dynamic-activation split test suites.
 *
 * Imported by:
 *   integration-test-mcp-009-shape.mjs
 *   integration-test-mcp-009-happy.mjs
 *   integration-test-mcp-009-narrow.mjs
 *   integration-test-mcp-009-policy.mjs
 *   integration-test-mcp-009-table.mjs
 *
 * @module integration-test-mcp-009-helpers
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Path resolution ───────────────────────────────────────────────────────────
const KIT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const ACTIVATION_PATH = join(KIT_ROOT, 'templates/contextkit/runtime/mcp/activation.mjs')
  .replaceAll('\\', '/');

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Full manifest: all canonical servers present, enabled.
 * Fields are ManifestEntry only (no registry fields).
 * These entries will be DENIED by policy.mjs (no risk/pin/capabilities).
 * Used in degraded-mode, narrowing, and mapping tests.
 */
export const FULL_MANIFEST = [
  { id: 'playwright', mode: 'write',     allowedTools: [] },
  { id: 'github',     mode: 'read-only', allowedTools: [] },
  { id: 'figma',      mode: 'read-only', allowedTools: [] },
  { id: 'postgres',   mode: 'read-only', allowedTools: [] },
];

/**
 * Policy-compliant manifest: entries carry the registry fields required by
 * policy.mjs to survive evaluation (risk R1/R2, concrete pin, no unknown
 * tools, no R4/R5).
 * Used only where we need full-mode async results to actually produce servers.
 */
export const POLICY_MANIFEST = [
  {
    id: 'playwright',
    mode: 'write',
    risk: 'R2',
    pin: { npm: '1.44.0' },
    capabilities: { tools: ['navigate', 'screenshot', 'click', 'fill', 'check', 'wait_for_selector'] },
    allowedTools: ['navigate', 'screenshot', 'click', 'fill', 'check'],
  },
  {
    id: 'github',
    mode: 'read-only',
    risk: 'R1',
    pin: { npm: '2.0.1' },
    capabilities: { tools: ['get_file_contents', 'search_code', 'list_pull_requests',
      'get_pull_request', 'create_pull_request', 'create_issue', 'get_issue',
      'list_commits', 'list_releases', 'get_release'] },
    allowedTools: ['get_file_contents', 'search_code', 'list_pull_requests', 'get_pull_request'],
  },
  {
    id: 'figma',
    mode: 'read-only',
    risk: 'R1',
    pin: { npm: '0.3.0' },
    capabilities: { tools: ['get_file', 'get_node', 'get_comments', 'get_images'] },
    allowedTools: ['get_file', 'get_node', 'get_comments'],
  },
  {
    id: 'postgres',
    mode: 'read-only',
    risk: 'R2',
    pin: { npm: '1.1.0' },
    capabilities: { tools: ['query', 'list_tables', 'describe_table'] },
    allowedTools: ['query', 'list_tables', 'describe_table'],
  },
];

// ── Module loader ─────────────────────────────────────────────────────────────

/**
 * Loads activation.mjs and returns its named exports. Calls rep.bad + exits on
 * import failure so callers don't need try/catch boilerplate.
 *
 * @param {{ bad: Function, finish: Function }} rep
 * @param {string} suiteLabel  Passed to rep.finish on fatal error.
 * @returns {Promise<{ resolveActivation: Function, resolveActivationSync: Function, ACTIVATION_TABLE: Array }>}
 */
export async function loadActivationModule(rep, suiteLabel) {
  try {
    const mod = await import('file://' + ACTIVATION_PATH);
    return {
      resolveActivation:     mod.resolveActivation,
      resolveActivationSync: mod.resolveActivationSync,
      ACTIVATION_TABLE:      mod.ACTIVATION_TABLE,
    };
  } catch (err) {
    rep.bad(`Failed to import activation.mjs: ${err?.message ?? err}`);
    rep.finish(suiteLabel);
    // rep.finish exits; this return is never reached but satisfies linters.
    return /** @type {never} */ (null);
  }
}
