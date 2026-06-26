/**
 * integration-test-mcp-010-core.mjs — MCP-010 AC-5: pure core helpers.
 *
 * Acceptance criteria covered:
 *   AC-5  computeFlags + buildReport + hasWriteTools + secretReferenceNames
 *         unit behaviour (pure functions, no filesystem I/O)
 *
 * Suites:
 *   Suite 6 — mcp-audit-core: hasWriteTools + secretReferenceNames (AC-5)
 *   Suite 7 — computeFlags: HAS_WRITE_TOOLS, UNPINNED_SERVER, SECRET_REFERENCE,
 *              UNUSED_SERVER, HOST_DRIFT (AC-2, AC-5)
 *
 * Run:  node tools/integration-test-mcp-010-core.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  computeFlags,
  hasWriteTools,
  secretReferenceNames,
} from './integration-test-mcp-010-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

// ---------------------------------------------------------------------------
// Suite 6: mcp-audit-core pure helpers — hasWriteTools, secretReferenceNames
// ---------------------------------------------------------------------------
console.log('\n[Suite 6] mcp-audit-core pure helpers — hasWriteTools, secretReferenceNames (AC-5)\n');
{
  // hasWriteTools
  hasWriteTools({ tools: ['read_file', 'list_dir'] })
    ? bad('hasWriteTools: read-only tools should return false')
    : ok('hasWriteTools returns false for read-only tools');

  hasWriteTools({ tools: ['read_file', 'write_file'] })
    ? ok('hasWriteTools returns true when write_file present')
    : bad('hasWriteTools must return true for write_file');

  hasWriteTools({ tools: ['delete_record', 'get_info'] })
    ? ok('hasWriteTools returns true when delete_record present')
    : bad('hasWriteTools must return true for delete_record');

  hasWriteTools({ tools: ['push_commit'] })
    ? ok('hasWriteTools returns true for push_commit')
    : bad('hasWriteTools must return true for push_commit');

  hasWriteTools({})
    ? bad('hasWriteTools: no tools field should return false')
    : ok('hasWriteTools returns false when tools absent');

  hasWriteTools({ tools: [] })
    ? bad('hasWriteTools: empty tools array should return false')
    : ok('hasWriteTools returns false for empty tools array');

  // secretReferenceNames — McpServerInfo carries envKeys (string[]), not env values
  const names = secretReferenceNames({ envKeys: ['GITHUB_TOKEN', 'NORMAL_VAR', 'API_KEY', 'PORT'] });

  names.includes('GITHUB_TOKEN')
    ? ok('secretReferenceNames includes GITHUB_TOKEN')
    : bad(`secretReferenceNames missing GITHUB_TOKEN: ${JSON.stringify(names)}`);

  names.includes('API_KEY')
    ? ok('secretReferenceNames includes API_KEY')
    : bad(`secretReferenceNames missing API_KEY: ${JSON.stringify(names)}`);

  !names.includes('NORMAL_VAR')
    ? ok('secretReferenceNames excludes NORMAL_VAR')
    : bad('secretReferenceNames must NOT include NORMAL_VAR');

  !names.includes('PORT')
    ? ok('secretReferenceNames excludes PORT')
    : bad('secretReferenceNames must NOT include PORT');

  secretReferenceNames({}).length === 0
    ? ok('secretReferenceNames returns empty for no envKeys')
    : bad('secretReferenceNames must return [] when envKeys absent');
}

// ---------------------------------------------------------------------------
// Suite 7: computeFlags — all flag types (AC-2, AC-5)
// ---------------------------------------------------------------------------
console.log('\n[Suite 7] computeFlags — HAS_WRITE_TOOLS, UNPINNED, SECRET_REFERENCE, UNUSED, HOST_DRIFT (AC-2 + AC-5)\n');
{
  // McpServerInfo uses envKeys (string[]) — values are stripped at the I/O boundary
  const servers = [
    {
      name: 'write-srv',
      transport: 'stdio',
      version: '1.0.0',
      tools: ['write_file', 'read_file'],
      envKeys: ['WRITE_TOKEN'],
    },
    {
      name: 'unpinned-srv',
      transport: 'http',
      // no version — UNPINNED
      tools: ['search'],
      envKeys: [],
    },
    {
      name: 'clean-srv',
      transport: 'stdio',
      version: '2.0.0',
      tools: ['read_file'],
      envKeys: ['SAFE_VAR'],
    },
  ];

  const receipts = [
    {
      id: 'r1',
      kind: 'mcp',
      servers: ['write-srv'],
      host: 'cursor',         // drift — current host will be 'claude-code'
      result: 'passed',
      createdAt: new Date().toISOString(),
    },
    // unpinned-srv and clean-srv have no receipts → UNUSED for both
  ];

  const flags = computeFlags(servers, receipts, { currentHost: 'claude-code' });
  const codes = flags.map((f) => f.code);

  codes.includes('HAS_WRITE_TOOLS')
    ? ok('HAS_WRITE_TOOLS flagged for write-srv')
    : bad(`HAS_WRITE_TOOLS missing; flags: ${JSON.stringify(codes)}`);

  codes.includes('UNPINNED_SERVER')
    ? ok('UNPINNED_SERVER flagged for unpinned-srv')
    : bad(`UNPINNED_SERVER missing; flags: ${JSON.stringify(codes)}`);

  codes.includes('SECRET_REFERENCE')
    ? ok('SECRET_REFERENCE flagged for WRITE_TOKEN in write-srv')
    : bad(`SECRET_REFERENCE missing; flags: ${JSON.stringify(codes)}`);

  // UNUSED for unpinned-srv and clean-srv (no receipts)
  const unusedFlags = flags.filter((f) => f.code === 'UNUSED_SERVER').map((f) => f.server);
  unusedFlags.includes('unpinned-srv')
    ? ok('UNUSED_SERVER flagged for unpinned-srv')
    : bad(`UNUSED_SERVER missing for unpinned-srv; unused: ${JSON.stringify(unusedFlags)}`);

  unusedFlags.includes('clean-srv')
    ? ok('UNUSED_SERVER flagged for clean-srv')
    : bad(`UNUSED_SERVER missing for clean-srv; unused: ${JSON.stringify(unusedFlags)}`);

  codes.includes('HOST_DRIFT')
    ? ok('HOST_DRIFT flagged for receipt from host "cursor"')
    : bad(`HOST_DRIFT missing; flags: ${JSON.stringify(codes)}`);

  // SECRET_REFERENCE flag must contain key NAME, not value
  const secretFlag = flags.find((f) => f.code === 'SECRET_REFERENCE');
  secretFlag?.message.includes('WRITE_TOKEN')
    ? ok('SECRET_REFERENCE flag names the key WRITE_TOKEN')
    : bad(`SECRET_REFERENCE flag message missing key name: ${secretFlag?.message}`);

  !secretFlag?.message.includes('super-secret-value-xyz')
    ? ok('SECRET_REFERENCE flag does not expose the env value')
    : bad('SECRET_REFERENCE flag must NOT include env value "super-secret-value-xyz"');

  // clean-srv (read-only, pinned, no secret keys) must NOT trigger WRITE or UNPINNED flags
  const cleanWriteFlag = flags.find((f) => f.code === 'HAS_WRITE_TOOLS' && f.server === 'clean-srv');
  !cleanWriteFlag
    ? ok('clean-srv does not trigger HAS_WRITE_TOOLS')
    : bad('clean-srv must NOT trigger HAS_WRITE_TOOLS');

  const cleanUnpinnedFlag = flags.find((f) => f.code === 'UNPINNED_SERVER' && f.server === 'clean-srv');
  !cleanUnpinnedFlag
    ? ok('clean-srv does not trigger UNPINNED_SERVER')
    : bad('clean-srv must NOT trigger UNPINNED_SERVER');

  // No HOST_DRIFT for a receipt whose host matches currentHost
  const receiptsSameHost = [{ id: 'r2', servers: ['write-srv'], host: 'claude-code', result: 'passed' }];
  const flagsSameHost = computeFlags(servers, receiptsSameHost, { currentHost: 'claude-code' });
  !flagsSameHost.some((f) => f.code === 'HOST_DRIFT')
    ? ok('no HOST_DRIFT when receipt host matches currentHost')
    : bad('HOST_DRIFT must NOT fire when host matches');
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------
finish('MCP-010 core helpers (AC-5)');
