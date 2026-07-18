/**
 * WF-0059 W3 — the ONE transition engine (atomic status↔event pairing).
 *
 * The single writer of a task's status. Every status change flows through here,
 * appending a reversible ADR-0043 event to the per-task journal (the authority,
 * retained in `state/<id>/`) paired with the `tasks.json` status projection. The
 * invariant `fold(events)==status` is preserved by **JOURNAL-FIRST ordering**:
 * the event is appended BEFORE the projection is written, so a crash between the
 * two can never leave a status WITHOUT its reversible event (the forbidden
 * state). A crash AFTER the event but before the projection is self-healing —
 * re-derive `status = fold(events)` (no lost history). This is the decisive
 * safety receipt the 2026-06-26 deliberation mandated.
 *
 * Split in two so the pairing is testable with crash injection:
 *   - `planTransition(...)`   — PURE. Validates the legal table + actor rules +
 *     the blocked/done predicates; returns the event to append, or THROWS.
 *   - `applyTransition(io, ...)` — orchestrates the journal-first write via an
 *     INJECTED `io` ({ readEvents, appendEvent, writeStatus }); production wires
 *     `io` to `runtime/state/state-io.mjs` (`appendEvent` is the ONLY journal
 *     writer). W5 layers CAS-on-revision + atomic write over this same io.
 *
 * Actor rules (SPEC §D3, deliberation CONSENSUS):
 *   - `auto`  — forward-only: not_started→working, working→testing. NEVER enters
 *               or exits `blocked`; never reaches `done`.
 *   - `qa`    — owns the testing edges: testing→working (qa-reject, MUST carry
 *               feedback) and testing→done (qa-approve, requires evidence).
 *   - `human` — the fenced escape hatch: any edge LEGAL in the table (it cannot
 *               re-open the machine with an illegal jump).
 *
 * Zero-dep, `node:*`-free — safe on the hot path.
 */
import { isLegalTransition, foldStatus, isValidBlocker } from './tasks-schema.mjs';

/** Actors permitted to drive a transition (mirrors state-io's set, minus `evict`). */
export const TRANSITION_ACTORS = Object.freeze(['human', 'auto', 'qa']);

/** Edges `auto` may drive (forward-only; never blocked, never done). */
const AUTO_EDGES = Object.freeze([['not_started', 'working'], ['working', 'testing']]);
/** Edges `qa` may drive (the testing monopoly). */
const QA_EDGES = Object.freeze([['testing', 'working'], ['testing', 'done']]);

/** True when `edges` contains the `from→to` pair. */
function edgeIn(edges, from, to) {
  return edges.some(([f, t]) => f === from && t === to);
}

/**
 * True when `actor` is permitted to drive `from→to`. `human` may drive any edge
 * that is legal in the table (the fenced escape hatch); `auto`/`qa` are
 * restricted to their edge sets.
 *
 * @param {'human'|'auto'|'qa'} actor
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function actorMayTransition(actor, from, to) {
  if (actor === 'human') return isLegalTransition(from, to);
  if (actor === 'auto') return edgeIn(AUTO_EDGES, from, to);
  if (actor === 'qa') return edgeIn(QA_EDGES, from, to);
  return false;
}

/**
 * Plans a transition: validates and returns the event to append, or throws a
 * descriptive error. PURE — no I/O.
 *
 * @param {object} args
 * @param {string} args.from — current (folded) status
 * @param {string} args.to — target status
 * @param {'human'|'auto'|'qa'} args.actor
 * @param {object} [args.blocker] — required when `to==='blocked'`
 * @param {boolean} [args.acceptanceMet] — required true when `to==='done'`
 * @param {*} [args.evidenceRef] — required non-null when `to==='done'`
 * @param {string} [args.note] — feedback/context; REQUIRED for a qa-reject
 * @returns {{ from: string, to: string, actor: string, note?: string }}
 * @throws {Error} on illegal edge, disallowed actor, or unmet predicate
 */
export function planTransition({ from, to, actor, blocker, acceptanceMet, evidenceRef, note }) {
  if (!TRANSITION_ACTORS.includes(actor)) {
    throw new Error(`transition: unknown actor "${actor}" — one of ${TRANSITION_ACTORS.join(', ')}`);
  }
  if (!isLegalTransition(from, to)) {
    throw new Error(`transition: illegal edge ${from} → ${to} (not in the closed lifecycle table)`);
  }
  if (!actorMayTransition(actor, from, to)) {
    throw new Error(`transition: actor "${actor}" may not drive ${from} → ${to}`);
  }
  if (to === 'blocked' && !isValidBlocker(blocker)) {
    throw new Error('transition: entering "blocked" requires a structured blocker { category, explanation, releaseCondition }');
  }
  if (to === 'done' && !(acceptanceMet === true && evidenceRef != null)) {
    throw new Error('transition: entering "done" requires acceptanceMet===true && evidenceRef!=null');
  }
  // qa-reject monopoly: testing→working by qa MUST carry feedback (SPEC §D3).
  if (actor === 'qa' && from === 'testing' && to === 'working' && !(typeof note === 'string' && note.trim() !== '')) {
    throw new Error('transition: qa-reject (testing→working) must carry feedback (note)');
  }
  const event = { from, to, actor };
  if (note) event.note = String(note).slice(0, 300);
  return event;
}

/**
 * Applies a transition JOURNAL-FIRST via the injected `io`. Reads the journal,
 * folds the current status, plans+validates the transition, then appends the
 * event (the authority) BEFORE writing the status projection. A crash in
 * `writeStatus` leaves the event in the journal (status re-derivable), never a
 * status without its event.
 *
 * `io` contract:
 *   - `readEvents(id)  -> Array`   the current journal (may be empty)
 *   - `appendEvent(id, event)`     append one event (the ONLY journal writer)
 *   - `writeStatus(id, status)`    write the `tasks.json` projection
 *
 * @param {{ readEvents: Function, appendEvent: Function, writeStatus: Function }} io
 * @param {object} args — { id, to, actor, blocker?, acceptanceMet?, evidenceRef?, note? }
 * @returns {{ status: string, event: object, from: string }}
 */
export function applyTransition(io, args) {
  const { id } = args;
  const events = io.readEvents(id) || [];
  const from = foldStatus(events);
  const event = planTransition({ ...args, from });
  io.appendEvent(id, event);      // authority first
  io.writeStatus(id, event.to);   // projection second (crash here is self-healing)
  return { status: event.to, event, from };
}

/**
 * Re-derives the status projection from the journal — the recovery primitive
 * after a crash between `appendEvent` and `writeStatus`. Idempotent: running it
 * when already consistent is a no-op write of the same value.
 *
 * @param {{ readEvents: Function, writeStatus: Function }} io
 * @param {string} id
 * @returns {string} the folded status written back
 */
export function reconcileStatus(io, id) {
  const status = foldStatus(io.readEvents(id) || []);
  io.writeStatus(id, status);
  return status;
}
