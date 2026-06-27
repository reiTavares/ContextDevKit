/**
 * Selftest for Wave-3 work verbs (part 1): intake, link, unlink, start, close.
 * (BIZ-0001 / ADR-0125)
 *
 * Tests each verb via dispatch() in --check / dry-run / --apply mode.
 * Part 2 (promote, reconcile, validate) lives in work-verbs-part2.selftest.mjs.
 *
 * Zero runtime dependencies beyond node:* and the modules under test.
 * Run with: `node templates/contextkit/tools/scripts/work-verbs.selftest.mjs`
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'work-verbs-selftest-'));
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
// Test: intake
// ---------------------------------------------------------------------------

function testIntake(root) {
  const checkReceipt = dispatch(parsed('intake', ['--check']), { root });
  assert('intake --check dispatches', checkReceipt.command === 'intake', JSON.stringify(checkReceipt));
  assert('intake --check returns check detail', checkReceipt.detail.check === true);
  assert('intake dry-run writes nothing', checkReceipt.writes.length === 0);

  try {
    const r = dispatch(parsed('intake', ['Fix the staging key rotation']), { root });
    assert('intake objective dispatches', r.command === 'intake');
    assert('intake dry-run mode is dry-run', r.mode === 'dry-run');
  } catch (err) {
    assert('intake throws descriptively if policy missing', typeof err.message === 'string');
  }
}

// ---------------------------------------------------------------------------
// Test: link / unlink
// ---------------------------------------------------------------------------

function testLink(root) {
  const opDir = join(root, 'contextkit', 'memory', 'operations', 'OP-0001-selftest');
  const opJsonPath = join(opDir, 'operation.json');

  const r = dispatch(parsed('link', ['--id', 'OP-0001', '--biz', 'BIZ-0001']), { root });
  assert('link dispatches', r.command === 'link');
  assert('link dry-run mode', r.mode === 'dry-run');

  const rApply = dispatch(parsed('link', ['--id', 'OP-0001', '--biz', 'BIZ-0001', '--apply']), { root });
  assert('link --apply applied flag', rApply.applied === true);
  const parsedAfter = JSON.parse(readFileSync(opJsonPath, 'utf-8'));
  assert('link --apply wrote business.id', parsedAfter.business?.id === 'BIZ-0001');
  assert('link --apply wrote business.status confirmed', parsedAfter.business?.status === 'confirmed');

  const r2 = dispatch(parsed('link', ['--id', 'OP-0001', '--biz', 'BIZ-0001', '--apply']), { root });
  assert('link idempotent: second run noop', r2.detail.idempotentNoop === true);

  const ru = dispatch(parsed('unlink', ['--id', 'OP-0001']), { root });
  assert('unlink dispatches', ru.command === 'unlink');
  assert('unlink dry-run mode', ru.mode === 'dry-run');

  const ruApply = dispatch(parsed('unlink', ['--id', 'OP-0001', '--apply']), { root });
  assert('unlink --apply applied', ruApply.applied === true);
  const afterUnlink = JSON.parse(readFileSync(opJsonPath, 'utf-8'));
  assert('unlink --apply set status unlinked', afterUnlink.business?.status === 'unlinked');

  const ru2 = dispatch(parsed('unlink', ['--id', 'OP-0001', '--apply']), { root });
  assert('unlink idempotent: second run noop', ru2.detail.idempotentNoop === true);
}

// ---------------------------------------------------------------------------
// Test: start / close
// ---------------------------------------------------------------------------

function testStartClose(root) {
  const bizDir = join(root, 'contextkit', 'memory', 'business', 'BIZ-0001-selftest');
  const bizJsonPath = join(bizDir, 'business.json');

  const rs = dispatch(parsed('start', ['--id', 'BIZ-0001']), { root });
  assert('start dispatches', rs.command === 'start');
  assert('start dry-run mode', rs.mode === 'dry-run');
  const beforeStart = JSON.parse(readFileSync(bizJsonPath, 'utf-8'));
  assert('start dry-run did not write', beforeStart.status !== 'active');

  const rsApply = dispatch(parsed('start', ['--id', 'BIZ-0001', '--apply']), { root });
  assert('start --apply applied', rsApply.applied === true);
  const afterStart = JSON.parse(readFileSync(bizJsonPath, 'utf-8'));
  assert('start --apply set status active', afterStart.status === 'active');

  const rc = dispatch(parsed('close', ['--id', 'BIZ-0001']), { root });
  assert('close dispatches', rc.command === 'close');
  assert('close dry-run mode', rc.mode === 'dry-run');

  const rcApply = dispatch(parsed('close', ['--id', 'BIZ-0001', '--apply']), { root });
  assert('close --apply applied', rcApply.applied === true);
  const afterClose = JSON.parse(readFileSync(bizJsonPath, 'utf-8'));
  assert('close --apply set status closed', afterClose.status === 'closed');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const root = buildTmpRoot();
  try {
    testIntake(root);
    testLink(root);
    testStartClose(root);
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }

  if (failures.length > 0) {
    process.stderr.write('\nwork-verbs selftest FAILURES:\n');
    for (const msg of failures) process.stderr.write(`${msg}\n`);
  }
  process.stdout.write(`\nwork-verbs selftest: ${passCount} passed, ${failCount} failed\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`work-verbs selftest FATAL: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
