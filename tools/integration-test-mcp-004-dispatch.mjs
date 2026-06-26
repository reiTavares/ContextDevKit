/**
 * integration-test-mcp-004-dispatch.mjs — MCP-004 transport coverage + dispatcher.
 *
 * Covers:
 *   Suite 6  — AC-3  stdio AND streamable-http probes; host-neutral rendersInto
 *                    (rendersInto is always an array regardless of outcome)
 *   Suite 8  — AC-4  mcp.mjs is a dispatcher only — no business logic;
 *                    unknown subcommand → exit 0; --help, no-args; SUBCOMMAND_MAP;
 *                    correct delegation to mcp-doctor/mcp-audit/mcp-receipt
 *   Suite 9  — AC-4  mcp.mjs doctor dispatch end-to-end (empty config → exit 0)
 *
 * Run:  node tools/integration-test-mcp-004-dispatch.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 * Zero test-framework deps (node:* only).
 */

import { readFileSync }                                               from 'node:fs';
import { join }                                                       from 'node:path';
import { spawnSync }                                                  from 'node:child_process';
import { NODE, check, makeTmpRoot, cleanup, writeSettings, SCRIPTS, loadMcpModules }
  from './integration-test-mcp-004-helpers.mjs';
import { reporter } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;
const c = (cond, label, detail = '') => check(rep, cond, label, detail);

const { runDoctorProbe } = await loadMcpModules();

// ---------------------------------------------------------------------------
// [Suite 6] AC-3 — stdio + HTTP probes; host-neutral rendersInto
// ---------------------------------------------------------------------------
console.log('\n[Suite 6] AC-3 — stdio + HTTP probes; host-neutral rendersInto\n');

{
  const stdioFixture = `
const buf = [];
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buf.push(chunk);
  const joined = buf.join('');
  const nl = joined.indexOf('\\n');
  if (nl === -1) return;
  try {
    const req = JSON.parse(joined.slice(0, nl).trim());
    if (req.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: req.id,
        result: {
          capabilities: { tools: [{ name: 'ping' }], resources: [], prompts: [] },
          serverInfo: { version: '1.0.0' },
        },
      }) + '\\n');
    }
  } catch {}
});
`;
  const stdioResult = await runDoctorProbe({
    name: 'stdio-probe', transport: 'stdio',
    command: NODE, args: ['-e', stdioFixture], env: {},
    requiredSecrets: [], version: null,
    rendersInto: ['claude-code', 'cursor', 'opencode'],
  });
  c(stdioResult.status === 'pass',                       'AC-3: stdio probe passes');
  c(stdioResult.transport === 'stdio',                   'AC-3: transport=stdio');
  c(stdioResult.rendersInto.includes('claude-code'),     'AC-3: rendersInto claude-code');
  c(stdioResult.rendersInto.includes('cursor'),          'AC-3: rendersInto cursor');
  c(stdioResult.rendersInto.includes('opencode'),        'AC-3: rendersInto opencode');
  c(stdioResult.tools.includes('ping'),                  'AC-3: tool ping enumerated');

  // HTTP probe: unreachable → fail, but transport field is correct
  const httpResult = await runDoctorProbe({
    name: 'http-probe', transport: 'streamable-http',
    url: 'http://127.0.0.1:19995', headers: {},
    requiredSecrets: [], version: null,
    rendersInto: ['claude-code', 'antigravity'],
  });
  c(httpResult.transport === 'streamable-http',          'AC-3: HTTP transport preserved on fail');
  c(httpResult.status === 'fail',                        'AC-3: unreachable HTTP → fail');
  c(httpResult.rendersInto.includes('antigravity'),      'AC-3: rendersInto antigravity preserved');

  // rendersInto is always an array regardless of outcome
  for (const r of [stdioResult, httpResult]) {
    c(Array.isArray(r.rendersInto), `AC-3: rendersInto is always array (${r.server})`);
  }
}

// ---------------------------------------------------------------------------
// [Suite 8] AC-4 — mcp.mjs is a dispatcher only
// ---------------------------------------------------------------------------
console.log('\n[Suite 8] AC-4 — mcp.mjs is a dispatcher only\n');

{
  const mcpScript = join(SCRIPTS, 'mcp.mjs');

  // Unknown subcommand → exit 0 (hook contract), output mentions "unknown"
  const resUnknown = spawnSync(NODE, [mcpScript, 'xyzzy-not-a-subcommand'], {
    encoding: 'utf-8', env: process.env,
  });
  c(resUnknown.status === 0,          'AC-4: unknown subcommand → exit 0 (hook contract)');
  const combinedUnknown = (resUnknown.stdout ?? '') + (resUnknown.stderr ?? '');
  c(combinedUnknown.includes('unknown'), 'AC-4: output mentions "unknown" for bad subcommand');

  // --help → exit 0, usage lists all known subcommands
  const resHelp = spawnSync(NODE, [mcpScript, '--help'], {
    encoding: 'utf-8', env: process.env,
  });
  c(resHelp.status === 0,          'AC-4: --help → exit 0');
  const helpOut = resHelp.stdout ?? '';
  c(helpOut.includes('doctor'),    'AC-4: --help mentions "doctor"');
  c(helpOut.includes('audit'),     'AC-4: --help mentions "audit"');
  c(helpOut.includes('discover'),  'AC-4: --help mentions "discover"');
  c(helpOut.includes('receipt'),   'AC-4: --help mentions "receipt"');
  c(helpOut.includes('--root'),    'AC-4: --help mentions "--root"');

  // No args → exit 0, usage shown
  const resNoArgs = spawnSync(NODE, [mcpScript], {
    encoding: 'utf-8', env: process.env,
  });
  c(resNoArgs.status === 0,                      'AC-4: no args → exit 0 (shows usage)');
  c((resNoArgs.stdout ?? '').length > 0,         'AC-4: no args → non-empty stdout (usage)');

  // Source inspection: dispatcher contract
  const mcpSource = readFileSync(mcpScript, 'utf-8');
  c(mcpSource.includes('SUBCOMMAND_MAP'),        'AC-4: mcp.mjs declares SUBCOMMAND_MAP');
  c(mcpSource.includes('function delegate'),     'AC-4: mcp.mjs has delegate() helper');
  c(!mcpSource.includes('runDoctor'),            'AC-4: mcp.mjs does NOT contain runDoctor (no business logic)');
  c(!mcpSource.includes('runAudit'),             'AC-4: mcp.mjs does NOT contain runAudit (no business logic)');
  c(!mcpSource.includes('runDoctorProbe'),       'AC-4: mcp.mjs does not import probe logic');

  // SUBCOMMAND_MAP routing
  const doctorEntry = mcpSource.match(/doctor\s*:\s*['"]([^'"]+)['"]/);
  c(doctorEntry !== null && (doctorEntry[1] ?? '').includes('mcp-doctor'),
    'AC-4: SUBCOMMAND_MAP doctor → mcp-doctor.mjs');

  const auditEntry = mcpSource.match(/audit\s*:\s*['"]([^'"]+)['"]/);
  c(auditEntry !== null && (auditEntry[1] ?? '').includes('mcp-audit'),
    'AC-4: SUBCOMMAND_MAP audit → mcp-audit.mjs');

  const receiptEntry = mcpSource.match(/receipt\s*:\s*['"]([^'"]+)['"]/);
  c(receiptEntry !== null && (receiptEntry[1] ?? '').includes('mcp-receipt'),
    'AC-4: SUBCOMMAND_MAP receipt → mcp-receipt.mjs');
}

// ---------------------------------------------------------------------------
// [Suite 9] AC-4 — mcp.mjs doctor dispatch end-to-end
// ---------------------------------------------------------------------------
console.log('\n[Suite 9] AC-4 — mcp.mjs doctor dispatch end-to-end\n');

{
  const mcpScript  = join(SCRIPTS, 'mcp.mjs');
  const rootDoctor = makeTmpRoot('-dispatch');
  try {
    writeSettings(rootDoctor, {});
    const res = spawnSync(NODE, [mcpScript, 'doctor', '--root', rootDoctor], {
      encoding: 'utf-8', env: process.env,
    });
    c(res.status === 0, 'AC-4: mcp doctor (empty config) → exit 0');
    c((res.stdout ?? '').includes('No MCP servers configured')
      || (res.stdout ?? '').includes('Summary'),
      'AC-4: mcp doctor shows report output');
  } finally {
    cleanup(rootDoctor);
  }
}

// ---------------------------------------------------------------------------
finish('MCP-004 dispatch + transport coverage');
