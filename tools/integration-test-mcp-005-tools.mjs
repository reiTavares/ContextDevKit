/**
 * MCP-005 integration test — Tool allow-list + policy files sub-suite.
 *
 * Covers:
 *   AC#4 — Tool allow-list enforced: no implicit all-tools, default mode = read-only,
 *           write-mode override denied on read-only-default class.
 *   AC#4 — servers.json per-server tool policy file integrity (deny beats allow,
 *           expected servers present with correct risk/allow/deny arrays).
 *
 * Run:  node tools/integration-test-mcp-005-tools.mjs
 * Exits non-zero on any failure. Zero test-framework dependencies (node:* only).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reporter } from './it-helpers.mjs';
import {
  loadModules,
  BASE_ENTRY, BASE_MANIFEST,
  POLICIES, makeEvalWith,
} from './integration-test-mcp-005-helpers.mjs';

const { ok, bad, finish } = reporter();
const { evaluateServer, resolveAutonomy } = await loadModules();
const evalWith = makeEvalWith(evaluateServer, resolveAutonomy);

// ---------------------------------------------------------------------------
// [Suite 6] AC#4 — Tool allow-list: least privilege, default read-only
// ---------------------------------------------------------------------------
console.log('\n[Suite 6] Tool allow-list enforcement + default read-only (AC#4)\n');

// No allow-list → zero tools exposed, warn reason fires
const noList = evalWith(BASE_ENTRY, {});
noList.allowedTools.length === 0
  ? ok('no allowedTools in manifest → allowedTools result is empty (never implicitly all)')
  : bad(`no allowedTools: expected empty, got [${noList.allowedTools.join(', ')}]`);

noList.reasons.some((r) => /defaults-to-zero-tools/.test(r))
  ? ok('no allowedTools → warn reason "defaults-to-zero-tools" fired')
  : bad(`"defaults-to-zero-tools" warn reason missing | reasons: ${noList.reasons.join(' | ')}`);

// Effective mode for a new server with no override is read-only
noList.mode === 'read-only'
  ? ok('new server with no mode override defaults to read-only')
  : bad(`default mode: expected read-only, got ${noList.mode}`);

// Allow-list with a valid declared tool — no undeclared-tool deny
const withValidTool = evalWith(BASE_ENTRY, { allowedTools: ['search_files'] });
withValidTool.reasons.some((r) => /undeclared-in-registry/.test(r))
  ? bad('valid tool should not trigger undeclared-in-registry deny')
  : ok('declared tool in allowedTools: no undeclared-in-registry deny');
withValidTool.allowedTools.includes('search_files')
  ? ok('valid tool is present in result.allowedTools')
  : bad(`valid tool missing from result.allowedTools: [${withValidTool.allowedTools.join(', ')}]`);

// A server with no declared tools + no allowedTools: no "no-allow-list" warn
const noTools = evalWith({ ...BASE_ENTRY, capabilities: { tools: [], resources: [], prompts: [] } }, {});
noTools.reasons.some((r) => /defaults-to-zero-tools/.test(r))
  ? bad('server with no declared tools + no allowedTools should NOT warn about zero tools')
  : ok('server with zero declared tools + no allowedTools: no spurious zero-tools warn');

// write-mode override on a read-only-default class is DENIED (least privilege)
const writeOverride = evalWith(
  { ...BASE_ENTRY, risk: 'R1' },
  { allowedTools: ['read_file'], mode: 'write' }
);
writeOverride.reasons.some((r) => /mode:write-override.*read-only-default-denied/.test(r))
  ? ok('write-mode override on R1 (read-only default) emits deny reason')
  : bad(`write override deny missing | reasons: ${writeOverride.reasons.join(' | ')}`);

writeOverride.decision === 'deny'
  ? ok('write-mode override escalates to deny (least privilege)')
  : bad(`write-mode override should be a deny | decision: ${writeOverride.decision}`);

writeOverride.mode === 'read-only'
  ? ok('denied write override returns canonical read-only mode, not write')
  : bad(`write override should return canonical read-only mode | mode: ${writeOverride.mode}`);

// ---------------------------------------------------------------------------
// [Suite 8] AC#4 — servers.json per-server tool policy integrity
// ---------------------------------------------------------------------------
console.log('\n[Suite 8] servers.json per-server tool policy (AC#4)\n');

const serversJson = JSON.parse(
  readFileSync(resolve(POLICIES, 'servers.json'), 'utf-8').replace(/^﻿/, '')
);

typeof serversJson.servers === 'object' && serversJson.servers !== null
  ? ok('servers.json has servers object')
  : bad('servers.json missing servers object');

const EXPECTED_SERVERS = {
  contextdevkit: { risk: 'R0', allow: ['session-log', 'context-read', 'glossary-read', 'adr-read'], deny: [] },
  github: { risk: 'R2', deny: ['create_or_update_file', 'push_files', 'create_pull_request', 'merge_pull_request'] },
  playwright: { risk: 'R3', allow: [], deny: ['browser_install'] },
};

for (const [serverId, expected] of Object.entries(EXPECTED_SERVERS)) {
  const entry = serversJson.servers[serverId];
  entry
    ? ok(`servers.json has entry for '${serverId}'`)
    : bad(`servers.json missing entry for '${serverId}'`);

  entry?.risk === expected.risk
    ? ok(`${serverId} risk = ${expected.risk}`)
    : bad(`${serverId} risk: expected ${expected.risk}, got ${entry?.risk}`);

  if (expected.allow !== undefined) {
    Array.isArray(entry?.allow)
      ? ok(`${serverId} has allow array`)
      : bad(`${serverId} allow is not an array`);
    expected.allow.every((t) => entry?.allow?.includes(t))
      ? ok(`${serverId} allow list contains expected tools`)
      : bad(`${serverId} allow mismatch: ${JSON.stringify(entry?.allow)}`);
  }

  if (expected.deny !== undefined) {
    Array.isArray(entry?.deny)
      ? ok(`${serverId} has deny array`)
      : bad(`${serverId} deny is not an array`);
    expected.deny.every((t) => entry?.deny?.includes(t))
      ? ok(`${serverId} deny list contains expected tools`)
      : bad(`${serverId} deny mismatch: ${JSON.stringify(entry?.deny)}`);
  }
}

// deny always beats allow: no tool appears in BOTH allow and deny for any server
for (const [serverId, serverPolicy] of Object.entries(serversJson.servers)) {
  const allowSet = new Set(serverPolicy.allow ?? []);
  const denySet = new Set(serverPolicy.deny ?? []);
  const conflicts = [...allowSet].filter((t) => denySet.has(t));
  conflicts.length === 0
    ? ok(`${serverId}: no tool appears in both allow and deny lists`)
    : bad(`${serverId}: tool(s) in both allow+deny (deny must win): ${conflicts.join(', ')}`);
}

// ---------------------------------------------------------------------------
finish('MCP-005 tools');
