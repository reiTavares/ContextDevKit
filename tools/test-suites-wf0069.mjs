/**
 * WF-0069 (OP-0008, ADR-0131 + ADR-0133) test suites — language-aware intent
 * classification + its two isolated OP-0008 direct fixes.
 *
 * Cohesion note: these three fast `selfcheck` suites live in their own module —
 * spread into `test-suites.mjs` via `...WF0069_SUITES` — so the main registry stays
 * under the 308-line RED ceiling (same pattern as `BDM_SUITES` / `INFRA_SUITES`).
 *
 *   - wf0069-lang-intent  : golden pt/en/ru set, F-A write authority, F-B binding,
 *                           Finding #7 (minted-taskId misroute), determinism, fail-open,
 *                           domain-axis guard (ADR-0131 hard acceptance criteria).
 *   - wf0069-adr-allocator: OP-0008 Finding #2 — maxAdrInDir counts ADR-####-*.md.
 *   - wf0069-wf-prefix    : OP-0008 Finding #8 — createWorkflow WF- prefix + owner survives.
 *
 * Zero runtime dependencies — node:* only (no imports needed).
 *
 * @module test-suites-wf0069
 */

/**
 * WF-0069 suites, declared with the other selfcheck floors.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0069_SUITES = Object.freeze([
  { id: 'wf0069-lang-intent', file: 'tools/selfcheck-wf0069-lang-intent.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/runtime/execution/intent-language.mjs', 'templates/contextkit/runtime/execution/request-classify.mjs', 'templates/contextkit/runtime/execution/task-intake.mjs', 'templates/contextkit/runtime/hooks/completion-gate.mjs', 'templates/contextkit/runtime/hooks/track-edits.mjs', 'templates/contextkit/runtime/hooks/execution-contract-hook.mjs'] },
  { id: 'wf0069-adr-allocator', file: 'tools/selfcheck-wf0069-adr-allocator.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/registry/ids.mjs'] },
  { id: 'wf0069-wf-prefix', file: 'tools/selfcheck-wf0069-wf-prefix.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/workflow-pack.mjs', 'templates/contextkit/tools/scripts/registry/workflow.mjs'] },
]);
