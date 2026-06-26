#!/usr/bin/env node
/**
 * mcp-doctor.mjs — MCP server health-check I/O + CLI (MCP-004).
 *
 * WHY this module exists: operators need fast, decisive feedback on whether
 * each enabled MCP server is reachable, passes the protocol handshake, and
 * has its secrets available — without touching business logic.
 *
 * Responsibility split:
 *   - THIS FILE: config read, host mapping, render, CLI, exit logic.
 *   - mcp-doctor-core.mjs: probe logic (stdio / streamable-http) — pure, zero I/O.
 *
 * Exit semantics:
 *   - 0 — all servers passed or were skipped (missing secrets).
 *   - 1 — at least one server failed (unreachable / handshake error).
 *   - 0 — on unexpected internal error (hook contract: never break real work).
 *
 * Output is host-neutral: each result lists which host(s) the server renders
 * into (e.g. ['claude-code', 'cursor']) rather than assuming a single host.
 *
 * Zero runtime deps — node:* only (immutable rule §1, ADR-0001).
 *
 * @module mcp-doctor
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join }            from 'node:path';
import { runDoctorProbes }          from './mcp-doctor-core.mjs';

// ---------------------------------------------------------------------------
// Types (JSDoc only)
// ---------------------------------------------------------------------------

/**
 * @typedef {import('./mcp-doctor-core.mjs').ProbeResult} ProbeResult
 *
 * @typedef {Object} DoctorReport
 * @property {number}        totalServers
 * @property {number}        passed
 * @property {number}        failed
 * @property {number}        skipped
 * @property {boolean}       hasFailures
 * @property {ProbeResult[]} results
 */

// ---------------------------------------------------------------------------
// Internal: JSON helpers
// ---------------------------------------------------------------------------

const BOM = /^﻿/;

/**
 * Reads and parses a JSON file defensively (BOM-tolerant).
 * Returns the fallback on any error — never throws.
 *
 * @param {string}  filePath
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
function readJsonSafe(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    const text = readFileSync(filePath, 'utf-8').replace(BOM, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Internal: Config extraction
// ---------------------------------------------------------------------------

/**
 * Known host identifiers for host-presence determination.
 * Extend when a new host is added to the kit (ADR-0036 / ADR-0068).
 */
const KNOWN_HOSTS = ['claude-code', 'cursor', 'codex', 'antigravity', 'opencode'];

/**
 * Extracts server definitions from .claude/settings.json and the manifest,
 * then annotates each with which hosts it renders into.
 *
 * Priority: the manifest (if present) is authoritative for host bindings.
 * Settings.json is the fallback (legacy / non-manifest install).
 *
 * @param {string} root — project root
 * @returns {object[]} array of server definition objects ready for probing
 */
function extractServerDefs(root) {
  const settingsPath = join(root, '.claude', 'settings.json');
  const manifestPath = join(root, 'contextkit', 'mcp', 'project-manifest.json');

  const settings = readJsonSafe(settingsPath) ?? {};
  const manifest = readJsonSafe(manifestPath) ?? null;

  // ── Manifest path (preferred) ───────────────────────────────────────────
  if (manifest && typeof manifest === 'object' && Array.isArray(manifest.servers)) {
    return manifest.servers.map((srv) => {
      const allowedHosts =
        Array.isArray(srv.allowedHosts) && srv.allowedHosts.length > 0
          ? srv.allowedHosts
          : KNOWN_HOSTS;
      return {
        name:            srv.id ?? srv.name ?? '(unnamed)',
        transport:       srv.transport ?? 'stdio',
        command:         srv.command,
        args:            srv.args ?? [],
        url:             srv.url,
        env:             srv.env ?? {},
        requiredSecrets: Array.isArray(srv.requiredSecrets) ? srv.requiredSecrets : [],
        version:         srv.version ?? null,
        rendersInto:     allowedHosts,
      };
    });
  }

  // ── Settings.json path (fallback) ──────────────────────────────────────
  const mcpServers = settings.mcpServers ?? settings.mcp?.servers ?? {};
  if (!mcpServers || typeof mcpServers !== 'object') return [];

  return Object.entries(mcpServers).map(([name, def]) => {
    const d = def && typeof def === 'object' ? def : {};
    // env keys in settings.json may carry values — strip to key names for secret check
    const envKeys    = d.env && typeof d.env === 'object' ? Object.keys(d.env) : [];
    const envForProbe = d.env && typeof d.env === 'object' ? d.env : {};
    return {
      name,
      transport:       String(d.transport ?? d.type ?? 'stdio'),
      command:         d.command,
      args:            Array.isArray(d.args) ? d.args : [],
      url:             d.url,
      env:             envForProbe,
      requiredSecrets: envKeys,
      version:         d.version ? String(d.version) : null,
      rendersInto:     KNOWN_HOSTS, // settings.json has no host-binding info
    };
  });
}

// ---------------------------------------------------------------------------
// Internal: Report assembly
// ---------------------------------------------------------------------------

/**
 * Assembles a DoctorReport from ProbeResult[].
 *
 * @param {ProbeResult[]} results
 * @returns {DoctorReport}
 */
export function buildDoctorReport(results) {
  let passed = 0; let failed = 0; let skipped = 0;
  for (const r of results) {
    if (r.status === 'pass') passed++;
    else if (r.status === 'fail') failed++;
    else skipped++;
  }
  return { totalServers: results.length, passed, failed, skipped, hasFailures: failed > 0, results };
}

// ---------------------------------------------------------------------------
// Internal: Render
// ---------------------------------------------------------------------------

const HR = '─'.repeat(72);

/**
 * Renders the doctor report to a human-readable string.
 *
 * @param {DoctorReport} report
 * @returns {string}
 */
export function renderDoctorReport(report) {
  const { totalServers, passed, failed, skipped, results } = report;
  const lines = ['\n=== MCP Doctor Report ===\n'];

  if (totalServers === 0) {
    lines.push('No MCP servers configured.');
    lines.push('');
    return lines.join('\n');
  }

  for (const r of results) {
    const statusTag = r.status === 'pass' ? '[PASS]' : r.status === 'skipped' ? '[SKIP]' : '[FAIL]';
    lines.push(`${statusTag} ${r.server}  (${r.transport})`);
    lines.push(`  Hosts      : ${r.rendersInto.join(', ') || '(none)'}`);
    if (r.status === 'pass') {
      lines.push(`  Tools      : ${r.tools.length > 0 ? r.tools.join(', ') : '(none)'}`);
      lines.push(`  Resources  : ${r.resources.length > 0 ? r.resources.join(', ') : '(none)'}`);
      lines.push(`  Prompts    : ${r.prompts.length > 0 ? r.prompts.join(', ') : '(none)'}`);
      const versionStr = r.serverVersion ?? '(not reported)';
      const pinStr     = r.pinnedVersion ? ` (pinned: ${r.pinnedVersion})` : ' (unpinned)';
      const matchStr   = r.pinnedVersion ? (r.versionMatch ? ' ✓ match' : ' ✗ MISMATCH') : '';
      lines.push(`  Version    : ${versionStr}${pinStr}${matchStr}`);
      lines.push(`  Latency    : ${r.latencyMs}ms`);
    } else {
      lines.push(`  Reason     : ${r.reason ?? '(unknown)'}`);
    }
    lines.push(HR);
  }

  lines.push(`Summary: ${passed} passed, ${skipped} skipped, ${failed} failed  (${totalServers} total)`);
  if (failed > 0) {
    lines.push('');
    lines.push('One or more servers FAILED. Check the reasons above.');
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API: runDoctor
// ---------------------------------------------------------------------------

/**
 * Runs the full MCP doctor check against a project root.
 *
 * @param {string} [root] — project root (default process.cwd())
 * @returns {Promise<DoctorReport>}
 */
export async function runDoctor(root = process.cwd()) {
  const serverDefs = extractServerDefs(root);
  const results    = await runDoctorProbes(serverDefs);
  return buildDoctorReport(results);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/** CLI: node mcp-doctor.mjs [--json] [--root <path>] */
async function main() {
  const args     = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const rootIdx  = args.indexOf('--root');
  const root     = rootIdx !== -1 ? resolve(args[rootIdx + 1] ?? process.cwd()) : process.cwd();

  let report;
  try {
    report = await runDoctor(root);
  } catch (err) {
    // Defensive: should never reach here (runDoctor catches internally), but if it
    // does, print a safe message and exit 0 (hook contract: never break real work).
    process.stderr.write(`mcp-doctor: unexpected error: ${err.message}\n`);
    process.exit(0);
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderDoctorReport(report));
  }

  // Exit non-zero only on real failures; skipped is not a failure (AC-2).
  process.exit(report.hasFailures ? 1 : 0);
}

const isMain =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('mcp-doctor.mjs');

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`mcp-doctor: unexpected error: ${err.message}\n`);
    process.exit(0); // hook contract: exit 0
  });
}
