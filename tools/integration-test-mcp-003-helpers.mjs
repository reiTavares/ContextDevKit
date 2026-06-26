/**
 * integration-test-mcp-003-helpers.mjs — Shared fixtures and utilities
 *
 * Imported by every integration-test-mcp-003-*.mjs sub-suite.
 * NOT standalone-runnable (no finish() call).
 *
 * @module integration-test-mcp-003-helpers
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT } from './it-helpers.mjs';

export const RENDER_DIR = join(KIT, 'templates', 'contextkit', 'runtime', 'mcp', 'render');

// ---------------------------------------------------------------------------
// Fixtures: shared across all sub-suites
// ---------------------------------------------------------------------------

/** Four registry entries: stdio, http, wildcard, and restricted hosts. */
export const FIXTURE_REGISTRY = Object.freeze([
  {
    id: 'contextdevkit',
    displayName: 'ContextDevKit MCP',
    source: 'npm:contextdevkit-mcp',
    transport: 'stdio',
    requiredSecrets: [],
    allowedHosts: ['*'],
    pin: { npm: '1.0.0' },
  },
  {
    id: 'playwright',
    displayName: 'Playwright MCP',
    source: 'npm:@playwright/mcp',
    transport: 'stdio',
    requiredSecrets: [],
    allowedHosts: ['*'],
    pin: { npm: '0.0.3' },
  },
  {
    id: 'github',
    displayName: 'GitHub MCP',
    source: 'npm:@modelcontextprotocol/server-github',
    transport: 'stdio',
    requiredSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    allowedHosts: ['claude-code', 'cursor'],   // NOT codex, NOT antigravity
    pin: { npm: '0.6.2' },
  },
  {
    id: 'http-server',
    displayName: 'HTTP Example MCP',
    source: 'https://mcp.example.com/sse',
    transport: 'streamable-http',
    requiredSecrets: ['HTTP_API_KEY'],
    allowedHosts: ['*'],
    pin: { sha: 'abc123' },
  },
]);

/** Full manifest: 5 entries — 4 real + 1 absent-from-registry (must be skipped). */
export const FIXTURE_MANIFEST = Object.freeze({
  version: 1,
  servers: [
    { id: 'contextdevkit', mode: 'read-only', referencedSecrets: [], allowedTools: ['session-log'] },
    { id: 'playwright',    mode: 'write',     referencedSecrets: [], allowedTools: ['navigate', 'screenshot'] },
    { id: 'github',        mode: 'read-only', referencedSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'], allowedTools: ['get_file_contents'] },
    { id: 'http-server',   mode: 'read-only', referencedSecrets: ['HTTP_API_KEY'], allowedTools: ['fetch'] },
    { id: 'unknown-server', mode: 'read-only', referencedSecrets: [], allowedTools: [] },
  ],
});

/** Wildcard-only manifest for AC#4 parity test. */
export const WILDCARD_MANIFEST = Object.freeze({
  version: 1,
  servers: [
    { id: 'contextdevkit', referencedSecrets: [], allowedTools: ['session-log'] },
    { id: 'playwright',    referencedSecrets: [], allowedTools: ['navigate'] },
    { id: 'http-server',   referencedSecrets: ['HTTP_API_KEY'], allowedTools: ['fetch'] },
  ],
});

// ---------------------------------------------------------------------------
// Reporter helpers (re-exported from caller's reporter instance)
// ---------------------------------------------------------------------------

/** Asserts a condition; logs ok/bad to the provided reporter. */
export function check(rep, condition, label, detail = '') {
  if (condition) {
    rep.ok(label);
  } else {
    rep.bad(`${label}${detail ? ' — ' + detail : ''}`);
  }
}

/** Expects fn() to throw; fails assertion if it does not. */
export function expectThrow(rep, label, fn, msgFragment) {
  try {
    fn();
    rep.bad(`${label} — expected throw but did not throw`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msgFragment && !msg.includes(msgFragment)) {
      rep.bad(`${label} — threw but wrong message (got: ${msg.slice(0, 120)})`);
    } else {
      rep.ok(label);
    }
  }
}

// ---------------------------------------------------------------------------
// Dynamic renderer imports (call once; callers await the returned object)
// ---------------------------------------------------------------------------

/**
 * Loads all four host renderers and the shared render utilities.
 * @returns {Promise<{renderClaude, renderCodex, renderCursor, renderAg,
 *                    filterForHost, expandSource, buildEnvRefs, assertSecretName}>}
 */
export async function loadRenderers() {
  const [{ renderHost: renderClaude }, { renderHost: renderCodex },
         { renderHost: renderCursor }, { renderHost: renderAg },
         shared] = await Promise.all([
    import(pathToFileURL(join(RENDER_DIR, 'render-claude.mjs')).href),
    import(pathToFileURL(join(RENDER_DIR, 'render-codex.mjs')).href),
    import(pathToFileURL(join(RENDER_DIR, 'render-cursor.mjs')).href),
    import(pathToFileURL(join(RENDER_DIR, 'render-antigravity.mjs')).href),
    import(pathToFileURL(join(RENDER_DIR, 'render-shared.mjs')).href),
  ]);
  const { filterForHost, expandSource, buildEnvRefs, assertSecretName } = shared;
  return { renderClaude, renderCodex, renderCursor, renderAg,
           filterForHost, expandSource, buildEnvRefs, assertSecretName };
}
