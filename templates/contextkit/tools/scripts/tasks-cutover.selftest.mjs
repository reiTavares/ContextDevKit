/**
 * In-process self-test for WF-0059 W8 — authority cutover + old-writer fence
 * (`tasks-cutover.mjs`), migration Phase 2. In-memory marker io — no disk.
 *
 * Sections:
 *   [a] checkParity — matching derived↔oracle passes; mismatch/absent enumerated
 *   [b] assertParity — throws on mismatch, returns true on match
 *   [c] canCutover — BOTH gates required (parity + exercised rollback)
 *   [d] cutover — refuses unless both gates hold; writes Phase 2 marker; idempotent
 *   [e] fenceOldWriter — inert in Phase 1; THROWS OldWriterFenced in Phase 2
 *   [f] rollbackCutover — resets marker to Phase 1 (un-fences old board)
 *   [g] readCutoverState — missing marker ⇒ safe Phase 1 default
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import {
  checkParity, assertParity, canCutover, cutover, fenceOldWriter, rollbackCutover,
  readCutoverState, OldWriterFenced,
} from './tasks-cutover.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}
function throwsType(fn, Type) {
  try { fn(); return false; } catch (e) { return Type ? e instanceof Type : true; }
}

/** In-memory marker store. */
function makeIo(initial = null) {
  const box = { marker: initial };
  return { box, readMarker: () => box.marker, writeMarker: (m) => { box.marker = m; } };
}

const oracle = { cards: [{ id: '1', status: 'working' }, { id: '2', status: 'done' }] };
const derivedMatch = { rows: [{ id: '1', status: 'working' }, { id: '2', status: 'done' }] };
const derivedBad = { rows: [{ id: '1', status: 'testing' }, { id: '2', status: 'done' }] };
const derivedMissing = { rows: [{ id: '1', status: 'working' }] };

// [a] checkParity
assert('[a] matching parity ok', checkParity(derivedMatch, oracle).ok);
assert('[a] status mismatch flagged', !checkParity(derivedBad, oracle).ok && checkParity(derivedBad, oracle).mismatches.some((m) => m.includes('1')));
assert('[a] absent-from-derived flagged', !checkParity(derivedMissing, oracle).ok);

// [b] assertParity
assert('[b] assertParity returns true on match', assertParity(derivedMatch, oracle) === true);
assert('[b] assertParity throws on mismatch', throwsType(() => assertParity(derivedBad, oracle)));

// [c] canCutover — all three gates (parity + rollback + observed provenance)
assert('[c] all three gates → ok', canCutover({ parityOk: true, rollbackExercised: true, provenanceObserved: true }).ok);
assert('[c] missing parity → refused', !canCutover({ parityOk: false, rollbackExercised: true, provenanceObserved: true }).ok);
assert('[c] missing rollback → refused', !canCutover({ parityOk: true, rollbackExercised: false, provenanceObserved: true }).ok);
assert('[c] none → three reasons', canCutover({}).reasons.length === 3);

// [c2] inferred-cannot-flip (D2.2, ADR-0148) — a corpus reconciled only by
// inference (observed provenance NOT proven) never authorizes a cutover, even
// with parity + rollback satisfied. This is the independent fail-closed guard
// against laundering an inferred reconciliation into cutover authority.
assert('[c2] inferred provenance blocks cutover despite parity + rollback',
  !canCutover({ parityOk: true, rollbackExercised: true, provenanceObserved: false }).ok);
assert('[c2] absent provenance is default-refuse (not-proven)',
  !canCutover({ parityOk: true, rollbackExercised: true }).ok);
assert('[c2] inferred refusal names the observed-journal reason',
  canCutover({ parityOk: true, rollbackExercised: true, provenanceObserved: false })
    .reasons.some((reason) => reason.includes('observed-journal parity')));

// [d] cutover
{
  const io = makeIo();
  assert('[d] cutover refused without gates', throwsType(() => cutover(io, { parityOk: false, rollbackExercised: false, provenanceObserved: false }, 'T0')));
  assert('[d] marker unchanged after refusal', io.box.marker === null);
  const result = cutover(io, { parityOk: true, rollbackExercised: true, provenanceObserved: true }, 'T1');
  assert('[d] cutover writes Phase 2', result.phase === 'phase2' && io.box.marker.phase === 'phase2' && io.box.marker.at === 'T1');
  // idempotent
  const again = cutover(io, { parityOk: true, rollbackExercised: true, provenanceObserved: true }, 'T1');
  assert('[d] idempotent re-cutover', again.phase === 'phase2');
}

// [e] fenceOldWriter
{
  const phase1 = makeIo({ phase: 'phase1' });
  let inert = true;
  try { fenceOldWriter(phase1, 'move', '342'); } catch { inert = false; }
  assert('[e] fence inert in Phase 1', inert);

  const phase2 = makeIo({ phase: 'phase2', parityOk: true, rollbackExercised: true });
  assert('[e] fence THROWS OldWriterFenced in Phase 2', throwsType(() => fenceOldWriter(phase2, 'move', '342'), OldWriterFenced));
}

// [f] rollbackCutover
{
  const io = makeIo({ phase: 'phase2', parityOk: true, rollbackExercised: true });
  rollbackCutover(io, 'T2');
  assert('[f] rollback resets to Phase 1', io.box.marker.phase === 'phase1');
  let inert = true;
  try { fenceOldWriter(io, 'move', 'x'); } catch { inert = false; }
  assert('[f] old writer un-fenced after rollback', inert);
}

// [g] readCutoverState default
assert('[g] missing marker ⇒ safe Phase 1 default', readCutoverState(makeIo(null)).phase === 'phase1');
assert('[g] garbage marker ⇒ Phase 1 (defensive)', readCutoverState(makeIo({ phase: 'nonsense' })).phase === 'phase1');

process.stdout.write(`\nWF-0059 W8 cutover+fence selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
