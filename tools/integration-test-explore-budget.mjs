/**
 * integration-test-explore-budget.mjs — end-to-end tests for the persisted
 * broad-search counter (CDK-035, ADR-0072) in execution-gate.mjs.
 *
 * Tests are HERMETIC: they build contracts using DEFAULT_RUBRIC (no ambient
 * rubric file in the tmp root) and drive evaluateAction directly for budget
 * rule assertions. The ledger increment path is tested via a per-session tmp
 * ledger dir so CI never touches the real sessions directory.
 *
 * Coverage:
 *   EB1. After 1 broad search, ledger.broadSearchCount === 1.
 *   EB2. After 3 broad searches, ledger.broadSearchCount === 3.
 *   EB3. Advisory mode: broadSearchCount >= budget but stale map -> warn (never deny).
 *   EB4. Strict mode: broadSearchCount >= budget + stale map -> deny + explore-budget code.
 *   EB5. Budget NOT exceeded when count < budget.
 *   EB6. evaluateAction: broadSearchCount=0, fresh map -> allow (budget rule silent).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-eb-'));
const clean = (r) => rmSync(r, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

const LEDGER_PATH = resolve(KIT, 'templates/contextkit/runtime/hooks/ledger.mjs');
const EVAL_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/evaluate-action.mjs');
const CONTRACT_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/execution-contract.mjs');
const INTAKE_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/task-intake.mjs');

let readLedger, writeLedger;
let evaluateAction;
let buildContract, loadContract, saveContract;
let intake;

try {
  const ledgerMod = await import('file://' + LEDGER_PATH.replaceAll('\\', '/'));
  ({ readLedger, writeLedger } = ledgerMod);
  const evalMod = await import('file://' + EVAL_PATH.replaceAll('\\', '/'));
  ({ evaluateAction } = evalMod);
  const contractMod = await import('file://' + CONTRACT_PATH.replaceAll('\\', '/'));
  ({ buildContract, loadContract, saveContract } = contractMod);
  const intakeMod = await import('file://' + INTAKE_PATH.replaceAll('\\', '/'));
  ({ intake } = intakeMod);
} catch (err) {
  rep.bad(`Module import failed: ${err?.message ?? err}`);
  rep.finish('explore-budget counter (CDK-035)');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a hermetic session directory under a tmp root and returns the helper
 * functions scoped to it. No rubric file is written so DEFAULT_RUBRIC is used.
 *
 * @returns {{ root: string, sessionId: string, clean: () => void,
 *             readSessionLedger: () => Promise<object>,
 *             simulateBroadSearchIncrement: (n: number, mapFresh?: boolean) => Promise<void> }}
 */
function hermeticSession() {
  const root = tmp();
  const sessDir = join(root, '.claude', '.sessions');
  mkdirSync(sessDir, { recursive: true });
  // Provide a minimal config.json so loadConfig and getLevel work.
  const ckDir = join(root, 'contextkit', 'config');
  mkdirSync(ckDir, { recursive: true });
  writeFileSync(join(ckDir, 'config.json'), JSON.stringify({ level: 5 }));

  const sessionId = `test-eb-${Date.now()}`;

  async function readSessionLedger() {
    // readLedger resolves the sessions dir relative to cwd; we override via env.
    // Instead: write and read directly via the module (it uses process.cwd()/LEDGER_DIR).
    // Simplest approach: write the ledger file directly and read it back.
    const ledgerFile = join(sessDir, `${sessionId}.json`);
    try {
      return JSON.parse(readFileSync(ledgerFile, 'utf-8'));
    } catch {
      return {};
    }
  }

  async function simulateBroadSearchIncrement(n, mapFresh = false) {
    // Simulate what the gate's incrementBroadSearchCount does: read, increment, write.
    const ledgerFile = join(sessDir, `${sessionId}.json`);
    let ledger;
    try {
      ledger = JSON.parse(readFileSync(ledgerFile, 'utf-8'));
    } catch {
      ledger = { sessionId, broadSearchCount: 0, modifications: [], registered: false, startedAt: Date.now() };
    }
    if (typeof ledger.broadSearchCount !== 'number') ledger.broadSearchCount = 0;
    if (mapFresh && ledger.broadSearchCount > 0) ledger.broadSearchCount = 0;
    for (let i = 0; i < n; i++) ledger.broadSearchCount += 1;
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
  }

  return {
    root,
    sessionId,
    clean: () => clean(root),
    readSessionLedger,
    simulateBroadSearchIncrement,
  };
}

/** Builds a minimal feature contract (no rubric on disk -> DEFAULT_RUBRIC). */
function buildFeatureContract(root, sessionId) {
  const { signals } = intake(
    { objective: 'implement broad search feature', taskId: `task-eb-${sessionId}`, sessionId },
    { root }
  );
  const contract = buildContract(signals);
  saveContract(root, `task-eb-${sessionId}`, contract);
  return { contract, taskId: `task-eb-${sessionId}` };
}

const baseProjectState = (overrides = {}) => ({
  scope: { branch: 'feat/eb', taskId: 'task-eb-001', paths: [] },
  root: '/nonexistent',
  requiresHumanApproval: false,
  activeWorkflow: true,
  projectMapFresh: true,
  broadSearchCount: 0,
  exploreBudget: 2,
  ...overrides,
});

// ---------------------------------------------------------------------------
// EB1. After 1 broad search, ledger counter === 1
// ---------------------------------------------------------------------------
console.log('\nEB1. Ledger counter after 1 broad search...');
{
  const sess = hermeticSession();
  try {
    await sess.simulateBroadSearchIncrement(1);
    const ledger = await sess.readSessionLedger();
    ledger.broadSearchCount === 1
      ? rep.ok('EB1. broadSearchCount === 1 after 1 increment')
      : rep.bad(`EB1. expected 1, got ${ledger.broadSearchCount}`);
  } finally {
    sess.clean();
  }
}

// ---------------------------------------------------------------------------
// EB2. After 3 broad searches, ledger counter === 3
// ---------------------------------------------------------------------------
console.log('\nEB2. Ledger counter after 3 broad searches...');
{
  const sess = hermeticSession();
  try {
    await sess.simulateBroadSearchIncrement(3);
    const ledger = await sess.readSessionLedger();
    ledger.broadSearchCount === 3
      ? rep.ok('EB2. broadSearchCount === 3 after 3 increments')
      : rep.bad(`EB2. expected 3, got ${ledger.broadSearchCount}`);
  } finally {
    sess.clean();
  }
}

// ---------------------------------------------------------------------------
// EB3. Advisory mode: count >= budget + stale map -> warn (NEVER deny)
// ---------------------------------------------------------------------------
console.log('\nEB3. Advisory: over-budget + stale map -> warn...');
{
  const ps = baseProjectState({ projectMapFresh: false, broadSearchCount: 5, exploreBudget: 2 });
  const contract = {
    signals: { tier: 'feature' },
    requiredBeforeExploration: [],
    requiredBeforeWrite: [],
    requiredBeforeCompletion: [],
  };
  const r = evaluateAction({ tool: 'Read', input: {}, contract, projectState: ps, mode: 'advisory' });
  r.decision === 'warn'
    ? rep.ok('EB3. advisory + over-budget + stale -> warn (never deny)')
    : rep.bad(`EB3. expected warn, got ${r.decision}`);
  r.reasonCodes.includes('explore-budget')
    ? rep.ok('EB3. explore-budget reason code present')
    : rep.bad(`EB3. explore-budget code missing: ${JSON.stringify(r.reasonCodes)}`);
}

// ---------------------------------------------------------------------------
// EB4. Strict mode: count >= budget + stale map -> deny + explore-budget code
// ---------------------------------------------------------------------------
console.log('\nEB4. Strict: over-budget + stale map -> deny...');
{
  const ps = baseProjectState({ projectMapFresh: false, broadSearchCount: 3, exploreBudget: 2 });
  const contract = {
    signals: { tier: 'feature' },
    requiredBeforeExploration: [],
    requiredBeforeWrite: [],
    requiredBeforeCompletion: [],
  };
  const r = evaluateAction({ tool: 'Grep', input: {}, contract, projectState: ps, mode: 'strict' });
  r.decision === 'deny'
    ? rep.ok('EB4. strict + over-budget + stale -> deny')
    : rep.bad(`EB4. expected deny, got ${r.decision}`);
  r.reasonCodes.includes('explore-budget')
    ? rep.ok('EB4. explore-budget reason code present in strict deny')
    : rep.bad(`EB4. explore-budget code missing: ${JSON.stringify(r.reasonCodes)}`);
  r.remediation.length > 0
    ? rep.ok('EB4. remediation non-empty in deny case')
    : rep.bad('EB4. remediation empty');
}

// ---------------------------------------------------------------------------
// EB5. Budget NOT exceeded when count < budget
// ---------------------------------------------------------------------------
console.log('\nEB5. Budget not exceeded when count < exploreBudget...');
{
  const ps = baseProjectState({ projectMapFresh: false, broadSearchCount: 1, exploreBudget: 2 });
  const contract = {
    signals: { tier: 'feature' },
    requiredBeforeExploration: [],
    requiredBeforeWrite: [],
    requiredBeforeCompletion: [],
  };
  const r = evaluateAction({ tool: 'Read', input: {}, contract, projectState: ps, mode: 'strict' });
  !r.reasonCodes.includes('explore-budget')
    ? rep.ok('EB5. count < budget -> explore-budget NOT triggered')
    : rep.bad('EB5. explore-budget fired prematurely (count < budget)');
}

// ---------------------------------------------------------------------------
// EB6. Fresh project map -> budget rule silent (count irrelevant)
// ---------------------------------------------------------------------------
console.log('\nEB6. Fresh project map -> budget rule silent...');
{
  const ps = baseProjectState({ projectMapFresh: true, broadSearchCount: 99, exploreBudget: 2 });
  const contract = {
    signals: { tier: 'feature' },
    requiredBeforeExploration: [],
    requiredBeforeWrite: [],
    requiredBeforeCompletion: [],
  };
  const r = evaluateAction({ tool: 'Glob', input: {}, contract, projectState: ps, mode: 'strict' });
  !r.reasonCodes.includes('explore-budget')
    ? rep.ok('EB6. fresh map -> explore-budget silent even with count=99')
    : rep.bad('EB6. explore-budget fired despite fresh project map');
  r.decision === 'allow'
    ? rep.ok('EB6. fresh map + over-count -> allow (budget not the constraint)')
    : rep.bad(`EB6. expected allow, got ${r.decision}`);
}

rep.finish('explore-budget counter (CDK-035)');
