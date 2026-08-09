#!/usr/bin/env node
/**
 * selfcheck-mcp-004-report.mjs — MCP-004 report/render tests (Sections 7-8).
 *
 * Acceptance criteria covered:
 *   AC-5  buildDoctorReport correctly counts pass/fail/skipped from a result set.
 *         hasFailures is true only when at least one 'fail' result is present.
 *   AC-5  renderDoctorReport produces non-empty string output containing
 *         PASS/SKIP/FAIL labels, server names, tool names, latency values,
 *         and skip/fail reasons.
 *
 * Standalone-runnable: node tools/selfcheck-mcp-004-report.mjs
 * Exits non-zero on any failure.
 */

import {
  doctorModule,
  makeCounters,
  assert_ok,
  section,
} from './selfcheck-mcp-004-helpers.mjs';

const { buildDoctorReport, renderDoctorReport } = doctorModule;

const C = makeCounters();

// ---------------------------------------------------------------------------
// Section 7: buildDoctorReport — counter logic (AC-5)
// ---------------------------------------------------------------------------

section('7. buildDoctorReport — counter logic');

{
  /** @type {import('../templates/contextkit/tools/scripts/mcp-doctor-core.mjs').ProbeResult[]} */
  const mockResults = [
    {
      status: 'pass',    server: 'a', transport: 'stdio',
      rendersInto: [], tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion: null, versionMatch: true,
      latencyMs: 10, reason: null,
    },
    {
      status: 'pass',    server: 'b', transport: 'stdio',
      rendersInto: [], tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion: null, versionMatch: true,
      latencyMs: 20, reason: null,
    },
    {
      status: 'fail',    server: 'c', transport: 'stdio',
      rendersInto: [], tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion: null, versionMatch: true,
      latencyMs: null, reason: 'down',
    },
    {
      status: 'skipped', server: 'd', transport: 'stdio',
      rendersInto: [], tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion: null, versionMatch: true,
      latencyMs: null, reason: 'no secret',
    },
  ];

  const report = buildDoctorReport(mockResults);

  assert_ok(C, report.totalServers === 4,   'totalServers = 4');
  assert_ok(C, report.passed === 2,         'passed = 2');
  assert_ok(C, report.failed === 1,         'failed = 1');
  assert_ok(C, report.skipped === 1,        'skipped = 1');
  assert_ok(C, report.hasFailures === true, 'hasFailures = true when failed > 0');

  const allPass = buildDoctorReport(mockResults.slice(0, 2));
  assert_ok(C, allPass.hasFailures === false, 'hasFailures = false when all pass');
}

// ---------------------------------------------------------------------------
// Section 8: renderDoctorReport — smoke test (AC-5)
// ---------------------------------------------------------------------------

section('8. renderDoctorReport — smoke test');

{
  const report = buildDoctorReport([
    {
      status: 'pass', server: 'myserver', transport: 'stdio',
      rendersInto: ['claude-code'], tools: ['read'], resources: [], prompts: [],
      serverVersion: '1.0.0', pinnedVersion: '1.0.0', versionMatch: true,
      latencyMs: 42, reason: null,
    },
    {
      status: 'skipped', server: 'secretsrv', transport: 'streamable-http',
      rendersInto: ['cursor'], tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion: null, versionMatch: true,
      latencyMs: null, reason: 'Missing: MY_TOKEN',
    },
    {
      status: 'fail', server: 'badsrv', transport: 'stdio',
      rendersInto: [], tools: [], resources: [], prompts: [],
      serverVersion: null, pinnedVersion: null, versionMatch: true,
      latencyMs: null, reason: 'connection refused',
    },
  ]);

  const text = renderDoctorReport(report);
  assert_ok(C, typeof text === 'string' && text.length > 0,  'render returns non-empty string');
  assert_ok(C, text.includes('PASS'),                        'render shows PASS');
  assert_ok(C, text.includes('SKIP'),                        'render shows SKIP');
  assert_ok(C, text.includes('FAIL'),                        'render shows FAIL');
  assert_ok(C, text.includes('myserver'),                    'render shows server name');
  assert_ok(C, text.includes('claude-code'),                 'render shows host name');
  assert_ok(C, text.includes('Missing: MY_TOKEN'),           'render shows skip reason');
  assert_ok(C, text.includes('connection refused'),          'render shows fail reason');
  assert_ok(C, text.includes('read'),                        'render shows tool name');
  assert_ok(C, text.includes('42ms'),                        'render shows latency');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- MCP-004-report selfcheck: ${C.passed} passed, ${C.failed} failed ---\n`);
if (C.failed > 0) process.exit(1);
