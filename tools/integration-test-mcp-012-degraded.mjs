/**
 * integration-test-mcp-012-degraded.mjs — MCP-012 network/parse failure + empty registry suite.
 *
 * Acceptance criteria covered:
 *   AC-3  Network failure / unreachable URL → status="skipped", candidates=[],
 *         reason string present. renderDiscovery handles skipped without crash.
 *         fetchRegistryPage returns null (never throws) on failure.
 *         Malformed JSON response also degrades cleanly to status="skipped".
 *   AC-2  Empty registry response: status="ok", zero candidates, disclaimer still shown.
 *
 * No real network: failure path uses a dead loopback port; malformed-JSON path
 * uses a loopback server that returns invalid text (AC-5).
 * Standalone-runnable: node tools/integration-test-mcp-012-degraded.mjs
 * Exits 0 on all-green, non-zero on any failure.
 */

import { createServer } from 'node:http';
import {
  loadModules,
  spawnMock,
  reporter,
} from './integration-test-mcp-012-helpers.mjs';

const { bad, assert, getFailures } = reporter();

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

let discoverCandidates, fetchRegistryPage, renderDiscovery;

try {
  const mods = await loadModules();
  discoverCandidates = mods.discoverCandidates;
  fetchRegistryPage  = mods.fetchRegistryPage;
  renderDiscovery    = mods.renderDiscovery;
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Suite 2: offline / network failure (AC-3)
// ---------------------------------------------------------------------------

console.log('\n── Suite 2: offline / network failure degradation ──');
{
  // Dead loopback port — no real network needed (AC-5)
  const DEAD_URL = 'http://127.0.0.1:19998/dead-end';

  // fetchRegistryPage must return null, not throw
  let pageResult;
  try {
    pageResult = await fetchRegistryPage(DEAD_URL);
  } catch (err) {
    bad('AC-3 fetchRegistryPage must not throw on network failure', err.message);
    pageResult = 'threw'; // sentinel
  }
  assert(pageResult === null, 'AC-3 fetchRegistryPage returns null on connection refused');

  // discoverCandidates must return status="skipped", candidates=[], reason string
  let discoverResult;
  try {
    discoverResult = await discoverCandidates({ registryUrl: DEAD_URL });
  } catch (err) {
    bad('AC-3 discoverCandidates must not throw on network failure', err.message);
    discoverResult = null;
  }

  if (discoverResult) {
    assert(discoverResult.status === 'skipped',
      'AC-3 discoverCandidates status="skipped" when offline');
    assert(
      Array.isArray(discoverResult.candidates) && discoverResult.candidates.length === 0,
      'AC-3 discoverCandidates candidates=[] when offline',
    );
    assert(
      typeof discoverResult.reason === 'string' && discoverResult.reason.length > 0,
      'AC-3 discoverCandidates reason string non-empty when offline',
    );

    // renderDiscovery must handle skipped without crashing
    let skippedRender;
    try {
      skippedRender = renderDiscovery(discoverResult, '');
    } catch (err) {
      bad('AC-3 renderDiscovery must not throw on skipped result', err.message);
      skippedRender = null;
    }
    if (skippedRender !== null) {
      assert(skippedRender.includes('[skipped]'),
        'AC-3 skipped render contains "[skipped]" label');
      assert(skippedRender.includes(discoverResult.reason),
        'AC-3 skipped render includes the reason message');
    }
  }
}

// ---------------------------------------------------------------------------
// Suite 3: malformed JSON response degrades cleanly (AC-3 variant)
// ---------------------------------------------------------------------------

console.log('\n── Suite 3: malformed JSON response degrades cleanly ──');
{
  const brokenSrv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('NOT_VALID_JSON{{{');
  });
  await new Promise((resolve) => brokenSrv.listen(0, '127.0.0.1', resolve));
  const { port } = brokenSrv.address();
  const brokenUrl = `http://127.0.0.1:${port}/`;

  try {
    const raw = await fetchRegistryPage(brokenUrl);
    assert(raw === null, 'AC-3 fetchRegistryPage returns null on malformed JSON');

    const result = await discoverCandidates({ registryUrl: brokenUrl });
    assert(result.status === 'skipped',      'AC-3 discoverCandidates skipped on malformed JSON');
    assert(result.candidates.length === 0,   'AC-3 candidates=[] on malformed JSON');
  } finally {
    brokenSrv.close();
  }
}

// ---------------------------------------------------------------------------
// Suite 4: empty registry response (AC-2)
// ---------------------------------------------------------------------------

console.log('\n── Suite 4: empty registry response ──');
{
  const emptyMock = await spawnMock({ objects: [], total: 0 });
  try {
    const result = await discoverCandidates({ registryUrl: emptyMock.url });
    assert(result.status === 'ok',          'empty registry → status="ok" (not an error)');
    assert(result.candidates.length === 0,  'empty registry → zero candidates');

    const rendered = renderDiscovery(result, 'nothing');
    assert(rendered.includes('[skipped]'),  'empty result renders "[skipped] No candidates"');
    // Disclaimer must still appear even with no candidates
    assert(
      rendered.includes('"Published in registry" is NEVER "trusted"'),
      'disclaimer shown even when no candidates matched',
    );
  } finally {
    emptyMock.close();
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const failures = getFailures();
console.log('\n────────────────────────────────────────────────────────────────────────');
if (failures === 0) {
  console.log('✅ integration-test-mcp-012-degraded passed — all checks green.\n');
  process.exit(0);
} else {
  console.error(`❌ integration-test-mcp-012-degraded FAILED — ${failures} check(s) failed.\n`);
  process.exit(1);
}
