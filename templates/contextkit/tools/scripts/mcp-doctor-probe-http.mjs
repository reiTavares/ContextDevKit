/**
 * mcp-doctor-probe-http.mjs — Streamable HTTP transport probe for /mcp doctor (MCP-004).
 *
 * Responsibility: one function — probeHttp. Sends an HTTP POST to <url>/mcp
 * with a JSON-RPC initialize request and parses the response (plain JSON or
 * SSE data frame). Returns a ProbeResult. Never throws; times out after
 * PROBE_TIMEOUT_MS.
 *
 * Follows the MCP 2024-11-05 Streamable HTTP specification:
 *   POST <base>/mcp
 *   Content-Type: application/json
 *   Accept: application/json, text/event-stream
 *
 * Callers: mcp-doctor-core.mjs (runDoctorProbe dispatch).
 * Zero runtime deps — node:* only (immutable rule §1).
 *
 * @module mcp-doctor-probe-http
 */

import { request as httpRequest }  from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL }                     from 'node:url';
import { extractCapabilityNames }  from './mcp-doctor-helpers.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JSONRPC_VERSION    = '2.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const PROBE_TIMEOUT_MS   = 6000;

let _rpcId = 1;

/**
 * Builds a JSON-RPC initialize request body.
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
// SSE extraction helper
// ---------------------------------------------------------------------------

/**
 * Extracts the first `data:` line from an SSE stream body.
 * Falls back to the raw body if no data line is found.
 *
 * @param {string} body Raw response body.
 * @returns {string} JSON string to parse.
 */
function extractSseData(body) {
  const dataLine = body.split('\n').find((l) => l.startsWith('data:'));
  return dataLine ? dataLine.slice(5).trim() : body;
}

// ---------------------------------------------------------------------------
// probeHttp
// ---------------------------------------------------------------------------

/**
 * Probes a Streamable HTTP MCP server by POSTing an initialize request
 * to `<url>/mcp`. Handles both `application/json` and `text/event-stream`
 * response content types.
 *
 * Returns a ProbeResult (never throws; times out after PROBE_TIMEOUT_MS).
 *
 * @param {object}   opts
 * @param {string}   opts.server           Server id for result labeling.
 * @param {string}   opts.url              Base URL (e.g. 'http://localhost:3000').
 * @param {Record<string,string>} opts.headers  Extra HTTP headers (auth tokens, etc.).
 * @param {string|null} opts.pinnedVersion Version from config (null if unpinned).
 * @param {string[]} opts.rendersInto      Host names this server is configured for.
 * @returns {Promise<import('./mcp-doctor-core.mjs').ProbeResult>}
 */
export async function probeHttp({ server, url, headers, pinnedVersion, rendersInto }) {
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
      server, transport: 'streamable-http', rendersInto,
      status: 'fail', reason,
      tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion,
      versionMatch: pinnedVersion == null,
      latencyMs: null,
    });

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return failResult(`invalid URL: ${url}`);
    }

    const { body: initPayload } = buildInitRequest();
    const mcpPath   = parsed.pathname.replace(/\/?$/, '/mcp');
    const isHttps   = parsed.protocol === 'https:';
    const reqFn     = isHttps ? httpsRequest : httpRequest;
    const bodyBytes = Buffer.byteLength(initPayload);

    const reqOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     mcpPath,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyBytes,
        'Accept':         'application/json, text/event-stream',
        ...(headers ?? {}),
      },
    };

    timer = setTimeout(() => {
      try { req.destroy(); } catch { /* ignore */ }
      failResult(`probe timed out after ${PROBE_TIMEOUT_MS}ms`);
    }, PROBE_TIMEOUT_MS);

    const req = reqFn(reqOptions, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        clearTimeout(timer);
        res.resume();
        return failResult(`auth error: HTTP ${res.statusCode}`);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer);
        res.resume();
        return failResult(`HTTP ${res.statusCode} from ${url}`);
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', (err) => { clearTimeout(timer); failResult(`response error: ${err.message}`); });
      res.on('end', () => {
        clearTimeout(timer);
        const body = Buffer.concat(chunks).toString('utf-8');
        const ct   = (res.headers['content-type'] ?? '').toLowerCase();
        const json = ct.includes('text/event-stream') ? extractSseData(body) : body;

        let rpcResult;
        try {
          rpcResult = JSON.parse(json);
        } catch {
          return failResult(`invalid JSON response: ${json.slice(0, 120)}`);
        }

        if (rpcResult.error) {
          return failResult(`JSON-RPC error ${rpcResult.error.code}: ${rpcResult.error.message}`);
        }

        // Constitution §8: graceful degradation must never produce a false pass.
        // A body that has neither .result nor .error is not a valid JSON-RPC response
        // (e.g. { "ok": true }); treat it as fail, not pass.
        if (!('result' in rpcResult)) {
          return failResult('JSON-RPC response missing .result field');
        }

        const result = rpcResult.result;
        const caps   = result.capabilities ?? {};

        settle({
          server, transport: 'streamable-http', rendersInto,
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
    });

    req.on('error', (err) => { clearTimeout(timer); failResult(`request error: ${err.message}`); });
    req.write(initPayload);
    req.end();
  });
}
