/**
 * Single source of truth for the test-suite inventory (TEA-002, SPEC §3).
 *
 * WHY this file exists: before TEA-002 the 41-suite list lived ONLY inside the
 * `test` `&&` chain in package.json. There was no way to run a subset and no
 * guard against drift — a suite added to `test` could be silently missed by any
 * future tier or selector. Every npm script (incl. `npm test`) now runs *from
 * this list* via `tools/run-suites.mjs`, and `tools/selfcheck-suites.mjs`
 * asserts the list covers every suite file on disk (immutable rule 3).
 *
 * Each entry is `{ id, file, tier, touches }`:
 *   - `id`      — short, stable identifier (used by `--list` and reporters).
 *   - `file`    — the `tools/...mjs` path, forward-slashed, relative to repo root.
 *   - `tier`    — EXACTLY ONE of TIERS (see below). Drives the `test:*` scripts.
 *   - `touches` — conservative source-path glob/prefix SEEDS that should select
 *                 this suite when changed. Best-effort only; Wave 2's selector
 *                 (`tools/test-impact.mjs`) refines + broadens. Keep these honest
 *                 and conservative — a false-negative (suite that should run but
 *                 wasn't) is treated as worse than over-selecting.
 *
 * IMPORTANT: the array order below is the LEGACY execution order (the literal
 * old `package.json:19` `&&` chain). `run-suites.mjs --legacy` replays exactly
 * this order so the rollback path stays a one-line flip.
 */

/**
 * The eight execution tiers. Each suite belongs to EXACTLY ONE. The grouping is
 * a mapping exercise (SPEC §2) — no suite file moves; only the npm script that
 * invokes the group is new.
 * @type {readonly string[]}
 */
export const TIERS = Object.freeze([
  'smoke',
  'selfcheck',
  'integration:core',
  'integration:installer',
  'integration:hosts',
  'integration:workflow',
  'integration:enforcement',
  'integration:ecosystem',
]);

/** Conventional integration-test file path from its short name. */
const it = (name) => `tools/integration-test-${name}.mjs`;

/**
 * The full suite inventory, in LEGACY execution order. 41 product suites + the
 * standalone `selfcheck-suites` floor check (also a smoke suite). Touches seeds
 * are conservative prefixes/globs into the SOURCE tree the suite exercises.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const SUITES = Object.freeze([
  // selfcheck (static, in-process wiring) — 1
  { id: 'selfcheck', file: 'tools/selfcheck.mjs', tier: 'selfcheck',
    touches: ['tools/selfcheck', 'templates/contextkit/runtime/', 'install.mjs'] },

  // integration:core — engine + real hooks — 5
  { id: 'integration-test', file: 'tools/integration-test.mjs', tier: 'integration:core',
    touches: ['install.mjs', 'templates/contextkit/runtime/hooks/', 'templates/contextkit/runtime/config/'] },
  { id: 'tooling', file: it('tooling'), tier: 'integration:installer',
    touches: ['templates/contextkit/tools/scripts/', 'templates/contextkit/squads/'] },
  { id: 'tooling-qa', file: it('tooling-qa'), tier: 'integration:workflow',
    touches: ['templates/contextkit/squads/qa-team/', 'templates/contextkit/commands/qa'] },
  { id: 'project-map', file: it('project-map'), tier: 'integration:core',
    touches: ['templates/contextkit/tools/scripts/project-map', 'templates/contextkit/runtime/hooks/'] },
  { id: 'token-economy', file: it('token-economy'), tier: 'integration:core',
    touches: ['templates/contextkit/tools/scripts/token', 'templates/contextkit/runtime/economy/'] },
  { id: 'tooling-pipeline', file: it('tooling-pipeline'), tier: 'integration:workflow',
    touches: ['templates/contextkit/tools/scripts/pipeline', 'templates/contextkit/commands/pipeline'] },
  { id: 'pipeline-substrate', file: it('pipeline-substrate'), tier: 'integration:workflow',
    touches: ['templates/contextkit/tools/scripts/pipeline', 'templates/contextkit/tools/scripts/state'] },
  { id: 'tooling-agent-forge', file: it('tooling-agent-forge'), tier: 'integration:workflow',
    touches: ['templates/contextkit/squads/agent-forge/'] },
  { id: 'guards', file: it('guards'), tier: 'integration:installer',
    touches: ['templates/contextkit/runtime/hooks/commit-msg', 'templates/contextkit/runtime/hooks/pre-push', 'templates/contextkit/runtime/config/load'] },
  { id: 'autonomy', file: it('autonomy'), tier: 'integration:core',
    touches: ['templates/contextkit/runtime/config/resolve-autonomy', 'templates/contextkit/commands/autonomy'] },
  { id: 'compozy', file: it('compozy'), tier: 'integration:ecosystem',
    touches: ['templates/contextkit/squads/', 'templates/contextkit/tools/scripts/'] },
  { id: 'migrate', file: it('migrate'), tier: 'integration:installer',
    touches: ['install.mjs', 'templates/contextkit/tools/scripts/migrate'] },
  { id: 'update-safety', file: it('update-safety'), tier: 'integration:installer',
    touches: ['install.mjs'] },
  { id: 'antigravity', file: it('antigravity'), tier: 'integration:hosts',
    touches: ['templates/contextkit/runtime/antigravity/', 'templates/ctx.mjs'] },
  { id: 'active-squads', file: it('active-squads'), tier: 'integration:hosts',
    touches: ['templates/contextkit/squads/', 'templates/contextkit/runtime/hooks/squad-context'] },
  { id: 'codex', file: it('codex'), tier: 'integration:hosts',
    touches: ['templates/contextkit/runtime/codex/', 'templates/cdx.mjs'] },
  { id: 'lp', file: it('lp'), tier: 'integration:hosts',
    touches: ['templates/contextkit/squads/design-team/', 'templates/contextkit/commands/landing-page'] },
  { id: 'swarm', file: it('swarm'), tier: 'smoke',
    touches: ['templates/contextkit/tools/scripts/swarm', 'templates/contextkit/commands/swarm'] },
  { id: 'deliberation', file: it('deliberation'), tier: 'integration:workflow',
    touches: ['templates/contextkit/tools/scripts/deliberation', 'templates/contextkit/commands/debate'] },
  { id: 'hooks', file: it('hooks'), tier: 'integration:core',
    touches: ['templates/contextkit/runtime/hooks/'] },
  { id: 'workflow-governance', file: it('workflow-governance'), tier: 'integration:workflow',
    touches: ['templates/contextkit/tools/scripts/workflow', 'templates/contextkit/commands/workflow'] },
  { id: 'hookcoexist', file: it('hookcoexist'), tier: 'integration:ecosystem',
    touches: ['templates/contextkit/runtime/config/settings-compose', 'templates/contextkit/runtime/hooks/'] },
  { id: 'autoformat', file: it('autoformat'), tier: 'integration:ecosystem',
    touches: ['templates/contextkit/runtime/hooks/auto-format', 'templates/contextkit/runtime/config/settings-compose'] },
  { id: 'qgates', file: it('qgates'), tier: 'integration:enforcement',
    touches: ['templates/contextkit/tools/scripts/qgates', 'templates/contextkit/runtime/hooks/'] },
  { id: 'ci-squad', file: it('ci-squad'), tier: 'integration:ecosystem',
    touches: ['templates/contextkit/squads/', '.github/workflows/'] },
  { id: 'marker-inject', file: it('marker-inject'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/hooks/boot', 'templates/contextkit/runtime/hooks/inject'] },
  { id: 'bridges', file: it('bridges'), tier: 'integration:hosts',
    touches: ['templates/contextkit/runtime/antigravity/', 'templates/contextkit/runtime/codex/'] },
  { id: 'capabilities', file: it('capabilities'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/capabilities/', 'templates/contextkit/runtime/config/'] },
  { id: 'install-cycle', file: it('install-cycle'), tier: 'smoke',
    touches: ['install.mjs'] },
  { id: 'execution', file: it('execution'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/execution/', 'templates/contextkit/runtime/hooks/'] },
  { id: 'execution-persistence', file: it('execution-persistence'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/execution/'] },
  { id: 'receipts', file: it('receipts'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/execution/', 'templates/contextkit/runtime/enforcement/'] },
  { id: 'enforcement', file: it('enforcement'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/enforcement/'] },
  { id: 'enforcement-modes', file: it('enforcement-modes'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/enforcement/'] },
  { id: 'gate', file: it('gate'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/enforcement/', 'templates/contextkit/runtime/hooks/'] },
  { id: 'gate-p2', file: it('gate-p2'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/enforcement/'] },
  { id: 'contract-hook', file: it('contract-hook'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/execution/', 'templates/contextkit/runtime/hooks/'] },
  { id: 'indirect-write', file: it('indirect-write'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/execution/', 'templates/contextkit/runtime/hooks/'] },
  { id: 'explore-budget', file: it('explore-budget'), tier: 'smoke',
    touches: ['templates/contextkit/runtime/execution/'] },
  { id: 'completion-gate', file: it('completion-gate'), tier: 'integration:enforcement',
    touches: ['templates/contextkit/runtime/hooks/completion-gate', 'templates/contextkit/runtime/execution/evaluate-completion'] },

  // Infra self-test (TEA-002) — guards the list itself; also a fast smoke suite.
  { id: 'selfcheck-suites', file: 'tools/selfcheck-suites.mjs', tier: 'smoke',
    touches: ['tools/test-suites.mjs', 'tools/run-suites.mjs', 'tools/selfcheck-suites.mjs'] },

  // Infra self-test (TEA-004) — guards the impact selector; also a fast smoke suite.
  { id: 'selfcheck-impact', file: 'tools/selfcheck-impact.mjs', tier: 'smoke',
    touches: ['tools/test-impact.mjs', 'tools/test-suites.mjs', 'tools/selfcheck-impact.mjs'] },
]);

/**
 * All suites, in declared (legacy) order.
 * @returns {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export function allSuites() {
  return SUITES;
}

/**
 * Suites belonging to one tier, preserving declared order.
 * @param {string} tier - a member of TIERS.
 * @returns {Array<{id:string,file:string,tier:string,touches:string[]}>}
 * @throws {Error} if `tier` is not a known tier (fail-fast, no silent empty set).
 */
export function suitesForTier(tier) {
  if (!TIERS.includes(tier)) {
    throw new Error(`unknown tier "${tier}"; valid tiers: ${TIERS.join(', ')}`);
  }
  return SUITES.filter((suite) => suite.tier === tier);
}
