/**
 * render-cursor.mjs - MCP config renderer for the Cursor host.
 *
 * Produces one ConfigArtifact: .cursor/mcp.json (workspace-level).
 *
 * Cursor reads MCP server definitions from .cursor/mcp.json at the workspace
 * root. The file format is:
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
 * Cursor also supports workspace-level env interpolation via the ${env:NAME}
 * syntax in string values, which is exactly what we emit for secrets.
 *
 * CONTRACT:
 *   - renderHost(manifest, registry) is PURE: no I/O.
 *   - Secrets appear ONLY as ${env:NAME} references (never literals).
 *   - Only servers whose allowedHosts includes '*' or 'cursor' are emitted.
 *   - Writes are marker-idempotent (ADR-0067); callers use injectMarkedBlock.
 *   - Never overwrites user MCP config entries outside the marker region.
 *
 * @module render/render-cursor
 */

import { filterForHost } from './render-shared.mjs';

/** Canonical host id for this renderer. */
export const HOST_ID = 'cursor';

/** @typedef {import('./render-shared.mjs').ManifestEntry} ManifestEntry */
/** @typedef {import('./render-shared.mjs').RegistryEntry} RegistryEntry */
/** @typedef {import('./render-shared.mjs').ConfigArtifact} ConfigArtifact */
/** @typedef {import('./render-shared.mjs').ResolvedRenderEntry} ResolvedRenderEntry */

// -- Internal helpers ---------------------------------------------------------

/**
 * Serialises a single resolved server to the Cursor mcpServers entry shape.
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
 * Builds the full mcpServers JSON content for .cursor/mcp.json.
 *
 * @param {ResolvedRenderEntry[]} entries
 * @returns {string}
 */
function buildCursorJson(entries) {
  /** @type {Record<string, Object>} */
  const mcpServers = {};
  for (const e of entries) {
    mcpServers[e.id] = serializeServer(e);
  }
  return JSON.stringify({ mcpServers }, null, 2) + '\n';
}

// -- Public API ---------------------------------------------------------------

/**
 * Renders the Cursor MCP config artifact from the supplied manifest and registry.
 *
 * Returns a single-element array (the workspace .cursor/mcp.json artifact).
 * Returns an array pattern for API consistency with multi-scope renderers.
 *
 * @param {Object}          manifest   Parsed project manifest (readManifest()).
 * @param {RegistryEntry[]} registry   Loaded registry entries (loadRegistry()).
 * @param {Object}          [options]  Reserved for future workspace/env options.
 * @returns {ConfigArtifact[]}
 * @throws {TypeError} If manifest or registry are structurally invalid.
 */
export function renderHost(manifest, registry, options = {}) {
  if (!manifest || !Array.isArray(manifest.servers)) {
    throw new TypeError('render-cursor: manifest must have a servers array');
  }
  if (!Array.isArray(registry)) {
    throw new TypeError('render-cursor: registry must be an array');
  }

  void options; // reserved for future workspace/env expansion

  const { entries, skipped } = filterForHost(manifest.servers, registry, HOST_ID);

  return [
    {
      filePath: '.cursor/mcp.json',
      format: 'json',
      content: buildCursorJson(entries),
      servers: entries,
      skipped,
      host: HOST_ID,
      scope: 'workspace',
    },
  ];
}