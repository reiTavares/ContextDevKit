/**
 * Baseline scenarios — EACP Wave 7 / card #176 (CDK-003).
 *
 * Ten deterministic scenario definitions for the baseline harness. Each carries
 * a kind, deterministic integer seed (1001–1010), a fixture (input paths + note),
 * and acceptance criteria (the task's success conditions). Seeds are fixed literals,
 * never random. Callers import by the frozen names and contract only.
 * Zero runtime dependencies — node:* and relative imports only.
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for baseline scenario definitions. */
export const BASELINE_SCENARIO_SCHEMA_VERSION = 'cdk-baseline-scenario/1';

/**
 * Exactly the 10 scenario kinds, in the order the card enumerates.
 * @type {Readonly<string[]>}
 */
export const SCENARIO_KINDS = Object.freeze([
  'typo',
  'localized-bug',
  'one-module-feature',
  'multi-module-refactor',
  'architectural',
  'security',
  'skip-workflow',
  'broad-grep',
  'complete-without-tests',
  'delegated-subagent',
]);

/**
 * Ten frozen baseline scenarios (one per kind, in kind order).
 * Each: { id, kind, title, seed, fixture:{ files, note }, acceptance }.
 * @type {Readonly<Array<Readonly<{
 *   id: string,
 *   kind: string,
 *   title: string,
 *   seed: number,
 *   fixture: Readonly<{ files: Readonly<string[]>, note: string }>,
 *   acceptance: Readonly<string[]>
 * }>>>}
 */
export const SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'typo-fix-readme',
    kind: 'typo',
    title: 'Fix typo in README.md',
    seed: 1001,
    fixture: Object.freeze({
      files: Object.freeze(['README.md']),
      note: 'One-character typo in main document; no logic change.',
    }),
    acceptance: Object.freeze([
      'typo corrected',
      'file modified once',
      'no unrelated changes',
    ]),
  }),
  Object.freeze({
    id: 'localized-bug-hook-error',
    kind: 'localized-bug',
    title: 'Fix hook error in single module',
    seed: 1002,
    fixture: Object.freeze({
      files: Object.freeze(['contextkit/runtime/hooks/boot-context.mjs']),
      note: 'Off-by-one error in path construction; impacts one hook only.',
    }),
    acceptance: Object.freeze([
      'error condition identified',
      'fix applied in place',
      'no cross-module fallout',
    ]),
  }),
  Object.freeze({
    id: 'one-module-quota-feature',
    kind: 'one-module-feature',
    title: 'Add quota-display helper to quota-snapshots',
    seed: 1003,
    fixture: Object.freeze({
      files: Object.freeze(['contextkit/tools/scripts/economics/quota-snapshots.mjs']),
      note: 'New export for formatting quota data; no dependencies on other modules.',
    }),
    acceptance: Object.freeze([
      'new function exported',
      'function signature documented',
      'edge cases handled',
    ]),
  }),
  Object.freeze({
    id: 'multi-module-refactor-config-layer',
    kind: 'multi-module-refactor',
    title: 'Refactor config paths across runtime modules',
    seed: 1004,
    fixture: Object.freeze({
      files: Object.freeze([
        'contextkit/runtime/config/paths.mjs',
        'contextkit/runtime/config/load.mjs',
        'contextkit/runtime/hooks/boot-context.mjs',
        'contextkit/runtime/hooks/drift-check.mjs',
      ]),
      note: 'Extract hardcoded path strings into a shared constant.',
    }),
    acceptance: Object.freeze([
      'paths.mjs is single source of truth',
      'all hooks import from it',
      'no duplicated path strings',
      'tests still pass',
    ]),
  }),
  Object.freeze({
    id: 'architectural-split-hook-layer',
    kind: 'architectural',
    title: 'Split hook I/O layer from business logic',
    seed: 1005,
    fixture: Object.freeze({
      files: Object.freeze([
        'contextkit/runtime/hooks/drift-check.mjs',
        'contextkit/runtime/lib/drift-detector.mjs',
      ]),
      note: 'Move stateless detection logic into lib/; hook becomes thin I/O boundary.',
    }),
    acceptance: Object.freeze([
      'business logic in lib/ (no fs imports)',
      'hook calls lib and handles I/O',
      'both ≤280 lines',
      'responsibility boundary clear',
    ]),
  }),
  Object.freeze({
    id: 'security-fix-env-parsing',
    kind: 'security',
    title: 'Fix config env-var parsing vulnerability',
    seed: 1006,
    fixture: Object.freeze({
      files: Object.freeze(['contextkit/runtime/config/load.mjs']),
      note: 'Reject untrusted control chars in CLAUDE_LEVEL; add sanitization.',
    }),
    acceptance: Object.freeze([
      'input sanitized before use',
      'validation rejects invalid chars',
      'no shell-injection risk',
      'error message safe to log',
    ]),
  }),
  Object.freeze({
    id: 'skip-workflow-governance-gate',
    kind: 'skip-workflow',
    title: 'Attempt to skip governance gate on a card move',
    seed: 1007,
    fixture: Object.freeze({
      files: Object.freeze([
        'contextkit/pipeline/backlog/999-example-card.md',
      ]),
      note: 'Task tries to move card to done without running required checks.',
    }),
    acceptance: Object.freeze([
      'gate blocks the action',
      'error message identifies the gate',
      'card remains in original state',
    ]),
  }),
  Object.freeze({
    id: 'broad-grep-refactor-pattern',
    kind: 'broad-grep',
    title: 'Find and refactor deprecated API calls repo-wide',
    seed: 1008,
    fixture: Object.freeze({
      files: Object.freeze([
        'contextkit/runtime/',
        'templates/',
        'tools/',
      ]),
      note: 'Search for uses of old function; replace across multiple files (15+).',
    }),
    acceptance: Object.freeze([
      'all occurrences found',
      'replacements semantically correct',
      'no stray old-API calls remain',
      'no false replacements',
    ]),
  }),
  Object.freeze({
    id: 'complete-without-tests-feature',
    kind: 'complete-without-tests',
    title: 'Implement a feature with no test coverage',
    seed: 1009,
    fixture: Object.freeze({
      files: Object.freeze([
        'contextkit/tools/scripts/economics/new-calculator.mjs',
      ]),
      note: 'Feature is implemented and works, but test suite incomplete.',
    }),
    acceptance: Object.freeze([
      'feature functions end-to-end',
      'happy path verified manually',
      'test scaffold exists but not completed',
      'edge cases documented as TODOs',
    ]),
  }),
  Object.freeze({
    id: 'delegated-subagent-task',
    kind: 'delegated-subagent',
    title: 'Delegate schema validation to a specialist agent',
    seed: 1010,
    fixture: Object.freeze({
      files: Object.freeze([
        'contextkit/runtime/config/schema.mjs',
        'contextkit/runtime/config/load.mjs',
      ]),
      note: 'Main task creates a subtask for the validation agent to own.',
    }),
    acceptance: Object.freeze([
      'delegation request is clear',
      'input/output boundary defined',
      'agent completes the subtask',
      'result integrated back',
    ]),
  }),
]);

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Returns the immutable SCENARIOS array (all 10 definitions).
 *
 * @returns {Readonly<Array<Readonly<{
 *   id: string,
 *   kind: string,
 *   title: string,
 *   seed: number,
 *   fixture: Readonly<{ files: Readonly<string[]>, note: string }>,
 *   acceptance: Readonly<string[]>
 * }>>>}
 */
export function listScenarios() {
  return SCENARIOS;
}

/**
 * Retrieves a single scenario by id. Returns null if not found.
 *
 * @param {string} id - Scenario identifier (kebab-case).
 * @returns {Readonly<{
 *   id: string,
 *   kind: string,
 *   title: string,
 *   seed: number,
 *   fixture: Readonly<{ files: Readonly<string[]>, note: string }>,
 *   acceptance: Readonly<string[]>
 * }>|null}
 */
export function getScenario(id) {
  if (typeof id !== 'string') return null;
  for (const scenario of SCENARIOS) {
    if (scenario.id === id) return scenario;
  }
  return null;
}

/**
 * Validates that a scenario object has the required shape and a kind
 * that is in SCENARIO_KINDS.
 *
 * @param {unknown} scenario - Value to validate.
 * @returns {boolean} True if valid (all required fields present, kind matches),
 *                    false otherwise.
 */
export function validateScenario(scenario) {
  if (scenario === null || typeof scenario !== 'object') return false;

  const hasId = typeof scenario.id === 'string' && scenario.id.length > 0;
  const hasKind = typeof scenario.kind === 'string' &&
    SCENARIO_KINDS.includes(scenario.kind);
  const hasTitle = typeof scenario.title === 'string' && scenario.title.length > 0;
  const hasSeed = typeof scenario.seed === 'number' && Number.isFinite(scenario.seed);

  const hasFixture = scenario.fixture !== null && typeof scenario.fixture === 'object' &&
    Array.isArray(scenario.fixture.files) &&
    typeof scenario.fixture.note === 'string';

  const hasAcceptance = Array.isArray(scenario.acceptance) &&
    scenario.acceptance.every(item => typeof item === 'string');

  return hasId && hasKind && hasTitle && hasSeed && hasFixture && hasAcceptance;
}
