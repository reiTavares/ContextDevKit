/**
 * WF-0070 (OP-0008, ADR-0132) memory-accessibility suites.
 *
 * Cohesion note: these three suites cover the memory-accessibility workstream —
 * the installer VCS posture split + F-D dogfood guard (`memory-posture`), the
 * reuse-based governance digest (`governance-digest`), and the project-map
 * memory-roots config surface (`projmap-memory-roots`). They live in their own
 * module — spread into `test-suites.mjs` via `...WF0070_SUITES` — so the main
 * registry stays within the 308-line budget (same pattern as `BDM_SUITES` /
 * `INFRA_SUITES` / `MCP_SUITES`).
 *
 * Zero runtime dependencies — node:* only (no imports needed).
 *
 * @module test-suites-wf0070
 */

/** Conventional integration-test file path from its short name (mirrors test-suites.mjs). */
const it = (name) => `tools/integration-test-${name}.mjs`;

/**
 * WF-0070 memory-accessibility suites.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0070_SUITES = Object.freeze([
  // Installer VCS posture split + F-D dogfood guard (ADR-0132 blocker).
  { id: 'memory-posture', file: it('memory-posture'), tier: 'integration:installer',
    touches: ['tools/install/exclude.mjs', 'tools/install/git.mjs', 'tools/install/update-preflight.mjs'] },
  // Query-first governance digest reusing the three registries.
  { id: 'governance-digest', file: 'tools/selfcheck-governance-digest.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/governance-digest.mjs', 'templates/contextkit/tools/scripts/registry/'] },
  // Project-map governance-memory roots config surface.
  { id: 'projmap-memory-roots', file: 'tools/selfcheck-projmap-memory-roots.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/project-map-roots.mjs'] },
]);
