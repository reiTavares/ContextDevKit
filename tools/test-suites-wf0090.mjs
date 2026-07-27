/**
 * WF-0090 (BIZ-0006, ADR-0148 rails (a)+(b)) test suite — the grounded content
 * engine, the ONE place in the kit where an LLM writes. The co-located selftest
 * lives beside its engine modules under `templates/` (like the WF-0089
 * projections/provenance selftests) and is spread into `test-suites.mjs` via
 * `...WF0090_SUITES` so the main registry stays inside its line budget.
 *
 *   - wf0090-content-fill : rail (a) grounded-only — a field is filled only when
 *                           it cites a BIZ-0004 graph-retrieved exemplar that
 *                           passes all four deterministic checks (shape,
 *                           existence, membership in THIS field's retrieved set,
 *                           numeric containment); an empty retrieved set refuses
 *                           WITHOUT calling the generator, so a refusal costs
 *                           zero tokens. Rail (b) provenance-gated — every fill
 *                           is stamped `draft`/`llm:grounded-content` with sorted
 *                           citations, never `authored` and never `derived`;
 *                           WF-0089's `deriveField` skips a draft forever; no
 *                           KPI/target/status field has a write path at all.
 *                           Also pins the edge-field contract (cites are read
 *                           through `relation`, NOT `kind`/`type` — a mistyped
 *                           filter would silently ground nothing while every
 *                           refusal test still passed), proves
 *                           `REASONED_FIELD_KEYS ∩ DERIVED_FIELD_KEYS === ∅`,
 *                           and covers rail (d): six independent off-switches
 *                           plus hostile input all leave the `{{TOKEN}}` skeleton
 *                           intact and never throw.
 *
 * Every case runs with a FAKE generator — zero model calls, zero tokens.
 * Zero runtime dependencies — node:* only.
 *
 * @module test-suites-wf0090
 */

/**
 * WF-0090 suites, declared with the other selfcheck floors.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0090_SUITES = Object.freeze([
  {
    id: 'wf0090-content-fill',
    file: 'templates/contextkit/methodology/content-fill.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/methodology/content-fill.mjs',
      'templates/contextkit/methodology/content-grounding.mjs',
      'templates/contextkit/methodology/content-eligibility.mjs',
      'templates/contextkit/methodology/provenance.mjs',
      'templates/contextkit/methodology/schema-provenance-sidecar.mjs',
      'templates/contextkit/methodology/projections.mjs',
      'templates/contextkit/tools/scripts/graph-query.mjs',
      'templates/contextkit/tools/scripts/work-business-create.mjs',
    ],
  },
]);
