/**
 * integration-test-mcp-003-parity.mjs — AC#4: Cross-host server set parity
 *
 * One fixture manifest with allowedHosts='*' must yield the identical server
 * set across all four hosts. No host may silently drop or add a server.
 *
 * Covers: Suite 10 from integration-test-mcp-003.mjs
 * Run:    node tools/integration-test-mcp-003-parity.mjs
 * Exits 0 on all-pass, non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  FIXTURE_REGISTRY, WILDCARD_MANIFEST,
  check, loadRenderers,
} from './integration-test-mcp-003-helpers.mjs';

const rep = reporter();
const { renderClaude, renderCodex, renderCursor, renderAg } = await loadRenderers();

// ---------------------------------------------------------------------------
// Suite 10: AC#4 — Parity: wildcard manifest yields identical server sets
// ---------------------------------------------------------------------------

console.log('\n[Suite 10] AC#4 — Cross-host server set parity (allowedHosts=*)\n');

{
  const claudeIds  = renderClaude(WILDCARD_MANIFEST, FIXTURE_REGISTRY)[0].servers.map(s => s.id).sort();
  const codexIds   = renderCodex(WILDCARD_MANIFEST,  FIXTURE_REGISTRY)[0].servers.map(s => s.id).sort();
  const cursorIds  = renderCursor(WILDCARD_MANIFEST, FIXTURE_REGISTRY)[0].servers.map(s => s.id).sort();
  const agIds      = renderAg(WILDCARD_MANIFEST,     FIXTURE_REGISTRY)[0].servers.map(s => s.id).sort();

  const refJson = JSON.stringify(claudeIds);
  check(rep, JSON.stringify(codexIds)  === refJson, 'codex parity: same server ids as claude',
    `codex=${JSON.stringify(codexIds)} claude=${refJson}`);
  check(rep, JSON.stringify(cursorIds) === refJson, 'cursor parity: same server ids as claude',
    `cursor=${JSON.stringify(cursorIds)} claude=${refJson}`);
  check(rep, JSON.stringify(agIds)     === refJson, 'antigravity parity: same server ids as claude',
    `ag=${JSON.stringify(agIds)} claude=${refJson}`);

  rep.ok(`parity: ${claudeIds.length} servers consistent across all 4 hosts (${claudeIds.join(', ')})`);
}

rep.finish('MCP-003 parity');
