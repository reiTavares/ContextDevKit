/**
 * integration-test-mcp-004-deny.mjs — MCP-004 failure / denial / three-way semantics.
 *
 * Covers:
 *   Suite 2  — AC-2  missing secret → skipped (NEVER fail, NEVER pass)
 *   Suite 3  — AC-2  unreachable / bad handshake → fail (all stdio + HTTP deny paths)
 *   Suite 4  — AC-2  runDoctorProbes never throws; buildDoctorReport exit semantics
 *                    (hasFailures is false on all-skip, true only on real failures)
 *
 * Run:  node tools/integration-test-mcp-004-deny.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 * Zero test-framework deps (node:* only).
 */

import { NODE, check, loadMcpModules } from './integration-test-mcp-004-helpers.mjs';
import { reporter }                     from './it-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;
const c = (cond, label, detail = '') => check(rep, cond, label, detail);

const { runDoctorProbe, runDoctorProbes, buildDoctorReport } = await loadMcpModules();

// ---------------------------------------------------------------------------
// [Suite 2] AC-2 — missing secret → skipped (never fail, never pass)
// ---------------------------------------------------------------------------
console.log('\n[Suite 2] AC-2 — missing secret → skipped (never fail, never pass)\n');

{
  const result = await runDoctorProbe({
    name: 'needs-secret', transport: 'stdio',
    command: NODE, args: ['-e', 'process.stdin.on("data",()=>{})'], env: {},
    requiredSecrets: ['__CDK_IT_ABSENT_SECRET_XYZ__'],
    version: null, rendersInto: ['claude-code'],
  });

  c(result.status === 'skipped',                 'AC-2: missing secret → status=skipped');
  c(result.status !== 'fail',                    'AC-2: status is NOT fail');
  c(result.status !== 'pass',                    'AC-2: status is NOT pass');
  c(result.server === 'needs-secret',            'AC-2: server name preserved on skip');
  c(result.tools.length === 0,                   'AC-2: tools empty on skip');
  c(result.resources.length === 0,               'AC-2: resources empty on skip');
  c(result.prompts.length === 0,                 'AC-2: prompts empty on skip');
  c(result.latencyMs === null,                   'AC-2: latencyMs=null on skip');
  c(typeof result.reason === 'string'
    && result.reason.length > 0,                 'AC-2: reason is non-empty string on skip');
  c(result.reason.includes('__CDK_IT_ABSENT_SECRET_XYZ__'),
                                                 'AC-2: reason names the missing var');
}

// ---------------------------------------------------------------------------
// [Suite 3] AC-2 — unreachable / bad handshake → fail
// ---------------------------------------------------------------------------
console.log('\n[Suite 3] AC-2 — unreachable / bad handshake → fail\n');

{
  // Stdio: exits immediately without responding
  const exitResult = await runDoctorProbe({
    name: 'early-exit', transport: 'stdio',
    command: NODE, args: ['-e', 'process.exit(1)'], env: {},
    requiredSecrets: [], version: null, rendersInto: ['claude-code'],
  });
  c(exitResult.status === 'fail',                     'AC-2: early-exit → fail');
  c(exitResult.tools.length === 0,                    'AC-2: tools empty on fail');
  c(exitResult.latencyMs === null,                    'AC-2: latencyMs=null on fail');
  c(typeof exitResult.reason === 'string',            'AC-2: reason is string on fail');
  c(exitResult.rendersInto.includes('claude-code'),   'AC-2: rendersInto preserved on fail');

  // Stdio: invalid JSON response
  const badJsonFixture = `
process.stdin.setEncoding('utf-8');
process.stdin.on('data', () => { process.stdout.write('NOT_JSON\\n'); });
`;
  const badJsonResult = await runDoctorProbe({
    name: 'bad-json', transport: 'stdio',
    command: NODE, args: ['-e', badJsonFixture], env: {},
    requiredSecrets: [], version: null, rendersInto: [],
  });
  c(badJsonResult.status === 'fail',               'AC-2: invalid JSON response → fail');
  c(/invalid JSON/i.test(badJsonResult.reason ?? ''), 'AC-2: reason mentions invalid JSON');

  // Stdio: JSON-RPC error response
  const rpcErrFixture = `
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  try {
    const req = JSON.parse(chunk.trim());
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: req.id,
      error: { code: -32601, message: 'Method not found' },
    }) + '\\n');
  } catch {}
});
`;
  const rpcErrResult = await runDoctorProbe({
    name: 'rpc-error', transport: 'stdio',
    command: NODE, args: ['-e', rpcErrFixture], env: {},
    requiredSecrets: [], version: null, rendersInto: [],
  });
  c(rpcErrResult.status === 'fail',                        'AC-2: JSON-RPC error response → fail');
  c(/Method not found/i.test(rpcErrResult.reason ?? ''),   'AC-2: reason contains RPC message');

  // Stdio: missing "command" field
  const noCmd = await runDoctorProbe({
    name: 'no-command', transport: 'stdio',
    requiredSecrets: [], version: null, rendersInto: [],
  });
  c(noCmd.status === 'fail',              'AC-2: missing command field → fail');
  c(/command/i.test(noCmd.reason ?? ''), 'AC-2: reason mentions "command"');

  // HTTP: unreachable URL
  const httpDead = await runDoctorProbe({
    name: 'http-dead', transport: 'streamable-http',
    url: 'http://127.0.0.1:19997', headers: {},
    requiredSecrets: [], version: null, rendersInto: ['claude-code'],
  });
  c(httpDead.status === 'fail',                   'AC-2: unreachable HTTP → fail');
  c(httpDead.transport === 'streamable-http',     'AC-2: transport preserved on HTTP fail');

  // HTTP: missing url field
  const httpNoUrl = await runDoctorProbe({
    name: 'http-no-url', transport: 'streamable-http',
    requiredSecrets: [], version: null, rendersInto: [],
  });
  c(httpNoUrl.status === 'fail',           'AC-2: missing url field → fail');
  c(/url/i.test(httpNoUrl.reason ?? ''),   'AC-2: reason mentions "url"');

  // HTTP: invalid URL string
  const httpInvalidUrl = await runDoctorProbe({
    name: 'http-invalid-url', transport: 'streamable-http',
    url: ':::not-a-url:::', headers: {},
    requiredSecrets: [], version: null, rendersInto: [],
  });
  c(httpInvalidUrl.status === 'fail', 'AC-2: invalid URL string → fail');
}

// ---------------------------------------------------------------------------
// [Suite 4] AC-2 — runDoctorProbes never throws; exit semantics
// ---------------------------------------------------------------------------
console.log('\n[Suite 4] AC-2 — runDoctorProbes never throws; exit semantics\n');

{
  const defs = [
    { name: 'b1', transport: 'stdio', command: NODE, args: ['-e', 'process.exit(2)'], env: {}, requiredSecrets: [], version: null, rendersInto: [] },
    { name: 'b2', transport: 'streamable-http', url: 'http://127.0.0.1:19996', headers: {}, requiredSecrets: [], version: null, rendersInto: [] },
    { name: 's1', transport: 'stdio', command: NODE, args: [], env: {}, requiredSecrets: ['__CDK_IT_ABSENT_S2__'], version: null, rendersInto: [] },
  ];

  let threw = false;
  let results;
  try {
    results = await runDoctorProbes(defs);
  } catch {
    threw = true;
  }

  c(!threw,                         'AC-2: runDoctorProbes never throws');
  c(Array.isArray(results),         'AC-2: runDoctorProbes returns array');
  c(results.length === 3,           'AC-2: one result per server def');
  c(results[0].status === 'fail',   'AC-2: broken stdio → fail');
  c(results[1].status === 'fail',   'AC-2: unreachable HTTP → fail');
  c(results[2].status === 'skipped','AC-2: missing secret → skipped (not fail)');

  // buildDoctorReport: hasFailures=true only when failed>0
  const reportWithFails = buildDoctorReport(results);
  c(reportWithFails.hasFailures === true, 'AC-2: hasFailures=true when failures exist');
  c(reportWithFails.failed === 2,         'AC-2: failed count correct');
  c(reportWithFails.skipped === 1,        'AC-2: skipped count correct');
  c(reportWithFails.passed === 0,         'AC-2: passed count correct');

  // All-skip scenario: hasFailures must be false (skipped ≠ failure)
  const skipOnlyDefs = [
    { name: 'sk1', transport: 'stdio', command: NODE, args: [], env: {}, requiredSecrets: ['__CDK_IT_SK1__'], version: null, rendersInto: [] },
    { name: 'sk2', transport: 'stdio', command: NODE, args: [], env: {}, requiredSecrets: ['__CDK_IT_SK2__'], version: null, rendersInto: [] },
  ];
  const skipOnlyResults = await runDoctorProbes(skipOnlyDefs);
  const skipOnlyReport  = buildDoctorReport(skipOnlyResults);
  c(skipOnlyReport.hasFailures === false, 'AC-2: all-skip → hasFailures=false');
  c(skipOnlyReport.skipped === 2,         'AC-2: all-skip → skipped=2');
  c(skipOnlyReport.failed === 0,          'AC-2: all-skip → failed=0');
}

// ---------------------------------------------------------------------------
finish('MCP-004 deny / failure / three-way semantics');
