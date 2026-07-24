/**
 * WF-0095 (OP-0008, reuses ADR-0131) test suite — bilingual classifier signals.
 *
 * WF-0069 made the intent classifier language-aware; WF-0095 extends the same
 * pattern (deterministic pt/en tables in the hook; other languages delegated to
 * the model via ‹CONTEXTKIT-LANG›) to the rest of the request-text classifier
 * fleet, plus an accent-preserving tokenizer.
 *
 * Cohesion note: declared in its own module — spread into `test-suites.mjs` via
 * `...WF0095_SUITES` — so the main registry stays under the 308-line RED ceiling
 * (same pattern as `WF0069_SUITES` / `INFRA_SUITES`).
 *
 *   - wf0095-bilingual-signals: accent-preserving tokenizer, STOPWORDS discipline,
 *                               pt/en tier + work parity, additive proof, determinism.
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module test-suites-wf0095
 */

/**
 * WF-0095 suites, declared with the other selfcheck floors.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0095_SUITES = Object.freeze([
  { id: 'wf0095-bilingual-signals', file: 'tools/selfcheck-wf0095-bilingual-signals.mjs', tier: 'selfcheck',
    touches: [
      'templates/contextkit/runtime/execution/work-classify-signals.mjs',
      'templates/contextkit/runtime/execution/work-classifier.mjs',
      'templates/contextkit/runtime/execution/work-classify-nature.mjs',
      'templates/contextkit/runtime/execution/materiality-policy-default.mjs',
      'templates/contextkit/runtime/execution/decision-triple.mjs',
      'templates/contextkit/runtime/execution/request-classify.mjs',
      'templates/contextkit/policy/complexity-rubric.json',
      'templates/contextkit/policy/work-classification.json',
      'templates/contextkit/policy/decision-intelligence.json',
      'templates/contextkit/policy/domain-engineering/code-intent-weights.json',
      'templates/contextkit/policy/domain-engineering/domain-applicability-weights.json',
      'templates/contextkit/tools/scripts/routing/task-classifier.mjs',
    ] },
]);
