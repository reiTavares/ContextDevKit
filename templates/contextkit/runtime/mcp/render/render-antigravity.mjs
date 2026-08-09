/**
 * render-antigravity.mjs - MCP config renderer for the Antigravity (agy) host.
 *
 * Produces one ConfigArtifact: .agents/mcp.json (project-level).
 *
 * Antigravity resolves MCP config from .agents/mcp.json at the workspace root.
 * The file format matches the MCP standard JSON shape:
 *
 *   {
 *     "mcpServers": {
 *       "<id>": {
 *         "command": "npx",
 *         "args": ["-y", "<pkg>"],
 *         "env": { "SECRET_NAME": "${env:SECRET_NAME}" }
 *       }
 *     }
 *   }
 *
 * For streamable-http:
 *   { "<id>": { "url": "<source>", "env": { ... } } }
 *
 * The ANTIGRAVITY_DIR constant (''.agents'') is sourced from paths.mjs (ADR-0048)
 * and is NOT hardcoded here -- the file path is computed at render time from the
 * exported constant so the platform folder name stays single-sourced.
 *
 * CONTRACT:
 *   - renderHost(manifest, registry) is PURE: no I/O.
 *   - Secrets appear ONLY as ${env:NAME} references (never literals).
 *   - Only servers whose allowedHosts includes '*' or 'antigravity' are emitted.
 *   - Writes are marker-idempotent (ADR-0067); callers use injectMarkedBlock.
 *   - Never overwrites user MCP config entries outside the marker region.
 *
 * @module render/render-antigravity
 */

import { filterForHost } from './render-shared.mjs';
import { ANTIGRAVITY_DIR } from '../../config/paths.mjs';

/** Canonical host id for this renderer. */
export const HOST_ID = 'antigravity';

/** @typedef {import('./render-shared.mjs').ManifestEntry} ManifestEntry */
/** @typedef {import('./render-shared.mjs').RegistryEntry} RegistryEntry */
/** @typedef {import('./render-shared.mjs').ConfigArtifact} ConfigArtifact */
/** @typedef {import('./render-shared.mjs').ResolvedRenderEntry} ResolvedRenderEntry */

// -- Internal helpers ---------------------------------------------------------

/**
 * Serialises a single resolved server to the Antigravity mcpServers entry shape.
 *
 * @param {ResolvedRenderEntry} server
 * @returns {Object}
 */
function serializeServer(server) {
  if (server.transport === 'streamable-http') {
    return { url: server.url, env: server.env };
  }
  return { command: server.command, args: server.args, env: server.env };
}

/**
 * Builds the full mcpServers JSON content for .agents/mcp.json.
 *
 * @param {ResolvedRenderEntry[]} entries
 * @returns {string}
 */
function buildAgJson(entries) {
  /** @type {Record<string, Object>} */
  const mcpServers = {};
  for (const e of entries) {
    mcpServers[e.id] = serializeServer(e);
  }
  return JSON.stringify({ mcpServers }, null, 2) + '\n';
}

// -- Public API ---------------------------------------------------------------

/**
 * Renders the Antigravity MCP config artifact from the supplied manifest and
 * registry.
 *
 * Returns a single-element array (the project .agents/mcp.json artifact).
 * Returns an array pattern for API consistency with multi-scope renderers.
 *
 * @param {Object}          manifest   Parsed project manifest (readManifest()).
 * @param {RegistryEntry[]} registry   Loaded registry entries (loadRegistry()).
 * @param {Object}          [options]  Reserved for future options.
 * @returns {ConfigArtifact[]}
 * @throws {TypeError} If manifest or registry are structurally invalid.
 */
export function renderHost(manifest, registry, options = {}) {
  if (!manifest || !Array.isArray(manifest.servers)) {
    throw new TypeError('render-antigravity: manifest must have a servers array');
  }
  if (!Array.isArray(registry)) {
    throw new TypeError('render-antigravity: registry must be an array');
  }

  void options; // reserved for future expansion

  const { entries, skipped } = filterForHost(manifest.servers, registry, HOST_ID);

  return [
    {
      filePath: `${ANTIGRAVITY_DIR}/mcp.json`,
      format: 'json',
      content: buildAgJson(entries),
      servers: entries,
      skipped,
      host: HOST_ID,
      scope: 'project',
    },
  ];
}