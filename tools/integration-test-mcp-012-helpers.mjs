/**
 * integration-test-mcp-012-helpers.mjs — shared fixtures and utilities for
 * integration-test-mcp-012-* sub-suites.
 *
 * Exports:
 *   loadModules()   — imports mcp-discover-core + mcp-discover; returns refs.
 *   spawnMock(body) — loopback HTTP server serving body as JSON.
 *   MOCK_REGISTRY   — two-item npm-shaped registry fixture.
 *   reporter()      — { ok, bad, assert, failures } reporter bound to a counter.
 *
 * @module integration-test-mcp-012-helpers
 */

import { pathToFileURL }  from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath }  from 'node:url';
import { createServer }   from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT  = resolve(__dirname, '..');

export const CORE_PATH = resolve(
  KIT_ROOT, 'templates/contextkit/tools/scripts/mcp-discover-core.mjs',
);
export const CLI_PATH = resolve(
  KIT_ROOT, 'templates/contextkit/tools/scripts/mcp-discover.mjs',
);

// ---------------------------------------------------------------------------
// Module loader
// ---------------------------------------------------------------------------

/**
 * Dynamically imports the modules under test and returns their exports.
 *
 * @returns {Promise<{
 *   discoverCandidates: Function,
 *   fetchRegistryPage: Function,
 *   normaliseCandidate: Function,
 *   CANDIDATE_STATUS: string,
 *   renderDiscovery: Function,
 * }>}
 * @throws {Error} with a descriptive message if import fails.
 */
export async function loadModules() {
  try {
    const coreMod = await import(pathToFileURL(CORE_PATH).href);
    const cliMod  = await import(pathToFileURL(CLI_PATH).href);
    return {
      discoverCandidates: coreMod.discoverCandidates,
      fetchRegistryPage:  coreMod.fetchRegistryPage,
      normaliseCandidate: coreMod.normaliseCandidate,
      CANDIDATE_STATUS:   coreMod.CANDIDATE_STATUS,
      renderDiscovery:    cliMod.renderDiscovery,
    };
  } catch (err) {
    throw new Error(`[FAIL] import: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Mock HTTP server factory (AC-5 — no real network)
// ---------------------------------------------------------------------------

/**
 * Spawns a loopback HTTP server that serves `body` as JSON on every request.
 *
 * @param {object} body
 * @returns {Promise<{url: string, close: () => void}>}
 */
export function spawnMock(body) {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolvePromise({ url: `http://127.0.0.1:${port}/`, close: () => srv.close() });
    });
    srv.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Shared fixture — minimal npm-shaped response with two distinguishable pkgs
// ---------------------------------------------------------------------------

export const MOCK_REGISTRY = {
  objects: [
    {
      package: {
        name:        '@acme/mcp-server-files',
        description: 'MCP server for filesystem access (read, write)',
        version:     '1.0.0',
        keywords:    ['mcp', 'model-context-protocol', 'files', 'read', 'write'],
        publisher:   { username: 'acme-corp' },
        links:       { npm: 'https://www.npmjs.com/package/@acme/mcp-server-files' },
      },
    },
    {
      package: {
        name:        'mcp-server-github',
        description: 'GitHub API access via streamable HTTP transport',
        version:     '0.9.0',
        keywords:    ['mcp', 'github', 'http', 'streamable'],
        publisher:   { username: 'github-inc' },
        links:       { npm: 'https://www.npmjs.com/package/mcp-server-github' },
      },
    },
  ],
  total: 2,
};

// ---------------------------------------------------------------------------
// Reporter factory
// ---------------------------------------------------------------------------

/**
 * Creates a fresh reporter with its own failure counter.
 *
 * @returns {{ ok: Function, bad: Function, assert: Function, getFailures: Function }}
 */
export function reporter() {
  let failures = 0;

  function ok(msg)  { console.log(`  ✓ ${msg}`); }

  function bad(msg, detail = '') {
    console.error(`  ✗ ${msg}${detail ? ' — ' + detail : ''}`);
    failures += 1;
  }

  function assert(cond, msg, detail = '') {
    if (cond) ok(msg);
    else       bad(msg, detail);
  }

  function getFailures() { return failures; }

  return { ok, bad, assert, getFailures };
}
