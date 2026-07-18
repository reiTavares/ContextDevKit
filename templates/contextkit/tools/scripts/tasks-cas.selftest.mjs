/**
 * In-process self-test for WF-0059 W5 — CAS-on-revision concurrency
 * (`tasks-cas.mjs`). Uses an in-memory store + an interleaving hook so a
 * concurrent writer can be injected deterministically between a writer's read
 * and its commit — no disk, no real threads.
 *
 * Sections:
 *   [a] casGuard — matching revision passes; mismatch throws CasConflict
 *   [b] casUpdate happy path — commits, bumps revision to R+1, one attempt
 *   [c] CONCURRENT WRITE — an injected writer advances the revision between
 *       read and commit; the first attempt conflicts, the retry wins on R+1
 *   [d] NO ORPHAN EVENT — casTransition appends the journal event exactly ONCE,
 *       only after CAS wins; a conflicting first attempt appends nothing
 *   [e] retry budget — exhausting maxRetries throws CasConflict
 *   [f] makeFileCasIo — greenfield read is revision 0 (defensive)
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import { casGuard, casUpdate, casTransition, CasConflict, makeFileCasIo } from './tasks-cas.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}
function throws(fn, Type) {
  try { fn(); return false; } catch (e) { return Type ? e instanceof Type : true; }
}

/**
 * In-memory CAS store. `onRead(count)` optionally mutates the store to simulate
 * a concurrent writer winning the race between this writer's read and commit.
 */
function makeMemStore({ onRead } = {}) {
  const store = { doc: { revision: 0, tasks: [] }, commits: 0 };
  let reads = 0;
  return {
    store,
    io: {
      read() {
        reads += 1;
        // Capture the snapshot BEFORE the racer fires, so the injected concurrent
        // writer models a commit landing strictly BETWEEN this read and our commit.
        const snapshot = { doc: store.doc, revision: store.doc.revision };
        if (onRead) onRead(reads, store);
        return snapshot;
      },
      commit(nextDoc, expected) {
        if (store.doc.revision !== expected) throw new CasConflict(expected, store.doc.revision);
        store.doc = nextDoc; store.commits += 1;
        return nextDoc.revision;
      },
    },
  };
}

// [a] casGuard
assert('[a] matching revision passes', (() => { casGuard(3, 3); return true; })());
assert('[a] mismatch throws CasConflict', throws(() => casGuard(4, 3), CasConflict));

// [b] casUpdate happy path
{
  const { store, io } = makeMemStore();
  const result = casUpdate(io, (doc) => ({ ...doc, tasks: [...doc.tasks, 'a'] }));
  assert('[b] committed once, revision→1', result.revision === 1 && store.commits === 1 && result.attempts === 1);
  assert('[b] mutation applied', store.doc.tasks.length === 1);
}

// [c] CONCURRENT WRITE — injected racer advances revision between read #1 and its commit
{
  // On the FIRST read, simulate another writer committing R0→R1 before our commit.
  const { store, io } = makeMemStore({
    onRead(count, s) {
      if (count === 1) { s.doc = { ...s.doc, revision: 1, tasks: ['racer'] }; }
    },
  });
  const result = casUpdate(io, (doc) => ({ ...doc, tasks: [...doc.tasks, 'mine'] }));
  // First attempt read R0, but store jumped to R1 → conflict → retry reads R1 → commits R2.
  assert('[c] retried after conflict (attempts≥2)', result.attempts >= 2, `attempts=${result.attempts}`);
  assert('[c] winner committed on fresh revision', store.doc.revision === result.revision && store.commits === 1);
  assert('[c] racer write preserved (no lost update)', store.doc.tasks.includes('racer') && store.doc.tasks.includes('mine'));
}

// [d] NO ORPHAN EVENT — the decisive receipt
{
  const events = [];
  const journalIo = { appendEvent: (e) => events.push(e) };
  // Racer wins the first read so the first CAS attempt conflicts.
  const { io } = makeMemStore({
    onRead(count, s) { if (count === 1) s.doc = { ...s.doc, revision: 1 }; },
  });
  const planStatusPatch = (doc) => ({ doc: { ...doc, status: 'working' }, event: { from: 'not_started', to: 'working', actor: 'auto' } });
  const result = casTransition(io, journalIo, planStatusPatch);
  assert('[d] transition eventually committed', result.event.to === 'working' && result.attempts >= 2);
  assert('[d] EXACTLY ONE event appended despite the conflict/retry', events.length === 1, `events=${events.length}`);
  assert('[d] no orphan event from the losing attempt', events[0].to === 'working');
}
// [d2] a plain conflict-free transition still appends exactly one event
{
  const events = [];
  const { io } = makeMemStore();
  const result = casTransition(io, { appendEvent: (e) => events.push(e) },
    (doc) => ({ doc: { ...doc, status: 'working' }, event: { from: 'not_started', to: 'working', actor: 'human' } }));
  assert('[d2] happy path: one event, one commit', events.length === 1 && result.attempts === 1);
}

// [e] retry budget exhausted → CasConflict
{
  // Every read shows a moved revision → every commit conflicts → budget exhausts.
  let rev = 0;
  const io = {
    read() { return { doc: { revision: rev, tasks: [] }, revision: rev }; },
    commit(_next, expected) { rev += 1; throw new CasConflict(expected, rev); },
  };
  assert('[e] exhausted retries throw CasConflict', throws(() => casUpdate(io, (d) => d, { maxRetries: 2 }), CasConflict));
}

// [f] makeFileCasIo greenfield (no disk write — just the defensive read path)
{
  const io = makeFileCasIo('D:/nonexistent/does-not-exist-tasks.json');
  const { revision } = io.read();
  assert('[f] greenfield read → revision 0', revision === 0);
}

process.stdout.write(`\nWF-0059 W5 CAS concurrency selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
