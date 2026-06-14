/**
 * integration-test-execution.mjs — CDK-021 / ADR-0072.
 *
 * Table-driven integration tests for task-intake.mjs and execution-contract.mjs.
 * Exercises: signal production, contract grouping, level filtering, domain forcing,
 * persistence round-trip (saveContract / loadContract), and reclassify history.
 *
 * Runs without a real project install — uses the embedded DEFAULT_REGISTRY from
 * resolve-capabilities.mjs and a mkdtemp fixture for persistence tests.
 * Mirrors the it-helpers.mjs reporter pattern used by integration-test-capabilities.mjs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const intakePath = resolve(KIT, 'templates/contextkit/runtime/execution/task-intake.mjs');
const contractPath = resolve(KIT, 'templates/contextkit/runtime/execution/execution-contract.mjs');
const resolverPath = resolve(KIT, 'templates/contextkit/runtime/capabilities/resolve-capabilities.mjs');

const rep = reporter();

// ---------------------------------------------------------------------------
// Module imports — bail early on failure so later cases do not crash blindly.
// ---------------------------------------------------------------------------
let intake, buildContract, saveContract, loadContract, reclassify, DEFAULT_REGISTRY, resolveCapabilities;
try {
  const intakeMod = await import('file://' + intakePath.replaceAll('\\', '/'));
  intake = intakeMod.intake;
} catch (err) {
  rep.bad(`Failed to import task-intake.mjs: ${err?.message ?? err}`);
  rep.finish('execution (CDK-021)');
}
try {
  const contractMod = await import('file://' + contractPath.replaceAll('\\', '/'));
  buildContract = contractMod.buildContract;
  saveContract = contractMod.saveContract;
  loadContract = contractMod.loadContract;
  reclassify = contractMod.reclassify;
} catch (err) {
  rep.bad(`Failed to import execution-contract.mjs: ${err?.message ?? err}`);
  rep.finish('execution (CDK-021)');
}
try {
  const resolverMod = await import('file://' + resolverPath.replaceAll('\\', '/'));
  DEFAULT_REGISTRY = resolverMod.DEFAULT_REGISTRY;
  resolveCapabilities = resolverMod.resolveCapabilities;
} catch (err) {
  rep.bad(`Failed to import resolve-capabilities.mjs: ${err?.message ?? err}`);
  rep.finish('execution (CDK-021)');
}

// ---------------------------------------------------------------------------
// Case 1: trivial → minimal contract (no required gates).
// ---------------------------------------------------------------------------
{
  const { signals, reasons } = intake({ objective: 'fix typo in README', level: 7 });
  signals.tier === 'trivial'
    ? rep.ok('1. trivial intake: tier=trivial')
    : rep.bad(`1. trivial intake: expected tier=trivial, got ${signals.tier}`);

  Array.isArray(reasons) && reasons.length > 0
    ? rep.ok('1. trivial intake: reasons array is non-empty')
    : rep.bad('1. trivial intake: reasons array is empty or missing');

  const contract = buildContract(signals, DEFAULT_REGISTRY);
  // A trivial task must carry no HEAVY ceremony gates. Universal gates (e.g.
  // log-session on tiers=['*']) may still appear in beforeCompletion — that is
  // the correct registry behaviour. The invariant is that deep workflow gates are absent.
  const trivialHeavyGates = ['workflow', 'simulate-impact', 'qa-signoff', 'test-plan', 'context-pack', 'project-map'];
  const trivialAllRequired = [
    ...contract.requiredBeforeExploration,
    ...contract.requiredBeforeWrite,
    ...contract.requiredBeforeCompletion,
  ];
  const trivialUnexpected = trivialHeavyGates.filter((id) => trivialAllRequired.includes(id));
  trivialUnexpected.length === 0
    ? rep.ok('1. trivial contract: no heavy-ceremony gates (workflow/simulate/qa/test-plan absent)')
    : rep.bad(`1. trivial contract: unexpected heavy gates: [${trivialUnexpected}] — exploration=[${contract.requiredBeforeExploration}] write=[${contract.requiredBeforeWrite}] completion=[${contract.requiredBeforeCompletion}]`);

  // beforeExploration and beforeWrite must truly be empty for a trivial task.
  contract.requiredBeforeExploration.length === 0 && contract.requiredBeforeWrite.length === 0
    ? rep.ok('1. trivial contract: beforeExploration and beforeWrite are empty')
    : rep.bad(`1. trivial contract: beforeExploration=[${contract.requiredBeforeExploration}] beforeWrite=[${contract.requiredBeforeWrite}] should both be empty`);

  contract.version === 1
    ? rep.ok('1. trivial contract: version=1')
    : rep.bad(`1. trivial contract: unexpected version=${contract.version}`);
}

// ---------------------------------------------------------------------------
// Case 2: feature → exploration + write + completion sets.
// ---------------------------------------------------------------------------
{
  const { signals } = intake({ objective: 'add user registration endpoint', level: 7 });
  signals.tier === 'feature'
    ? rep.ok('2. feature intake: tier=feature')
    : rep.bad(`2. feature intake: expected tier=feature, got ${signals.tier}`);

  const contract = buildContract(signals, DEFAULT_REGISTRY);

  // beforeExploration: context-pack, project-map (both minLevel=3, tiers=[feature,arch]).
  const hasExploration = contract.requiredBeforeExploration.includes('context-pack') &&
                         contract.requiredBeforeExploration.includes('project-map');
  hasExploration
    ? rep.ok('2. feature contract: context-pack + project-map in beforeExploration')
    : rep.bad(`2. feature contract: beforeExploration=[${contract.requiredBeforeExploration}]`);

  // beforeWrite: dev-start, workflow.
  const hasWrite = contract.requiredBeforeWrite.includes('dev-start') &&
                   contract.requiredBeforeWrite.includes('workflow');
  hasWrite
    ? rep.ok('2. feature contract: dev-start + workflow in beforeWrite')
    : rep.bad(`2. feature contract: beforeWrite=[${contract.requiredBeforeWrite}]`);

  // beforeCompletion: tests, test-plan, qa-signoff, log-session.
  const hasCompletion = contract.requiredBeforeCompletion.includes('tests') &&
                        contract.requiredBeforeCompletion.includes('test-plan') &&
                        contract.requiredBeforeCompletion.includes('qa-signoff') &&
                        contract.requiredBeforeCompletion.includes('log-session');
  hasCompletion
    ? rep.ok('2. feature contract: tests + test-plan + qa-signoff + log-session in beforeCompletion')
    : rep.bad(`2. feature contract: beforeCompletion=[${contract.requiredBeforeCompletion}]`);

  // simulate-impact must NOT be present (architectural-only, minLevel=5).
  !contract.requiredBeforeWrite.includes('simulate-impact')
    ? rep.ok('2. feature contract: simulate-impact absent (not architectural)')
    : rep.bad('2. feature contract: simulate-impact appeared unexpectedly on feature task');
}

// ---------------------------------------------------------------------------
// Case 3: architectural → adds simulate-impact to beforeWrite.
// ---------------------------------------------------------------------------
{
  const { signals } = intake({ objective: 'refactor auth module across services', level: 7 });
  signals.tier === 'architectural'
    ? rep.ok('3. architectural intake: tier=architectural')
    : rep.bad(`3. architectural intake: expected tier=architectural, got ${signals.tier}`);

  const contract = buildContract(signals, DEFAULT_REGISTRY);
  contract.requiredBeforeWrite.includes('simulate-impact')
    ? rep.ok('3. architectural contract: simulate-impact in beforeWrite')
    : rep.bad(`3. architectural contract: simulate-impact missing from beforeWrite=[${contract.requiredBeforeWrite}]`);

  contract.requiredBeforeWrite.includes('workflow')
    ? rep.ok('3. architectural contract: workflow in beforeWrite')
    : rep.bad(`3. architectural contract: workflow missing from beforeWrite=[${contract.requiredBeforeWrite}]`);

  contract.requiredBeforeExploration.includes('context-pack')
    ? rep.ok('3. architectural contract: context-pack in beforeExploration')
    : rep.bad(`3. architectural contract: context-pack missing from beforeExploration=[${contract.requiredBeforeExploration}]`);
}

// ---------------------------------------------------------------------------
// Case 4: lgpd domain objective → forced to architectural tier.
// ---------------------------------------------------------------------------
{
  const { signals, reasons } = intake({ objective: 'store user CPF and consent data', level: 7 });
  signals.domain === 'lgpd'
    ? rep.ok('4. lgpd intake: domain=lgpd')
    : rep.bad(`4. lgpd intake: expected domain=lgpd, got ${signals.domain}`);

  signals.tier === 'architectural'
    ? rep.ok('4. lgpd intake: domain forces tier=architectural')
    : rep.bad(`4. lgpd intake: expected tier=architectural, got ${signals.tier}`);

  const hasForcedReason = reasons.some((r) => r.includes('forced') && r.includes('lgpd'));
  hasForcedReason
    ? rep.ok('4. lgpd intake: reasons records the domain-forced tier upgrade')
    : rep.bad(`4. lgpd intake: reasons missing domain-force note — got: ${JSON.stringify(reasons)}`);

  const contract = buildContract(signals, DEFAULT_REGISTRY);
  // Since domain is forced architectural, simulate-impact must be required.
  contract.requiredBeforeWrite.includes('simulate-impact')
    ? rep.ok('4. lgpd contract: simulate-impact required (architectural forced by lgpd)')
    : rep.bad(`4. lgpd contract: simulate-impact missing — beforeWrite=[${contract.requiredBeforeWrite}]`);
}

// ---------------------------------------------------------------------------
// Case 5: level-2 project → minLevel filters out high-ceremony gates.
// ---------------------------------------------------------------------------
{
  const { signals } = intake({ objective: 'add export report feature', level: 2 });
  const contract = buildContract(signals, DEFAULT_REGISTRY);

  // minLevel=3 caps (context-pack, project-map, workflow) must be absent.
  const shouldBeAbsent = ['context-pack', 'project-map', 'workflow', 'simulate-impact', 'test-plan', 'qa-signoff'];
  const unexpectedlyPresent = shouldBeAbsent.filter(
    (id) =>
      contract.requiredBeforeExploration.includes(id) ||
      contract.requiredBeforeWrite.includes(id) ||
      contract.requiredBeforeCompletion.includes(id),
  );
  unexpectedlyPresent.length === 0
    ? rep.ok(`5. L2 contract: high-ceremony gates absent (${shouldBeAbsent.join(', ')})`)
    : rep.bad(`5. L2 contract: unexpected gates present: ${unexpectedlyPresent.join(', ')}`);

  // dev-start (minLevel=2, feature/arch) must still be required at beforeWrite.
  contract.requiredBeforeWrite.includes('dev-start')
    ? rep.ok('5. L2 contract: dev-start (minLevel=2) still required at beforeWrite')
    : rep.bad(`5. L2 contract: dev-start missing — beforeWrite=[${contract.requiredBeforeWrite}]`);
}

// ---------------------------------------------------------------------------
// Case 6: saveContract → loadContract round-trip (tmp dir fixture).
// ---------------------------------------------------------------------------
{
  const tmpRoot = mkdtempSync(tmpdir() + '/ck-exec-it-');
  try {
    const { signals } = intake({ objective: 'add export report feature', taskId: 'task-42', level: 7 });
    const contract = buildContract(signals, DEFAULT_REGISTRY);
    saveContract(tmpRoot, 'task-42', contract);
    const loaded = loadContract(tmpRoot, 'task-42');

    loaded !== null
      ? rep.ok('6. round-trip: loadContract returns a non-null object')
      : rep.bad('6. round-trip: loadContract returned null after saveContract');

    if (loaded) {
      const requiredMatches =
        JSON.stringify(loaded.requiredBeforeExploration) === JSON.stringify(contract.requiredBeforeExploration) &&
        JSON.stringify(loaded.requiredBeforeWrite) === JSON.stringify(contract.requiredBeforeWrite) &&
        JSON.stringify(loaded.requiredBeforeCompletion) === JSON.stringify(contract.requiredBeforeCompletion);
      requiredMatches
        ? rep.ok('6. round-trip: required-set fields identical after save/load')
        : rep.bad('6. round-trip: required-set fields differ after save/load');

      loaded.version === 1
        ? rep.ok('6. round-trip: version=1 preserved')
        : rep.bad(`6. round-trip: version changed — got ${loaded.version}`);
    }

    // loadContract returns null for a missing id — never throws.
    const missing = loadContract(tmpRoot, 'nonexistent-id-xyz');
    missing === null
      ? rep.ok('6. loadContract returns null for missing id (never throws)')
      : rep.bad(`6. loadContract returned non-null for missing id: ${JSON.stringify(missing)}`);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Case 7: reclassify → history grows + added/removed recorded correctly.
// ---------------------------------------------------------------------------
{
  // Start from a trivial contract (no required gates).
  const { signals: trivialSig } = intake({ objective: 'fix typo', level: 7 });
  const trivialContract = buildContract(trivialSig, DEFAULT_REGISTRY);

  // Reclassify to architectural — lots of gates get added.
  const { signals: archSig } = intake({ objective: 'refactor auth across services', level: 7 });
  const reclassified = reclassify(trivialContract, archSig, DEFAULT_REGISTRY, 'scope expanded to architectural');

  reclassified.history.length === 1
    ? rep.ok('7. reclassify: history grows to length 1 after first reclassification')
    : rep.bad(`7. reclassify: expected history.length=1, got ${reclassified.history.length}`);

  const entry = reclassified.history[0];
  entry?.event === 'reclassified'
    ? rep.ok("7. reclassify: history entry has event='reclassified'")
    : rep.bad(`7. reclassify: wrong history event: ${entry?.event}`);

  Array.isArray(entry?.added) && entry.added.includes('simulate-impact')
    ? rep.ok('7. reclassify: simulate-impact appears in added list')
    : rep.bad(`7. reclassify: simulate-impact missing from added=[${entry?.added}]`);

  // Reclassify back to trivial — scope shrink, gates removed.
  const { signals: trivialSig2 } = intake({ objective: 'fix another typo', level: 7 });
  const shrunk = reclassify(reclassified, trivialSig2, DEFAULT_REGISTRY, 'scope shrunk to trivial');

  shrunk.history.length === 2
    ? rep.ok('7. reclassify (shrink): history grows to length 2')
    : rep.bad(`7. reclassify (shrink): expected history.length=2, got ${shrunk.history.length}`);

  const shrinkEntry = shrunk.history[1];
  shrinkEntry?.isScopeShrink === true
    ? rep.ok('7. reclassify (shrink): isScopeShrink=true recorded in history')
    : rep.bad(`7. reclassify (shrink): isScopeShrink not recorded — entry: ${JSON.stringify(shrinkEntry)}`);

  Array.isArray(shrinkEntry?.removed) && shrinkEntry.removed.includes('simulate-impact')
    ? rep.ok('7. reclassify (shrink): simulate-impact appears in removed list')
    : rep.bad(`7. reclassify (shrink): simulate-impact missing from removed=[${shrinkEntry?.removed}]`);

  // Shrunk contract must carry no HEAVY ceremony gates after trivial reclassification.
  // Universal gates (log-session on tiers=['*']) may remain in beforeCompletion —
  // the same expectation as Case 1 for a fresh trivial contract.
  const shrinkHeavyGates = ['workflow', 'simulate-impact', 'qa-signoff', 'test-plan', 'context-pack', 'project-map'];
  const shrinkAllRequired = [
    ...shrunk.requiredBeforeExploration,
    ...shrunk.requiredBeforeWrite,
    ...shrunk.requiredBeforeCompletion,
  ];
  const shrinkUnexpected = shrinkHeavyGates.filter((id) => shrinkAllRequired.includes(id));
  shrinkUnexpected.length === 0
    ? rep.ok('7. reclassify (shrink): no heavy-ceremony gates remain after trivial reclassification')
    : rep.bad(`7. reclassify (shrink): unexpected heavy gates remain: [${shrinkUnexpected}]`);

  // createdAt from the ORIGINAL contract must be preserved (reclassify does not reset it).
  shrunk.createdAt === trivialContract.createdAt
    ? rep.ok('7. reclassify: original createdAt preserved across reclassifications')
    : rep.bad(`7. reclassify: createdAt changed — original=${trivialContract.createdAt} after=${shrunk.createdAt}`);
}

rep.finish('execution (CDK-021)');
