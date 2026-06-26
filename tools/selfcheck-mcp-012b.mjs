/**
 * selfcheck-mcp-012b.mjs — Companion suites for MCP-012 (mcp-discover).
 *
 * Split from selfcheck-mcp-012.mjs to stay under the 308-line RED ceiling
 * (constitution §1; config.json lineBudget.red = 308). Cohesion: all tests here
 * share the spawnMockServer helper and focus on edge-case degradation (empty
 * registry, client-side query filter) that complement the primary happy-path
 * and offline-degradation suites in selfcheck-mcp-012.mjs.
 *
 * When imported as a module, only spawnMockServer and MOCK_NPM_RESPONSE are
 * exported — no side effects. Suite 3 & 4 only execute when this file is the
 * entrypoint (isMain guard). This lets selfcheck-mcp-012.mjs import the helper
 * without triggering the companion's own process.exit().
 *
 * Registered in tools/selfcheck-suites.mjs infra set; dispatched directly
 * (not discovered as integration-test* entrypoint).
 *
 * Acceptance criteria verified here:
 *   AC-2 (empty result set)   — Suite 3
 *   AC-4 (client-side filter) — Suite 4
 *
 * Exits 0 on all-pass, non-zero on any failure (only when run directly).
 */

import { createServer }    from 'node:http';
import { pathToFileURL }   from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath }   from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const KIT_ROOT   = resolve(__dirname, '..');

/** True when this file is the process entrypoint (not imported as a module). */
const isMain = process.argv[1] === __filename;

// ---------------------------------------------------------------------------
// Shared helper — exported so selfcheck-mcp-012.mjs can import without side effects
// ---------------------------------------------------------------------------

/**
 * Spawns a temporary HTTP server that responds with `body`.
 * If `body` is a string it is sent verbatim (useful for malformed-JSON tests);
 * otherwise it is JSON-serialised. Returns { url, close }.
 *
 * @param {object|string} body  Object to JSON-encode, or a raw string to send as-is.
 * @returns {Promise<{url: string, close: () => void}>}
 */
export function spawnMockServer(body) {
  const responseText = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolveP, reject) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(responseText);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveP({
        url:   `http://127.0.0.1:${port}/`,
        close: () => server.close(),
      });
    });
    server.on('error', reject);
  });
}

/** Minimal npm search response shared across suites. */
export const MOCK_NPM_RESPONSE = {
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
// Suite execution — only when run as the direct entrypoint
// ---------------------------------------------------------------------------

if (isMain) {
  const CLI_PATH  = resolve(KIT_ROOT, 'templates/contextkit/tools/scripts/mcp-discover.mjs');
  const CORE_PATH = resolve(KIT_ROOT, 'templates/contextkit/tools/scripts/mcp-discover-core.mjs');

  let discoverCandidates, renderDiscovery;
  try {
    const cliMod  = await import(pathToFileURL(CLI_PATH).href);
    const coreMod = await import(pathToFileURL(CORE_PATH).href);
    discoverCandidates = coreMod.discoverCandidates;
    renderDiscovery    = cliMod.renderDiscovery;
  } catch (err) {
    console.error(`[FAIL] Could not import mcp-discover modules: ${err.message}`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  function ok(label)           { console.log(`  [OK]  ${label}`);  passed++; }
  function fail(label, detail) { console.error(`  [FAIL] ${label}${detail ? ': ' + detail : ''}`); failed++; }
  function assert(cond, label, detail) { if (cond) ok(label); else fail(label, detail ?? ''); }

  console.log('\nMCP-012b self-test: edge-case suites\n');

  // ── Suite 3: empty registry response degrades cleanly  (AC-2) ──
  {
    console.log('Suite 3: empty registry response degrades cleanly');
    const emptyMock = await spawnMockServer({ objects: [], total: 0 });
    try {
      const result = await discoverCandidates({ registryUrl: emptyMock.url });
      assert(result.status === 'ok', 'status is "ok" even with empty result set');
      assert(result.candidates.length === 0, 'zero candidates for empty registry');

      const rendered = renderDiscovery(result, 'nothing');
      assert(rendered.includes('[skipped]'), 'empty result renders "[skipped] No candidates"');
    } finally {
      emptyMock.close();
    }
  }

  // ── Suite 4: client-side query filter  (AC-4) ──
  {
    console.log('\nSuite 4: client-side query filtering');
    const mock = await spawnMockServer(MOCK_NPM_RESPONSE);
    try {
      const result = await discoverCandidates({ query: 'github', registryUrl: mock.url });
      // The mock returns the full dataset regardless of URL path, so we verify
      // client-side post-fetch filtering trims to only matching candidates.
      assert(result.status === 'ok', 'filter query still returns ok status');
      const allMatch = result.candidates.every(
        (c) =>
          c.server.toLowerCase().includes('github') ||
          c.publisher.toLowerCase().includes('github'),
      );
      assert(allMatch, 'query "github" filters to only matching candidates');
    } finally {
      mock.close();
    }
  }

  console.log(`\n─────────────────────────────────────────────────────────────────────────`);
  console.log(`MCP-012b self-test complete: ${passed} passed, ${failed} failed.`);

  if (failed > 0) process.exit(1);
  process.exit(0);
}
