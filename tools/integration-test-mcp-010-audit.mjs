/**
 * integration-test-mcp-010-audit.mjs — MCP-010 AC-2 + AC-4b: runAudit integration.
 *
 * Acceptance criteria covered:
 *   AC-2  /mcp audit reports: active servers, versions, exposed tools, referenced
 *         secrets, transport, unused servers, host drift; flags HAS_WRITE_TOOLS /
 *         UNPINNED / HOST_DRIFT / UNUSED / SECRET_REFERENCE
 *   AC-4b ABSENT substrate: absent config/store → graceful degrade; never false-pass
 *
 * Suites:
 *   Suite 8  — runAudit: present config + receipts, full flags (AC-2)
 *   Suite 9  — runAudit: absent config + absent store (AC-4b graceful degrade)
 *   Suite 10 — runAudit: config present, empty receipt store (AC-2, AC-4b)
 *
 * Run:  node tools/integration-test-mcp-010-audit.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  runAudit,
  makeTmpRoot,
  cleanup,
  writeSettings,
  writeReceiptFile,
} from './integration-test-mcp-010-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

// ---------------------------------------------------------------------------
// Suite 8: runAudit — present config + receipts, full flags integration (AC-2)
// ---------------------------------------------------------------------------
console.log('\n[Suite 8] runAudit — full integration with settings.json + receipts (AC-2)\n');
{
  const root = makeTmpRoot();
  try {
    writeSettings(root, {
      mcpServers: {
        'write-server': {
          transport: 'stdio',
          version: '2.1.0',
          tools: ['read_file', 'create_file', 'delete_file'],
          env: { GITHUB_TOKEN: 'env-ref', BATCH_SIZE: '10' },
        },
        'read-server': {
          transport: 'http',
          // no version → UNPINNED
          tools: ['search', 'fetch'],
          env: {},
        },
      },
    });

    // Receipt for write-server from a different host (HOST_DRIFT)
    writeReceiptFile(root, 'receipt-a.json', {
      id: 'receipt-a',
      kind: 'mcp',
      task: 'task-x',
      run: 'run-x',
      host: 'cursor',            // not claude-code → HOST_DRIFT
      servers: ['write-server'],
      tools: ['create_file'],
      result: 'passed',
      substrate: 'skipped',
      createdAt: new Date().toISOString(),
    });
    // read-server has no receipts → UNUSED_SERVER

    const report = runAudit(root, { host: 'claude-code' });

    report.configFound === true
      ? ok('report.configFound = true')
      : bad(`report.configFound: ${report.configFound}`);

    report.substrateStatus === 'local'
      ? ok('report.substrateStatus = "local" (store dir exists)')
      : bad(`report.substrateStatus: ${report.substrateStatus}`);

    report.activeServers.length === 2
      ? ok('report.activeServers has 2 servers')
      : bad(`report.activeServers: ${JSON.stringify(report.activeServers)}`);

    report.activeServers.includes('write-server') && report.activeServers.includes('read-server')
      ? ok('both servers appear in activeServers')
      : bad(`activeServers content: ${JSON.stringify(report.activeServers)}`);

    report.receipts === 1
      ? ok('report.receipts = 1')
      : bad(`report.receipts: ${report.receipts}`);

    const flagCodes = report.flags.map((f) => f.code);

    flagCodes.includes('HAS_WRITE_TOOLS')
      ? ok('HAS_WRITE_TOOLS flagged')
      : bad(`HAS_WRITE_TOOLS missing; codes: ${JSON.stringify(flagCodes)}`);

    flagCodes.includes('UNPINNED_SERVER')
      ? ok('UNPINNED_SERVER flagged for read-server')
      : bad(`UNPINNED_SERVER missing; codes: ${JSON.stringify(flagCodes)}`);

    flagCodes.includes('SECRET_REFERENCE')
      ? ok('SECRET_REFERENCE flagged for GITHUB_TOKEN')
      : bad(`SECRET_REFERENCE missing; codes: ${JSON.stringify(flagCodes)}`);

    flagCodes.includes('UNUSED_SERVER')
      ? ok('UNUSED_SERVER flagged for read-server')
      : bad(`UNUSED_SERVER missing; codes: ${JSON.stringify(flagCodes)}`);

    flagCodes.includes('HOST_DRIFT')
      ? ok('HOST_DRIFT flagged for cursor receipt')
      : bad(`HOST_DRIFT missing; codes: ${JSON.stringify(flagCodes)}`);

    // Secret flag: key name surfaced, not value
    const secFlag = report.flags.find((f) => f.code === 'SECRET_REFERENCE');
    secFlag?.message.includes('GITHUB_TOKEN')
      ? ok('SECRET_REFERENCE message names GITHUB_TOKEN key')
      : bad(`SECRET_REFERENCE message: ${secFlag?.message}`);

    !secFlag?.message.includes('env-ref')
      ? ok('SECRET_REFERENCE message does not include env value')
      : bad('SECRET_REFERENCE must NOT expose env value "env-ref"');

    report.unusedServers.includes('read-server')
      ? ok('read-server in report.unusedServers')
      : bad(`unusedServers: ${JSON.stringify(report.unusedServers)}`);

    report.transports['write-server'] === 'stdio'
      ? ok('write-server transport = "stdio"')
      : bad(`write-server transport: ${report.transports['write-server']}`);

    report.transports['read-server'] === 'http'
      ? ok('read-server transport = "http"')
      : bad(`read-server transport: ${report.transports['read-server']}`);

    Array.isArray(report.exposedTools['write-server']) && report.exposedTools['write-server'].includes('create_file')
      ? ok('write-server exposedTools includes create_file')
      : bad(`write-server exposedTools: ${JSON.stringify(report.exposedTools['write-server'])}`);

    Array.isArray(report.secretRefs['write-server']) && report.secretRefs['write-server'].includes('GITHUB_TOKEN')
      ? ok('secretRefs["write-server"] contains GITHUB_TOKEN key name')
      : bad(`secretRefs["write-server"]: ${JSON.stringify(report.secretRefs['write-server'])}`);

    // AC-3: report.servers must carry envKeys only — no raw env values
    const reportJson = JSON.stringify(report.servers);
    !reportJson.includes('env-ref')
      ? ok('report.servers does not contain raw env value "env-ref"')
      : bad('report.servers must NOT include raw env value "env-ref" (AC-3 secret leak)');

    const writeSrvDescriptor = report.servers.find((s) => s.name === 'write-server');
    Array.isArray(writeSrvDescriptor?.envKeys) && writeSrvDescriptor.envKeys.includes('GITHUB_TOKEN')
      ? ok('report.servers[write-server].envKeys contains GITHUB_TOKEN key name')
      : bad(`report.servers[write-server].envKeys: ${JSON.stringify(writeSrvDescriptor?.envKeys)}`);
  } finally {
    cleanup(root);
  }
}

// ---------------------------------------------------------------------------
// Suite 9: runAudit — absent config + absent store (AC-4b graceful degrade)
// ---------------------------------------------------------------------------
console.log('\n[Suite 9] runAudit — absent config + absent store (AC-4b)\n');
{
  const root = makeTmpRoot();
  try {
    const report = runAudit(root, { host: 'claude-code' });

    report.configFound === false
      ? ok('report.configFound = false (no settings.json)')
      : bad(`report.configFound should be false; got ${report.configFound}`);

    report.substrateStatus === 'local-empty'
      ? ok('report.substrateStatus = "local-empty" (no store dir)')
      : bad(`report.substrateStatus: expected "local-empty", got "${report.substrateStatus}"`);

    // AC-4b: must never report substrate-only fields as 'passed'
    report.substrateStatus !== 'passed'
      ? ok('substrateStatus is not "passed" — no false-pass on absent substrate')
      : bad('substrateStatus must NEVER be "passed" when substrate absent');

    report.servers.length === 0
      ? ok('report.servers is empty')
      : bad(`report.servers: ${JSON.stringify(report.servers)}`);

    report.activeServers.length === 0
      ? ok('report.activeServers is empty')
      : bad(`report.activeServers: ${JSON.stringify(report.activeServers)}`);

    report.receipts === 0
      ? ok('report.receipts = 0')
      : bad(`report.receipts: ${report.receipts}`);

    report.flags.length === 0
      ? ok('report.flags is empty (no servers to audit)')
      : bad(`report.flags should be empty; got ${JSON.stringify(report.flags)}`);

    report.unusedServers.length === 0
      ? ok('report.unusedServers is empty')
      : bad(`report.unusedServers: ${JSON.stringify(report.unusedServers)}`);
  } finally {
    cleanup(root);
  }
}

// ---------------------------------------------------------------------------
// Suite 10: runAudit — config present, empty receipt store (AC-2 + AC-4b)
// ---------------------------------------------------------------------------
console.log('\n[Suite 10] runAudit — config present, empty receipt store (AC-2 + AC-4b)\n');
{
  const root = makeTmpRoot();
  try {
    writeSettings(root, {
      mcpServers: {
        'only-server': {
          transport: 'stdio',
          version: '1.0.0',
          tools: ['read_file'],
          env: {},
        },
      },
    });

    const report = runAudit(root, { host: 'claude-code' });

    report.configFound === true
      ? ok('configFound = true with settings.json present')
      : bad(`configFound: ${report.configFound}`);

    // No receipt store yet → local-empty
    report.substrateStatus === 'local-empty'
      ? ok('substrateStatus = "local-empty" (no receipts dir)')
      : bad(`substrateStatus: expected "local-empty", got "${report.substrateStatus}"`);

    report.substrateStatus !== 'passed'
      ? ok('substrateStatus ≠ "passed" (no false-pass)')
      : bad('substrateStatus must NOT be "passed" when store absent');

    report.receipts === 0
      ? ok('receipts = 0 with empty store')
      : bad(`receipts: ${report.receipts}`);

    // No receipts for only-server → UNUSED_SERVER
    report.flags.some((f) => f.code === 'UNUSED_SERVER' && f.server === 'only-server')
      ? ok('UNUSED_SERVER flagged for only-server (no receipts)')
      : bad(`UNUSED_SERVER missing for only-server; flags: ${JSON.stringify(report.flags.map((f) => f.code))}`);

    // No HOST_DRIFT without any receipts
    !report.flags.some((f) => f.code === 'HOST_DRIFT')
      ? ok('no HOST_DRIFT flags without any receipts')
      : bad('HOST_DRIFT must NOT fire when there are no receipts');
  } finally {
    cleanup(root);
  }
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------
finish('MCP-010 audit integration (AC-2 + AC-4b)');
