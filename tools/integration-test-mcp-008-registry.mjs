/**
 * integration-test-mcp-008-registry.mjs — MCP-008 AC-1: Wave-1 registry
 * immutability contract.
 *
 * Verifies that registry.json was NOT mutated by MCP-008 — the playwright entry
 * must retain exactly the fields seeded in wave-1 (risk, approval, defaultMode,
 * transport) and no new top-level entries were added.
 *
 * Run:  node tools/integration-test-mcp-008-registry.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { buildSuiteContext } from './integration-test-mcp-008-helpers.mjs';

const SUITE = 'MCP-008 registry (AC-1)';
const { check, finish, registry } = buildSuiteContext(SUITE);

// ---------------------------------------------------------------------------
// [Suite 1] AC-1 — registry.json is wave-1 only (not modified by MCP-008)
// ---------------------------------------------------------------------------
console.log('\n[MCP-008/registry] AC-1 — registry.json unchanged by MCP-008\n');

const pwEntry = registry.entries?.find((e) => e.id === 'playwright');

check(Array.isArray(registry.entries), 'registry.entries is an array');
check(
  typeof registry.version === 'number',
  'registry.version field present (structure intact)',
);
check(
  registry.entries?.length === 3,
  'registry still has exactly 3 entries (no MCP-008 additions)',
  `got ${registry.entries?.length}`,
);
check(pwEntry !== undefined, 'playwright entry exists (seeded in wave-1)');

// Structural fields that MCP-008 must NOT have changed
check(
  pwEntry?.risk === 'R3',
  'registry playwright risk still R3',
  `got ${pwEntry?.risk}`,
);
check(
  pwEntry?.approval === 'human',
  'registry playwright approval still human',
  `got ${pwEntry?.approval}`,
);
check(
  pwEntry?.defaultMode === 'write',
  'registry playwright defaultMode still write',
  `got ${pwEntry?.defaultMode}`,
);
check(
  pwEntry?.transport === 'stdio',
  'registry playwright transport still stdio',
  `got ${pwEntry?.transport}`,
);

// ---------------------------------------------------------------------------
finish(SUITE);
