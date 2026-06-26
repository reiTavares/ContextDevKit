#!/usr/bin/env node
/**
 * selfcheck-mcp-004-pass.mjs — MCP-004 happy-path tests (Sections 5-6).
 *
 * Acceptance criteria covered:
 *   AC-1  ProbeResult fields are fully populated on a successful handshake:
 *         tools, resources, prompts, serverVersion, latencyMs, rendersInto, transport.
 *   AC-2  'pass' status on correct stdio handshake (echo fixture).
 *         version mismatch remains 'pass' but sets versionMatch=false.
 *   AC-3  Works for stdio transport; output host-neutral (rendersInto).
 *
 * Standalone-runnable: node tools/selfcheck-mcp-004-pass.mjs
 * Exits non-zero on any failure.
 */

import {
  coreModule,
  makeCounters,
  assert_ok,
  section,
  NODE,
} from './selfcheck-mcp-004-helpers.mjs';

const { runDoctorProbe } = coreModule;

const C = makeCounters();

// ---------------------------------------------------------------------------
// Section 5: AC-2 — 'pass' on correct handshake (stdio echo fixture)
// ---------------------------------------------------------------------------

section('5. AC-2 — good handshake → status pass (stdio echo fixture)');

{
  // Inline MCP server that responds correctly to `initialize`.
  const fixture = `
const lines = [];
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  lines.push(chunk);
  const joined = lines.join('');
  const nl = joined.indexOf('\\n');
  if (nl === -1) return;
  const line = joined.slice(0, nl).trim();
  try {
    const req = JSON.parse(line);
    if (req.method === 'initialize') {
      const resp = JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools:     [{ name: 'read_file' }, { name: 'write_file' }],
            resources: [{ name: 'filesystem' }],
            prompts:   [],
          },
          serverInfo: { name: 'fixture-server', version: '1.2.3' },
        },
      });
      process.stdout.write(resp + '\\n');
    }
  } catch (e) {}
});
`;

  const result = await runDoctorProbe({
    name:            'fixture-server',
    transport:       'stdio',
    command:         NODE,
    args:            ['-e', fixture],
    env:             {},
    requiredSecrets: [],
    version:         '1.2.3',
    rendersInto:     ['claude-code', 'codex'],
  });

  assert_ok(C, result.status === 'pass',
    'echo fixture → pass',
    `got: ${result.status}, reason: ${result.reason}`);
  assert_ok(C, result.tools.includes('read_file'),            'tool read_file enumerated');
  assert_ok(C, result.tools.includes('write_file'),           'tool write_file enumerated');
  assert_ok(C, result.resources.includes('filesystem'),       'resource filesystem enumerated');
  assert_ok(C, result.prompts.length === 0,                   'no prompts (empty array)');
  assert_ok(C, result.serverVersion === '1.2.3',              'serverVersion from handshake');
  assert_ok(C, result.versionMatch === true,                  'version matches pin');
  assert_ok(C, typeof result.latencyMs === 'number' && result.latencyMs >= 0, 'latency ≥ 0ms');
  assert_ok(C, result.transport === 'stdio',                  'transport = stdio');
  assert_ok(
    C,
    JSON.stringify(result.rendersInto) === JSON.stringify(['claude-code', 'codex']),
    'rendersInto preserved',
  );
}

// ---------------------------------------------------------------------------
// Section 6: AC-2 — version mismatch is still 'pass' (but versionMatch=false)
// ---------------------------------------------------------------------------

section('6. AC-2 — version mismatch → pass with versionMatch=false');

{
  // Fixture reports version 9.9.9; probe is pinned to 1.0.0.
  const fixture = `
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  try {
    const req = JSON.parse(chunk.trim());
    if (req.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: req.id,
        result: {
          capabilities: { tools: [], resources: [], prompts: [] },
          serverInfo: { version: '9.9.9' },
        },
      }) + '\\n');
    }
  } catch {}
});
`;

  const result = await runDoctorProbe({
    name:            'version-drift',
    transport:       'stdio',
    command:         NODE,
    args:            ['-e', fixture],
    env:             {},
    requiredSecrets: [],
    version:         '1.0.0',   // pinned to 1.0.0; server reports 9.9.9
    rendersInto:     ['claude-code'],
  });

  assert_ok(C, result.status === 'pass',          'still pass on version mismatch');
  assert_ok(C, result.versionMatch === false,     'versionMatch=false when server reports different version');
  assert_ok(C, result.serverVersion === '9.9.9',  'serverVersion from handshake');
  assert_ok(C, result.pinnedVersion === '1.0.0',  'pinnedVersion preserved');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- MCP-004-pass selfcheck: ${C.passed} passed, ${C.failed} failed ---\n`);
if (C.failed > 0) process.exit(1);
