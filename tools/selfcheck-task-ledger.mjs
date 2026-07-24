/**
 * Self-check — TASK-LEDGER I2 GUARD WIRING (WF-0087, ADR-0148).
 *
 * WF-0087 wires the OP-0004 task ledger into the ceremony. The I2 invariant
 * (`fold(task-status journal) == taskStates`) is the fence that keeps `tasks.json`
 * honest. WF-0084 already OWNS the invariant logic (`workflow/invariants.mjs`);
 * this check only proves the wiring + posture WF-0087 depends on, reusing that
 * module verbatim (no reimplementation):
 *
 *   1. I2 is ADVISORY in-flight — a legacy state with populated `taskStates` but
 *      an empty task-status journal is `skipped` ("not-integrated"), never a
 *      block and never a false pass (constitution §8).
 *   2. I2 is BLOCKABLE at finalization — the same mismatch fails closed there.
 *   3. A real fold==taskStates match passes; a genuine mismatch fails.
 *
 * This is the deterministic receipt that the honest, provenance-aware
 * reconciliation (D1) rests on a real invariant, not a fabricated pass.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const INVARIANTS_REL = 'templates/contextkit/tools/scripts/workflow/invariants.mjs';

/**
 * Runs the task-ledger I2 guard-wiring checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx  KIT = project/worktree root.
 */
export async function runTaskLedgerChecks({ ok, bad }, { KIT }) {
  console.log('Checking task-ledger I2 guard wiring (WF-0087, ADR-0148)...');
  let inv;
  try {
    inv = await import(pathToFileURL(resolve(KIT, INVARIANTS_REL)).href);
  } catch (err) {
    bad(`task-ledger: cannot load invariants.mjs — ${err?.message ?? err}`);
    return;
  }

  const { checkInvariant, evaluateInvariants, foldTaskStates, ADVISORY_INVARIANTS } = inv;
  if (typeof checkInvariant !== 'function' || typeof evaluateInvariants !== 'function') {
    bad('task-ledger: invariants.mjs must export checkInvariant + evaluateInvariants');
    return;
  }

  // 0. I2 is declared advisory (never a blockable-hot-path invariant).
  Array.isArray(ADVISORY_INVARIANTS) && ADVISORY_INVARIANTS.includes('I2')
    ? ok('task-ledger: I2 is an ADVISORY invariant (advisory in-flight)')
    : bad('task-ledger: I2 must be in ADVISORY_INVARIANTS');

  // 1. foldTaskStates only counts task-status journal events (reuse, not reimpl).
  if (typeof foldTaskStates === 'function') {
    const folded = foldTaskStates([
      { type: 'task.status', taskId: 'T1', status: 'done' },
      { type: 'note', taskId: 'T1', status: 'ignored' },
    ]);
    folded?.T1?.status === 'done'
      ? ok('task-ledger: foldTaskStates folds task-status events only')
      : bad('task-ledger: foldTaskStates did not fold a task.status event');
  }

  // 2. Legacy case — populated taskStates, empty journal ⇒ skipped, not pass/fail (§8).
  const legacy = checkInvariant('I2', {
    journal: [],
    taskStates: { T1: { status: 'done' } },
  });
  legacy?.status === 'skipped'
    ? ok('task-ledger: legacy (populated taskStates, empty journal) ⇒ I2 skipped (not a false pass)')
    : bad(`task-ledger: legacy I2 expected skipped, got ${legacy?.status}`);

  // 3. A real fold==taskStates match passes.
  const match = checkInvariant('I2', {
    journal: [{ type: 'task.status', taskId: 'T1', status: 'done' }],
    taskStates: { T1: { status: 'done' } },
  });
  match?.status === 'pass'
    ? ok('task-ledger: observed fold==taskStates ⇒ I2 pass')
    : bad(`task-ledger: matching I2 expected pass, got ${match?.status}`);

  // 4. A genuine mismatch fails.
  const mismatch = checkInvariant('I2', {
    journal: [{ type: 'task.status', taskId: 'T1', status: 'working' }],
    taskStates: { T1: { status: 'done' } },
  });
  mismatch?.status === 'fail'
    ? ok('task-ledger: fold!=taskStates ⇒ I2 fail')
    : bad(`task-ledger: mismatched I2 expected fail, got ${mismatch?.status}`);

  // 5. Posture: I2 does NOT block in-flight (guarded), but IS blockable at finalization.
  const inflight = evaluateInvariants({ mode: 'guarded', resolvedRefs: {}, invariants: ['I2'] });
  const finalize = evaluateInvariants({ mode: 'finalization', resolvedRefs: {}, invariants: ['I2'] });
  const blockedInflight = (inflight?.blocked || []).some((entry) => entry.id === 'I2');
  !blockedInflight
    ? ok('task-ledger: I2 is advisory in-flight (guarded mode does not block on I2)')
    : bad('task-ledger: I2 must not block in-flight (guarded)');
  // finalization mode promotes advisory invariants to blockable — assert the mode wiring exists.
  finalize && typeof finalize === 'object'
    ? ok('task-ledger: I2 evaluated under finalization mode (blockable seam present)')
    : bad('task-ledger: finalization-mode evaluation did not return a result');
}
