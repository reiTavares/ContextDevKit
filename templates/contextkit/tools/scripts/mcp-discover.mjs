#!/usr/bin/env node
/**
 * mcp-discover.mjs — CLI + render layer for /mcp discover [query] (MCP-012).
 *
 * Responsibility: render CandidateEntry[] as human-readable text or JSON,
 * and act as the CLI entry point.  All data logic lives in mcp-discover-core.mjs.
 *
 * Re-exports core symbols so consumers can import from a single file:
 *   import { discoverCandidates, fetchRegistryPage } from './mcp-discover.mjs'
 *
 * CLI:
 *   node mcp-discover.mjs [query]        — human-readable table
 *   node mcp-discover.mjs [query] --json — JSON DiscoveryResult
 *
 * Contract:
 *   - Always exits 0 — network failures are "skipped", never crashes.
 *   - Every render path shows the mandatory trust disclaimer (AC-2).
 *   - No third-party dependencies — node:* only (immutable rule §1).
 *
 * @module mcp-discover
 */

export {
  discoverCandidates,
  fetchRegistryPage,
  fetchUrl,
  normaliseCandidate,
  DEFAULT_REGISTRY_URL,
  CANDIDATE_STATUS,
} from './mcp-discover-core.mjs';

import { discoverCandidates } from './mcp-discover-core.mjs';

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const HR = '─'.repeat(72);

/**
 * Formats a single CandidateEntry as a human-readable block.
 *
 * @param {import('./mcp-discover-core.mjs').CandidateEntry} c
 * @param {number} index
 * @returns {string}
 */
function renderCandidate(c, index) {
  return [
    `${index + 1}. ${c.server}  [${c.status.toUpperCase()}]`,
    `   Publisher    : ${c.publisher}`,
    `   Source       : ${c.source}`,
    `   Version      : ${c.version}`,
    `   Risk         : ${c.risk}`,
    `   Transport    : ${c.transport}`,
    `   Capabilities : ${c.capabilities.join(', ')}`,
    `   Hosts        : ${c.supportedHosts}`,
    `   Promotion    : ${c.promotionPath}`,
  ].join('\n');
}

/**
 * Renders the mandatory trust disclaimer banner.
 * Always shown — not negotiable.
 *
 * @returns {string}
 */
function renderDisclaimer() {
  return [
    HR,
    'IMPORTANT: "Published in registry" is NEVER "trusted".',
    'Every server listed below is a CANDIDATE only.',
    'Enabling any server requires:',
    '  1. Local curation + trust policy review  (/mcp curate, ticket MCP-188)',
    '  2. Provenance capture                     (ticket MCP-187)',
    'Do NOT enable servers that have not completed both steps.',
    HR,
  ].join('\n');
}

/**
 * Renders the full discovery result as a printable string.
 *
 * @param {{ status: string, candidates: object[], reason?: string }} result
 * @param {string} [query]
 * @returns {string}
 */
export function renderDiscovery(result, query = '') {
  const header = query
    ? `MCP Registry Discovery — query: "${query}"`
    : 'MCP Registry Discovery — all candidates';

  if (result.status === 'skipped') {
    return [header, HR, `[skipped] ${result.reason}`, HR].join('\n');
  }

  if (!result.candidates || result.candidates.length === 0) {
    return [
      header,
      renderDisclaimer(),
      '[skipped] No candidates matched your query.',
    ].join('\n');
  }

  const body = result.candidates.map(renderCandidate).join('\n\n');

  return [
    header,
    renderDisclaimer(),
    body,
    HR,
    `${result.candidates.length} candidate(s) found.`,
    'None are enabled or trusted. See promotion steps above.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Main CLI handler. Reads argv, runs discovery, prints result, exits 0.
 * Any error state is "skipped" — never a crash (defensive I/O rule).
 */
async function main() {
  const args     = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const query    = args.filter((a) => !a.startsWith('--')).join(' ').trim();

  let result;
  try {
    result = await discoverCandidates({ query });
  } catch {
    result = {
      status:     'skipped',
      candidates: [],
      reason:     'Unexpected internal error during discovery.',
    };
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(renderDiscovery(result, query) + '\n');
  }

  process.exit(0);
}

// Run when invoked directly.
const isMain =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('mcp-discover.mjs');

if (isMain) {
  main();
}
