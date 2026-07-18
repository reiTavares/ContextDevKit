/**
 * WF-0059 W2 — per-owner `tasks.json` schema (the contextual-ownership surface).
 *
 * This is the SHAPE + the pure lifecycle primitives for the reform's canonical
 * authoring surface (SPEC §D1–D5, ratified in the 2026-06-26 deliberation). A
 * task lives inside exactly one owner's `tasks.json`; status authority stays in
 * the ADR-0043 event journal (`state/<id>/`), and `tasks.json.status` is a
 * re-derivable projection of `fold(events)` — NOT a second source of truth.
 *
 * This module is pure DATA + tiny pure FUNCTIONS (no I/O). The transition ENGINE
 * that appends journal events atomically paired with the status write is W3; it
 * imports these constants + `foldStatus`/`isLegalTransition` so the table is
 * single-sourced between the engine and the validators (`tasks-validate.mjs`).
 *
 * Zero-dep, `node:*`-free (no imports needed). Safe on the hot path.
 */

/** The closed 5-state lifecycle (deliberation CONSENSUS; SPEC §D3). */
export const TASK_STATES = Object.freeze(['not_started', 'working', 'blocked', 'testing', 'done']);

/** Owner kinds — a task belongs to exactly one structural owner (SPEC §D1). */
export const OWNER_KINDS = Object.freeze(['WF', 'OP', 'BIZ']);

/** Owner-level execution policy (SPEC §D5) — lives on the owner, not the task. */
export const EXECUTION_MODES = Object.freeze(['workflow', 'direct', 'batch']);

/** Closed blocker taxonomy (SPEC §D4) — `blocker.category` must be one of these. */
export const BLOCKER_CATEGORIES = Object.freeze([
  'dependency_unmet', 'approval_required', 'missing_input', 'decision_required',
  'contract_unavailable', 'environment_failure', 'test_infrastructure_failure',
  'resource_unavailable', 'conflicting_change', 'security_or_compliance',
  'governance_required', 'external_condition', 'technical_failure',
]);

/**
 * Deterministic release-condition predicate kinds (SPEC §D4). `manual` still
 * resolves to a recorded verdict — never free text — so auto-unblock is decidable.
 */
export const RELEASE_CONDITION_KINDS = Object.freeze([
  'task_done', 'gate_approved', 'adr_accepted', 'file_present', 'manual',
]);

/**
 * The closed legal transition table (SPEC §D3): `from → allowed to[]`.
 * `blocked` enters from `working` ONLY and exits to `working` ONLY. The
 * `testing→working` edge is the qa-reject monopoly; `testing→done` is qa-approve.
 * `done` is terminal. The ACTOR rules (auto never enters/exits blocked; qa owns
 * the testing edges) are enforced by the W3 engine, not this data table.
 */
export const LEGAL_TRANSITIONS = Object.freeze({
  not_started: Object.freeze(['working']),
  working: Object.freeze(['testing', 'blocked']),
  blocked: Object.freeze(['working']),
  testing: Object.freeze(['working', 'done']),
  done: Object.freeze([]),
});

/** The status a task starts in before any transition event exists. */
export const INITIAL_STATE = 'not_started';

/**
 * Derives a task's status from its ADR-0043 event journal — the current status
 * is the `to` of the last event (`fold`). An empty/absent journal ⇒ the initial
 * state. This is the primitive behind the `fold(events)==status` fence.
 *
 * @param {Array<{from?: string, to?: string}>} events — the per-task journal
 * @param {string} [initial] — status before any event (default `not_started`)
 * @returns {string} the folded (current) status
 */
export function foldStatus(events, initial = INITIAL_STATE) {
  if (!Array.isArray(events) || events.length === 0) return initial;
  const last = events[events.length - 1];
  return last && typeof last.to === 'string' && last.to !== '' ? last.to : initial;
}

/**
 * True when `from → to` is a legal edge in the closed lifecycle table.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function isLegalTransition(from, to) {
  return Array.isArray(LEGAL_TRANSITIONS[from]) && LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * True when the event chain is contiguous (each event's `from` equals the prior
 * event's `to`, starting at `initial`) AND every edge is legal. A broken chain
 * means the journal cannot be trusted to fold to the recorded status.
 *
 * @param {Array<{from?: string, to?: string}>} events
 * @param {string} [initial]
 * @returns {boolean}
 */
export function eventsContiguous(events, initial = INITIAL_STATE) {
  if (!Array.isArray(events)) return false;
  let cursor = initial;
  for (const event of events) {
    if (!event || event.from !== cursor) return false;
    if (!isLegalTransition(event.from, event.to)) return false;
    cursor = event.to;
  }
  return true;
}
