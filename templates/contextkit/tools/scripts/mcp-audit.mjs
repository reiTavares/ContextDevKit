#!/usr/bin/env node
/**
 * mcp-audit.mjs — MCP server/tool audit I/O + CLI (MCP-010).
 *
 * WHY this module exists: surfaces the MCP integration posture of a project so
 * engineers and governance can verify: which servers are active, which tools are
 * exposed, which secrets are referenced, whether pinning and approval gates hold.
 *
 * Responsibility split:
 *   - THIS FILE: I/O (read .claude/settings.json, read local receipt store) + CLI.
 *   - mcp-audit-core.mjs: pure flag computation + report assembly (zero I/O).
 *
 * CDK-022 SEAM: when the shared receipt store arrives, replace readLocalReceipts()
 * with a call to that substrate. Flag logic (mcp-audit-core.mjs) is unchanged.
 *
 * Design decisions:
 *   - Read-only; never writes config (mutations require explicit --write flows).
 *   - Fail-open: missing config / missing store → degrade gracefully.
 *   - METADATA ONLY in all output — no secret values, no prompt content.
 *   - Zero runtime deps — node:* only.
 *   - ≤ 280 useful lines. ADR-0073 / MCP-010.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildReport } from './mcp-audit-core.mjs';

// ---------------------------------------------------------------------------
// Types (JSDoc only)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ name: string, transport: string, version?: string, envKeys?: string[], tools?: string[] }} McpServerInfo
 * @typedef {{
 *   configFound: boolean, substrateStatus: string,
 *   servers: McpServerInfo[], receipts: number,
 *   flags: import('./mcp-audit-core.mjs').AuditFlag[],
 *   activeServers: string[], unusedServers: string[],
 *   exposedTools: Record<string,string[]>,
 *   secretRefs: Record<string,string[]>,
 *   transports: Record<string,string>,
 * }} AuditReport
 */

// ---------------------------------------------------------------------------
// Internal: JSON helpers
// ---------------------------------------------------------------------------

const BOM = /^﻿/;

/**
 * Parse JSON defensively (BOM-tolerant). Returns fallback on error.
 * @param {string} text
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
function parseJsonSafe(text, fallback = null) {
  if (typeof text !== 'string') return fallback;
  try { return JSON.parse(text.replace(BOM, '')); } catch { return fallback; }
}

/**
 * Read and parse a JSON file defensively.
 * @param {string} filePath
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
function readJsonFile(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try { return parseJsonSafe(readFileSync(filePath, 'utf-8'), fallback); } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Internal: MCP config extraction (.claude/settings.json)
// ---------------------------------------------------------------------------

/**
 * Extracts MCP server descriptors from .claude/settings.json.
 * Returns an empty array when config is missing or has no mcpServers block.
 *
 * @param {string} root — project root
 * @returns {{ servers: McpServerInfo[], configFound: boolean }}
 */
function readMcpConfig(root) {
  const settingsPath = resolve(root, '.claude', 'settings.json');
  const raw = readJsonFile(settingsPath);
  if (!raw || typeof raw !== 'object') return { servers: [], configFound: false };

  const mcpServers = raw.mcpServers ?? raw.mcp?.servers ?? {};
  if (!mcpServers || typeof mcpServers !== 'object') return { servers: [], configFound: true };

  const servers = Object.entries(mcpServers).map(([name, def]) => {
    const d = def && typeof def === 'object' ? def : {};
    // Strip env to key names immediately at the I/O boundary — raw values (tokens, passwords)
    // from settings.json must never enter the pipeline. AC-3: METADATA ONLY. The guarantee
    // is structural here, not emergent from downstream callers remembering to strip.
    const envKeys =
      d.env && typeof d.env === 'object'
        ? Object.keys(d.env)
        : [];
    return {
      name,
      transport: String(d.transport ?? d.type ?? 'unknown'),
      version: d.version ? String(d.version) : undefined,
      envKeys,
      tools: Array.isArray(d.tools) ? d.tools : [],
    };
  });

  return { servers, configFound: true };
}

// ---------------------------------------------------------------------------
// Internal: receipt store reader (LOCAL — CDK-022 SEAM)
// ---------------------------------------------------------------------------

/**
 * Reads all receipts from the local MCP receipt store.
 *
 * CDK-022 SEAM: replace this function body with a call to the shared substrate
 * when CDK-022 ships. The flag logic in mcp-audit-core.mjs is unchanged.
 *
 * @param {string} root
 * @returns {{ receipts: object[], substrateStatus: string }}
 */
function readLocalReceipts(root) {
  const storeDir = resolve(root, 'contextkit', 'runtime', 'receipts', 'mcp');
  if (!existsSync(storeDir)) return { receipts: [], substrateStatus: 'local-empty' };

  let entries;
  try {
    entries = readdirSync(storeDir).filter((f) => f.endsWith('.json'));
  } catch {
    return { receipts: [], substrateStatus: 'local-read-error' };
  }

  const receipts = [];
  for (const entry of entries) {
    const parsed = readJsonFile(join(storeDir, entry));
    if (parsed && typeof parsed === 'object') receipts.push(parsed);
  }

  return { receipts, substrateStatus: 'local' };
}

// ---------------------------------------------------------------------------
// Public API: runAudit
// ---------------------------------------------------------------------------

/**
 * Runs the full MCP audit against a project root.
 *
 * @param {string} [root] — project root (default process.cwd())
 * @param {{ host?: string }} [opts]
 * @returns {AuditReport}
 */
export function runAudit(root = process.cwd(), { host = 'claude-code' } = {}) {
  const { servers, configFound } = readMcpConfig(root);
  const { receipts, substrateStatus } = readLocalReceipts(root);
  return buildReport({ servers, receipts, configFound, substrateStatus, currentHost: host });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Renders a human-readable audit summary to stdout.
 * @param {AuditReport} report
 */
function renderReport(report) {
  const { configFound, substrateStatus, activeServers, receipts, flags, unusedServers } = report;
  console.log('\n=== MCP Audit Report ===');
  console.log(`Config found:      ${configFound}`);
  console.log(`Substrate:         ${substrateStatus}`);
  console.log(`Active servers:    ${activeServers.join(', ') || '(none)'}`);
  console.log(`Receipts in store: ${receipts}`);
  console.log(`Unused servers:    ${unusedServers.join(', ') || '(none)'}`);
  console.log(`\nFlags (${flags.length}):`);
  for (const f of flags) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.code} — ${f.message}`);
  }
  console.log('');
}

/** CLI: node mcp-audit.mjs [--json] [--root <path>] [--host <name>] */
function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 ? resolve(args[rootIdx + 1] ?? process.cwd()) : process.cwd();
  const hostIdx = args.indexOf('--host');
  const host = hostIdx !== -1 ? (args[hostIdx + 1] ?? 'claude-code') : 'claude-code';

  const report = runAudit(root, { host });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderReport(report);
  }
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (isMain) {
  try { main(); } catch (err) {
    process.stderr.write(`mcp-audit: unexpected error: ${err.message}\n`);
    process.exit(0); // hook contract: exit 0
  }
}
