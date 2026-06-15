/**
 * integration-test-completion-gate.mjs — end-to-end tests for the
 * completion-gate.mjs Stop hook (CDK-040, ADR-0072).
 *
 * Drives the hook as a subprocess using the installFixture helper so the
 * test runs against the REAL installed hook (not the template directly).
 * All cases are HERMETIC: they rely only on the embedded DEFAULT_REGISTRY
 * and DEFAULT_RUBRIC so results are stable on any machine or branch.
 *
 * Coverage:
 *   CG1. L4 (below 5): hook silent (empty output), exit 0.
 *   CG2. L5, active task + contract requiring 'tests', NO receipt:
 *          stdout contains advisory text, no decision:block.
 *   CG3. L5, valid passing receipt matching scope -> hook silent.
 *   CG4. No activeTask in ledger -> hook silent.
 *   CG5. Malformed stdin -> exit 0, silent (fail-open).
 *   CG6. Debounce: completionWarnedAt already set -> silent (fires once).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { installFixture, KIT, reporter } from './it-helpers.mjs';

const rep = reporter();

// ---------------------------------------------------------------------------
// Module imports
// ---------------------------------------------------------------------------

const CONTRACT_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/execution-contract.mjs');
const RECEIPT_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');

let saveContract, writeReceipt;

try {
  const contractMod = await import('file://' + CONTRACT_PATH.replaceAll('\\', '/'));
  ({ saveContract } = contractMod);
  const receiptMod = await import('file://' + RECEIPT_PATH.replaceAll('\\', '/'));
  ({ writeReceipt } = receiptMod);
} catch (err) {
  rep.bad(`Module import failed: ${err?.message ?? err}`);
  rep.finish('completion-gate (CDK-040)');
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const TASK_ID = 'task-cg-001';
const SESSION_ID = 'sess-cg-test-01';
// MUST match the fixture's git branch: installFixture does `git init -b main`,
// and the hook builds the receipt-matching scope from `currentBranch(proj)`.
// A receipt written under a different branch fails isReceiptValid's branch check.
const BRANCH = 'main';

/** Minimal feature contract requiring 'tests' before completion. */
const featureContract = {
  version: 1,
  taskId: TASK_ID,
  sessionId: SESSION_ID,
  branch: BRANCH,
  host: 'claude',
  signals: { tier: 'feature', domain: 'core', level: 5, needsAdr: false, paths: [] },
  requiredBeforeExploration: [],
  requiredBeforeWrite: [],
  requiredBeforeCompletion: ['tests'],
  recommended: [],
  createdAt: Date.now(),
  history: [],
};

/** Scope used for receipt matching (must match the scope in evaluateCompletion). */
const scope = { branch: BRANCH, taskId: TASK_ID, paths: [] };

/**
 * Seeds the session ledger with activeTask so the hook treats this as a
 * registered task. Writes to the sessions dir inside the fixture project.
 *
 * @param {string} proj installed fixture root
 * @param {object} [overrides] extra ledger fields (e.g. completionWarnedAt)
 */
function seedLedger(proj, overrides = {}) {
  const sessDir = join(proj, '.claude', '.sessions');
  mkdirSync(sessDir, { recursive: true });
  const ledger = {
    sessionId: SESSION_ID,
    startedAt: Date.now(),
    modifications: [],
    registered: false,
    stopWarnedAt: null,
    activeTask: TASK_ID,
    ...overrides,
  };
  writeFileSync(join(sessDir, `${SESSION_ID}.json`), JSON.stringify(ledger, null, 2), 'utf-8');
}

/** Standard Stop hook payload in Claude Code wire format. */
const hookPayload = () => ({
  session_id: SESSION_ID,
  hook_event_name: 'Stop',
  stop_hook_active: false,
});

// ---------------------------------------------------------------------------
// Install fixture
// ---------------------------------------------------------------------------

const { proj, cfgPath, hook, cleanup } = installFixture(rep);

try {
  // CG1. L4 (below 5): hook is inert — silent and exit 0.
  console.log('\nCG1. L4 inert guard...');
  {
    // Override level to 4 in the config.
    writeFileSync(cfgPath, JSON.stringify({ level: 4 }), 'utf-8');
    seedLedger(proj);
    saveContract(proj, TASK_ID, featureContract);
    const out = hook('completion-gate.mjs', hookPayload());
    (out === '' || !out.includes('completion-gate'))
      ? rep.ok('CG1. L4: hook silent (inert below L5)')
      : rep.bad(`CG1. L4: expected silence, got: ${out.slice(0, 200)}`);
  }

  // Restore L5 for remaining cases.
  writeFileSync(cfgPath, JSON.stringify({ level: 5 }), 'utf-8');

  // CG2. L5, active task + contract requiring 'tests', NO receipt -> advisory text.
  console.log('\nCG2. L5 + contract + no receipt -> advisory nudge...');
  {
    seedLedger(proj);
    saveContract(proj, TASK_ID, featureContract);
    const out = hook('completion-gate.mjs', hookPayload());
    out.includes('completion-gate') && out.includes('completion-evidence-missing')
      ? rep.ok('CG2. advisory text emitted with completion-evidence-missing code')
      : rep.bad(`CG2. advisory text missing or wrong: ${out.slice(0, 300)}`);
    !out.includes('"decision":"block"') && !out.includes('"decision": "block"')
      ? rep.ok('CG2. advisory mode does not block (no decision:block in stdout)')
      : rep.bad('CG2. advisory should NOT produce a block decision');
    out.includes('tests')
      ? rep.ok('CG2. output mentions missing capability "tests"')
      : rep.bad(`CG2. output missing capability mention: ${out.slice(0, 200)}`);
  }

  // CG3. L5, valid passing receipt matching scope -> hook silent.
  console.log('\nCG3. L5 + contract + valid receipt -> silent...');
  {
    // Write a fresh passing receipt. Scope must match what evaluateCompletion uses.
    writeReceipt(proj, {
      capability: 'tests',
      taskId: TASK_ID,
      sessionId: SESSION_ID,
      runId: 'run-cg-1',
      command: '/tests',
      host: 'claude',
      result: 'passed',
      evidence: { exitCode: 0, summary: 'All tests passed' },
      scope,
    });
    // Re-seed ledger (no completionWarnedAt — fresh check).
    seedLedger(proj);
    const out = hook('completion-gate.mjs', hookPayload());
    (out === '' || (!out.includes('completion-gate') && !out.includes('"decision"')))
      ? rep.ok('CG3. valid receipt -> hook silent')
      : rep.bad(`CG3. expected silence with valid receipt, got: ${out.slice(0, 200)}`);
  }

  // CG4. No activeTask in ledger -> hook silent.
  console.log('\nCG4. No activeTask -> silent...');
  {
    // Seed ledger WITHOUT activeTask.
    seedLedger(proj, { activeTask: undefined });
    const out = hook('completion-gate.mjs', hookPayload());
    (out === '' || !out.includes('completion-gate'))
      ? rep.ok('CG4. no activeTask -> hook silent')
      : rep.bad(`CG4. expected silence when no activeTask, got: ${out.slice(0, 200)}`);
  }

  // CG5. Malformed stdin -> exit 0, silent (fail-open).
  console.log('\nCG5. Malformed stdin -> fail-open...');
  {
    // The hook helper pipes JSON, but we can pass raw malformed text via a direct spawn.
    const { spawnSync } = await import('node:child_process');
    const hookFile = join(proj, 'contextkit', 'runtime', 'hooks', 'completion-gate.mjs');
    const result = spawnSync(process.execPath, [hookFile], {
      cwd: proj,
      input: 'not-valid-json{{{',
      encoding: 'utf-8',
      timeout: 15_000,
    });
    result.status === 0
      ? rep.ok('CG5. malformed stdin -> exit 0 (fail-open)')
      : rep.bad(`CG5. malformed stdin: expected exit 0, got ${result.status}: ${result.stderr?.slice(0, 100)}`);
    (!result.stdout || result.stdout.trim() === '' || !result.stdout.includes('decision'))
      ? rep.ok('CG5. malformed stdin -> no output (silent fail-open)')
      : rep.bad(`CG5. malformed stdin produced output: ${result.stdout.slice(0, 200)}`);
  }

  // CG6. Debounce: completionWarnedAt already stamped -> second Stop silent.
  console.log('\nCG6. Debounce: second Stop in same session -> silent...');
  {
    // Seed ledger with completionWarnedAt already set.
    seedLedger(proj, { completionWarnedAt: Date.now() });
    saveContract(proj, TASK_ID, featureContract);
    const out = hook('completion-gate.mjs', hookPayload());
    (out === '' || !out.includes('completion-gate'))
      ? rep.ok('CG6. completionWarnedAt already set -> second Stop is silent (debounce)')
      : rep.bad(`CG6. expected silence on second Stop, got: ${out.slice(0, 200)}`);
  }

} finally {
  cleanup();
}

rep.finish('completion-gate (CDK-040)');
