#!/usr/bin/env node
/**
 * WF-0057 W6.1 (ADR-0122) — MASTER ACCEPTANCE selftest for the Architecture &
 * Technical-Debt Governance Gate. This is the single green-light for §35: it
 * programmatically asserts the HEADLINE INVARIANTS hold AND fills the
 * integration-level §34 GAP rows the per-analyzer selftests do not reach.
 *
 * It REUSES the existing engine (no second test platform, §17): every assertion
 * drives the real `runGate` composition root, the real `evaluatePolicy` engine,
 * the real `makeFinding` contract, and the real config resolver/migrator. The
 * per-analyzer selftests (`selfcheck-arch-debt-*.mjs`) own the unit rows; this
 * suite owns the cross-cutting invariants + the engine-level GAPs:
 *
 *   HEADLINE INVARIANTS (§35):
 *     I1  line count alone can NEVER block (a 999-line file → approval).
 *     I2  a deterministic floor breach BLOCKS (immediately, lexicographic).
 *     I3  UNKNOWN ≠ PASS (missing evidence → non-approval, never silent PASS).
 *     I4  the gate ships ACTIVE (mode === 'active', not Shadow/Canary).
 *     I5  the blocking set is DETERMINISTIC-ONLY (no SEMANTIC/HEURISTIC may block).
 *
 *   §34 GAP rows (engine-level, not covered by a unit selftest):
 *     §34.8   worsened change-amplification DETECTED (observed, never blocks).
 *     §34.9   breaking contract w/o migration BLOCKS (deterministic floor).
 *     §34.10  compatible contract change PASSES (no violation surfaced).
 *     §34.21  contradiction with an active decision DETECTED (→ non-approval).
 *     §34.28  clean-clone PASSES (nothing wired → SKIPPED, not blocking UNKNOWN).
 *     §34.29  greenfield PASSES (empty tree composes to a passing outcome).
 *     §34.30  installer/updater PRESERVE the new policy (defaults survive migrate).
 *     §34.33  material semantic → REVIEW_REQUIRED (raised, never auto-block).
 *     §34.34  experimental → OBSERVE_ONLY (runs, never sways the verdict).
 *
 * Zero runtime deps, ESM, node:/relative only, Windows-safe. Suite name:
 * `arch-debt-acceptance`. Standalone entrypoint (exit 0 = all invariants hold).
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };

const SCRIPTS = 'templates/contextkit/tools/scripts';
const CFG = 'templates/contextkit/runtime/config';

/** Import a module from the kit tree by relative path (Windows-safe file URL). */
const load = (rel) => import(pathToFileURL(resolve(KIT, rel)).href);

const gatePath = resolve(KIT, SCRIPTS + '/architecture-debt-gate.mjs');
existsSync(gatePath) ? ok('architecture-debt-gate.mjs exists') : bad('architecture-debt-gate.mjs NOT FOUND');

let runGate, policy, finding, enums, defaults, archDefaults, resolver, migrate;
try {
  ({ runGate } = await load(SCRIPTS + '/architecture-debt-gate.mjs'));
  policy = await load(SCRIPTS + '/arch-debt/policy-engine.mjs');
  finding = await load(SCRIPTS + '/arch-debt/finding.mjs');
  enums = await load(SCRIPTS + '/arch-debt/finding-enums.mjs');
  defaults = await load(CFG + '/defaults.mjs');
  archDefaults = await load(CFG + '/defaults-arch-debt.mjs');
  resolver = await load(CFG + '/resolve-arch-debt-config.mjs');
  migrate = await load('tools/install/config-migrate.mjs');
} catch (err) {
  bad('Failed to import engine modules: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}

const { evaluatePolicy } = policy;
const { makeFinding, isApproval } = finding;
const {
  Enforcement, FindingStatus, EvidenceClass, Dimension, DebtClass,
  RecommendedAction, GateOutcome, DETERMINISTIC_TIER,
} = enums;
const { DEFAULT_CONFIG } = defaults;
const { ARCH_DEBT_GATE_DEFAULTS } = archDefaults;
const { resolveArchDebtConfig } = resolver;
const { migrateConfigSections } = migrate;

typeof runGate === 'function' ? ok('runGate exported') : bad('runGate not a function');

/** A changed-set reader covering the given paths (engine injects this in prod). */
const changed = (paths) => () => paths;

// ==========================================================================
// HEADLINE INVARIANTS (§35) — the single green-light.
// ==========================================================================

// I1 — line count alone can NEVER block. A wildly-over-budget cohesive file with
// nothing else wired must still resolve to an APPROVAL outcome (PASS_WITH_OBSERVATION).
console.log('\nI1 (§35) — line count alone can never block');
const hugeFile = await runGate({
  root: KIT,
  model: { modules: [{ path: 'src/dto', deps: [], capped: false }], fileCount: 1 },
  fileMetrics: [{ path: 'src/dto/constants.js', lines: 999 }],
  baseline: null,
  readChangedFiles: changed(['src/dto/constants.js']),
});
isApproval(hugeFile.outcome) ? ok('999-line file → approval outcome (' + hugeFile.outcome + ')') : bad('999-line file blocked: ' + hugeFile.outcome);
hugeFile.exitCode === 0 ? ok('999-line file → exitCode 0') : bad('999-line file exitCode ' + hugeFile.exitCode);
hugeFile.blocking.length === 0 ? ok('999-line file → zero blockers') : bad('line count produced blockers');

// I2 — a deterministic floor breach BLOCKS immediately. An irreversible migration
// with no rollback (reliability floor) → BLOCKED, exitCode 1.
console.log('\nI2 (§35) — a deterministic floor breach blocks');
const floorBreach = await runGate({
  root: KIT,
  model: { modules: [{ path: 'src/db', deps: [] }], fileCount: 1 },
  fileMetrics: [],
  baseline: null,
  readChangedFiles: changed(['src/db/migrate.js']),
  config: { reliability: { migrations: [{ path: 'src/db/migrate.js', irreversible: true, hasRollback: false }] } },
});
floorBreach.outcome === GateOutcome.BLOCKED ? ok('irreversible migration → BLOCKED') : bad('expected BLOCKED got ' + floorBreach.outcome);
floorBreach.exitCode === 1 ? ok('floor breach → exitCode 1') : bad('floor breach exitCode ' + floorBreach.exitCode);
floorBreach.blocking.some((f) => /irreversible-migration/.test(f.ruleId)) ? ok('R2 migration floor in blocking[]') : bad('migration floor not in blocking[]');

// I3 — UNKNOWN ≠ PASS. A configured baseline with a STALE (missing) graph →
// conformance fails closed to UNKNOWN → non-approval, never a silent PASS.
console.log('\nI3 (§35) — UNKNOWN ≠ PASS');
const unknownRun = await runGate({
  root: KIT,
  model: { modules: [{ path: 'src/a' }], fileCount: 1 },
  fileMetrics: [],
  baseline: { stateAuthorities: [] },
  readChangedFiles: changed(['src/a/x.js']),
  config: { layerRules: { layers: {}, forbidden: [] } },
  insights: {}, // no `cycles` → graphMissing → UNKNOWN
});
isApproval(unknownRun.outcome) === false ? ok('missing graph → non-approval (' + unknownRun.outcome + ')') : bad('UNKNOWN silently passed: ' + unknownRun.outcome);
(unknownRun.outcome === GateOutcome.UNKNOWN || unknownRun.outcome === GateOutcome.REVIEW_REQUIRED)
  ? ok('missing graph → UNKNOWN/REVIEW_REQUIRED') : bad('unexpected outcome: ' + unknownRun.outcome);

// I4 — the gate ships ACTIVE (not Shadow/Canary). Both the standalone block and
// the resolver of an empty config must report mode 'active'.
console.log('\nI4 (§35) — the gate ships ACTIVE');
ARCH_DEBT_GATE_DEFAULTS.mode === 'active' ? ok("defaults mode === 'active'") : bad('defaults mode not active: ' + ARCH_DEBT_GATE_DEFAULTS.mode);
resolveArchDebtConfig({}).mode === 'active' ? ok("resolver of empty config → mode 'active'") : bad('empty-config mode not active');
DEFAULT_CONFIG.architectureDebtGate && DEFAULT_CONFIG.architectureDebtGate.mode === 'active'
  ? ok('DEFAULT_CONFIG ships the gate ACTIVE') : bad('DEFAULT_CONFIG gate not active');

// I5 — the blocking set is DETERMINISTIC-ONLY. makeFinding must REJECT a BLOCKING
// SEMANTIC/HEURISTIC finding (a model opinion can never reach the blocking path),
// and evaluatePolicy must never place a non-deterministic finding in blocking[].
console.log('\nI5 (§35) — the blocking set is deterministic-only');
let rejected = false;
try {
  makeFinding({
    id: 'x', ruleId: 'x', path: 'x',
    status: FindingStatus.VIOLATION,
    evidence: { class: EvidenceClass.SEMANTIC, source: 'model', ref: 'x' },
    enforcement: Enforcement.BLOCKING,
  });
} catch { rejected = true; }
rejected ? ok('makeFinding REJECTS a BLOCKING SEMANTIC finding (construction-time)') : bad('a BLOCKING SEMANTIC finding was constructed');
// Every deterministic-tier class is exactly the set permitted to block.
['DETERMINISTIC', 'SCHEMA_DERIVED', 'GRAPH_DERIVED', 'TEST_DERIVED'].every((c) => DETERMINISTIC_TIER.has(c))
  && !DETERMINISTIC_TIER.has('SEMANTIC') && !DETERMINISTIC_TIER.has('HEURISTIC')
  ? ok('DETERMINISTIC_TIER is the blocking allow-set (SEMANTIC/HEURISTIC excluded)') : bad('blocking allow-set wrong');

// ==========================================================================
// §34 GAP ROWS — engine-level, reusing runGate / evaluatePolicy / makeFinding.
// ==========================================================================

// §34.8 — worsened change-amplification DETECTED. The collector rides OBSERVE_ONLY:
// it must surface a WORSENED amplification observation, yet never block.
console.log('\n§34.8 — worsened change-amplification detected (observed, never blocks)');
const ampRun = await runGate({
  root: KIT,
  model: { modules: [{ path: 'src/core', deps: [] }], fileCount: 1 },
  fileMetrics: [],
  baseline: null,
  readChangedFiles: changed(['src/core']),
  config: { amplificationSignals: { before: { 'src/core': { blastRadius: 2 } }, after: { 'src/core': { blastRadius: 9 } } } },
});
isApproval(ampRun.outcome) ? ok('worsened amplification → still approval (observe-only)') : bad('amplification blocked: ' + ampRun.outcome);
ampRun.exitCode === 0 ? ok('worsened amplification → exitCode 0 (never blocks)') : bad('amplification exitCode ' + ampRun.exitCode);
// The observation is collected even though it does not influence the verdict.
const ampSeen = (ampRun.store.findings || []).some((f) => f.ruleId === 'arch-debt.change-amplification' && (f.reasonCodes || []).includes('CHANGE_AMPLIFICATION_WORSENED'));
ampSeen ? ok('WORSENED amplification surfaced in the findings store') : bad('worsened amplification not detected in store');

// §34.9 — breaking contract w/o migration BLOCKS. Modeled as a deterministic
// DATA_CONTRACTS VIOLATION (BLOCKING, DETERMINISTIC tier) — the policy engine must
// turn it into BLOCKED. §34.10 — a COMPATIBLE change carries no violation → PASS.
console.log('\n§34.9 / §34.10 — breaking contract blocks, compatible passes');
const breakingContract = makeFinding({
  id: 'C1.breaking-contract:api/users:remove-field', ruleId: 'C1.breaking-contract',
  dimension: Dimension.DATA_CONTRACTS, debtClass: DebtClass.CONTRACT,
  status: FindingStatus.VIOLATION, confidence: 1,
  evidence: { class: EvidenceClass.SCHEMA_DERIVED, source: 'contract-diff', ref: 'api/users' },
  reasonCodes: ['BREAKING_CONTRACT_NO_MIGRATION'],
  recommendedAction: RecommendedAction.ADD_CONTRACT, enforcement: Enforcement.BLOCKING,
  message: 'A breaking contract change ships with no migration (§34.9).', path: 'api/users',
});
const breakingVerdict = evaluatePolicy([breakingContract]);
breakingVerdict.outcome === GateOutcome.BLOCKED ? ok('breaking contract → BLOCKED') : bad('expected BLOCKED got ' + breakingVerdict.outcome);
breakingVerdict.blocking.some((f) => f.ruleId === 'C1.breaking-contract') ? ok('contract violation in blocking[]') : bad('contract not in blocking[]');
// Compatible: the same rule, but a satisfied PASS finding → no block, approval.
const compatibleContract = makeFinding({
  id: 'C1.breaking-contract:api/users:add-optional', ruleId: 'C1.breaking-contract',
  dimension: Dimension.DATA_CONTRACTS, debtClass: DebtClass.CONTRACT,
  status: FindingStatus.PASS, confidence: 1,
  evidence: { class: EvidenceClass.SCHEMA_DERIVED, source: 'contract-diff', ref: 'api/users' },
  reasonCodes: ['CONTRACT_BACKWARD_COMPATIBLE'],
  recommendedAction: RecommendedAction.OBSERVE, enforcement: Enforcement.BLOCKING,
  message: 'Contract change is backward-compatible (§34.10).', path: 'api/users',
});
const compatibleVerdict = evaluatePolicy([compatibleContract]);
isApproval(compatibleVerdict.outcome) && compatibleVerdict.blocking.length === 0
  ? ok('compatible contract → approval, no blockers (' + compatibleVerdict.outcome + ')') : bad('compatible contract non-approval: ' + compatibleVerdict.outcome);

// §34.21 — contradiction with an active decision DETECTED. Modeled as a
// deterministic GOVERNANCE VIOLATION against a recorded decision → non-approval.
console.log('\n§34.21 — contradiction with an active decision detected');
const contradiction = makeFinding({
  id: 'G1.decision-contradiction:src/store:ADR-0001', ruleId: 'G1.decision-contradiction',
  dimension: Dimension.ARCHITECTURE_CONFORMANCE, debtClass: DebtClass.GOVERNANCE,
  status: FindingStatus.VIOLATION, confidence: 1,
  evidence: { class: EvidenceClass.SCHEMA_DERIVED, source: 'decisions-index', ref: 'ADR-0001' },
  reasonCodes: ['CONTRADICTS_ACTIVE_DECISION'],
  recommendedAction: RecommendedAction.RESTORE_BOUNDARY, enforcement: Enforcement.BLOCKING,
  message: 'Change contradicts active decision ADR-0001 (§34.21).', path: 'src/store',
});
const contraVerdict = evaluatePolicy([contradiction]);
isApproval(contraVerdict.outcome) === false ? ok('decision contradiction → non-approval (' + contraVerdict.outcome + ')') : bad('contradiction silently passed: ' + contraVerdict.outcome);
contraVerdict.blocking.some((f) => f.ruleId === 'G1.decision-contradiction') ? ok('contradiction surfaced in blocking[]') : bad('contradiction not in blocking[]');

// §34.28 / §34.29 — clean-clone + greenfield PASS. Nothing wired (no baseline,
// no config) → conformance degrades to SKIPPED (not a blocking UNKNOWN) and the
// gate composes to a passing outcome on a bare tree.
console.log('\n§34.28 / §34.29 — clean-clone + greenfield pass');
const greenfield = await runGate({
  root: KIT,
  model: { modules: [], fileCount: 0 },
  fileMetrics: [],
  baseline: null,
  readChangedFiles: () => null, // no changes (fresh clone / greenfield)
});
isApproval(greenfield.outcome) ? ok('greenfield/clean-clone → approval (' + greenfield.outcome + ')') : bad('greenfield non-approval: ' + greenfield.outcome);
greenfield.exitCode === 0 ? ok('greenfield → exitCode 0') : bad('greenfield exitCode ' + greenfield.exitCode);
greenfield.blocking.length === 0 ? ok('greenfield → zero blockers') : bad('greenfield produced blockers');

// §34.30 — installer/updater PRESERVE the new policy. A project missing the gate
// block gains it on --update (migrateConfigSections), with the hard invariants
// intact (mode active + lineSignals.blocking false); a user override survives.
console.log('\n§34.30 — installer/updater preserve the new policy');
const legacyProject = { level: 5, l5: { lineBudget: { yellow: 240, red: 308 } } };
const migrated = migrateConfigSections(legacyProject, DEFAULT_CONFIG);
const addedGate = migrated.cfg.architectureDebtGate;
addedGate && addedGate.mode === 'active' ? ok('update adds architectureDebtGate (mode active)') : bad('update did not add an active gate block');
addedGate && addedGate.lineSignals && addedGate.lineSignals.blocking === false
  ? ok('update preserves lineSignals.blocking === false') : bad('update leaked a blocking line signal');
migrated.added.includes('architectureDebtGate') ? ok('update records architectureDebtGate as added') : bad('update did not record the gate addition');
// A user that already set mode keeps it (additive-only never clobbers).
const userSet = migrateConfigSections(
  { architectureDebtGate: { mode: 'active', ruleModes: { 'F1.forbidden-cycle': 'DISABLED' } } },
  DEFAULT_CONFIG,
);
userSet.cfg.architectureDebtGate.ruleModes['F1.forbidden-cycle'] === 'DISABLED'
  ? ok('update preserves a user ruleModes override (additive-only)') : bad('update clobbered a user override');

// §34.33 — material semantic → REVIEW_REQUIRED. A SEMANTic REVIEW_REQUIRED finding
// RAISES a review need (never auto-blocks) → outcome REVIEW_REQUIRED.
console.log('\n§34.33 — material semantic → REVIEW_REQUIRED');
const materialSemantic = makeFinding({
  id: 'S1.semantic-concern:src/core:coherence', ruleId: 'S1.semantic-concern',
  dimension: Dimension.COGNITIVE_COHERENCE, debtClass: DebtClass.DESIGN,
  status: FindingStatus.WARNING, confidence: 0.6,
  evidence: { class: EvidenceClass.SEMANTIC, source: 'model', ref: 'src/core' },
  reasonCodes: ['MATERIAL_SEMANTIC_CONCERN'],
  recommendedAction: RecommendedAction.SIMPLIFY, enforcement: Enforcement.REVIEW_REQUIRED,
  message: 'A material semantic concern requires human review (§34.33).', path: 'src/core',
});
const semanticVerdict = evaluatePolicy([materialSemantic]);
semanticVerdict.outcome === GateOutcome.REVIEW_REQUIRED ? ok('material semantic → REVIEW_REQUIRED') : bad('expected REVIEW_REQUIRED got ' + semanticVerdict.outcome);
isApproval(semanticVerdict.outcome) === false ? ok('REVIEW_REQUIRED is not an approval') : bad('REVIEW_REQUIRED counted as approval');
semanticVerdict.blocking.length === 0 ? ok('material semantic never auto-blocks') : bad('semantic finding reached blocking[]');

// §34.34 — experimental → OBSERVE_ONLY. An OBSERVE_ONLY finding RUNS but never
// sways the verdict: a lone observation leaves the gate at PASS (no review, no block).
console.log('\n§34.34 — experimental → OBSERVE_ONLY (never sways the verdict)');
const experimental = makeFinding({
  id: 'E1.experimental:src/core:probe', ruleId: 'E1.experimental',
  dimension: Dimension.MODULARITY, debtClass: DebtClass.ARCHITECTURAL,
  status: FindingStatus.OBSERVATION, confidence: 0.3,
  evidence: { class: EvidenceClass.SEMANTIC, source: 'model', ref: 'src/core' },
  reasonCodes: ['EXPERIMENTAL_OBSERVATION'],
  recommendedAction: RecommendedAction.OBSERVE, enforcement: Enforcement.OBSERVE_ONLY,
  message: 'An experimental heuristic observes only (§34.34).', path: 'src/core',
});
const experimentalVerdict = evaluatePolicy([experimental]);
isApproval(experimentalVerdict.outcome) ? ok('experimental observation → approval (' + experimentalVerdict.outcome + ')') : bad('experimental swayed the verdict: ' + experimentalVerdict.outcome);
experimentalVerdict.blocking.length === 0 && experimentalVerdict.review.length === 0
  ? ok('experimental never blocks nor demands review') : bad('experimental influenced block/review buckets');

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\narch-debt acceptance selftest: FAIL'); process.exit(1); }
console.log('\narch-debt acceptance selftest: PASS');
process.exit(0);
