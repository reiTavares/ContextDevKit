/**
 * Shared helpers, fixtures, and module imports for MCP-005 integration tests.
 *
 * Imported by:
 *   integration-test-mcp-005-taxonomy.mjs
 *   integration-test-mcp-005-deny.mjs
 *   integration-test-mcp-005-tools.mjs
 *   integration-test-mcp-005-pure.mjs
 *
 * NOT standalone-runnable — import-only helper module.
 *
 * @module integration-test-mcp-005-helpers
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Root of the kit repo. */
export const KIT = resolve(here, '..');

/** Path to runtime/mcp product modules. */
export const TEMPLATES = resolve(KIT, 'templates', 'contextkit', 'runtime', 'mcp');

/** Path to mcp/policies data directory. */
export const POLICIES = resolve(KIT, 'templates', 'contextkit', 'mcp', 'policies');

/** Build a file:// URL that works cross-platform (forward-slashes on Windows). */
export function fileUrl(absPath) {
  return new URL(`file:///${absPath.replaceAll('\\', '/')}`);
}

/**
 * Load all product modules under test. Returns them as a named bag.
 * Call once at the top of each sub-suite with `await loadModules()`.
 * @returns {Promise<{evaluateServer, CLASS_DEFAULTS, RISK_CLASSES, classDefault,
 *   isHumanApprovalClass, looksLikeSecretValue, resolveAutonomy}>}
 */
export async function loadModules() {
  const { evaluateServer } = await import(fileUrl(resolve(TEMPLATES, 'policy.mjs')));
  const { CLASS_DEFAULTS, RISK_CLASSES, classDefault, isHumanApprovalClass } = await import(
    fileUrl(resolve(TEMPLATES, 'risk-classes.mjs'))
  );
  const { looksLikeSecretValue } = await import(
    fileUrl(resolve(TEMPLATES, 'secret-shape.mjs'))
  );
  const { resolveAutonomy } = await import(
    fileUrl(resolve(KIT, 'templates', 'contextkit', 'runtime', 'config', 'resolve-autonomy.mjs'))
  );
  return { evaluateServer, CLASS_DEFAULTS, RISK_CLASSES, classDefault, isHumanApprovalClass,
    looksLikeSecretValue, resolveAutonomy };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A concrete, valid R1 base registry entry to vary from in tests. */
export const BASE_ENTRY = Object.freeze({
  id: 'sample-server',
  risk: 'R1',
  allowedHosts: ['*'],
  pin: { npm: '1.2.3' },
  defaultMode: 'read-only',
  capabilities: {
    tools: ['read_file', 'search_files', 'list_directory'],
    resources: [],
    prompts: [],
  },
});

/** Minimal valid manifest entry (passes all policy checks). */
export const BASE_MANIFEST = Object.freeze({ allowedTools: ['read_file'] });

/** Autonomy config that lets the resolver resolve without throwing. */
export const AUTONOMY_CFG = Object.freeze({ autonomy: { grade: 3 } });

/** A well-formed recorded-approval token for R4/R5 gate tests. */
export const APPROVAL_TOKEN = Object.freeze({
  by: 'human@example.com',
  at: '2026-06-25T00:00:00Z',
  via: 'slack-thread-123',
});

/**
 * Convenience wrapper: evaluates with the real autonomy resolver injected.
 * @param {Function} evaluateServer
 * @param {Function} resolveAutonomy
 * @param {object}   entry
 * @param {object}   [manifest]
 * @param {string}   [host]
 * @param {object}   [opts]
 */
export function makeEvalWith(evaluateServer, resolveAutonomy) {
  return function evalWith(entry, manifest = {}, host = 'claude-code', opts = {}) {
    return evaluateServer(entry, manifest, host, {
      resolveAutonomyFn: resolveAutonomy,
      autonomyConfig: AUTONOMY_CFG,
      ...opts,
    });
  };
}
