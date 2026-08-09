/**
 * integration-test-mcp-012-normalise.mjs — MCP-012 normaliseCandidate unit contract suite.
 *
 * Acceptance criteria covered:
 *   AC-4  Promotion from candidate → curated ONLY via explicit provenance-complete
 *         step: normaliseCandidate always returns status="candidate", risk="UNREVIEWED",
 *         and promotionPath referencing both MCP-187 and MCP-188.
 *   AC-1  normaliseCandidate maps all required fields from an npm package object.
 *
 * No HTTP calls. Pure unit contract test against normaliseCandidate.
 * Standalone-runnable: node tools/integration-test-mcp-012-normalise.mjs
 * Exits 0 on all-green, non-zero on any failure.
 */

import {
  loadModules,
  reporter,
} from './integration-test-mcp-012-helpers.mjs';

const { bad, assert, getFailures } = reporter();

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

let normaliseCandidate;

try {
  const mods = await loadModules();
  normaliseCandidate = mods.normaliseCandidate;
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Suite 5: normaliseCandidate — unit contract (AC-1 + AC-4)
// ---------------------------------------------------------------------------

console.log('\n── Suite 5: normaliseCandidate — unit contract ──');
{
  const rawObj = {
    package: {
      name:        'some-mcp-server',
      description: 'Does web fetch and email via SSE',
      version:     '2.1.0',
      keywords:    ['mcp', 'web', 'email', 'sse'],
      publisher:   { username: 'example' },
    },
  };

  const candidate = normaliseCandidate(rawObj);

  assert(candidate.status === 'candidate',        'normaliseCandidate status="candidate"');
  assert(candidate.risk   === 'UNREVIEWED',       'normaliseCandidate risk="UNREVIEWED"');
  assert(candidate.server === 'some-mcp-server',  'normaliseCandidate server=pkg.name');
  assert(candidate.publisher === 'example',       'normaliseCandidate publisher=publisher.username');
  assert(candidate.source.startsWith('npm:'),     'normaliseCandidate source has npm: prefix');
  assert(candidate.version === '2.1.0',           'normaliseCandidate version mapped');
  assert(
    candidate.supportedHosts.includes('unverified'),
    'supportedHosts flagged as unverified',
  );
  assert(
    candidate.transport.toLowerCase().includes('http'),
    'SSE keyword in description → http transport detected',
  );
  assert(
    candidate.capabilities.some((cap) => ['web', 'email', 'fetch'].includes(cap)),
    'capabilities extracted from keywords/description',
    `got: ${candidate.capabilities.join(', ')}`,
  );
  assert(
    candidate.promotionPath.includes('MCP-187'),
    'normaliseCandidate promotionPath includes MCP-187',
  );
  assert(
    candidate.promotionPath.includes('MCP-188'),
    'normaliseCandidate promotionPath includes MCP-188',
  );

  // Defensive: missing package data must not crash
  let safeResult;
  try {
    safeResult = normaliseCandidate({});
  } catch (err) {
    bad('normaliseCandidate must not throw on empty object', err.message);
    safeResult = null;
  }
  if (safeResult) {
    assert(safeResult.status === 'candidate',  'normaliseCandidate fallback status="candidate"');
    assert(safeResult.server === '(unknown)',  'normaliseCandidate fallback server="(unknown)"');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const failures = getFailures();
console.log('\n────────────────────────────────────────────────────────────────────────');
if (failures === 0) {
  console.log('✅ integration-test-mcp-012-normalise passed — all checks green.\n');
  process.exit(0);
} else {
  console.error(`❌ integration-test-mcp-012-normalise FAILED — ${failures} check(s) failed.\n`);
  process.exit(1);
}
