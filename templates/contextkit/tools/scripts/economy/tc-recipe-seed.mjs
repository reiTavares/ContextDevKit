/**
 * Task-Compiler: inert seed recipe (TC-15 / WF0022 / ADR-0089).
 *
 * Single responsibility: ship ONE reviewable seed recipe that exercises the
 * three DAG shapes supported by tc-recipe-runner.mjs (linear, fan-out-to-join,
 * conditional-edge). All steps are kind='noop' — no patches, no writes.
 *
 * Expansion of the recipe library is ADR-gated (constitution §9).
 * This file exists as a separate module because the seed is pure DATA with its
 * own consumer (tests, CLI preview); the runner itself has no hard dep on it.
 *
 * Zero runtime dependencies — node:* only (no imports needed for pure data).
 * [task-compiler] [token-economy] [WF0022] [ADR-0089]
 */

/**
 * @typedef {import('./tc-recipe-runner.mjs').Recipe} Recipe
 */

/**
 * Inert seed recipe shipped with the runner.
 * Shape: linear A → fan-out(B, C) → join D → linear E.
 * Step C is conditional on `env.mode == "full"`.
 *
 * @type {Recipe}
 */
export const SEED_RECIPE = Object.freeze({
  id:      'tc-seed-recipe/1',
  version: '1.0.0',
  entry:   'step-a',
  steps:   Object.freeze([
    Object.freeze({
      id:    'step-a',
      kind:  'noop',
      label: 'Seed linear start — fans out to B and C',
      edges: Object.freeze([
        Object.freeze({ target: 'step-b', fanOut: true }),
        Object.freeze({ target: 'step-c', fanOut: true }),
      ]),
    }),
    Object.freeze({
      id:    'step-b',
      kind:  'noop',
      label: 'Seed fan-out branch B (unconditional)',
      edges: Object.freeze([
        Object.freeze({ target: 'step-d', join: true }),
      ]),
    }),
    Object.freeze({
      id:    'step-c',
      kind:  'noop',
      label: 'Seed fan-out branch C (conditional on env.mode)',
      edges: Object.freeze([
        Object.freeze({ target: 'step-d', join: true, condition: 'env.mode == "full"' }),
      ]),
    }),
    Object.freeze({
      id:    'step-d',
      kind:  'noop',
      label: 'Seed join point — merges B and C',
      edges: Object.freeze([
        Object.freeze({ target: 'step-e' }),
      ]),
    }),
    Object.freeze({
      id:    'step-e',
      kind:  'noop',
      label: 'Seed linear terminal',
    }),
  ]),
});
