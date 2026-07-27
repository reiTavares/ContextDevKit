/**
 * WF-0086 (BIZ-0006, ADR-0148 §13) test suite — program integration, rollout and
 * the plane-wide governance measurement. The co-located selftest lives beside its
 * engine module under `templates/` (like the WF-0089 projections and WF-0090
 * guardrail selftests) and is spread into `test-suites.mjs` via `...WF0086_SUITES`
 * so the main registry stays inside its line budget.
 *
 *   - wf0086-governance-north-star : IN2 — the plane-wide `governance-tokens/session`
 *                          reader `methodology/token-guardrail.mjs` names as a
 *                          WF-0086 seam and deliberately does not implement (it
 *                          reads only its own `content-fill` lever). Pins the
 *                          classification boundary — the four observable levers
 *                          (boot-delta/run-compact/project-map/routing) are
 *                          EXCLUDED from governance spend, because folding a
 *                          saving into a spend measurement would make the HARD
 *                          §13 guardrail unfalsifiable. Proves a rising series
 *                          FAILS and blocks promotion while flat/falling pass;
 *                          that an unavailable measurement is `skipped` and never
 *                          behaves as a pass (constitution §8); that the
 *                          concluded-context numerator is decided by the state
 *                          authority and NEVER by directory placement (the exact
 *                          BIZ-0004 drift shape must not be counted); that the
 *                          north-star keeps `baseline`/`target` null and reports
 *                          `available:false` rather than a flattering zero when
 *                          either side of the ratio is missing; and statically
 *                          that no model is called to decide.
 */
export const WF0086_SUITES = Object.freeze([
  {
    id: 'wf0086-governance-north-star',
    file: 'templates/contextkit/tools/scripts/economics/governance-north-star.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/tools/scripts/economics/governance-north-star.mjs',
      'templates/contextkit/tools/scripts/token-report.mjs',
      'templates/contextkit/tools/scripts/economy/economy-events.mjs',
      'templates/contextkit/tools/scripts/economy/registry.mjs',
      'templates/contextkit/tools/scripts/workflow/invariants.mjs',
      'templates/contextkit/methodology/token-guardrail.mjs',
    ],
  },
]);
