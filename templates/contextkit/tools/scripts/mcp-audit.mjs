#!/usr/bin/env node
/** Read-only MCP configuration audit for ContextDevKit 4. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport } from './mcp-audit-core.mjs';

/** @param {string} text @param {unknown} fallback @returns {unknown} */
function parseJsonSafe(text, fallback = null) {
  try { return JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { return fallback; }
}

/**
 * Reads MCP metadata while dropping environment values at the boundary.
 *
 * @param {string} root project root
 * @returns {{servers:object[],configFound:boolean}}
 */
function readMcpConfig(root) {
  const settingsPath = resolve(root, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return { servers: [], configFound: false };
  let settings;
  try { settings = parseJsonSafe(readFileSync(settingsPath, 'utf8')); } catch { settings = null; }
  if (!settings || typeof settings !== 'object') return { servers: [], configFound: false };
  const configuredServers = settings.mcpServers ?? settings.mcp?.servers ?? {};
  if (!configuredServers || typeof configuredServers !== 'object') return { servers: [], configFound: true };
  return {
    configFound: true,
    servers: Object.entries(configuredServers).map(([name, definition]) => {
      const source = definition && typeof definition === 'object' ? definition : {};
      return {
        name,
        transport: String(source.transport ?? source.type ?? 'unknown'),
        ...(source.version ? { version: String(source.version) } : {}),
        envKeys: source.env && typeof source.env === 'object' ? Object.keys(source.env) : [],
        tools: Array.isArray(source.tools) ? [...source.tools] : [],
      };
    }),
  };
}

/** @param {string} [root] @returns {object} */
export function runAudit(root = process.cwd()) {
  return buildReport(readMcpConfig(root));
}

/** @param {object} report */
function renderReport(report) {
  console.log('\n=== MCP Configuration Audit ===');
  console.log(`Config found:   ${report.configFound}`);
  console.log(`Observation:    ${report.observationStatus}`);
  console.log(`Active servers: ${report.activeServers.join(', ') || '(none)'}`);
  console.log(`\nFlags (${report.flags.length}):`);
  for (const flag of report.flags) console.log(`  [${flag.severity.toUpperCase()}] ${flag.code} — ${flag.message}`);
  for (const diagnostic of report.diagnostics) console.log(`  note: ${diagnostic}`);
  console.log('');
}

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? process.cwd()) : process.cwd();
  const report = runAudit(root);
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else renderReport(report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write(`mcp-audit: ${error.message}\n`);
    process.exitCode = 0;
  }
}
