/**
 * render-claude.mjs - MCP config renderer for Claude Code (claude-code host).
 *
 * Produces two ConfigArtifacts from a single manifest + registry:
 *   1. PROJECT scope: .claude/settings.json mcpServers block (workspace-local,
 *      env interpolation via ${env:NAME}).
 *   2. USER scope:    ~/.claude/claude_mcp_settings.json (user-global config;
 *      same env reference format, different file path convention).
 *
 * Claude Code reads mcpServers from .claude/settings.json in the project root
 * and/or from a user-level settings file. Both share the same JSON shape:
 *   { "mcpServers": { "<id>": { "command": "...", "args": [...], "env": {...} } } }
 *
 * For streamable-http servers the shape is:
 *   { "<id>": { "url": "...", "env": {...} } }
 *
 * CONTRACT:
 *   - renderHost(manifest, registry) is PURE: no I/O.
 *   - Secrets appear ONLY as ${env:NAME} references (never literals).
 *   - Only servers whose allowedHosts includes '*' or 'claude-code' are emitted.
 *   - Writes are marker-idempotent (ADR-0067); callers use injectMarkedBlock.
 *   - Never clobbers user content outside the marker region.
 *
 * @module render/render-claude
 */

import { filterForHost } from './render-shared.mjs';

/** Canonical host id for this renderer. */
export const HOST_ID = 'claude-code';

/** @typedef {import('./render-shared.mjs').ManifestEntry} ManifestEntry */
/** @typedef {import('./render-shared.mjs').RegistryEntry} RegistryEntry */
/** @typedef {import('./render-shared.mjs').ConfigArtifact} ConfigArtifact */
/** @typedef {import('./render-shared.mjs').ResolvedRenderEntry} ResolvedRenderEntry */

/**
 * Scope for the generated artifact.
 * - 'project': .claude/settings.json mcpServers block (workspace).
 * - 'user':    user-global Claude settings file.
 *
 * @typedef {'project'|'user'} ClaudeScope
 */

// -- Internal helpers ---------------------------------------------------------

/**
 * Serialises a single resolved server to the Claude JSON mcpServers entry shape.
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
 * Builds the mcpServers JSON object from a list of resolved entries.
 *
 * @param {ResolvedRenderEntry[]} entries
 * @returns {Record<string, Object>}
 */
function buildMcpServersBlock(entries) {
  /** @type {Record<string, Object>} */
  const block = {};
  for (const entry of entries) {
    block[entry.id] = serializeServer(entry);
  }
  return block;
}

// -- Public API ---------------------------------------------------------------

/**
 * Renders Claude Code MCP config artifacts (project + user scopes) from the
 * supplied manifest and registry.
 *
 * @param {Object}          manifest   Parsed project manifest (readManifest()).
 * @param {RegistryEntry[]} registry   Loaded registry entries (loadRegistry()).
 * @param {Object}          [options]
 * @param {ClaudeScope[]}   [options.scopes]  Scopes to render. Default: both.
 * @returns {ConfigArtifact[]}
 * @throws {TypeError} If manifest or registry are structurally invalid.
 */
export function renderHost(manifest, registry, options = {}) {
  if (!manifest || !Array.isArray(manifest.servers)) {
    throw new TypeError('render-claude: manifest must have a servers array');
  }
  if (!Array.isArray(registry)) {
    throw new TypeError('render-claude: registry must be an array');
  }

  const scopes = options.scopes ?? ['project', 'user'];
  const { entries, skipped } = filterForHost(manifest.servers, registry, HOST_ID);

  const mcpBlock = buildMcpServersBlock(entries);
  const jsonContent = JSON.stringify({ mcpServers: mcpBlock }, null, 2) + '\n';

  /** @type {ConfigArtifact[]} */
  const artifacts = [];

  if (scopes.includes('project')) {
    artifacts.push({
      filePath: '.claude/settings.json',
      format: 'json',
      content: jsonContent,
      servers: entries,
      skipped,
      host: HOST_ID,
      scope: 'project',
    });
  }

  if (scopes.includes('user')) {
    artifacts.push({
      filePath: '~/.claude/claude_mcp_settings.json',
      format: 'json',
      content: jsonContent,
      servers: entries,
      skipped,
      host: HOST_ID,
      scope: 'user',
    });
  }

  return artifacts;
}