/**
 * Selftest for Wave-3 work verbs (part 2): promote, reconcile, validate.
 * (BIZ-0001 / ADR-0125)
 *
 * Part 1 (intake, link, unlink, start, close) lives in work-verbs.selftest.mjs.
 * Each file is fully self-contained with its own harness, tmp root, and exit.
 *
 * Zero runtime dependencies beyond node:* and the modules under test.
 * Run with: `node templates/contextkit/tools/scripts/work-verbs-part2.selftest.mjs`
 */
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dispatch } from './work.mjs';

// ---------------------------------------------------------------------------
// Minimal test harness (mirrors existing kit selftest patterns)
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;
const failures = [];

/**
 * @param {string} label - human name for the assertion.
 * @param {boolean} condition - pass condition.
 * @param {string} [detail] - extra detail appended on failure.
 */
function assert(label, condition, detail = '') {
  if (condition) {
    passCount += 1;
  } else {
    failCount += 1;
    failures.push(detail ? `  FAIL: ${label} — ${detail}` : `  FAIL: ${label}`);
  }
}

/**
 * Expects `fn` to throw (synchronously). Returns the thrown error.
 *
 * @param {string} label
 * @param {() => unknown} fn
 * @returns {Error|null} the caught error, or null on failure.
 */
function assertThrows(label, fn) {
  try {
    fn();
    failCount += 1;
    failures.push(`  FAIL: ${label} — expected throw, but did not throw`);
    return null;
  } catch (err) {
    passCount += 1;
    return err;
  }
}

// ---------------------------------------------------------------------------
// Hermetic tmp root setup
// ---------------------------------------------------------------------------

/**
 * Creates a hermetic tmp root with minimal fixture files for the verbs under
 * test. Returns the root path.
 *
 * @returns {string} absolute path to the tmp root.
 */
function buildTmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'work-verbs-p2-selftest-'));
  const memory = join(root, 'contextkit', 'memory');
  const bizDir = join(memory, 'business', 'BIZ-0001-selftest');
  const opDir = join(memory, 'operations', 'OP-0001-selftest');

  mkdirSync(bizDir, { recursive: true });
  mkdirSync(opDir, { recursive: true });

  const bizJson = {
    schemaVersion: 1, uid: null, id: 'BIZ-0001', title: 'Selftest Business',
    slug: 'selftest-business', status: 'proposed', kind: 'TEST',
    strategicFacet: 'GROWTH', valueIntents: { primary: 'GROW', secondary: [] },
    growth: { levers: [] }, investment: { estimate: null },
    approval: { actor: null, revision: 0, approvedAt: null, decision: null, decisionHash: null },
    decisions: { status: 'NEEDS_DECISION', coverage: 'NEEDS_DECISION' },
    workflows: {}, relations: [],
    lifecycle: ['draft', 'proposed', 'confirmed', 'active', 'closed'],
    revisions: [],
  };

  const opJson = {
    schemaVersion: 1, uid: null, id: 'OP-0001', title: 'Selftest Operation',
    slug: 'selftest-operation', kind: 'MAINTENANCE', executionMode: 'direct',
    valueIntents: { primary: 'IMPROVE', secondary: [] },
    business: { status: 'pending', id: null },
    decisions: { coverage: 'NEEDS_DECISION' }, relations: [],
  };

  writeFileSync(join(bizDir, 'business.json'), `${JSON.stringify(bizJson, null, 2)}\n`);
  writeFileSync(join(opDir, 'operation.json'), `${JSON.stringify(opJson, null, 2)}\n`);

  return root;
}

// ---------------------------------------------------------------------------
// Helpers: build parsed argv shape
// ---------------------------------------------------------------------------

/** @param {string} cmd @param {string[]} rest */
function parsed(cmd, rest = []) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) { flags[body.slice(0, eq)] = body.slice(eq + 1); continue; }
      if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
        flags[body] = rest[i + 1]; i += 1;
      } else { flags[body] = true; }
    } else { positionals.push(token); }
  }
  return { command: cmd, positionals, flags };
}

// ---------------------------------------------------------------------------
// Test: promote (human-gate)
// ---------------------------------------------------------------------------

function testPromote(root) {
  // Promote with non-human actor MUST throw.
  const errAgent = assertThrows(
    'promote refuses non-human actor',
    () => dispatch(parsed('promote', ['--id', 'BIZ-0001', '--actor', 'agent', '--owner-type', 'op', '--owner-id', 'OP-0001']), { root }),
  );
  assert('promote refusal message mentions actor', errAgent && errAgent.message.includes('not "human"'));

  // Promote with missing owner flags MUST throw.
  const errNoOwner = assertThrows(
    'promote requires --owner-type and --owner-id',
    () => dispatch(parsed('promote', ['--id', 'BIZ-0001', '--actor', 'human']), { root }),
  );
  assert('promote missing-owner error message correct', errNoOwner && errNoOwner.message.includes('--owner-type'));

  // dry-run promote with valid inputs.
  const rDry = dispatch(
    parsed('promote', ['--id', 'BIZ-0001', '--actor', 'human', '--owner-type', 'business', '--owner-id', 'BIZ-0002']),
    { root },
  );
  assert('promote dry-run dispatches', rDry.command === 'promote');
  assert('promote dry-run mode', rDry.mode === 'dry-run');
}

// ---------------------------------------------------------------------------
// Test: reconcile
// ---------------------------------------------------------------------------

function testReconcile(root) {
  const rc = dispatch(parsed('reconcile', ['--check']), { root });
  assert('reconcile --check dispatches', rc.command === 'reconcile');
  assert('reconcile --check detail.check === true', rc.detail.check === true);
  assert('reconcile --check dry-run writes nothing', rc.writes.length === 0);

  const rd = dispatch(parsed('reconcile'), { root });
  assert('reconcile dry-run dispatches', rd.command === 'reconcile');
  assert('reconcile dry-run mode', rd.mode === 'dry-run');

  const workContextRegistry = join(root, 'contextkit', 'memory', 'work-context-registry.json');
  const workflowRegistry = join(root, 'contextkit', 'memory', 'workflow-registry.json');
  const decisionRegistry = join(root, 'contextkit', 'memory', 'decision-registry.json');
  assert('reconcile dry-run did not write work-context-registry', !existsSync(workContextRegistry));

  const ra = dispatch(parsed('reconcile', ['--apply']), { root });
  assert('reconcile --apply applied', ra.applied === true);
  assert('reconcile --apply wrote work-context-registry', existsSync(workContextRegistry));
  assert('reconcile --apply wrote workflow-registry', existsSync(workflowRegistry));
  assert('reconcile --apply wrote decision-registry', existsSync(decisionRegistry));

  const ra2 = dispatch(parsed('reconcile', ['--apply']), { root });
  assert('reconcile idempotent: second apply succeeds', ra2.applied === true);
}

// ---------------------------------------------------------------------------
// Test: validate
// ---------------------------------------------------------------------------

function testValidate(root) {
  const rc = dispatch(parsed('validate', ['--check']), { root });
  assert('validate --check dispatches', rc.command === 'validate');
  assert('validate --check ready flag', rc.detail.ready === true);

  const rvOp = dispatch(parsed('validate', ['--id', 'OP-0001']), { root });
  assert('validate OP-0001 dispatches', rvOp.command === 'validate');
  assert('validate OP-0001 returns detail.id', rvOp.detail.id === 'OP-0001');

  const badOpDir = join(root, 'contextkit', 'memory', 'operations', 'OP-0002-bad');
  mkdirSync(badOpDir, { recursive: true });
  writeFileSync(join(badOpDir, 'operation.json'), JSON.stringify({ id: 'OP-0002' }));
  const rvBad = dispatch(parsed('validate', ['--id', 'OP-0002']), { root });
  assert('validate invalid entity reports invalid', rvBad.detail.valid === false);
  assert('validate invalid entity has errors', Array.isArray(rvBad.detail.errors) && rvBad.detail.errors.length > 0);

  const rvScan = dispatch(parsed('validate'), { root });
  assert('validate scan mode dispatches', rvScan.command === 'validate');
  assert('validate scan mode returns count', typeof rvScan.detail.count === 'number');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const root = buildTmpRoot();
  try {
    testPromote(root);
    testReconcile(root);
    testValidate(root);
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }

  if (failures.length > 0) {
    process.stderr.write('\nwork-verbs-part2 selftest FAILURES:\n');
    for (const msg of failures) process.stderr.write(`${msg}\n`);
  }
  process.stdout.write(`\nwork-verbs-part2 selftest: ${passCount} passed, ${failCount} failed\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`work-verbs-part2 selftest FATAL: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
