/**
 * integration-test-gate-p2.mjs — evaluateAction end-to-end tests, part 2 (CDK-032/033/035).
 *
 * Continues from integration-test-gate.mjs:
 * G5. Valid receipt + workflow -> allow in all modes.
 * G6. Unmonitored tools -> always allow.
 * G7. Combined violations (receipt-missing + workflow-missing).
 * G8. detail object structure.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();

const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-gate2-'));
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
  rep.finish('integration-gate-p2 (CDK-032/033/035)');
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

/**
 * Minimal feature-tier contract with one required capability at beforeWrite.
 * @param {string} taskId
 */
const featureWithReceipt = (taskId) => ({
  version: 1, taskId, sessionId: 'sess-g', branch: 'feat/gate', host: 'claude',
  signals: { tier: 'feature', domain: 'core', level: 5, needsAdr: false, paths: [] },
  requiredBeforeExploration: [],
  requiredBeforeWrite: ['qa-signoff'],
  requiredBeforeCompletion: [],
  recommended: [],
  createdAt: Date.now(), history: [],
});

/**
 * Writes a passing qa-signoff receipt into the tmp root for the given taskId.
 * @param {string} root
 * @param {string} taskId
 */
function writeQaReceipt(root, taskId) {
  writeReceipt(root, {
    capability: 'qa-signoff',
    taskId,
    sessionId: 'sess-g',
    runId: 'run-g-1',
    command: '/qa-signoff',
    host: 'claude',
    result: 'passed',
    evidence: { exitCode: 0, summary: 'Gate p2 integration test — all green' },
    scope: baseScope(taskId),
  });
}

// ---------------------------------------------------------------------------
// G5. Receipt-satisfied + no workflow violation → allow in all modes
// ---------------------------------------------------------------------------
console.log('\nG5. Valid receipt -> allow in all modes...');
{
  for (const mode of ['advisory', 'guarded', 'strict']) {
    const root = tmp();
    const taskId = `task-g5-${mode}`;
    try {
      writeQaReceipt(root, taskId);
      const r = evaluateAction({
        tool: 'Edit', input: {},
        contract: featureWithReceipt(taskId),
        projectState: buildState(root, taskId, { activeWorkflow: true }),
        mode,
      });
      r.decision === 'allow'
        ? rep.ok(`G5. ${mode}: valid receipt + workflow -> allow`)
        : rep.bad(`G5. ${mode}: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
    } finally { clean(root); }
  }
}

// ---------------------------------------------------------------------------
// G6. Unmonitored tools → always allow (even under worst conditions)
// ---------------------------------------------------------------------------
console.log('\nG6. Unmonitored tools -> always allow...');
{
  const root = tmp();
  try {
    const state = buildState(root, 'task-g6', { activeWorkflow: false, projectMapFresh: false, broadSearchCount: 99 });
    const contract = featureWithReceipt('task-g6');
    for (const tool of ['Task', 'mcp__gmail__send', 'WebFetch', 'Agent']) {
      const r = evaluateAction({ tool, input: {}, contract, projectState: state, mode: 'strict' });
      r.decision === 'allow'
        ? rep.ok(`G6. unmonitored ${tool} strict -> allow`)
        : rep.bad(`G6. ${tool} strict: expected allow, got ${r.decision}`);
    }
  } finally { clean(root); }
}

// ---------------------------------------------------------------------------
// G7. Combined violations (receipt-missing + workflow-missing)
// ---------------------------------------------------------------------------
console.log('\nG7. Combined violations (receipt-missing + workflow-missing)...');
{
  const root = tmp();
  try {
    // No receipt written + no active workflow.
    const contract = featureWithReceipt('task-g7');
    const state = buildState(root, 'task-g7', { activeWorkflow: false });

    const advR = evaluateAction({ tool: 'Edit', input: {}, contract, projectState: state, mode: 'advisory' });
    advR.decision === 'warn' ? rep.ok('G7. advisory: combo violation -> warn') : rep.bad(`G7. advisory: expected warn, got ${advR.decision}`);
    (advR.reasonCodes.includes('receipt-missing') || advR.reasonCodes.includes('workflow-missing'))
      ? rep.ok(`G7. advisory: combo reason codes present: [${advR.reasonCodes}]`)
      : rep.bad(`G7. advisory: no reason code — got [${advR.reasonCodes}]`);

    const grdR = evaluateAction({ tool: 'Edit', input: {}, contract, projectState: state, mode: 'guarded' });
    grdR.decision === 'deny' ? rep.ok('G7. guarded: combo violation -> deny') : rep.bad(`G7. guarded: expected deny, got ${grdR.decision}`);

    const strR = evaluateAction({ tool: 'Edit', input: {}, contract, projectState: state, mode: 'strict' });
    strR.decision === 'deny' ? rep.ok('G7. strict: combo violation -> deny') : rep.bad(`G7. strict: expected deny, got ${strR.decision}`);
  } finally { clean(root); }
}

// ---------------------------------------------------------------------------
// G8. Detail object carries correct metadata
// ---------------------------------------------------------------------------
console.log('\nG8. detail object structure...');
{
  const root = tmp();
  try {
    const r = evaluateAction({
      tool: 'Edit', input: {},
      contract: featureWithReceipt('task-g8'),
      projectState: buildState(root, 'task-g8'),
      mode: 'advisory',
    });
    r.detail.moment === 'beforeWrite' ? rep.ok('G8. detail.moment = beforeWrite') : rep.bad(`G8. detail.moment: expected beforeWrite, got ${r.detail.moment}`);
    Array.isArray(r.detail.missing) ? rep.ok('G8. detail.missing is array') : rep.bad('G8. detail.missing not array');
    Array.isArray(r.detail.bypassed) ? rep.ok('G8. detail.bypassed is array') : rep.bad('G8. detail.bypassed not array');
    Array.isArray(r.detail.satisfied) ? rep.ok('G8. detail.satisfied is array') : rep.bad('G8. detail.satisfied not array');
    typeof r.decision === 'string' ? rep.ok('G8. decision is string') : rep.bad('G8. decision not string');
    Array.isArray(r.remediation) ? rep.ok('G8. remediation is array') : rep.bad('G8. remediation not array');
    Array.isArray(r.reasonCodes) ? rep.ok('G8. reasonCodes is array') : rep.bad('G8. reasonCodes not array');
  } finally { clean(root); }
}

rep.finish('integration-gate-p2 (CDK-032/033/035)');
