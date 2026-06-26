/**
 * mcp-doctor-core.mjs — Orchestrator + shared helpers for /mcp doctor (MCP-004).
 *
 * Responsibility split (three modules, one cohesive feature):
 *   - THIS FILE: shared pure helpers, secret check, runDoctorProbe dispatch,
 *     runDoctorProbes batch. No I/O; no rendering.
 *   - mcp-doctor-probe-stdio.mjs: stdio transport probe (spawn + JSON-RPC).
 *   - mcp-doctor-probe-http.mjs:  Streamable HTTP probe (HTTP POST + JSON-RPC).
 *
 * Three-way outcome (AC-2):
 *   pass    — handshake ok, capabilities enumerated, version checked.
 *   skipped — a required secret env var is absent; cannot verify without it.
 *   fail    — unreachable, crash, bad protocol, missing config fields.
 *
 * Doctor NEVER throws on a single broken server (AC-2); all probe errors are
 * caught and returned as { status: 'fail', reason } entries.
 *
 * Zero runtime deps — node:* only (immutable rule §1, ADR-0001).
 *
 * @module mcp-doctor-core
 */

import { probeStdio } from './mcp-doctor-probe-stdio.mjs';
import { probeHttp  } from './mcp-doctor-probe-http.mjs';
import { checkSecrets } from './mcp-doctor-helpers.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** MCP protocol version advertised in all probes. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

// ---------------------------------------------------------------------------
// Types (JSDoc only — zero runtime cost)
// ---------------------------------------------------------------------------

/**
 * @typedef {'pass'|'fail'|'skipped'} ProbeStatus
 *
 * @typedef {Object} ProbeResult
 * @property {string}        server           Server id from config.
 * @property {ProbeStatus}   status
 * @property {string}        transport        'stdio' | 'streamable-http'
 * @property {string[]}      rendersInto      Host names this server renders into.
 * @property {string[]}      tools            Tool names (empty on fail/skip).
 * @property {string[]}      resources        Resource names (empty on fail/skip).
 * @property {string[]}      prompts          Prompt names (empty on fail/skip).
 * @property {string|null}   serverVersion    Reported by the server on handshake.
 * @property {string|null}   pinnedVersion    Version from config (null if unpinned).
 * @property {boolean}       versionMatch     true if reported === pinned (or no pin).
 * @property {number|null}   latencyMs        Round-trip latency (null on fail/skip).
 * @property {string|null}   reason           Detail for fail/skip; null on pass.
 */

// ---------------------------------------------------------------------------
// Shared pure helpers (re-exported for callers who import from this module)
// ---------------------------------------------------------------------------

export { extractCapabilityNames, checkSecrets } from './mcp-doctor-helpers.mjs';

// ---------------------------------------------------------------------------
// runDoctorProbe — single-server dispatcher
// ---------------------------------------------------------------------------

/**
 * Runs the appropriate probe for one server definition.
 *
 * Server definition shape (from settings.json / manifest):
 * ```json
 * {
 *   "name":            "my-server",
 *   "transport":       "stdio" | "streamable-http",
 *   "command":         "node",           // stdio only
 *   "args":            ["server.mjs"],   // stdio only
 *   "url":             "http://...",     // streamable-http only
 *   "env":             { "KEY": "val" }, // env for the process / HTTP headers
 *   "requiredSecrets": ["API_TOKEN"],    // must be set; absent → 'skipped'
 *   "version":         "1.2.3",          // pin (optional)
 *   "rendersInto":     ["claude-code"]   // host binding (set by caller)
 * }
 * ```
 *
 * Never throws. Returns ProbeResult with status 'pass' | 'fail' | 'skipped'.
 *
 * @param {object} serverDef
 * @returns {Promise<ProbeResult>}
 */
export async function runDoctorProbe(serverDef) {
  const {
    name,
    transport,
    command,
    args,
    url,
    env,
    requiredSecrets,
    version: pinnedVersion = null,
    rendersInto = [],
  } = serverDef ?? {};

  const serverId   = typeof name === 'string' && name ? name : '(unnamed)';
  const transport_ = typeof transport === 'string' ? transport : 'stdio';

  // Secret check first — missing credentials → 'skipped' (never 'fail').
  const { ok: secretsOk, missing } = checkSecrets(requiredSecrets ?? []);
  if (!secretsOk) {
    return {
      server: serverId, transport: transport_, rendersInto,
      status: 'skipped',
      reason: `Missing required secret env vars: ${missing.join(', ')}`,
      tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion,
      versionMatch: pinnedVersion == null,
      latencyMs: null,
    };
  }

  try {
    if (transport_ === 'streamable-http') {
      if (!url || typeof url !== 'string') {
        return {
          server: serverId, transport: 'streamable-http', rendersInto,
          status: 'fail',
          reason: 'streamable-http server missing required "url" field',
          tools: [], resources: [], prompts: [],
          serverVersion: null, pinnedVersion, versionMatch: pinnedVersion == null,
          latencyMs: null,
        };
      }
      return await probeHttp({ server: serverId, url, headers: env ?? {}, pinnedVersion, rendersInto });
    }

    // Default: stdio
    if (!command || typeof command !== 'string') {
      return {
        server: serverId, transport: 'stdio', rendersInto,
        status: 'fail',
        reason: 'stdio server missing required "command" field',
        tools: [], resources: [], prompts: [],
        serverVersion: null, pinnedVersion, versionMatch: pinnedVersion == null,
        latencyMs: null,
      };
    }
    return await probeStdio({ server: serverId, command, args: args ?? [], env: env ?? {}, pinnedVersion, rendersInto });
  } catch (unexpected) {
    // Defensive catch-all — a bug in a probe module must never crash the doctor.
    return {
      server: serverId, transport: transport_, rendersInto,
      status: 'fail',
      reason: `unexpected probe error: ${unexpected?.message ?? String(unexpected)}`,
      tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion, versionMatch: pinnedVersion == null,
      latencyMs: null,
    };
  }
}

// ---------------------------------------------------------------------------
// runDoctorProbes — batch entry point
// ---------------------------------------------------------------------------

/**
 * Runs probes for all server definitions in parallel.
 *
 * Never throws — each individual probe captures its own failures.
 *
 * @param {object[]} serverDefs
 * @returns {Promise<ProbeResult[]>}
 */
export async function runDoctorProbes(serverDefs) {
  if (!Array.isArray(serverDefs) || serverDefs.length === 0) return [];
  return Promise.all(serverDefs.map((def) => runDoctorProbe(def)));
}
