#!/usr/bin/env node
/**
 * selfcheck-mcp-004-deny.mjs — MCP-004 skip/fail path tests (Sections 3-4).
 *
 * Acceptance criteria covered:
 *   AC-2  Three-way semantics — negative paths only:
 *           missing secret       → 'skipped'  (NOT fail, NOT pass)
 *           early-exit stdio     → 'fail'
 *           unreachable HTTP URL → 'fail'
 *           missing HTTP url     → 'fail'
 *           missing stdio command→ 'fail'
 *         Doctor never throws on a single broken server.
 *   AC-3  Zero-dep, defensive I/O — no crash on missing transport fields.
 *
 * Standalone-runnable: node tools/selfcheck-mcp-004-deny.mjs
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
// Section 3: AC-2 — 'skipped' when secret is missing
// ---------------------------------------------------------------------------

section('3. AC-2 — missing secret → status skipped (not fail, not pass)');

{
  const result = await runDoctorProbe({
    name:            'secret-server',
    transport:       'stdio',
    command:         'node',
    args:            ['-e', 'process.stdin.on("data",()=>{})'],
    env:             {},
    requiredSecrets: ['__CDK_NONEXISTENT_VAR_XYZ__'],
    version:         null,
    rendersInto:     ['claude-code'],
  });

  assert_ok(C, result.status === 'skipped',           'status is "skipped"',       `got: ${result.status}`);
  assert_ok(C, result.server === 'secret-server',     'server name preserved');
  assert_ok(C, result.tools.length === 0,             'tools empty on skip');
  assert_ok(C, result.latencyMs === null,             'latency null on skip');
  assert_ok(C, typeof result.reason === 'string' && result.reason.length > 0, 'reason present');
  assert_ok(C, result.rendersInto.includes('claude-code'), 'rendersInto preserved');
}

// ---------------------------------------------------------------------------
// Section 4: AC-2 — 'fail' on unreachable/bad-handshake
// ---------------------------------------------------------------------------

section('4. AC-2 — unreachable / bad handshake → status fail');

{
  // Stdio: command that exits immediately without responding to initialize.
  const result = await runDoctorProbe({
    name:            'exit-server',
    transport:       'stdio',
    command:         NODE,
    args:            ['-e', 'process.exit(1)'],
    env:             {},
    requiredSecrets: [],
    version:         null,
    rendersInto:     ['claude-code', 'cursor'],
  });

  assert_ok(C, result.status === 'fail',          'early-exit → fail',         `got: ${result.status}`);
  assert_ok(C, result.tools.length === 0,         'tools empty on fail');
  assert_ok(C, result.latencyMs === null,         'latency null on fail');
  assert_ok(C, typeof result.reason === 'string', 'reason is string');
  assert_ok(C, result.rendersInto.length === 2,   'rendersInto: both hosts');
}

{
  // HTTP: unreachable URL — nothing listening on this port.
  const result = await runDoctorProbe({
    name:            'http-dead-server',
    transport:       'streamable-http',
    url:             'http://127.0.0.1:19999',
    headers:         {},
    requiredSecrets: [],
    version:         null,
    rendersInto:     ['claude-code'],
  });

  assert_ok(C, result.status === 'fail',                   'unreachable HTTP → fail', `got: ${result.status}`);
  assert_ok(C, result.transport === 'streamable-http',     'transport preserved');
}

{
  // HTTP: missing url field.
  const result = await runDoctorProbe({
    name:            'http-no-url',
    transport:       'streamable-http',
    requiredSecrets: [],
    version:         null,
    rendersInto:     [],
  });

  assert_ok(C, result.status === 'fail',              'missing URL → fail');
  assert_ok(C, /url/i.test(result.reason ?? ''),      'reason mentions url');
}

{
  // Stdio: missing command field.
  const result = await runDoctorProbe({
    name:            'stdio-no-command',
    transport:       'stdio',
    requiredSecrets: [],
    version:         null,
    rendersInto:     [],
  });

  assert_ok(C, result.status === 'fail',                  'missing command → fail');
  assert_ok(C, /command/i.test(result.reason ?? ''),      'reason mentions command');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- MCP-004-deny selfcheck: ${C.passed} passed, ${C.failed} failed ---\n`);
if (C.failed > 0) process.exit(1);
