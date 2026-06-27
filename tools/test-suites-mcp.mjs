/**
 * MCP ticket integration-test suite registrations.
 *
 * Cohesion note: these suites verify the MCP integration layer. They live in
 * their own module — spread into `test-suites.mjs` via `...MCP_SUITES` — so the
 * main registry stays under the 308-line RED ceiling (same pattern as
 * `BDM_SUITES` / `WORKFLOW_ENGINE_SUITES` / `INFRA_SUITES`).
 *
 * Each ticket's suite was split into focused, standalone sub-suites (each well
 * under the 308-line budget) following the `selfcheck-mcp-002-*` convention; the
 * shared `*-helpers.mjs` files are imported by the sub-suites, not run directly,
 * so they are intentionally NOT registered here.
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module test-suites-mcp
 */

/** Conventional integration-test file path from its short name. */
const it = (name) => `tools/integration-test-${name}.mjs`;

/**
 * Per-ticket config: which host/ecosystem tier the suite belongs to, the source
 * paths that should select it under `--impact`, and the runnable sub-suite
 * aspects (helpers excluded).
 */
const TICKETS = {
  '002': { tier: 'integration:ecosystem', touches: ['templates/contextkit/runtime/mcp/registry.mjs', 'templates/contextkit/runtime/mcp/manifest.mjs', 'templates/contextkit/runtime/mcp/resolve-profile.mjs', 'templates/contextkit/mcp/'], aspects: ['deny', 'manifest', 'registry', 'seed'] },
  '003': { tier: 'integration:hosts', touches: ['templates/contextkit/runtime/mcp/render/'], aspects: ['deny', 'filesizes', 'happy', 'parity', 'secrets'] },
  '004': { tier: 'integration:ecosystem', touches: ['templates/contextkit/tools/scripts/mcp-doctor.mjs', 'templates/contextkit/tools/scripts/mcp.mjs'], aspects: ['degraded', 'deny', 'dispatch', 'happy'] },
  '005': { tier: 'integration:ecosystem', touches: ['templates/contextkit/runtime/mcp/policy.mjs', 'templates/contextkit/mcp/policies/'], aspects: ['deny', 'pure', 'taxonomy', 'tools'] },
  '006': { tier: 'integration:ecosystem', touches: ['templates/contextkit/mcp-server/'], aspects: ['catalog', 'contract', 'handlers', 'rpc'] },
  '007': { tier: 'integration:ecosystem', touches: ['templates/contextkit/mcp/profiles/github-readonly.json', 'templates/contextkit/mcp/policies/github.allow.json'], aspects: ['deny', 'policy', 'registry', 'render'] },
  '008': { tier: 'integration:ecosystem', touches: ['templates/contextkit/mcp/profiles/playwright-guarded.json', 'templates/contextkit/mcp/policies/playwright.allow.json'], aspects: ['boundary', 'consistency', 'deny', 'profile', 'registry'] },
  '009': { tier: 'integration:ecosystem', touches: ['templates/contextkit/runtime/mcp/activation.mjs'], aspects: ['happy', 'narrow', 'policy', 'shape', 'table'] },
  '010': { tier: 'integration:ecosystem', touches: ['templates/contextkit/tools/scripts/mcp-receipt.mjs', 'templates/contextkit/tools/scripts/mcp-audit.mjs'], aspects: ['audit', 'core', 'receipt-build', 'receipt-write', 'seam'] },
  '012': { tier: 'integration:ecosystem', touches: ['templates/contextkit/tools/scripts/mcp-discover.mjs'], aspects: ['degraded', 'happy', 'normalise'] },
};

/**
 * MCP integration-test suites + the static wiring floor check, declared in
 * ticket order.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const MCP_SUITES = Object.freeze([
  ...Object.entries(TICKETS).flatMap(([ticket, cfg]) =>
    cfg.aspects.map((aspect) => ({
      id: `mcp-${ticket}-${aspect}`,
      file: it(`mcp-${ticket}-${aspect}`),
      tier: cfg.tier,
      touches: cfg.touches,
    }))),
  // MCP static wiring floor check (registry valid, profiles reference known ids,
  // every runtime/mcp + mcp-server + scripts/mcp-* source present, /mcp surface).
  { id: 'mcp-wiring', file: 'tools/selfcheck-mcp.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/mcp/', 'templates/contextkit/runtime/mcp/', 'templates/contextkit/mcp-server/', 'templates/contextkit/tools/scripts/mcp', 'templates/claude/commands/mcp/'] },
  { id: 'mcp-install-propagation', file: 'tools/integration-test-mcp-install-propagation.mjs', tier: 'integration:ecosystem',
    touches: ['tools/install/engine.mjs', 'templates/contextkit/mcp/', 'templates/contextkit/mcp-server/'] },
  // Per-ticket static selfchecks (split into focused sub-suites; *-helpers are
  // imported, not run). MCP-002's selfcheck-mcp-002.mjs aggregates its 4 sub-files.
  { id: 'mcp-002-selfcheck', file: 'tools/selfcheck-mcp-002.mjs', tier: 'selfcheck', touches: ['templates/contextkit/runtime/mcp/registry.mjs', 'templates/contextkit/mcp/'] },
  ...['deny', 'pass', 'pure', 'report'].map((a) => ({ id: `mcp-004-selfcheck-${a}`, file: `tools/selfcheck-mcp-004-${a}.mjs`, tier: 'selfcheck', touches: ['templates/contextkit/tools/scripts/mcp-doctor.mjs', 'templates/contextkit/tools/scripts/mcp.mjs'] })),
  ...['e2e', 'handlers', 'imports'].map((a) => ({ id: `mcp-006-selfcheck-${a}`, file: `tools/selfcheck-mcp-006-${a}.mjs`, tier: 'selfcheck', touches: ['templates/contextkit/mcp-server/'] })),
  ...['engine', 'shape'].map((a) => ({ id: `mcp-007-selfcheck-${a}`, file: `tools/selfcheck-mcp-007-${a}.mjs`, tier: 'selfcheck', touches: ['templates/contextkit/mcp/profiles/github-readonly.json'] })),
  { id: 'mcp-012-selfcheck', file: 'tools/selfcheck-mcp-012.mjs', tier: 'selfcheck', touches: ['templates/contextkit/tools/scripts/mcp-discover.mjs'] },
  { id: 'mcp-012-selfcheck-b', file: 'tools/selfcheck-mcp-012b.mjs', tier: 'selfcheck', touches: ['templates/contextkit/tools/scripts/mcp-discover.mjs'] },
]);
