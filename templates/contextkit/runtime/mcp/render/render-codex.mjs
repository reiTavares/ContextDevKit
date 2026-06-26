/**
 * render-codex.mjs - MCP config renderer for the Codex host.
 *
 * Produces two ConfigArtifacts from a single manifest + registry:
 *   1. USER scope:    ~/.codex/config.toml  (user-global, TOML format).
 *   2. PROJECT scope: .codex/mcp.json       (per-project JSON override).
 *
 * Codex resolves MCP servers from a TOML config file at the user level and a
 * JSON override at the project level. The TOML shape for each server is:
 *
 *   [[mcp.servers]]
 *   id      = "<id>"
 *   command = "npx"
 *   args    = ["-y", "<pkg>"]
 *   [mcp.servers.env]
 *   SECRET_NAME = "${env:SECRET_NAME}"
 *
 * For streamable-http:
 *   [[mcp.servers]]
 *   id  = "<id>"
 *   url = "<source>"
 *
 * The per-project JSON shape mirrors Claude Code's mcpServers block so that the
 * same manifest yields an equivalent server set (AC#4 parity):
 *   { "mcpServers": { "<id>": { ... } } }
 *
 * CONTRACT:
 *   - renderHost(manifest, registry) is PURE: no I/O.
 *   - Secrets appear ONLY as ${env:NAME} references (never literals).
 *   - Only servers whose allowedHosts includes '*' or 'codex' are emitted.
 *   - Writes are marker-idempotent (ADR-0067); callers use injectMarkedBlock.
 *
 * @module render/render-codex
 */

import { filterForHost } from './render-shared.mjs';

/** Canonical host id for this renderer. */
export const HOST_ID = 'codex';

/** @typedef {import('./render-shared.mjs').ManifestEntry} ManifestEntry */
/** @typedef {import('./render-shared.mjs').RegistryEntry} RegistryEntry */
/** @typedef {import('./render-shared.mjs').ConfigArtifact} ConfigArtifact */
/** @typedef {import('./render-shared.mjs').ResolvedRenderEntry} ResolvedRenderEntry */

/**
 * Scope for the generated artifact.
 * - 'user':    ~/.codex/config.toml (TOML).
 * - 'project': .codex/mcp.json (JSON).
 *
 * @typedef {'user'|'project'} CodexScope
 */

// -- Internal helpers ---------------------------------------------------------

/**
 * Serialises a single resolved server to a TOML [[mcp.servers]] block string.
 * Uses only basic TOML constructs (strings + arrays) so zero deps are needed.
 *
 * @param {ResolvedRenderEntry} server
 * @returns {string}
 */
function serverToToml(server) {
  const lines = ['[[mcp.servers]]'];
  lines.push(`id = "${server.id}"`);

  if (server.transport === 'streamable-http') {
    lines.push(`url = "${server.url}"`);
  } else {
    lines.push(`command = "${server.command}"`);
    const argsToml = server.args.map((a) => `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ');
    lines.push(`args = [${argsToml}]`);
  }

  const envEntries = Object.entries(server.env);
  if (envEntries.length > 0) {
    lines.push(`[mcp.servers.env]`);
    for (const [k, v] of envEntries) {
      lines.push(`${k} = "${v}"`);
    }
  }

  return lines.join('\n');
}

/**
 * Builds the full TOML config.toml body for the Codex user scope.
 *
 * @param {ResolvedRenderEntry[]} entries
 * @returns {string}
 */
function buildTomlBody(entries) {
  if (entries.length === 0) return '# No MCP servers enabled for Codex.\n';
  return entries.map(serverToToml).join('\n\n') + '\n';
}

/**
 * Builds a per-project JSON body (mcpServers block) for the Codex project scope.
 * Uses the same shape as Claude Code for parity (AC#4).
 *
 * @param {ResolvedRenderEntry[]} entries
 * @returns {string}
 */
function buildProjectJson(entries) {
  /** @type {Record<string, Object>} */
  const mcpServers = {};
  for (const e of entries) {
    mcpServers[e.id] =
      e.transport === 'streamable-http'
        ? { url: e.url, env: e.env }
        : { command: e.command, args: e.args, env: e.env };
  }
  return JSON.stringify({ mcpServers }, null, 2) + '\n';
}

// -- Public API ---------------------------------------------------------------

/**
 * Renders Codex MCP config artifacts (user TOML + project JSON) from the
 * supplied manifest and registry.
 *
 * @param {Object}          manifest   Parsed project manifest (readManifest()).
 * @param {RegistryEntry[]} registry   Loaded registry entries (loadRegistry()).
 * @param {Object}          [options]
 * @param {CodexScope[]}    [options.scopes]  Scopes to render. Default: both.
 * @returns {ConfigArtifact[]}
 * @throws {TypeError} If manifest or registry are structurally invalid.
 */
export function renderHost(manifest, registry, options = {}) {
  if (!manifest || !Array.isArray(manifest.servers)) {
    throw new TypeError('render-codex: manifest must have a servers array');
  }
  if (!Array.isArray(registry)) {
    throw new TypeError('render-codex: registry must be an array');
  }

  const scopes = options.scopes ?? ['user', 'project'];
  const { entries, skipped } = filterForHost(manifest.servers, registry, HOST_ID);

  /** @type {ConfigArtifact[]} */
  const artifacts = [];

  if (scopes.includes('user')) {
    artifacts.push({
      filePath: '~/.codex/config.toml',
      format: 'toml',
      content: buildTomlBody(entries),
      servers: entries,
      skipped,
      host: HOST_ID,
      scope: 'user',
    });
  }

  if (scopes.includes('project')) {
    artifacts.push({
      filePath: '.codex/mcp.json',
      format: 'json',
      content: buildProjectJson(entries),
      servers: entries,
      skipped,
      host: HOST_ID,
      scope: 'project',
    });
  }

  return artifacts;
}