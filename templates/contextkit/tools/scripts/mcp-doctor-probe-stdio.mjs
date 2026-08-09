/**
 * mcp-doctor-probe-stdio.mjs — stdio transport probe for /mcp doctor (MCP-004).
 *
 * Responsibility: one function — probeStdio. Spawns the server command, sends
 * a JSON-RPC initialize request over stdin, reads the first response line, and
 * returns a ProbeResult. Never throws; times out after PROBE_TIMEOUT_MS.
 *
 * Callers: mcp-doctor-core.mjs (runDoctorProbe dispatch).
 * Zero runtime deps — node:* only (immutable rule §1).
 *
 * @module mcp-doctor-probe-stdio
 */

import { spawn } from 'node:child_process';
import { extractCapabilityNames } from './mcp-doctor-helpers.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** JSON-RPC protocol version used for MCP. */
const JSONRPC_VERSION = '2.0';

/** MCP protocol version we advertise. */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/** Probe timeout — keeps the doctor responsive. */
const PROBE_TIMEOUT_MS = 6000;

/** Monotonically increasing request id (per-process; reset on restart is fine). */
let _rpcId = 1;

/**
 * Builds a JSON-RPC initialize request body and its numeric id.
 * @returns {{ id: number, body: string }}
 */
function buildInitRequest() {
  const id = _rpcId++;
  return {
    id,
    body: JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      id,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'contextdevkit-doctor', version: '1.0.0' },
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// probeStdio
// ---------------------------------------------------------------------------

/**
 * Probes a stdio MCP server: spawns the command, sends `initialize` via stdin,
 * reads the first newline-delimited JSON response from stdout.
 *
 * Returns a ProbeResult (never throws; times out after PROBE_TIMEOUT_MS).
 *
 * @param {object}   opts
 * @param {string}   opts.server           Server id for result labeling.
 * @param {string}   opts.command          Executable (e.g. 'npx', 'node').
 * @param {string[]} opts.args             Argv for the command.
 * @param {Record<string,string>} opts.env Extra env vars (merged on top of process.env).
 * @param {string|null} opts.pinnedVersion Version from config (null if unpinned).
 * @param {string[]} opts.rendersInto      Host names this server is configured for.
 * @returns {Promise<import('./mcp-doctor-core.mjs').ProbeResult>}
 */
export async function probeStdio({ server, command, args, env, pinnedVersion, rendersInto }) {
  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let timer   = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const failResult = (reason) => settle({
      server, transport: 'stdio', rendersInto,
      status: 'fail', reason,
      tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion,
      versionMatch: pinnedVersion == null,
      latencyMs: null,
    });

    const { id: rpcId, body: initPayload } = buildInitRequest();

    let proc;
    try {
      proc = spawn(command, args ?? [], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (spawnErr) {
      return failResult(`spawn failed: ${spawnErr.message}`);
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      failResult(`probe timed out after ${PROBE_TIMEOUT_MS}ms`);
    }, PROBE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf-8');
      // MCP stdio uses newline-delimited JSON — wait for a complete line.
      const nl = stdoutBuf.indexOf('\n');
      if (nl === -1) return;
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf   = stdoutBuf.slice(nl + 1);
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return failResult(`invalid JSON response: ${line.slice(0, 120)}`);
      }

      if (parsed.error) {
        return failResult(`JSON-RPC error ${parsed.error.code}: ${parsed.error.message}`);
      }
      if (parsed.id !== rpcId) {
        return failResult(`unexpected response id ${parsed.id} (expected ${rpcId})`);
      }

      const result = parsed.result ?? {};
      const caps   = result.capabilities ?? {};

      settle({
        server, transport: 'stdio', rendersInto,
        status: 'pass', reason: null,
        tools:     extractCapabilityNames(caps, 'tools'),
        resources: extractCapabilityNames(caps, 'resources'),
        prompts:   extractCapabilityNames(caps, 'prompts'),
        serverVersion: result.serverInfo?.version ?? null,
        pinnedVersion,
        versionMatch: pinnedVersion == null || pinnedVersion === (result.serverInfo?.version ?? null),
        latencyMs: Date.now() - start,
      });
    });

    proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });
    proc.on('error', (err) => failResult(`process error: ${err.message}`));
    proc.on('close', (code) => {
      if (!settled) {
        const snippet = stderrBuf.slice(-200).trim();
        failResult(`process exited with code ${code}${snippet ? '; stderr: ' + snippet : ''}`);
      }
    });

    try {
      proc.stdin.write(initPayload + '\n');
      proc.stdin.end();
    } catch (writeErr) {
      failResult(`stdin write error: ${writeErr.message}`);
    }
  });
}
