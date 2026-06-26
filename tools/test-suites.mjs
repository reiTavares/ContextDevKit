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
 *   - `touches` — conservative source-path SEEDS that select this suite when
 *                 changed. Best-effort; `tools/test-impact.mjs` refines/broadens.
 *                 A false-negative (suite that should run but didn't) is worse
 *                 than over-selecting, so keep these honest and conservative.
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
import { WORKFLOW_ENGINE_SUITES } from './test-suites-workflow.mjs';
import { BDM_SUITES } from './test-suites-bdm.mjs';
import { INFRA_SUITES } from './test-suites-infra.mjs';
import { MCP_SUITES } from './test-suites-mcp.mjs';

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
  // `touches` EXCLUDES the broad `runtime/` seed (ADR-0113) so `runtime/execution/*`
  // selects the fast `selfcheck-request` shard, not this 8-min monolith.
  { id: 'selfcheck', file: 'tools/selfcheck.mjs', tier: 'selfcheck',
    touches: ['tools/selfcheck', 'install.mjs'] },
  { id: 'session-autonomy', file: 'tools/selfcheck-session-autonomy-all.mjs', tier: 'smoke',
    touches: ['templates/contextkit/tools/scripts/economics/session-autonomy/', 'templates/contextkit/tools/scripts/economics/calibration/'] },

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
  { id: 'eacp', file: it('eacp'), tier: 'integration:core',
    touches: ['templates/contextkit/tools/scripts/economics/'] },
  { id: 'competitive-followups', file: it('competitive-followups'), tier: 'integration:core', touches: ['templates/contextkit/tools/scripts/claims-gate', 'templates/contextkit/tools/scripts/runs'] },
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
  { id: 'config-migrate', file: it('config-migrate'), tier: 'integration:installer',
    touches: ['tools/install/config-migrate.mjs', 'templates/contextkit/runtime/config/defaults.mjs'] },
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
  { id: 'subagent-gate', file: it('subagent-gate'), tier: 'integration:enforcement',
    touches: ['templates/contextkit/runtime/hooks/subagent', 'templates/contextkit/runtime/execution/'] },
  { id: 'compaction', file: it('compaction'), tier: 'integration:enforcement',
    touches: ['templates/contextkit/runtime/hooks/compaction', 'templates/contextkit/runtime/execution/'] },

  // PKG-05 — Project-map & adaptive context (CDK-050…056), advisory, additive.
  { id: 'pkg05-roots', file: 'tools/selfcheck-pkg05-050.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/project-map-roots', 'templates/contextkit/tools/scripts/project-map-core'] },
  { id: 'pkg05-coverage', file: 'tools/selfcheck-pkg05-051.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/project-map-coverage'] },
  { id: 'pkg05-manifest', file: 'tools/integration-test-pkg05-052.mjs', tier: 'integration:core',
    touches: ['templates/contextkit/tools/scripts/context-manifest'] },
  { id: 'pkg05-playbook-scope', file: 'tools/selfcheck-pkg05-053.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/playbook-scope', 'templates/contextkit/tools/scripts/playbook'] },
  { id: 'pkg05-memory-score', file: 'tools/selfcheck-pkg05-054.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/memory-score'] },
  { id: 'pkg05-rule-archive', file: 'tools/selfcheck-pkg05-055.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/rule-archive'] },
  { id: 'pkg05-host-parity', file: 'tools/selfcheck-pkg05-056.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/host-parity'] },

  // PKG-06 — Multi-host telemetry, capability compliance, benchmark, drift (advisory, additive).
  { id: 'pkg06-skill-runner', file: 'tools/selfcheck-pkg06-060.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/skill-runner'] },
  { id: 'pkg06-compliance', file: 'tools/selfcheck-pkg06-061.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/capability-compliance'] },
  { id: 'pkg06-telemetry', file: 'tools/selfcheck-pkg06-062.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/telemetry/'] },
  { id: 'pkg06-benchmark', file: 'tools/selfcheck-pkg06-065.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/benchmark-task'] },
  { id: 'pkg06-wiring-drift', file: 'tools/selfcheck-pkg06-068.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/wiring-drift'] },

  // PKG-06 cost consumers (wf 0027) — advisory consumers of the EACP economics layer.
  { id: 'pkg06-host-cost', file: 'tools/selfcheck-pkg06-063.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/host-cost'] },
  { id: 'pkg06-capability-roi', file: 'tools/selfcheck-pkg06-066.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/capability-roi'] },
  { id: 'pkg06-cache-churn', file: 'tools/selfcheck-pkg06-067.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/cache-churn-health'] },

  // PKG-07 — Lineage graph (CDK-070), read-only advisory, unregistered.
  { id: 'selfcheck-lineage', file: 'tools/selfcheck-lineage.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/lineage-graph', 'templates/contextkit/runtime/execution/receipt-store', 'templates/contextkit/runtime/state/state-io'] },

  // ADR-0094 — automatic model routing for standard sessions (additive, advisory).
  { id: 'routing', file: it('routing'), tier: 'integration:core',
    touches: ['templates/contextkit/tools/scripts/routing/', 'templates/contextkit/runtime/hooks/session-start', 'templates/contextkit/runtime/config/defaults'] },

  // HIGH hotfix 3.0.1 — routing wired into the REAL UserPromptSubmit hook (ADR-0094 §Decision).
  { id: 'routing-hook', file: it('routing-hook'), tier: 'integration:core',
    touches: ['templates/contextkit/runtime/execution/routing-runtime', 'templates/contextkit/runtime/hooks/execution-contract-hook', 'templates/contextkit/tools/scripts/routing/'] },
  { id: 'dev-start-economy', file: it('dev-start-economy'), tier: 'integration:core',
    touches: ['templates/contextkit/tools/scripts/economy/dev-start', 'templates/contextkit/runtime/execution/economy-lifecycle', 'templates/contextkit/tools/scripts/routing/', 'templates/claude/commands/pipeline/dev-start'] },

  // PKG-07 — Lineage consumers (CDK-071…077), read-only advisory, unregistered.
  { id: 'pkg07-public', file: 'tools/selfcheck-pkg07-071.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/lineage-public'] },
  { id: 'pkg07-calibration', file: 'tools/selfcheck-pkg07-072.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/lineage-calibration', 'templates/contextkit/tools/scripts/predictions-review'] },
  { id: 'pkg07-rules', file: 'tools/selfcheck-pkg07-073.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/lineage-rules'] },
  { id: 'pkg07-policy', file: 'tools/selfcheck-pkg07-074.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/policy-registry'] },
  { id: 'pkg07-evidence', file: 'tools/selfcheck-pkg07-075.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/evidence-taxonomy', 'templates/contextkit/runtime/execution/receipt-store'] },
  { id: 'pkg07-scorecard', file: 'tools/selfcheck-pkg07-076.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/engineering-scorecard', 'templates/contextkit/tools/scripts/lineage-rules', 'templates/contextkit/tools/scripts/evidence-taxonomy'] },
  { id: 'pkg07-readiness', file: 'tools/selfcheck-pkg07-077.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/autonomy-readiness-v2', 'templates/contextkit/tools/scripts/engineering-scorecard'] },

  // PKG-08 — Fleet & agent platform (CDK-080/081/082), read-only advisory, unregistered.
  { id: 'pkg08-fleet', file: 'tools/selfcheck-pkg08-fleet.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/fleet-compliance', 'templates/contextkit/tools/scripts/agent-registry', 'templates/contextkit/tools/scripts/policy-distribution'] },

  // WF0020 Economy Runtime — Wave 1 (ECON-01..07/11): aggregates the cards' econCheck* exports.
  { id: 'economy-wave1', file: 'tools/selfcheck-economy-wave1.mjs', tier: 'selfcheck', touches: ['templates/contextkit/tools/scripts/economy/'] },
  { id: 'economy-completeness', file: 'tools/selfcheck-economy-completeness.mjs', tier: 'selfcheck', touches: ['templates/contextkit/tools/scripts/economy/registry.mjs'] },
  { id: 'economy-instrumentation', file: 'tools/selfcheck-economy-instrumentation.mjs', tier: 'selfcheck', touches: ['templates/contextkit/tools/scripts/economy/'] },

  // WF0020 Economy Runtime — Wave 2 (ECON-08/09/10): lean-loop/loop-breaker/patch-economy econCheck*.
  { id: 'economy-wave2', file: 'tools/selfcheck-economy-wave2.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/economy/'] },

  // 3.1.2 hotfix — VibeKit backward-compatibility regression lock (P0-08).
  // Calls migrateLegacy / migrateConfigPaths directly; covers ONLY-VIBEKIT,
  // ONLY-CONTEXTKIT, HYBRID (refuse+preserve), LEGACY-CFG-PATHS, NO-GLOBAL-REPLACE,
  // and IDEMPOTENT-SECOND-RUN (scenarios 1-6, ADR-0095).
  { id: 'vibekit-compat', file: it('vibekit-compat'), tier: 'integration:installer',
    touches: ['tools/install/migrate.mjs', 'tools/install/config-paths.mjs'] },

  // 3.1.2 updater-safety hotfix (ADR-0099, WF0034) — session/ledger preservation,
  // safe writes, external preflight/snapshot/status, project-map safe deferral.
  { id: 'session-safety', file: it('session-safety'), tier: 'integration:core',
    touches: ['templates/contextkit/runtime/hooks/session-start.mjs', 'templates/contextkit/runtime/hooks/ledger.mjs'] },
  { id: 'safe-writes', file: it('safe-writes'), tier: 'integration:installer',
    touches: ['tools/install/fs.mjs', 'tools/install/claude.mjs'] },
  { id: 'update-preflight', file: it('update-preflight'), tier: 'integration:installer',
    touches: ['tools/install/update-preflight.mjs', 'tools/install/update-status.mjs'] },
  { id: 'update-snapshot', file: it('update-snapshot'), tier: 'integration:installer',
    touches: ['tools/install/update-snapshot.mjs', 'tools/install/update-status.mjs'] },
  { id: 'projmap-defer', file: it('projmap-defer'), tier: 'integration:installer',
    touches: ['tools/install/project-map-baseline.mjs'] },
  // 3.1.2 RUN 2 hardening — non-TTY conflict honesty, adversarial matrices,
  // idempotency + failure boundaries (ADR-0099, WF0034).
  { id: 'sync-conflict', file: it('sync-conflict'), tier: 'integration:installer',
    touches: ['tools/install/sync.mjs'] },
  { id: 'session-adversarial', file: it('session-adversarial'), tier: 'integration:core',
    touches: ['templates/contextkit/runtime/hooks/session-start.mjs', 'tools/install/update-preflight.mjs'] },
  { id: 'vibekit-adversarial', file: it('vibekit-adversarial'), tier: 'integration:installer',
    touches: ['tools/install/migrate.mjs'] },
  { id: 'update-idempotency', file: it('update-idempotency'), tier: 'integration:installer',
    touches: ['install.mjs', 'tools/install/engine.mjs', 'tools/install/fs.mjs'] },
  { id: 'update-failure', file: it('update-failure'), tier: 'integration:installer',
    touches: ['install.mjs', 'tools/install/update-snapshot.mjs', 'tools/install/update-preflight.mjs'] },

  { id: 'projmap-signals', file: 'tools/selfcheck-projmap-signals.mjs', tier: 'selfcheck', touches: ['templates/contextkit/tools/scripts/project-map-signals', 'templates/contextkit/tools/scripts/project-map-insights'] }, // WF-0057 W1.1 (ADR-0122) structural signals
  // WF0033 project-map auto-baseline (PMB-01..03, ADR-0098) — advisory + fail-open;
  // the baseline is generated on --update / onboarding and nudged at boot when missing.
  { id: 'projmap-baseline', file: it('projmap-baseline'), tier: 'integration:installer',
    touches: ['install.mjs', 'tools/install/project-map-baseline.mjs'] },
  { id: 'projmap-onboarding', file: 'tools/selfcheck-projmap-onboarding.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/setup-complete.mjs', 'templates/claude/commands/setup/setupcontextdevkit.md'] },
  { id: 'projmap-boot-nudge', file: 'tools/selfcheck-boot-signals-projmap.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/runtime/hooks/boot-signals-projmap.mjs'] },

  // BIZ-0001 / WF-0036+WF-0037 (Business-driven methodology) — split into its own
  // module to keep this registry within the line budget (see test-suites-bdm.mjs).
  ...BDM_SUITES,

  ...WORKFLOW_ENGINE_SUITES,
  ...MCP_SUITES,      // MCP ticket integration-tests (see test-suites-mcp.mjs).
  // Test-infra self-tests (suite-list guard, impact selector, request shard) —
  // own module to keep this registry under the 308-line budget (ADR-0113).
  ...INFRA_SUITES,
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
