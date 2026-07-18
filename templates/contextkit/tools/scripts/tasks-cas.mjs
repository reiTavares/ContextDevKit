/**
 * WF-0059 W5 — CAS-on-revision + atomic write (single-writer concurrency).
 *
 * Guards concurrent writes to an owner's `tasks.json` so parallel
 * sessions/worktrees never silently last-write-wins. Each document carries a
 * `revision` integer (the CAS token). A writer reads `revision = R`, computes its
 * mutation, then COMMITS only if the on-disk revision is still `R`; if another
 * writer already advanced it to `R+1`, the commit is refused (`CasConflict`) and
 * the caller retries on the fresh revision. The physical write is atomic
 * (tmp + rename via `writeFileAtomicSync`, reused from the hooks' safe-io — the
 * same primitive `state-io.mjs` uses), so a reader never sees a torn file.
 *
 * **No orphan event (the decisive concurrency receipt).** `casUpdate`'s `mutate`
 * is PURE — it returns the next document and has NO side effects. The transition
 * event (ADR-0043 journal append) is the CALLER's responsibility, performed
 * exactly once AFTER `casUpdate` reports success. A losing attempt therefore
 * produces no event: the journal never gains an entry for a write that lost the
 * race. `casTransition` wires this safe ordering explicitly.
 *
 * **Cross-process honesty (stated, not overclaimed).** Within one Node process,
 * synchronous read→check→write is serialized by the event loop, so CAS is exact.
 * Across processes (separate sessions/worktrees), the revision re-check
 * immediately before the atomic rename narrows the window to the rename itself;
 * the atomic rename bounds the worst case to a detated stale revision on the next
 * read (a lost racer retries), never a torn file. This is the same pragmatic
 * bound the kit's existing substrate accepts — a true OS advisory lock is out of
 * scope for this reform and would be a separate ADR.
 *
 * Zero-dep beyond `node:*` (via safe-io). Pure core is hot-path safe.
 */
import { readJsonSafe, writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

/** Thrown when a commit's expected revision no longer matches the store. */
export class CasConflict extends Error {
  /** @param {number} expected @param {number} actual */
  constructor(expected, actual) {
    super(`CAS conflict: expected revision ${expected}, store is at ${actual} — a concurrent writer won; retry on the fresh revision`);
    this.name = 'CasConflict';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Pure CAS guard — throws `CasConflict` when `actual !== expected`.
 *
 * @param {number} actual — the store's current revision
 * @param {number} expected — the revision the writer read
 * @returns {void}
 */
export function casGuard(actual, expected) {
  if (actual !== expected) throw new CasConflict(expected, actual);
}

/** Coerce a doc's revision to a non-negative integer (missing/garbage → 0). */
function revisionOf(doc) {
  return doc && Number.isInteger(doc.revision) && doc.revision >= 0 ? doc.revision : 0;
}

/**
 * Read → mutate → compare-and-swap, retrying on `CasConflict` up to `maxRetries`.
 *
 * `io` contract:
 *   - `read()` → `{ doc, revision }` — the current document + its revision
 *   - `commit(nextDoc, expectedRevision)` → newRevision — writes ATOMICALLY only
 *     if the store is still at `expectedRevision`, else THROWS `CasConflict`
 *
 * `mutate(doc, revision)` MUST be pure (no I/O, no event append) and return the
 * next document. `casUpdate` stamps `revision = expectedRevision + 1` on it, so
 * the mutator need not manage the CAS token.
 *
 * @param {{ read: Function, commit: Function }} io
 * @param {(doc: object, revision: number) => object} mutate — pure
 * @param {{ maxRetries?: number }} [opts]
 * @returns {{ doc: object, revision: number, attempts: number }}
 * @throws {CasConflict} when the retry budget is exhausted
 */
export function casUpdate(io, mutate, opts = {}) {
  const maxRetries = Number.isInteger(opts.maxRetries) ? opts.maxRetries : 5;
  let lastConflict = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const { doc, revision } = io.read();
    const next = { ...mutate(doc, revision), revision: revision + 1 };
    try {
      const newRevision = io.commit(next, revision);
      return { doc: next, revision: newRevision, attempts: attempt };
    } catch (error) {
      if (!(error instanceof CasConflict)) throw error;
      lastConflict = error;
    }
  }
  throw lastConflict;
}

/**
 * Composes W5 (CAS) + the W3 transition safely: acquire the tasks.json write slot
 * via CAS, and ONLY on success append the ADR-0043 journal event (authority) and
 * leave the projected status in the doc. A losing attempt never appends — no
 * orphan event. The `applyTransition` planning is injected as `planStatusPatch`
 * so this module stays decoupled from the engine (no import cycle).
 *
 * @param {{ read: Function, commit: Function }} casIo — the tasks.json CAS io
 * @param {{ appendEvent: Function }} journalIo — the sidecar journal writer
 * @param {(doc: object) => { doc: object, event: object }} planStatusPatch —
 *   pure: returns the next doc (with the new status) + the event to journal
 * @param {{ maxRetries?: number }} [opts]
 * @returns {{ doc: object, revision: number, attempts: number, event: object }}
 */
export function casTransition(casIo, journalIo, planStatusPatch, opts = {}) {
  let plannedEvent = null;
  const result = casUpdate(casIo, (doc) => {
    const { doc: nextDoc, event } = planStatusPatch(doc);
    plannedEvent = event; // captured from the WINNING attempt's fresh read
    return nextDoc;
  }, opts);
  // CAS won — now (and only now) append the authoritative event, exactly once.
  journalIo.appendEvent(plannedEvent);
  return { ...result, event: plannedEvent };
}

/**
 * Disk-backed CAS io over a `tasks.json` path. `commit` re-reads the on-disk
 * revision immediately before the atomic write (tmp + rename) so an interleaved
 * writer is detected. A missing file reads as `{ revision: 0 }` (greenfield).
 *
 * @param {string} filePath — absolute path to the owner's tasks.json
 * @returns {{ read: Function, commit: Function }}
 */
export function makeFileCasIo(filePath) {
  return {
    read() {
      const doc = readJsonSafe(filePath, { revision: 0, tasks: [] });
      return { doc, revision: revisionOf(doc) };
    },
    commit(nextDoc, expectedRevision) {
      const current = readJsonSafe(filePath, { revision: 0 });
      casGuard(revisionOf(current), expectedRevision);
      writeFileAtomicSync(filePath, `${JSON.stringify(nextDoc, null, 2)}\n`);
      return revisionOf(nextDoc);
    },
  };
}
