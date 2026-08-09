/**
 * selfcheck-mcp-012.mjs — Self-contained self-test for MCP-012 (mcp-discover).
 *
 * Acceptance criteria verified here (Suites 1 & 2):
 *   AC-1  discoverCandidates returns server, publisher, source, risk, transport,
 *         capabilities, version, supportedHosts fields.
 *   AC-2  Every returned entry has status === "candidate" and is NOT auto-enabled.
 *         The rendered output contains the required trust disclaimer.
 *   AC-3  Network failure (fetchRegistryPage returns null) → status "skipped",
 *         no crash, clear message.
 *   AC-4  renderDiscovery output always contains the CANDIDATE label and
 *         explicit promotion instructions referencing MCP-187/188.
 *   AC-5  Test uses a mock fetchRegistryPage; no real network call.
 *
 * Suites 3 & 4 (empty-registry + client-side filter) live in the companion
 * selfcheck-mcp-012b.mjs, which also owns spawnMockServer, to stay under the
 * 308-line RED ceiling (constitution §1; config.json lineBudget.red = 308).
 *
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { pathToFileURL } from 'node:url';
import { resolve }       from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname }       from 'node:path';
import { spawnMockServer } from './selfcheck-mcp-012b.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT  = resolve(__dirname, '..');

// Absolute paths to the two implementation files under test.
const CLI_PATH  = resolve(KIT_ROOT, 'templates/contextkit/tools/scripts/mcp-discover.mjs');
const CORE_PATH = resolve(KIT_ROOT, 'templates/contextkit/tools/scripts/mcp-discover-core.mjs');

// ---------------------------------------------------------------------------
// Import the modules
// ---------------------------------------------------------------------------
let discoverCandidates, renderDiscovery, fetchRegistryPage;
try {
  // renderDiscovery lives in the CLI/render layer.
  const cliMod  = await import(pathToFileURL(CLI_PATH).href);
  // Core data/network logic is re-exported from CLI layer, but also importable directly.
  const coreMod = await import(pathToFileURL(CORE_PATH).href);
  discoverCandidates  = coreMod.discoverCandidates;
  renderDiscovery     = cliMod.renderDiscovery;
  fetchRegistryPage   = coreMod.fetchRegistryPage;
} catch (err) {
  console.error(`[FAIL] Could not import mcp-discover modules: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  [OK]  ${label}`);
  passed++;
}

function fail(label, detail = '') {
  console.error(`  [FAIL] ${label}${detail ? ': ' + detail : ''}`);
  failed++;
}

function assert(condition, label, detail = '') {
  if (condition) ok(label);
  else fail(label, detail);
}

// ---------------------------------------------------------------------------
// Mock npm registry response
// ---------------------------------------------------------------------------

/** Minimal npm search response shape. */
const MOCK_NPM_RESPONSE = {
  objects: [
    {
      package: {
        name:        '@anthropic-ai/mcp-server-filesystem',
        description: 'MCP server for filesystem read and write operations',
        version:     '1.2.0',
        keywords:    ['mcp', 'model-context-protocol', 'files', 'read', 'write'],
        publisher:   { username: 'anthropic' },
        links:       { npm: 'https://www.npmjs.com/package/@anthropic-ai/mcp-server-filesystem' },
      },
    },
    {
      package: {
        name:        'mcp-server-github',
        description: 'MCP server for GitHub API access via streamable HTTP',
        version:     '0.9.5',
        keywords:    ['mcp', 'github', 'http', 'streamable'],
        publisher:   { username: 'github' },
        links:       { npm: 'https://www.npmjs.com/package/mcp-server-github' },
      },
    },
  ],
  total: 2,
  time:  '2026-06-25T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// AC-5: Inject mock via registryUrl override that points to a local stub.
//
// discoverCandidates accepts { registryUrl } and passes it to fetchRegistryPage.
// We monkey-patch fetchRegistryPage by wrapping discoverCandidates with our own
// fetcher via a local HTTP echo — but to keep this truly zero-dep and no-network
// we instead test the two layers separately:
//   a) We test normaliseCandidate indirectly via discoverCandidates with a
//      fake URL that we make return our mock payload.
//   b) We separately test the offline-degradation path by making fetchRegistryPage
//      hit a definitely-bad URL (non-routable localhost port).
//
// NOTE: discoverCandidates calls fetchRegistryPage internally. To avoid real
// network without a DI seam for the function itself we verify the exported
// fetchRegistryPage degrades gracefully (AC-3), and verify discoverCandidates
// via a tiny local HTTP server seeded with MOCK_NPM_RESPONSE (AC-1, AC-2, AC-4).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

console.log('\nMCP-012 self-test: mcp-discover\n');

// ── AC-1 + AC-2 + AC-4: candidates have all required fields; status=candidate ──
{
  console.log('Suite 1: discoverCandidates returns well-formed candidates');
  const mock = await spawnMockServer(MOCK_NPM_RESPONSE);
  try {
    const result = await discoverCandidates({ registryUrl: mock.url });
    assert(result.status === 'ok', 'result.status is "ok" when registry reachable');
    assert(Array.isArray(result.candidates), 'candidates is an array');
    assert(result.candidates.length === 2, 'two candidates returned from mock data');

    const [first] = result.candidates;

    // AC-1: required fields present
    assert(typeof first.server       === 'string', 'field: server');
    assert(typeof first.publisher    === 'string', 'field: publisher');
    assert(typeof first.source       === 'string', 'field: source');
    assert(typeof first.version      === 'string', 'field: version');
    assert(typeof first.risk         === 'string', 'field: risk');
    assert(typeof first.transport    === 'string', 'field: transport');
    assert(Array.isArray(first.capabilities), 'field: capabilities is array');
    assert(typeof first.supportedHosts === 'string', 'field: supportedHosts');

    // AC-2: ALL entries are "candidate", never "enabled"/"trusted"
    const allCandidate = result.candidates.every((c) => c.status === 'candidate');
    assert(allCandidate, 'all entries have status="candidate"');

    const noneEnabled = result.candidates.every((c) => c.status !== 'enabled');
    assert(noneEnabled, 'no entry has status="enabled"');

    // AC-4: promotion path references MCP-187 and MCP-188
    const hasMcp187 = result.candidates.every((c) => c.promotionPath.includes('MCP-187'));
    const hasMcp188 = result.candidates.every((c) => c.promotionPath.includes('MCP-188'));
    assert(hasMcp187, 'promotionPath references MCP-187 (provenance)');
    assert(hasMcp188, 'promotionPath references MCP-188 (trust policy)');

    // AC-2: rendered output contains the mandatory disclaimer
    const rendered = renderDiscovery(result, '');
    assert(
      rendered.includes('"Published in registry" is NEVER "trusted"'),
      'disclaimer: "Published in registry" is NEVER "trusted" in output',
    );
    assert(
      rendered.includes('CANDIDATE'),
      'rendered output contains CANDIDATE label',
    );
    assert(
      rendered.includes('MCP-187'),
      'rendered output references MCP-187',
    );
    assert(
      rendered.includes('MCP-188'),
      'rendered output references MCP-188',
    );

    // transport guessing
    const second = result.candidates[1];
    assert(
      second.transport.toLowerCase().includes('http'),
      'HTTP/streamable keyword in name/description → transport contains "http"',
    );
    const first_transport = result.candidates[0].transport;
    assert(
      first_transport.toLowerCase().includes('stdio'),
      'first package without http keywords → transport defaults to stdio',
    );
  } finally {
    mock.close();
  }
}

// ── AC-3: offline degradation ──
{
  console.log('\nSuite 2: offline degradation — no crash, status="skipped"');

  // Use a deliberately malformed-JSON server so we test the null-return path
  // without depending on a specific port being unlistened (CI-safe, no ECONNREFUSED
  // timing dependency). fetchRegistryPage catches JSON.parse failures → null.
  const malformedServer = await spawnMockServer('NOT_VALID_JSON{{{');

  // fetchRegistryPage: malformed JSON body → null (never throws)
  const rawResult = await fetchRegistryPage(malformedServer.url);
  malformedServer.close();
  assert(rawResult === null, 'fetchRegistryPage returns null on malformed JSON (null degradation)');

  // discoverCandidates wraps it — bad response → skipped, never throws.
  // Spawn a second server for the discoverCandidates call.
  const malformedServer2 = await spawnMockServer('BROKEN{{');
  let skipResult;
  try {
    skipResult = await discoverCandidates({
      registryUrl: malformedServer2.url,
    });
  } catch (err) {
    fail('discoverCandidates must not throw on network failure', err.message);
    skipResult = null;
  } finally {
    malformedServer2.close();
  }

  if (skipResult) {
    assert(skipResult.status === 'skipped', 'status is "skipped" when offline');
    assert(Array.isArray(skipResult.candidates), 'candidates is still an array when skipped');
    assert(skipResult.candidates.length === 0, 'empty candidates when skipped');
    assert(typeof skipResult.reason === 'string' && skipResult.reason.length > 0,
      'reason string is present when skipped');

    // renderDiscovery must handle skipped without crashing
    let rendered;
    try {
      rendered = renderDiscovery(skipResult);
    } catch (err) {
      fail('renderDiscovery must not throw on skipped result', err.message);
      rendered = null;
    }
    if (rendered !== null) {
      assert(rendered.includes('[skipped]'), 'skipped render contains [skipped] label');
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n─────────────────────────────────────────────────────────────────────────`);
console.log(`MCP-012 self-test complete: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
