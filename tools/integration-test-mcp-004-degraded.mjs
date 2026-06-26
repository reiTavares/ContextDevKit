/**
 * integration-test-mcp-004-degraded.mjs — MCP-004 CLI exit semantics,
 * runDoctor() API, and report building/rendering.
 *
 * Covers:
 *   Suite 5  — AC-2 + AC-5  CLI exit codes via mcp-doctor.mjs subprocess
 *                            (empty → 0, skip → 0, fail → 1, --json, BOM-safe I/O)
 *   Suite 7  — AC-3  runDoctor() API reads real project root
 *                    (empty config, absent dir, skipped server)
 *   Suite 10 — AC-5  buildDoctorReport + renderDoctorReport correctness
 *                    (counts, hasFailures semantics, render tokens)
 *
 * Run:  node tools/integration-test-mcp-004-degraded.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 * Zero test-framework deps (node:* only).
 */

import { mkdirSync, writeFileSync }                           from 'node:fs';
import { join }                                               from 'node:path';
import { spawnSync }                                          from 'node:child_process';
import { NODE, check, makeTmpRoot, cleanup, writeSettings, SCRIPTS, loadMcpModules }
  from './integration-test-mcp-004-helpers.mjs';
import { reporter } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;
const c = (cond, label, detail = '') => check(rep, cond, label, detail);

const { buildDoctorReport, renderDoctorReport, runDoctor, MCP_PROTOCOL_VERSION }
  = await loadMcpModules();

// ---------------------------------------------------------------------------
// [Suite 5] AC-2 + AC-5 — CLI exit semantics via subprocess
// ---------------------------------------------------------------------------
console.log('\n[Suite 5] AC-2 + AC-5 — CLI exit semantics via subprocess\n');

{
  const doctorScript = join(SCRIPTS, 'mcp-doctor.mjs');

  // Empty config → exit 0 (no failures)
  const rootEmpty = makeTmpRoot('-empty');
  try {
    writeSettings(rootEmpty, {});
    const res = spawnSync(NODE, [doctorScript, '--root', rootEmpty], {
      encoding: 'utf-8', env: process.env,
    });
    c(res.status === 0,                                       'AC-5: empty config → exit 0');
    c((res.stdout ?? '').includes('No MCP servers configured'),
                                                              'AC-5: empty config → "No MCP servers configured" in output');
  } finally {
    cleanup(rootEmpty);
  }

  // Config with a missing secret → exit 0 (skip ≠ failure)
  const rootSkip = makeTmpRoot('-skip');
  try {
    writeSettings(rootSkip, {
      'needs-secret': {
        command: NODE,
        args: ['-e', '{}'],
        transport: 'stdio',
        env: { __CDK_IT_SKIP_SECRET__: '' },
      },
    });
    const envWithout = { ...process.env };
    delete envWithout.__CDK_IT_SKIP_SECRET__;
    const res = spawnSync(NODE, [doctorScript, '--root', rootSkip], {
      encoding: 'utf-8', env: envWithout,
    });
    c(res.status === 0,                               'AC-5: skipped server → exit 0 (not exit 1)');
    c((res.stdout ?? '').includes('SKIP'),            'AC-5: skipped server → [SKIP] in output');
    c(!(res.stdout ?? '').includes('[FAIL]'),         'AC-5: skipped server → no [FAIL] in output');
  } finally {
    cleanup(rootSkip);
  }

  // Config with an unreachable server → exit 1 (real failure)
  const rootFail = makeTmpRoot('-fail');
  try {
    writeSettings(rootFail, {
      'dead-server': {
        command: NODE,
        args: ['-e', 'process.exit(42)'],
        transport: 'stdio',
        env: {},
      },
    });
    const res = spawnSync(NODE, [doctorScript, '--root', rootFail], {
      encoding: 'utf-8', env: process.env,
    });
    c(res.status === 1,                               'AC-5: failed server → exit 1');
    c((res.stdout ?? '').includes('[FAIL]'),          'AC-5: failed server → [FAIL] in output');
    c(!(res.stdout ?? '').includes('[PASS]'),         'AC-5: failed server → no [PASS] in output');
  } finally {
    cleanup(rootFail);
  }

  // --json flag: output is valid JSON with expected shape
  const rootJson = makeTmpRoot('-json');
  try {
    writeSettings(rootJson, {});
    const res = spawnSync(NODE, [doctorScript, '--root', rootJson, '--json'], {
      encoding: 'utf-8', env: process.env,
    });
    let parsed;
    try { parsed = JSON.parse(res.stdout ?? ''); } catch { /* handled below */ }
    c(parsed !== undefined && parsed !== null,        'AC-5: --json produces valid JSON');
    c(typeof parsed?.totalServers === 'number',       'AC-5: JSON output has totalServers');
    c(typeof parsed?.hasFailures === 'boolean',       'AC-5: JSON output has hasFailures');
    c(Array.isArray(parsed?.results),                 'AC-5: JSON output has results array');
  } finally {
    cleanup(rootJson);
  }

  // BOM-corrupt settings.json → graceful degrade, exit 0 (defensive I/O)
  const rootBom = makeTmpRoot('-bom');
  try {
    const clDir = join(rootBom, '.claude');
    mkdirSync(clDir, { recursive: true });
    writeFileSync(join(clDir, 'settings.json'), '﻿{ "mcpServers": {} }', 'utf-8');
    const res = spawnSync(NODE, [doctorScript, '--root', rootBom], {
      encoding: 'utf-8', env: process.env,
    });
    c(res.status === 0, 'AC-2: BOM-prefixed settings.json → exit 0 (defensive I/O)');
  } finally {
    cleanup(rootBom);
  }
}

// ---------------------------------------------------------------------------
// [Suite 7] AC-3 — runDoctor() reads project root settings
// ---------------------------------------------------------------------------
console.log('\n[Suite 7] AC-3 — runDoctor() reads project root settings\n');

{
  // Empty config
  const rootEmpty = makeTmpRoot('-doctor-empty');
  try {
    writeSettings(rootEmpty, {});
    const report = await runDoctor(rootEmpty);
    c(report.totalServers === 0,     'AC-3: runDoctor on empty config → 0 servers');
    c(report.hasFailures === false,  'AC-3: runDoctor on empty config → no failures');
    c(Array.isArray(report.results), 'AC-3: runDoctor returns results array');
  } finally {
    cleanup(rootEmpty);
  }

  // Absent .claude dir → graceful degrade (defensive I/O)
  const rootAbsent = makeTmpRoot('-doctor-absent');
  try {
    const report = await runDoctor(rootAbsent);
    c(report.totalServers === 0,     'AC-3: missing .claude dir → 0 servers (graceful degrade)');
    c(report.hasFailures === false,  'AC-3: missing .claude dir → no failures');
  } finally {
    cleanup(rootAbsent);
  }

  // Settings with skipped server → hasFailures=false (skip ≠ fail)
  const rootSkipped = makeTmpRoot('-doctor-skip');
  try {
    writeSettings(rootSkipped, {
      'skip-me': {
        command: NODE, args: [], transport: 'stdio',
        env: { __CDK_IT_DOCTOR_SKIP__: '' },
      },
    });
    if (!process.env.__CDK_IT_DOCTOR_SKIP__) {
      const report = await runDoctor(rootSkipped);
      c(report.hasFailures === false, 'AC-3: skipped server → hasFailures=false');
      const skipResult = report.results.find(r => r.server === 'skip-me');
      if (skipResult) {
        c(skipResult.status === 'skipped', 'AC-3: skipped result has status=skipped');
      }
    } else {
      ok('AC-3: __CDK_IT_DOCTOR_SKIP__ set in env — skip verification skipped');
    }
  } finally {
    cleanup(rootSkipped);
  }
}

// ---------------------------------------------------------------------------
// [Suite 10] AC-5 — buildDoctorReport + renderDoctorReport
// ---------------------------------------------------------------------------
console.log('\n[Suite 10] AC-5 — buildDoctorReport + renderDoctorReport\n');

{
  const mockPass = {
    status: 'pass', server: 'alpha', transport: 'stdio', rendersInto: ['claude-code'],
    tools: ['get'], resources: ['r1'], prompts: [], serverVersion: '1.0', pinnedVersion: '1.0',
    versionMatch: true, latencyMs: 15, reason: null,
  };
  const mockFail = {
    status: 'fail', server: 'beta', transport: 'stdio', rendersInto: [],
    tools: [], resources: [], prompts: [], serverVersion: null, pinnedVersion: null,
    versionMatch: true, latencyMs: null, reason: 'connection refused',
  };
  const mockSkip = {
    status: 'skipped', server: 'gamma', transport: 'streamable-http', rendersInto: ['cursor'],
    tools: [], resources: [], prompts: [], serverVersion: null, pinnedVersion: null,
    versionMatch: true, latencyMs: null, reason: 'Missing: MY_TOKEN',
  };

  const report = buildDoctorReport([mockPass, mockFail, mockSkip]);
  c(report.totalServers === 3,     'AC-5: totalServers=3');
  c(report.passed  === 1,          'AC-5: passed=1');
  c(report.failed  === 1,          'AC-5: failed=1');
  c(report.skipped === 1,          'AC-5: skipped=1');
  c(report.hasFailures === true,   'AC-5: hasFailures=true when failed>0');
  c(Array.isArray(report.results), 'AC-5: results is array');
  c(report.results.length === 3,   'AC-5: results length matches input');

  // All-pass: hasFailures must be false
  const allPass = buildDoctorReport([mockPass, { ...mockPass, server: 'delta' }]);
  c(allPass.hasFailures === false, 'AC-5: hasFailures=false when all pass');

  // All-skip: hasFailures must be false (skip ≠ failure)
  const allSkip = buildDoctorReport([mockSkip, { ...mockSkip, server: 'epsilon' }]);
  c(allSkip.hasFailures === false, 'AC-5: hasFailures=false when all skipped');
  c(allSkip.failed === 0,          'AC-5: failed=0 on all-skip');

  // renderDoctorReport: smoke test — correct tokens in output
  const rendered = renderDoctorReport(report);
  c(typeof rendered === 'string' && rendered.length > 0, 'AC-5: renderDoctorReport returns non-empty string');
  c(rendered.includes('[PASS]'),               'AC-5: render shows [PASS]');
  c(rendered.includes('[FAIL]'),               'AC-5: render shows [FAIL]');
  c(rendered.includes('[SKIP]'),               'AC-5: render shows [SKIP]');
  c(rendered.includes('alpha'),                'AC-5: render shows pass server name');
  c(rendered.includes('beta'),                 'AC-5: render shows fail server name');
  c(rendered.includes('gamma'),                'AC-5: render shows skip server name');
  c(rendered.includes('connection refused'),   'AC-5: render shows fail reason');
  c(rendered.includes('Missing: MY_TOKEN'),    'AC-5: render shows skip reason');
  c(rendered.includes('claude-code'),          'AC-5: render shows rendersInto host name');
  c(rendered.includes('15ms'),                 'AC-5: render shows latency');
  c(rendered.includes('get'),                  'AC-5: render shows tool name');

  // Empty report
  const emptyReport   = buildDoctorReport([]);
  const emptyRendered = renderDoctorReport(emptyReport);
  c(emptyRendered.includes('No MCP servers configured'), 'AC-5: empty report renders correctly');

  // MCP_PROTOCOL_VERSION is exported and non-empty
  c(typeof MCP_PROTOCOL_VERSION === 'string' && MCP_PROTOCOL_VERSION.length > 0,
    'AC-5: MCP_PROTOCOL_VERSION exported from core');
}

// ---------------------------------------------------------------------------
finish('MCP-004 degraded / CLI / report semantics');
