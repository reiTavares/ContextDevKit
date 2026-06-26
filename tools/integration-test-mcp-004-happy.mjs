/**
 * integration-test-mcp-004-happy.mjs — MCP-004 happy-path & pure-helper tests.
 *
 * Covers:
 *   Suite 1  — AC-1  ProbeResult shape contract on successful stdio handshake
 *              (tools/resources/prompts/latency/rendersInto/versionMatch all present)
 *   Suite 11 — AC-3 + AC-1  extractCapabilityNames pure helper (all input shapes)
 *   Suite 12 — AC-3  checkSecrets pure helper (empty / absent / present / mixed / null)
 *
 * Run:  node tools/integration-test-mcp-004-happy.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 * Zero test-framework deps (node:* only).
 */

import { NODE, check, loadMcpModules } from './integration-test-mcp-004-helpers.mjs';
import { reporter }                     from './it-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;
const c = (cond, label, detail = '') => check(rep, cond, label, detail);

const {
  runDoctorProbe,
  checkSecrets,
  extractCapabilityNames,
} = await loadMcpModules();

// ---------------------------------------------------------------------------
// [Suite 1] AC-1 — ProbeResult shape on successful handshake
// ---------------------------------------------------------------------------
console.log('\n[Suite 1] AC-1 — ProbeResult shape on successful handshake\n');

{
  const fixture = `
const buf = [];
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buf.push(chunk);
  const joined = buf.join('');
  const nl = joined.indexOf('\\n');
  if (nl === -1) return;
  const line = joined.slice(0, nl).trim();
  try {
    const req = JSON.parse(line);
    if (req.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools:     [{ name: 'read_file' }, { name: 'write_file' }],
            resources: [{ name: 'filesystem' }],
            prompts:   [{ name: 'summarize' }],
          },
          serverInfo: { name: 'fixture-server', version: '2.1.0' },
        },
      }) + '\\n');
    }
  } catch {}
});
`;

  const result = await runDoctorProbe({
    name: 'shape-fixture', transport: 'stdio',
    command: NODE, args: ['-e', fixture], env: {},
    requiredSecrets: [], version: '2.1.0',
    rendersInto: ['claude-code', 'cursor', 'codex'],
  });

  c(result.status === 'pass',               'AC-1: status=pass on good handshake',       `got ${result.status}`);
  c(result.server === 'shape-fixture',      'AC-1: server name preserved');
  c(result.transport === 'stdio',           'AC-1: transport=stdio');
  c(Array.isArray(result.tools),            'AC-1: tools is array');
  c(result.tools.includes('read_file'),     'AC-1: tool read_file enumerated');
  c(result.tools.includes('write_file'),    'AC-1: tool write_file enumerated');
  c(Array.isArray(result.resources),        'AC-1: resources is array');
  c(result.resources.includes('filesystem'),'AC-1: resource filesystem enumerated');
  c(Array.isArray(result.prompts),          'AC-1: prompts is array');
  c(result.prompts.includes('summarize'),   'AC-1: prompt summarize enumerated');
  c(result.serverVersion === '2.1.0',       'AC-1: serverVersion from handshake');
  c(result.pinnedVersion === '2.1.0',       'AC-1: pinnedVersion preserved');
  c(result.versionMatch === true,           'AC-1: versionMatch=true when versions match');
  c(typeof result.latencyMs === 'number' && result.latencyMs >= 0, 'AC-1: latencyMs ≥ 0');
  c(result.reason === null,                 'AC-1: reason=null on pass');
  c(JSON.stringify(result.rendersInto.sort())
    === JSON.stringify(['claude-code', 'codex', 'cursor']),
                                            'AC-1: rendersInto preserved (all 3 hosts)');

  // Version mismatch stays pass with versionMatch=false (not a failure)
  const mismatchFixture = `
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
  const mmResult = await runDoctorProbe({
    name: 'version-mismatch', transport: 'stdio',
    command: NODE, args: ['-e', mismatchFixture], env: {},
    requiredSecrets: [], version: '1.0.0', rendersInto: [],
  });
  c(mmResult.status === 'pass',         'AC-1: version mismatch stays pass');
  c(mmResult.versionMatch === false,    'AC-1: versionMatch=false on mismatch');
  c(mmResult.serverVersion === '9.9.9', 'AC-1: serverVersion from server');
  c(mmResult.pinnedVersion === '1.0.0', 'AC-1: pinnedVersion=pinned value');
}

// ---------------------------------------------------------------------------
// [Suite 11] AC-3 + AC-1 — extractCapabilityNames pure helper
// ---------------------------------------------------------------------------
console.log('\n[Suite 11] AC-3 + AC-1 — extractCapabilityNames pure helper\n');

{
  c(JSON.stringify(extractCapabilityNames({ tools: [{ name: 'read' }, { name: 'write' }] }, 'tools'))
      === JSON.stringify(['read', 'write']),
    'AC-1: object-shape tools extracted');

  c(JSON.stringify(extractCapabilityNames({ tools: ['search', 'fetch'] }, 'tools'))
      === JSON.stringify(['search', 'fetch']),
    'AC-1: string-shape tools extracted');

  c(JSON.stringify(extractCapabilityNames({ tools: [{ name: 'read' }, 'write'] }, 'tools'))
      === JSON.stringify(['read', 'write']),
    'AC-1: mixed shape tools extracted');

  c(JSON.stringify(extractCapabilityNames({}, 'resources')) === JSON.stringify([]),
    'AC-1: missing key → empty array');

  c(JSON.stringify(extractCapabilityNames(null, 'tools')) === JSON.stringify([]),
    'AC-1: null capabilities → empty array (defensive)');

  c(JSON.stringify(extractCapabilityNames({ tools: 'scalar' }, 'tools')) === JSON.stringify([]),
    'AC-1: scalar tools value → empty array (defensive)');
}

// ---------------------------------------------------------------------------
// [Suite 12] AC-3 — checkSecrets pure helper
// ---------------------------------------------------------------------------
console.log('\n[Suite 12] AC-3 — checkSecrets pure helper\n');

{
  const { ok: emptyOk, missing: emptyMissing } = checkSecrets([]);
  c(emptyOk === true,           'AC-3: checkSecrets empty list → ok=true');
  c(emptyMissing.length === 0,  'AC-3: checkSecrets empty list → no missing');

  const { ok: absentOk, missing: absentMissing } = checkSecrets(['__CDK_IT_TOTALLY_ABSENT__']);
  c(absentOk === false,                                   'AC-3: absent var → ok=false');
  c(absentMissing.includes('__CDK_IT_TOTALLY_ABSENT__'),  'AC-3: absent var named in missing');

  const { ok: presentOk } = checkSecrets(['PATH']);
  c(presentOk === true, 'AC-3: present var (PATH) → ok=true');

  const { ok: mixedOk, missing: mixedMissing } = checkSecrets(['PATH', '__CDK_IT_ABSENT_MIX__']);
  c(mixedOk === false,                          'AC-3: mixed → ok=false');
  c(mixedMissing.length === 1,                  'AC-3: mixed → 1 missing');
  c(mixedMissing[0] === '__CDK_IT_ABSENT_MIX__','AC-3: mixed → correct missing var');

  const { ok: nullOk } = checkSecrets(null);
  c(nullOk === true, 'AC-3: null requiredSecrets → ok=true (defensive)');
}

// ---------------------------------------------------------------------------
finish('MCP-004 happy-path + pure helpers');
