#!/usr/bin/env node
/**
 * selfcheck-mcp-004-pure.mjs — MCP-004 pure-helper tests (Sections 1-2).
 *
 * Acceptance criteria covered:
 *   AC-1  extractCapabilityNames handles object-shape, string-shape, null, and
 *         missing-key inputs → always returns an array.
 *   AC-2  checkSecrets returns { ok, missing } correctly for both empty lists
 *         and lists that reference env vars absent from the process environment.
 *
 * No I/O, no subprocesses — pure synchronous assertions.
 * Standalone-runnable: node tools/selfcheck-mcp-004-pure.mjs
 * Exits non-zero on any failure.
 */

import {
  coreModule,
  makeCounters,
  assert_ok,
  section,
} from './selfcheck-mcp-004-helpers.mjs';

const { extractCapabilityNames, checkSecrets } = coreModule;

const C = makeCounters();

// ---------------------------------------------------------------------------
// Section 1: extractCapabilityNames — pure helper
// ---------------------------------------------------------------------------

section('1. extractCapabilityNames (pure helper)');

assert_ok(
  C,
  JSON.stringify(extractCapabilityNames({ tools: [{ name: 'read' }, { name: 'write' }] }, 'tools'))
    === JSON.stringify(['read', 'write']),
  'object-shape tools',
);

assert_ok(
  C,
  JSON.stringify(extractCapabilityNames({ tools: ['search', 'fetch'] }, 'tools'))
    === JSON.stringify(['search', 'fetch']),
  'string-shape tools',
);

assert_ok(
  C,
  JSON.stringify(extractCapabilityNames(null, 'tools')) === JSON.stringify([]),
  'null capabilities → empty array',
);

assert_ok(
  C,
  JSON.stringify(extractCapabilityNames({}, 'resources')) === JSON.stringify([]),
  'missing key → empty array',
);

// ---------------------------------------------------------------------------
// Section 2: checkSecrets — pure helper
// ---------------------------------------------------------------------------

section('2. checkSecrets (pure helper)');

{
  const { ok: secretsOk, missing } = checkSecrets([]);
  assert_ok(C, secretsOk === true,   'empty list → ok');
  assert_ok(C, missing.length === 0, 'empty list → no missing');
}

{
  // Use an env var that is never set in CI.
  const { ok: secretsOk, missing } = checkSecrets(['__CDK_NONEXISTENT_VAR_XYZ__']);
  assert_ok(C, secretsOk === false,                                        'missing var → not ok');
  assert_ok(C, missing.includes('__CDK_NONEXISTENT_VAR_XYZ__'),           'missing var reported');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- MCP-004-pure selfcheck: ${C.passed} passed, ${C.failed} failed ---\n`);
if (C.failed > 0) process.exit(1);
