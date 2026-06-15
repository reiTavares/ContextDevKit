/**
 * integration-test-gate.mjs — evaluateAction end-to-end tests, part 1 (CDK-032/033/035).
 *
 * Table-driven: real contracts + real receipts written to tmp roots, exercised
 * across {advisory, guarded, strict} x {Read, Edit, Bash-grep} x {workflow
 * present/absent, map fresh/stale, receipts present/missing}.
 *
 * G1. Advisory NEVER denies invariant.
 * G2. Null contract -> always allow.
 * G3. CDK-033 workflow-before-write rule.
 * G4. CDK-035 exploration-budget rule.
 *
 * Part 2 (G5-G8) continues in integration-test-gate-p2.mjs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();

const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-gate-'));
const clean = (r) => rmSync(r, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Module imports
// ---------------------------------------------------------------------------

const EVAL_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/evaluate-action.mjs');
const RECEIPT_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');

let evaluateAction;
let writeReceipt;

try {
  const eMod = await import('file://' + EVAL_PATH.replaceAll('\\', '/'));
  ({ evaluateAction } = eMod);
  const rMod = await import('file://' + RECEIPT_PATH.replaceAll('\\', '/'));
  ({ writeReceipt } = rMod);
} catch (err) {
  rep.bad(`Module import failed: ${err?.message ?? err}`);
  rep.finish('integration-gate-p1 (CDK-032/033/035)');
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Base scope for all tests in this file. */
const baseScope = (taskId) => ({ branch: 'feat/gate', taskId, paths: ['src/main.mjs'] });

/**
 * Builds a minimal projectState for evaluateAction.
 * @param {string} root
 * @param {string} taskId
 * @param {object} [overrides]
 */
const buildState = (root, taskId, overrides = {}) => ({
  scope: baseScope(taskId),
  root,
  requiresHumanApproval: false,
  activeWorkflow: true,
  projectMapFresh: true,
  broadSearchCount: 0,
  exploreBudget: 2,
  ...overrides,
});

/** Minimal feature-tier contract with no receipt requirements. */
const featureNoReqs = (taskId) => ({
  version: 1, taskId, sessionId: 'sess-g', branch: 'feat/gate', host: 'claude',
  signals: { tier: 'feature', domain: 'core', level: 5, needsAdr: false, paths: [] },
  requiredBeforeExploration: [],
  requiredBeforeWrite: [],
  requiredBeforeCompletion: [],
  recommended: [],
  createdAt: Date.now(), history: [],
});

// ---------------------------------------------------------------------------
// G1. Advisory NEVER denies — across all tools and conditions
// ---------------------------------------------------------------------------
console.log('\nG1. Advisory NEVER denies invariant...');
{
  const root = tmp();
  try {
    // Add receipt requirement + apply all stressors to maximise violation surface.
    const contract = {
      ...featureNoReqs('task-g1'),
      requiredBeforeWrite: ['qa-signoff'],
    };
    const state = buildState(root, 'task-g1', { activeWorkflow: false, projectMapFresh: false, broadSearchCount: 5 });

    for (const tool of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit']) {
      const r = evaluateAction({ tool, input: {}, contract, projectState: state, mode: 'advisory' });
      r.decision !== 'deny'
        ? rep.ok(`G1. advisory NEVER denies: ${tool} -> ${r.decision}`)
        : rep.bad(`G1. advisory INVARIANT BROKEN: ${tool} returned deny`);
    }
    const bashR = evaluateAction({ tool: 'Bash', input: { command: 'grep -r foo .' }, contract, projectState: state, mode: 'advisory' });
    bashR.decision !== 'deny'
      ? rep.ok(`G1. advisory NEVER denies: Bash broad-grep -> ${bashR.decision}`)
      : rep.bad('G1. advisory INVARIANT BROKEN: Bash broad-grep returned deny');
  } finally { clean(root); }
}

// ---------------------------------------------------------------------------
// G2. Null contract → always allow (silent)
// ---------------------------------------------------------------------------
console.log('\nG2. Null contract -> always allow...');
{
  for (const mode of ['advisory', 'guarded', 'strict']) {
    for (const tool of ['Edit', 'Read']) {
      const r = evaluateAction({
        tool, input: {},
        contract: null,
        projectState: buildState('/nonexistent', 'x', { activeWorkflow: false }),
        mode,
      });
      r.decision === 'allow' && r.reasonCodes.length === 0
        ? rep.ok(`G2. null contract ${mode}/${tool} -> allow`)
        : rep.bad(`G2. null contract ${mode}/${tool}: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
    }
  }
}

// ---------------------------------------------------------------------------
// G3. CDK-033 Workflow-before-write rule
// ---------------------------------------------------------------------------
console.log('\nG3. CDK-033 workflow-before-write...');
{
  // advisory + no workflow → warn (never deny)
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Edit', input: {}, contract: featureNoReqs('task-g3a'), projectState: buildState(root, 'task-g3a', { activeWorkflow: false }), mode: 'advisory' });
      r.decision === 'warn' ? rep.ok('G3. advisory + no workflow -> warn') : rep.bad(`G3. advisory + no workflow: expected warn, got ${r.decision}`);
      r.reasonCodes.includes('workflow-missing') ? rep.ok('G3. advisory: workflow-missing code present') : rep.bad(`G3. advisory: code missing=[${r.reasonCodes}]`);
    } finally { clean(root); }
  }

  // guarded + no workflow + Edit → deny
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Edit', input: {}, contract: featureNoReqs('task-g3b'), projectState: buildState(root, 'task-g3b', { activeWorkflow: false }), mode: 'guarded' });
      r.decision === 'deny' ? rep.ok('G3. guarded + no workflow + Edit -> deny') : rep.bad(`G3. guarded: expected deny, got ${r.decision}`);
    } finally { clean(root); }
  }

  // strict + no workflow → deny
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Write', input: {}, contract: featureNoReqs('task-g3c'), projectState: buildState(root, 'task-g3c', { activeWorkflow: false }), mode: 'strict' });
      r.decision === 'deny' ? rep.ok('G3. strict + no workflow -> deny') : rep.bad(`G3. strict: expected deny, got ${r.decision}`);
    } finally { clean(root); }
  }

  // workflow present → allow (no other violations)
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Edit', input: {}, contract: featureNoReqs('task-g3d'), projectState: buildState(root, 'task-g3d', { activeWorkflow: true }), mode: 'guarded' });
      r.decision === 'allow' ? rep.ok('G3. guarded + workflow present -> allow') : rep.bad(`G3. workflow present: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
    } finally { clean(root); }
  }

  // trivial tier → CDK-033 does NOT apply
  {
    const root = tmp();
    const trivialContract = { ...featureNoReqs('task-g3e'), signals: { tier: 'trivial', domain: 'core', level: 5, needsAdr: false, paths: [] } };
    try {
      const r = evaluateAction({ tool: 'Edit', input: {}, contract: trivialContract, projectState: buildState(root, 'task-g3e', { activeWorkflow: false }), mode: 'guarded' });
      r.decision === 'allow' ? rep.ok('G3. trivial tier + no workflow -> allow') : rep.bad(`G3. trivial: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
    } finally { clean(root); }
  }
}

// ---------------------------------------------------------------------------
// G4. CDK-035 Exploration-budget rule
// ---------------------------------------------------------------------------
console.log('\nG4. CDK-035 exploration-budget...');
{
  // advisory + stale + over-budget → warn
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Read', input: {}, contract: featureNoReqs('task-g4a'), projectState: buildState(root, 'task-g4a', { projectMapFresh: false, broadSearchCount: 3 }), mode: 'advisory' });
      r.decision === 'warn' ? rep.ok('G4. advisory + stale + over-budget: Read -> warn') : rep.bad(`G4. advisory: expected warn, got ${r.decision}`);
      r.reasonCodes.includes('explore-budget') ? rep.ok('G4. explore-budget code present') : rep.bad(`G4. code missing=[${r.reasonCodes}]`);
    } finally { clean(root); }
  }

  // strict + stale + over-budget → deny
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Grep', input: {}, contract: featureNoReqs('task-g4b'), projectState: buildState(root, 'task-g4b', { projectMapFresh: false, broadSearchCount: 5 }), mode: 'strict' });
      r.decision === 'deny' ? rep.ok('G4. strict + stale + over-budget: Grep -> deny') : rep.bad(`G4. strict: expected deny, got ${r.decision}`);
    } finally { clean(root); }
  }

  // Bash broad grep → counts as broad search
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Bash', input: { command: 'grep -r pattern .' }, contract: featureNoReqs('task-g4c'), projectState: buildState(root, 'task-g4c', { projectMapFresh: false, broadSearchCount: 2 }), mode: 'strict' });
      r.decision === 'deny' ? rep.ok('G4. strict + Bash broad-grep + stale + at-budget -> deny') : rep.bad(`G4. Bash broad-grep: expected deny, got ${r.decision}`);
    } finally { clean(root); }
  }

  // fresh map → CDK-035 does not apply even if count is over
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Read', input: {}, contract: featureNoReqs('task-g4d'), projectState: buildState(root, 'task-g4d', { projectMapFresh: true, broadSearchCount: 99 }), mode: 'strict' });
      r.decision === 'allow' ? rep.ok('G4. strict + fresh map + over-budget -> allow') : rep.bad(`G4. fresh map: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
    } finally { clean(root); }
  }

  // under budget → no flag
  {
    const root = tmp();
    try {
      const r = evaluateAction({ tool: 'Read', input: {}, contract: featureNoReqs('task-g4e'), projectState: buildState(root, 'task-g4e', { projectMapFresh: false, broadSearchCount: 1 }), mode: 'strict' });
      r.decision === 'allow' ? rep.ok('G4. strict + stale + under-budget -> allow') : rep.bad(`G4. under-budget: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
    } finally { clean(root); }
  }
}

rep.finish('integration-gate-p1 (CDK-032/033/035)');
