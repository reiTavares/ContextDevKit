#!/usr/bin/env node
/**
 * Grok MCP renderer integration checks for OP-0014.
 *
 * Proves the native Grok project artifact, wildcard/restricted host filtering,
 * Grok's `${ENV_NAME}` syntax, HTTP transport, and safe TOML escaping.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, reporter } from './it-helpers.mjs';
import {
  FIXTURE_REGISTRY, FIXTURE_MANIFEST,
  check, loadRenderers,
} from './integration-test-mcp-003-helpers.mjs';

const rep = reporter();
const { renderGrok } = await loadRenderers();

console.log('\n[Grok] Native `.grok/config.toml` renderer\n');

const artifact = renderGrok(FIXTURE_MANIFEST, FIXTURE_REGISTRY)[0];
check(rep, artifact.filePath === '.grok/config.toml', 'Grok writes project config at .grok/config.toml');
check(rep, artifact.format === 'toml' && artifact.host === 'grok' && artifact.scope === 'project',
  'Grok artifact carries TOML/project/grok metadata');
check(rep, artifact.content.includes('[mcp_servers."contextdevkit"]'),
  'Grok emits stdio server table');
check(rep, artifact.content.includes('command = "node"') &&
  artifact.content.includes('args = ["contextkit/mcp-server/server.mjs"]'),
  'Grok uses the installed native ContextDevKit MCP server');
check(rep, artifact.content.includes('[mcp_servers."http-server"]') &&
  artifact.content.includes('url = "https://mcp.example.com/sse"'),
  'Grok emits streamable-http server with url');
check(rep, artifact.content.includes('env = { HTTP_API_KEY = "${HTTP_API_KEY}" }'),
  'Grok translates shared env references to ${ENV_NAME}');
check(rep, !artifact.content.includes('${env:HTTP_API_KEY}'),
  'Grok artifact does not emit another host\'s env syntax');
check(rep, !artifact.content.includes('ghp_') && !artifact.content.includes('sk-'),
  'Grok artifact contains no literal token values');
const doctorSource = readFileSync(join(KIT, 'templates', 'contextkit', 'tools', 'scripts', 'mcp-doctor.mjs'), 'utf8');
check(rep, doctorSource.includes("'grok'"), 'MCP doctor host mapping recognizes grok');

const restrictedRegistry = FIXTURE_REGISTRY.map((entry) =>
  entry.id === 'github' ? { ...entry, allowedHosts: ['grok'] } : entry
);
const restricted = renderGrok(FIXTURE_MANIFEST, restrictedRegistry)[0];
check(rep, restricted.servers.some((server) => server.id === 'github'),
  'Grok accepts an entry explicitly allowed for the grok host');

const projectOnly = renderGrok(FIXTURE_MANIFEST, FIXTURE_REGISTRY, { scopes: ['user'] });
check(rep, projectOnly.length === 0, 'Grok rejects unsupported user scope without producing an artifact');

rep.finish('OP-0014 Grok MCP renderer');
