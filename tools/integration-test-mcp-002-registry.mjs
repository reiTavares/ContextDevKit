/**
 * MCP-002 integration test — Suite B: registry.mjs behaviour (AC-3)
 *
 * Covers:
 *   AC-3: registry.mjs — loadRegistry + findEntry, pure, throws on malformed
 *         input, zero-dep. Tests: JSON parse error, invalid transport enum,
 *         missing id field, missing entries array.
 *
 * Run:  node tools/integration-test-mcp-002-registry.mjs
 * Exits non-zero on any failure.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  reporter, buildTempTree, importMcpModules, assertThrows,
} from './integration-test-mcp-002-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

const { FAKE_ROOT, PLATFORM, MCP_DIR } = buildTempTree();
const { loadRegistry, findEntry } = await importMcpModules(PLATFORM);

console.log('\n[Suite B] registry.mjs behaviour (AC-3)\n');

// ---------------------------------------------------------------------------
// Happy path — findEntry
// ---------------------------------------------------------------------------
findEntry('contextdevkit', FAKE_ROOT)?.id === 'contextdevkit'
  ? ok('findEntry returns entry by id')
  : bad('findEntry failed for contextdevkit');

findEntry('nonexistent', FAKE_ROOT) === null
  ? ok('findEntry returns null for unknown id')
  : bad('findEntry should return null for unknown id');

// ---------------------------------------------------------------------------
// Fail-fast paths — mutate, assert, restore
// ---------------------------------------------------------------------------
const registryPath = join(MCP_DIR, 'registry.json');
const goodRegistry = readFileSync(registryPath, 'utf-8');

/** Minimal valid entry for mutation tests, excluding the field under test. */
const MINIMAL_ENTRY_BASE = {
  displayName: 'X', publisher: 'p', source: 'npm:x',
  risk: 'R0',
  capabilities: { tools: [], resources: [], prompts: [] },
  requiredSecrets: [], allowedHosts: ['*'], defaultMode: 'read-only',
  versionPolicy: 'pinned', pin: { npm: '1.0.0' }, approval: 'auto',
  provenance: {
    publisher: 'p', url: 'u', version: '1', hash: null,
    license: 'MIT', verifiedAt: null, transport: 'stdio', requestedPermissions: [],
  },
};

// Malformed JSON
writeFileSync(registryPath, '{ bad json ]', 'utf-8');
assertThrows('loadRegistry throws on malformed JSON', () => loadRegistry(FAKE_ROOT), 'malformed JSON', rep);

// Invalid transport field
writeFileSync(registryPath, JSON.stringify({
  entries: [{ ...MINIMAL_ENTRY_BASE, id: 'x', transport: 'ftp' }],
}), 'utf-8');
assertThrows(
  "loadRegistry throws on invalid transport 'ftp'",
  () => loadRegistry(FAKE_ROOT),
  "invalid or missing 'transport'",
  rep,
);

// Missing id field
writeFileSync(registryPath, JSON.stringify({
  entries: [{ ...MINIMAL_ENTRY_BASE, transport: 'stdio' /* no id */ }],
}), 'utf-8');
assertThrows(
  'loadRegistry throws when id is missing',
  () => loadRegistry(FAKE_ROOT),
  "invalid or missing 'id'",
  rep,
);

// Missing entries array
writeFileSync(registryPath, JSON.stringify({ version: 1 }), 'utf-8');
assertThrows(
  'loadRegistry throws when entries array is absent',
  () => loadRegistry(FAKE_ROOT),
  '"entries" array',
  rep,
);

// Restore
writeFileSync(registryPath, goodRegistry, 'utf-8');

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
try { rmSync(FAKE_ROOT, { recursive: true, force: true }); } catch { /* non-critical */ }

finish('MCP-002 registry (AC-3)');
