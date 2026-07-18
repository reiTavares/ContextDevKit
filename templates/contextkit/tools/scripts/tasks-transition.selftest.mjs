/**
 * In-process self-test for WF-0059 W3 — the transition engine
 * (`tasks-transition.mjs`), the atomic status↔event pairing.
 *
 * Uses an in-memory `io` fake (journal = array, projection = a variable) so the
 * crash-injection can fire between `appendEvent` and `writeStatus` deterministic-
 * ally — no disk, no live tree.
 *
 * Sections:
 *   [a] planTransition — legal edges by actor; illegal edge / disallowed actor throw
 *   [b] auto — forward-only; auto→blocked and auto→done throw
 *   [c] qa — testing→working requires feedback; testing→done requires evidence
 *   [d] blocked — entering blocked requires a valid structured blocker
 *   [e] done — entering done requires acceptanceMet && evidenceRef
 *   [f] applyTransition — journal-first: event appended before projection; fold==status
 *   [g] CRASH INJECTION — crash in writeStatus leaves the event in the journal
 *       (status re-derivable), NEVER a status without its event; reconcileStatus heals it
 *   [h] full lifecycle — not_started→working→testing→done, journal contiguous
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import { planTransition, applyTransition, reconcileStatus, actorMayTransition } from './tasks-transition.mjs';
import { foldStatus, eventsContiguous } from './tasks-schema.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

/** In-memory io fake. `crashOnWrite` makes writeStatus throw AFTER the event is appended. */
function makeIo({ crashOnWrite = false } = {}) {
  const store = { events: [], status: undefined, writes: 0 };
  return {
    store,
    readEvents: () => store.events,
    appendEvent: (_id, event) => { store.events.push(event); },
    writeStatus: (_id, status) => {
      if (crashOnWrite) throw new Error('injected crash in writeStatus');
      store.status = status; store.writes += 1;
    },
  };
}

// [a] planTransition — legal edges + guards
assert('[a] human not_started→working ok', planTransition({ from: 'not_started', to: 'working', actor: 'human' }).to === 'working');
assert('[a] illegal edge working→done throws', throws(() => planTransition({ from: 'working', to: 'done', actor: 'human' })));
assert('[a] unknown actor throws', throws(() => planTransition({ from: 'not_started', to: 'working', actor: 'robot' })));
assert('[a] actorMayTransition human=legal-table', actorMayTransition('human', 'testing', 'done') && !actorMayTransition('human', 'working', 'done'));

// [b] auto — forward-only
assert('[b] auto not_started→working ok', planTransition({ from: 'not_started', to: 'working', actor: 'auto' }).actor === 'auto');
assert('[b] auto working→testing ok', planTransition({ from: 'working', to: 'testing', actor: 'auto' }).to === 'testing');
assert('[b] auto working→blocked THROWS', throws(() => planTransition({ from: 'working', to: 'blocked', actor: 'auto', blocker: { category: 'dependency_unmet', explanation: 'x', releaseCondition: { kind: 'manual' } } })));
assert('[b] auto blocked→working THROWS', throws(() => planTransition({ from: 'blocked', to: 'working', actor: 'auto' })));
assert('[b] auto testing→done THROWS', throws(() => planTransition({ from: 'testing', to: 'done', actor: 'auto', acceptanceMet: true, evidenceRef: 'x' })));

// [c] qa — testing monopoly
assert('[c] qa testing→working needs feedback (throws w/o)', throws(() => planTransition({ from: 'testing', to: 'working', actor: 'qa' })));
assert('[c] qa testing→working ok w/ feedback', planTransition({ from: 'testing', to: 'working', actor: 'qa', note: 'failing test X' }).note === 'failing test X');
assert('[c] qa testing→done needs evidence (throws w/o)', throws(() => planTransition({ from: 'testing', to: 'done', actor: 'qa', acceptanceMet: true })));
assert('[c] qa testing→done ok w/ evidence', planTransition({ from: 'testing', to: 'done', actor: 'qa', acceptanceMet: true, evidenceRef: 'reports/x.md' }).to === 'done');
assert('[c] qa not_started→working DISALLOWED', throws(() => planTransition({ from: 'not_started', to: 'working', actor: 'qa' })));

// [d] blocked predicate
assert('[d] blocked w/o blocker throws', throws(() => planTransition({ from: 'working', to: 'blocked', actor: 'human' })));
assert('[d] blocked w/ free-text releaseCondition throws', throws(() => planTransition({ from: 'working', to: 'blocked', actor: 'human', blocker: { category: 'dependency_unmet', explanation: 'x', releaseCondition: 'soon' } })));
assert('[d] blocked w/ deterministic predicate ok', planTransition({ from: 'working', to: 'blocked', actor: 'human', blocker: { category: 'dependency_unmet', explanation: 'waits on 341', releaseCondition: { kind: 'task_done', ref: '341' } } }).to === 'blocked');

// [e] done predicate
assert('[e] done w/o evidence throws', throws(() => planTransition({ from: 'testing', to: 'done', actor: 'human', acceptanceMet: true })));
assert('[e] done ok', planTransition({ from: 'testing', to: 'done', actor: 'human', acceptanceMet: true, evidenceRef: 'x' }).to === 'done');

// [f] applyTransition — journal-first ordering
{
  const io = makeIo();
  const result = applyTransition(io, { id: '1', to: 'working', actor: 'auto' });
  assert('[f] event appended', io.store.events.length === 1 && io.store.events[0].to === 'working');
  assert('[f] projection written', io.store.status === 'working');
  assert('[f] fold==status', foldStatus(io.store.events) === io.store.status && result.status === 'working');
}

// [g] CRASH INJECTION — the decisive safety receipt
{
  const io = makeIo({ crashOnWrite: true });
  let crashed = false;
  try { applyTransition(io, { id: '1', to: 'working', actor: 'auto' }); } catch { crashed = true; }
  assert('[g] writeStatus crash surfaced', crashed);
  assert('[g] event IS in the journal despite crash', io.store.events.length === 1 && io.store.events[0].to === 'working');
  assert('[g] projection NOT written (status undefined) — no status without its event', io.store.status === undefined);
  // The forbidden state is "status written WITHOUT an event". Never the inverse.
  assert('[g] fold(events) re-derives the true status', foldStatus(io.store.events) === 'working');
  // reconcileStatus heals the projection from the journal (self-healing recovery).
  const healIo = { readEvents: () => io.store.events, writeStatus: (_id, s) => { io.store.status = s; } };
  assert('[g] reconcileStatus heals projection', reconcileStatus(healIo, '1') === 'working' && io.store.status === 'working');
}

// [h] full lifecycle — journal stays a contiguous legal chain
{
  const io = makeIo();
  applyTransition(io, { id: '9', to: 'working', actor: 'auto' });
  applyTransition(io, { id: '9', to: 'testing', actor: 'auto' });
  applyTransition(io, { id: '9', to: 'done', actor: 'qa', acceptanceMet: true, evidenceRef: 'reports/9.md' });
  assert('[h] journal contiguous legal chain', eventsContiguous(io.store.events));
  assert('[h] folds to done', foldStatus(io.store.events) === 'done' && io.store.status === 'done');
  assert('[h] 3 events == 3 transitions', io.store.events.length === 3);
}

process.stdout.write(`\nWF-0059 W3 transition-engine selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
