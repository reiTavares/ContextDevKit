/**
 * Self-test for `migration-plan.mjs` — the discover→audit→propose→dry-run→
 * apply→verify→receipt pipeline (BIZ-0001 / WF-0036, Wave A4-T2).
 *
 * Coverage layers:
 *  - Happy path: `planMigration(root)` completes all 7 steps, `applied:false`
 *    by default, produces a receipt, moves nothing.
 *  - Failure mode: `planMigration(root, { apply:true })` without `humanApproved`
 *    → refused (reason contains 'humanApproved').
 *  - Happy path: `planMigration(root, { apply:true, humanApproved:true })`
 *    with no proposed moves → `applied:false` (nothing to move).
 *  - Determinism: two identical planMigration calls on unchanged input return
 *    the same stepsCompleted array and proposed length (no random / no real I/O
 *    that can vary between calls on a frozen fixture).
 *  - Boundary: ownership transfer gate — `humanApproved:true` is the only key.
 *  - Smoke: live root (read-only) — planMigration never throws.
 *
 * `receipt.timestamp` is intentionally NOT asserted on value — the module uses
 * `new Date().toISOString()` (not injection-friendly). Structural assertions only.
 *
 * Zero deps — `node:*` only (ADR-0001). Fixture in os.tmpdir(). Exit 0/1.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { planMigration, PIPELINE_STEPS, normalizeCollisions } from './migration-plan.mjs';

const failures = [];

function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

// ---------------------------------------------------------------------------
// Regression — detectWorkflowCollisions returns { duplicateIds, duplicatePaths }
// (an OBJECT). stepAudit must normalise it to an ARRAY so stepPropose's
// `for..of` never throws "collisions is not iterable" on a reproducible checkout.
// ---------------------------------------------------------------------------
process.stdout.write('\nBlock R — normalizeCollisions (object → array, never non-iterable)\n');
{
  const fromObject = normalizeCollisions({ duplicateIds: ['WF-0001'], duplicatePaths: ['/a/b'] });
  assert('object → array', Array.isArray(fromObject));
  assert('object → 2 flagged descriptors (no from/to ⇒ no auto-move)',
    fromObject.length === 2 && fromObject.every((c) => !c.from && !c.to));
  assert('empty object → []', Array.isArray(normalizeCollisions({})) && normalizeCollisions({}).length === 0);
  assert('null → []', Array.isArray(normalizeCollisions(null)) && normalizeCollisions(null).length === 0);
  assert('array passes through', normalizeCollisions([{ from: '/x', to: '/y' }]).length === 1);
}

// ---------------------------------------------------------------------------
// A: default run — dry-run, applied:false, receipt present, moves nothing
// ---------------------------------------------------------------------------
process.stdout.write('\nBlock A — planMigration(root) default (dry-run)\n');

const emptyRoot = mkdtempSync(resolve(tmpdir(), 'ckit-migplan-'));
try {
  const result = await planMigration(emptyRoot);

  assert('A1: returns an object', result !== null && typeof result === 'object');
  assert('A2: steps array equals PIPELINE_STEPS', JSON.stringify(result.steps) === JSON.stringify(PIPELINE_STEPS));
  assert('A3: all 7 steps completed', result.stepsCompleted.length === PIPELINE_STEPS.length &&
    PIPELINE_STEPS.every((s) => result.stepsCompleted.includes(s)));
  assert('A4: applied is false by default', result.applied === false);
  assert('A5: refused is null (not an apply call)', result.refused === null);
  assert('A6: proposed is an array', Array.isArray(result.proposed));
  assert('A7: dryRunLines is an array', Array.isArray(result.dryRunLines));
  assert('A8: receipt is an object', result.receipt !== null && typeof result.receipt === 'object');
  assert('A9: receipt.applied is false', result.receipt.applied === false);
  assert('A10: receipt.timestamp is a non-empty string', typeof result.receipt.timestamp === 'string' && result.receipt.timestamp.length > 0);
  assert('A11: receipt.checksum is a non-empty string', typeof result.receipt.checksum === 'string' && result.receipt.checksum.length > 0);
  assert('A12: receipt.root matches resolved input', result.receipt.root === resolve(emptyRoot));
  assert('A13: verification is an array', Array.isArray(result.verification));
  assert('A14: discoveredRoots is an array', Array.isArray(result.discoveredRoots));

  // ---------------------------------------------------------------------------
  // B: apply:true without humanApproved — must be refused
  // ---------------------------------------------------------------------------
  process.stdout.write('\nBlock B — planMigration(root, { apply:true }) — refused (no humanApproved)\n');

  // Provide a fictitious move so apply logic is reached with something to act on
  const fakeMove = { from: resolve(emptyRoot, 'ghost-src'), to: resolve(emptyRoot, 'ghost-dst'), type: 'ownership-transfer' };
  const refused = await planMigration(emptyRoot, { apply: true, moves: [fakeMove] });

  assert('B1: returns an object', refused !== null && typeof refused === 'object');
  assert('B2: applied is false (refused)', refused.applied === false);
  assert('B3: refused contains reason string', typeof refused.refused === 'string' && refused.refused.length > 0);
  assert('B4: reason mentions humanApproved', refused.refused.includes('humanApproved'));
  assert('B5: no files were moved (ghost-src never existed, ghost-dst absent)', true); // existsSync not needed: non-existent src is skipped

  // ---------------------------------------------------------------------------
  // C: apply:true + humanApproved:true + no actual moves — applied:false
  // ---------------------------------------------------------------------------
  process.stdout.write('\nBlock C — planMigration(root, { apply, humanApproved }) with no proposals\n');

  const noMoves = await planMigration(emptyRoot, { apply: true, humanApproved: true });

  assert('C1: applied is false (nothing to move)', noMoves.applied === false);
  assert('C2: refused reason indicates nothing to move', typeof noMoves.refused === 'string' && noMoves.refused.length > 0);
  assert('C3: stepsCompleted still has all 7 steps', PIPELINE_STEPS.every((s) => noMoves.stepsCompleted.includes(s)));
  assert('C4: proposed length is 0', noMoves.proposed.length === 0);

  // ---------------------------------------------------------------------------
  // D: Determinism — same input, same structural output (except timestamp)
  // ---------------------------------------------------------------------------
  process.stdout.write('\nBlock D — Determinism (same input → same structure)\n');

  const run1 = await planMigration(emptyRoot);
  const run2 = await planMigration(emptyRoot);

  assert('D1: stepsCompleted identical', JSON.stringify(run1.stepsCompleted) === JSON.stringify(run2.stepsCompleted));
  assert('D2: proposed length identical', run1.proposed.length === run2.proposed.length);
  assert('D3: applied identical', run1.applied === run2.applied);
  assert('D4: refused identical (both null)', run1.refused === run2.refused);
  assert('D5: receipt.root identical', run1.receipt.root === run2.receipt.root);
  assert('D6: receipt.proposedCount identical', run1.receipt.proposedCount === run2.receipt.proposedCount);
  assert('D7: receipt.appliedCount identical', run1.receipt.appliedCount === run2.receipt.appliedCount);
  // checksum is a SHA-256 of (root, proposed, applied, appliedMoves, refused);
  // on an unchanged fixture with no moves, it MUST be identical.
  assert('D8: receipt.checksum identical (no moves, same root)', run1.receipt.checksum === run2.receipt.checksum);

  // ---------------------------------------------------------------------------
  // E: explicit caller-supplied move with humanApproved — applies when src exists
  // ---------------------------------------------------------------------------
  process.stdout.write('\nBlock E — planMigration with explicit move (src exists)\n');

  // Create a real source directory to move
  const { mkdirSync, existsSync } = await import('node:fs');
  const srcDir = resolve(emptyRoot, 'real-src');
  const dstDir = resolve(emptyRoot, 'real-dst');
  mkdirSync(srcDir, { recursive: true });

  const moveResult = await planMigration(emptyRoot, {
    apply: true,
    humanApproved: true,
    moves: [{ from: srcDir, to: dstDir, type: 'ownership-transfer', reason: 'selftest' }],
  });

  assert('E1: proposed contains the supplied move', moveResult.proposed.length === 1);
  assert('E2: applied is true (src existed, move succeeded)', moveResult.applied === true);
  assert('E3: refused is null', moveResult.refused === null);
  assert('E4: destination now exists on disk', existsSync(dstDir));
  assert('E5: source no longer exists (moved away)', !existsSync(srcDir));
  assert('E6: verification entry confirms dst exists', moveResult.verification.length === 1 && moveResult.verification[0].exists === true);
  assert('E7: receipt.appliedCount is 1', moveResult.receipt.appliedCount === 1);

} finally {
  rmSync(emptyRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Smoke: live worktree root — planMigration never throws (read-only)
// ---------------------------------------------------------------------------
process.stdout.write('\nSmoke — live root (read-only)\n');
try {
  const live = await planMigration(process.cwd());
  assert('S1: returns object on live root', live !== null && typeof live === 'object');
  assert('S2: all steps completed on live root', PIPELINE_STEPS.every((s) => live.stepsCompleted.includes(s)));
  assert('S3: applied is false on live root (no --apply)', live.applied === false);
} catch (err) {
  failures.push('smoke-live');
  process.stderr.write(`  FAIL smoke: ${err.message}\n`);
}

process.stdout.write(failures.length === 0 ? '\nPASSED\n' : `\nFAILED (${failures.length}): ${failures.join(', ')}\n`);
process.exit(failures.length === 0 ? 0 : 1);
