/**
 * integration-test-execution-persistence.mjs — CDK-021 / ADR-0072.
 *
 * The STATEFUL half of the execution-contract tests: saveContract/loadContract
 * round-trip and reclassify history. Split from integration-test-execution.mjs
 * (which keeps the pure intake/contract-grouping cases) to respect the file-size
 * budget. Uses the embedded DEFAULT_REGISTRY and the embedded DEFAULT_RUBRIC
 * (forced via a rubric-less root) so results are install-independent.
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
const VOID_ROOT = resolve(tmpdir(), 'cdk-hermetic-no-rubric');

let intake, buildContract, saveContract, loadContract, reclassify, DEFAULT_REGISTRY;
try {
  intake = (await import('file://' + intakePath.replaceAll('\\', '/'))).intake;
  const contractMod = await import('file://' + contractPath.replaceAll('\\', '/'));
  buildContract = contractMod.buildContract;
  saveContract = contractMod.saveContract;
  loadContract = contractMod.loadContract;
  reclassify = contractMod.reclassify;
  DEFAULT_REGISTRY = (await import('file://' + resolverPath.replaceAll('\\', '/'))).DEFAULT_REGISTRY;
} catch (err) {
  rep.bad(`Failed to import execution modules: ${err?.message ?? err}`);
  rep.finish('execution-persistence (CDK-021)');
}

// Hermetic intake: rubric-less root → embedded DEFAULT_RUBRIC, install-independent.
const runIntake = (request) => intake(request, { root: VOID_ROOT });

// ---------------------------------------------------------------------------
// Case 1: saveContract → loadContract round-trip (tmp dir fixture).
// ---------------------------------------------------------------------------
{
  const tmpRoot = mkdtempSync(tmpdir() + '/ck-exec-it-');
  try {
    const { signals } = runIntake({ objective: 'add export report feature', taskId: 'task-42', level: 7 });
    const contract = buildContract(signals, DEFAULT_REGISTRY);
    saveContract(tmpRoot, 'task-42', contract);
    const loaded = loadContract(tmpRoot, 'task-42');

    loaded !== null
      ? rep.ok('1. round-trip: loadContract returns a non-null object')
      : rep.bad('1. round-trip: loadContract returned null after saveContract');

    if (loaded) {
      const requiredMatches =
        JSON.stringify(loaded.requiredBeforeExploration) === JSON.stringify(contract.requiredBeforeExploration) &&
        JSON.stringify(loaded.requiredBeforeWrite) === JSON.stringify(contract.requiredBeforeWrite) &&
        JSON.stringify(loaded.requiredBeforeCompletion) === JSON.stringify(contract.requiredBeforeCompletion);
      requiredMatches
        ? rep.ok('1. round-trip: required-set fields identical after save/load')
        : rep.bad('1. round-trip: required-set fields differ after save/load');

      loaded.version === 1
        ? rep.ok('1. round-trip: version=1 preserved')
        : rep.bad(`1. round-trip: version changed — got ${loaded.version}`);
    }

    // loadContract returns null for a missing id — never throws.
    const missing = loadContract(tmpRoot, 'nonexistent-id-xyz');
    missing === null
      ? rep.ok('1. loadContract returns null for missing id (never throws)')
      : rep.bad(`1. loadContract returned non-null for missing id: ${JSON.stringify(missing)}`);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Case 2: reclassify → history grows + added/removed recorded correctly.
// ---------------------------------------------------------------------------
{
  const { signals: trivialSig } = runIntake({ objective: 'fix typo', level: 7 });
  const trivialContract = buildContract(trivialSig, DEFAULT_REGISTRY);

  // Reclassify to architectural — lots of gates get added.
  const { signals: archSig } = runIntake({ objective: 'refactor auth across services', level: 7 });
  const reclassified = reclassify(trivialContract, archSig, DEFAULT_REGISTRY, 'scope expanded to architectural');

  reclassified.history.length === 1
    ? rep.ok('2. reclassify: history grows to length 1 after first reclassification')
    : rep.bad(`2. reclassify: expected history.length=1, got ${reclassified.history.length}`);

  const entry = reclassified.history[0];
  entry?.event === 'reclassified'
    ? rep.ok("2. reclassify: history entry has event='reclassified'")
    : rep.bad(`2. reclassify: wrong history event: ${entry?.event}`);

  Array.isArray(entry?.added) && entry.added.includes('simulate-impact')
    ? rep.ok('2. reclassify: simulate-impact appears in added list')
    : rep.bad(`2. reclassify: simulate-impact missing from added=[${entry?.added}]`);

  // Reclassify back to trivial — scope shrink, gates removed.
  const { signals: trivialSig2 } = runIntake({ objective: 'fix another typo', level: 7 });
  const shrunk = reclassify(reclassified, trivialSig2, DEFAULT_REGISTRY, 'scope shrunk to trivial');

  shrunk.history.length === 2
    ? rep.ok('2. reclassify (shrink): history grows to length 2')
    : rep.bad(`2. reclassify (shrink): expected history.length=2, got ${shrunk.history.length}`);

  const shrinkEntry = shrunk.history[1];
  shrinkEntry?.isScopeShrink === true
    ? rep.ok('2. reclassify (shrink): isScopeShrink=true recorded in history')
    : rep.bad(`2. reclassify (shrink): isScopeShrink not recorded — entry: ${JSON.stringify(shrinkEntry)}`);

  Array.isArray(shrinkEntry?.removed) && shrinkEntry.removed.includes('simulate-impact')
    ? rep.ok('2. reclassify (shrink): simulate-impact appears in removed list')
    : rep.bad(`2. reclassify (shrink): simulate-impact missing from removed=[${shrinkEntry?.removed}]`);

  // Shrunk contract must carry no HEAVY ceremony gates after trivial reclassification.
  const shrinkHeavyGates = ['workflow', 'simulate-impact', 'qa-signoff', 'test-plan', 'context-pack', 'project-map'];
  const shrinkAllRequired = [
    ...shrunk.requiredBeforeExploration,
    ...shrunk.requiredBeforeWrite,
    ...shrunk.requiredBeforeCompletion,
  ];
  const shrinkUnexpected = shrinkHeavyGates.filter((id) => shrinkAllRequired.includes(id));
  shrinkUnexpected.length === 0
    ? rep.ok('2. reclassify (shrink): no heavy-ceremony gates remain after trivial reclassification')
    : rep.bad(`2. reclassify (shrink): unexpected heavy gates remain: [${shrinkUnexpected}]`);

  // createdAt from the ORIGINAL contract must be preserved (reclassify does not reset it).
  shrunk.createdAt === trivialContract.createdAt
    ? rep.ok('2. reclassify: original createdAt preserved across reclassifications')
    : rep.bad(`2. reclassify: createdAt changed — original=${trivialContract.createdAt} after=${shrunk.createdAt}`);
}

rep.finish('execution-persistence (CDK-021)');
