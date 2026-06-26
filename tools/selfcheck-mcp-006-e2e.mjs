#!/usr/bin/env node
/**
 * MCP-006 self-check — Suite 6: stdio JSON-RPC end-to-end.
 *
 * Spawns server.mjs as a child process, sends 7 JSON-RPC requests over stdin,
 * and verifies each response:
 *   - initialize → protocolVersion present
 *   - tools/list → 10 tools
 *   - resources/list → 6 resources
 *   - prompts/list → 5 prompts
 *   - tools/call get_project_state → content present
 *   - resources/read latest-session → contents present
 *   - ping → empty result
 *
 * Standalone-runnable: node tools/selfcheck-mcp-006-e2e.mjs
 * Exits non-zero on any failure.
 *
 * @module selfcheck-mcp-006-e2e
 */
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { MCP_SERVER_DIR, makeReporter } from './selfcheck-mcp-006-helpers.mjs';

const { ok, bad, summary, hasFailed } = makeReporter();

console.log('\nSuite 6 — stdio JSON-RPC end-to-end');

const SERVER_PATH = resolve(MCP_SERVER_DIR, 'server.mjs');

await new Promise((resolveTest) => {
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const rl = createInterface({ input: child.stdout, terminal: false });
  const responses = [];
  rl.on('line', (line) => {
    try { responses.push(JSON.parse(line)); } catch { /* skip non-JSON lines */ }
  });

  const stderrChunks = [];
  child.stderr.on('data', (d) => stderrChunks.push(d));

  const requests = [
    {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '0.0.0' },
        capabilities: {},
      },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/list',     params: {} },
    { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} },
    { jsonrpc: '2.0', id: 4, method: 'prompts/list',   params: {} },
    {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'get_project_state', arguments: {} },
    },
    {
      jsonrpc: '2.0', id: 6, method: 'resources/read',
      params: { uri: 'contextdevkit://memory/latest-session' },
    },
    { jsonrpc: '2.0', id: 7, method: 'ping', params: {} },
  ];

  for (const req of requests) {
    child.stdin.write(JSON.stringify(req) + '\n');
  }

  // Allow the server time to process all requests, then close stdin.
  setTimeout(() => { child.stdin.end(); }, 2000);

  child.on('close', () => {
    const byId = Object.fromEntries(responses.map((r) => [r.id, r]));

    // initialize
    if (byId[1]?.result?.protocolVersion) {
      ok('initialize response has protocolVersion');
    } else {
      bad('initialize response', JSON.stringify(byId[1]));
    }

    // tools/list
    const toolNames = (byId[2]?.result?.tools || []).map((t) => t.name);
    if (toolNames.length === 10) {
      ok('tools/list returns 10 tools');
    } else {
      bad('tools/list count', `got ${toolNames.length}: ${toolNames.join(', ')}`);
    }

    // resources/list
    const resUris = (byId[3]?.result?.resources || []).map((r) => r.uri);
    if (resUris.length === 6) {
      ok('resources/list returns 6 resources');
    } else {
      bad('resources/list count', `got ${resUris.length}`);
    }

    // prompts/list
    const promptNames = (byId[4]?.result?.prompts || []).map((p) => p.name);
    if (promptNames.length === 5) {
      ok('prompts/list returns 5 prompts');
    } else {
      bad('prompts/list count', `got ${promptNames.length}`);
    }

    // tools/call get_project_state
    const toolCallResult = byId[5]?.result;
    if (toolCallResult?.content?.[0]?.text) {
      ok('tools/call get_project_state returns content');
    } else {
      bad('tools/call get_project_state', JSON.stringify(byId[5]));
    }

    // resources/read latest-session
    const resReadResult = byId[6]?.result;
    if (resReadResult?.contents?.[0]?.text) {
      ok('resources/read latest-session returns contents');
    } else {
      bad('resources/read latest-session', JSON.stringify(byId[6]));
    }

    // ping
    if (byId[7]?.result !== undefined) {
      ok('ping returns empty result');
    } else {
      bad('ping response', JSON.stringify(byId[7]));
    }

    resolveTest();
  });

  child.on('error', (err) => {
    bad('child process spawned without error', err.message);
    resolveTest();
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nMCP-006/e2e: ${summary()}\n`);
process.exit(hasFailed() ? 1 : 0);
