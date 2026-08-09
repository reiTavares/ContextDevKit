/**
 * integration-test-mcp-012-happy.mjs — MCP-012 happy-path + trust-invariant suite.
 *
 * Acceptance criteria covered:
 *   AC-1  discoverCandidates returns all required fields on every candidate.
 *   AC-2  Every entry carries status="candidate"; NEVER "enabled"/"trusted".
 *         Rendered output shows the mandatory disclaimer verbatim and
 *         explicitly states that no servers are enabled (trust invariant).
 *   AC-4  promotionPath references both MCP-187 and MCP-188, and states that
 *         registry listing is NEVER sufficient.
 *
 * No real network: happy path served by a loopback mock HTTP server (AC-5).
 * Standalone-runnable: node tools/integration-test-mcp-012-happy.mjs
 * Exits 0 on all-green, non-zero on any failure.
 */

import {
  loadModules,
  spawnMock,
  MOCK_REGISTRY,
  reporter,
} from './integration-test-mcp-012-helpers.mjs';

const { ok, bad, assert, getFailures } = reporter();

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

let discoverCandidates, renderDiscovery, CANDIDATE_STATUS;

try {
  const mods = await loadModules();
  discoverCandidates = mods.discoverCandidates;
  renderDiscovery    = mods.renderDiscovery;
  CANDIDATE_STATUS   = mods.CANDIDATE_STATUS;
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Suite 1: required fields + status=candidate + promotion path (AC-1, AC-2, AC-4)
// ---------------------------------------------------------------------------

console.log('\n── Suite 1: required fields + status=candidate + promotion path ──');
{
  const mock = await spawnMock(MOCK_REGISTRY);
  try {
    const result = await discoverCandidates({ registryUrl: mock.url });

    // Top-level shape
    assert(result.status === 'ok',           'result.status is "ok" when registry reachable');
    assert(Array.isArray(result.candidates), 'candidates is an array');
    assert(result.candidates.length === 2,   '2 candidates returned from 2-item mock');

    const [first, second] = result.candidates;

    // AC-1: every required field present on first candidate
    assert(typeof first.server        === 'string' && first.server.length > 0,
      'AC-1 field: server');
    assert(typeof first.publisher     === 'string' && first.publisher.length > 0,
      'AC-1 field: publisher');
    assert(typeof first.source        === 'string' && first.source.startsWith('npm:'),
      'AC-1 field: source (npm: prefix)');
    assert(typeof first.version       === 'string' && first.version.length > 0,
      'AC-1 field: version');
    assert(typeof first.risk          === 'string' && first.risk.length > 0,
      'AC-1 field: risk');
    assert(typeof first.transport     === 'string' && first.transport.length > 0,
      'AC-1 field: transport');
    assert(Array.isArray(first.capabilities) && first.capabilities.length > 0,
      'AC-1 field: capabilities (non-empty array)');
    assert(typeof first.supportedHosts === 'string' && first.supportedHosts.length > 0,
      'AC-1 field: supportedHosts');

    // AC-2: status is always CANDIDATE_STATUS — the exported constant
    assert(CANDIDATE_STATUS === 'candidate',
      'AC-2 CANDIDATE_STATUS constant is "candidate"');
    assert(result.candidates.every((c) => c.status === CANDIDATE_STATUS),
      'AC-2 every candidate.status === CANDIDATE_STATUS');
    assert(result.candidates.every((c) => c.status !== 'enabled'),
      'AC-2 no candidate has status="enabled"');
    assert(result.candidates.every((c) => c.status !== 'trusted'),
      'AC-2 no candidate has status="trusted"');

    // AC-4: promotionPath references both tickets
    assert(result.candidates.every((c) => c.promotionPath.includes('MCP-187')),
      'AC-4 promotionPath references MCP-187 (provenance)');
    assert(result.candidates.every((c) => c.promotionPath.includes('MCP-188')),
      'AC-4 promotionPath references MCP-188 (trust policy)');
    assert(result.candidates.every((c) =>
      c.promotionPath.toLowerCase().includes('registry') &&
      c.promotionPath.toLowerCase().includes('never')),
      'AC-4 promotionPath states registry listing is NEVER sufficient');

    // AC-2: rendered output contains mandatory disclaimer verbatim
    const rendered = renderDiscovery(result, 'test');
    assert(
      rendered.includes('"Published in registry" is NEVER "trusted"'),
      'AC-2 rendered disclaimer: exact phrase present',
    );
    assert(rendered.includes('CANDIDATE'), 'AC-2 rendered output labels entries as CANDIDATE');
    assert(rendered.includes('MCP-187'),   'AC-2 rendered output references MCP-187');
    assert(rendered.includes('MCP-188'),   'AC-2 rendered output references MCP-188');

    // Transport inference — filesystem package without http keywords → stdio
    assert(
      first.transport.toLowerCase().includes('stdio'),
      'AC-1 transport: non-http package defaults to stdio',
      `got: ${first.transport}`,
    );
    // HTTP keyword in description → streamable-http
    assert(
      second.transport.toLowerCase().includes('http'),
      'AC-1 transport: "http"/"streamable" keyword → http transport',
      `got: ${second.transport}`,
    );

    // Correct publisher mapped from publisher.username
    assert(first.publisher  === 'acme-corp',   'publisher.username mapped to publisher field');
    assert(second.publisher === 'github-inc',  'publisher.username mapped for second candidate');
  } finally {
    mock.close();
  }
}

// ---------------------------------------------------------------------------
// Suite 6: registry presence is NEVER trust (AC-2 invariant)
// ---------------------------------------------------------------------------

console.log('\n── Suite 6: registry presence is NEVER trust (invariant) ──');
{
  const mock = await spawnMock(MOCK_REGISTRY);
  try {
    const result = await discoverCandidates({ registryUrl: mock.url });

    const allUnreviewed = result.candidates.every((c) => c.risk === 'UNREVIEWED');
    assert(allUnreviewed,
      'AC-2 risk="UNREVIEWED" on every candidate — no auto-promotion path exists');

    const noneAutoEnabled = result.candidates.every(
      (c) => !['enabled', 'trusted', 'active', 'approved'].includes(c.status),
    );
    assert(noneAutoEnabled,
      'AC-2 no auto-enabled status value appears on any candidate');

    const rendered = renderDiscovery(result, '');
    assert(rendered.includes('MCP-188'), 'trust-policy gate (MCP-188) called out in render');
    assert(rendered.includes('MCP-187'), 'provenance gate (MCP-187) called out in render');
    assert(
      rendered.toLowerCase().includes('do not enable') ||
      rendered.toLowerCase().includes('none are enabled'),
      'render explicitly says servers are NOT enabled',
    );
  } finally {
    mock.close();
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const failures = getFailures();
console.log('\n────────────────────────────────────────────────────────────────────────');
if (failures === 0) {
  console.log('✅ integration-test-mcp-012-happy passed — all checks green.\n');
  process.exit(0);
} else {
  console.error(`❌ integration-test-mcp-012-happy FAILED — ${failures} check(s) failed.\n`);
  process.exit(1);
}
