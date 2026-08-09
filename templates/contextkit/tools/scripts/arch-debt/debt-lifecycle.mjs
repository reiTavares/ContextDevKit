/**
 * Architecture-debt gate — the 11-state debt LIFECYCLE state machine (WF-0057,
 * ADR-0122, decisions.md fork #5 / spec §22).
 *
 * WHY this file is split from `debt-registry.mjs`: the registry is an I/O ADAPTER
 * (read/merge/render the findings store); the lifecycle is a PURE state machine
 * (legal transitions). Two distinct reasons to change → two modules (constitution
 * §1/§2 responsibility seam). The adapter imports `DebtState` + `transition`.
 *
 * DATA-OWNERSHIP BOUNDARY (fork #5): the lifecycle STATE is canonical in the
 * pipeline/`state.json` substrate, projected onto each finding as `lifecycleState`.
 * This module owns only the *legality* of a state change — it never persists
 * anything and never reads markdown. `tech-debt-board.md` is a projection.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 * Fail-fast: `transition` THROWS on an illegal move (constitution §8 — validators
 * throw, never silently downgrade to a bogus state).
 */

/**
 * The 11 canonical debt lifecycle states (spec §22). Closed set; a value outside
 * it is a contract violation, not a soft warning.
 * @type {Readonly<Record<string,string>>}
 */
export const DebtState = Object.freeze({
  CANDIDATE: 'CANDIDATE',
  CONFIRMED: 'CONFIRMED',
  ACCEPTED: 'ACCEPTED',
  CONTAINED: 'CONTAINED',
  SCHEDULED: 'SCHEDULED',
  IN_REMEDIATION: 'IN_REMEDIATION',
  PAID: 'PAID',
  TRANSFERRED: 'TRANSFERRED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
  REOPENED: 'REOPENED',
});

/** The set of all legal state values — used to reject unknown states fail-fast. */
export const DEBT_STATES = Object.freeze(new Set(Object.values(DebtState)));

/**
 * The legal transition graph (spec §22). A debt enters as CANDIDATE, is CONFIRMED
 * or REJECTED, may be governed (ACCEPTED/CONTAINED/SCHEDULED), enters
 * IN_REMEDIATION, and ends PAID — or is TRANSFERRED to another owner, EXPIRES
 * (intentional-debt expiry), and a regression REOPENs any closed state. Each key
 * lists the states reachable from it; an empty set is impossible (every state can
 * progress or reopen) so there is no dead-end trap.
 * @type {Readonly<Record<string, ReadonlySet<string>>>}
 */
export const LEGAL_TRANSITIONS = Object.freeze({
  CANDIDATE: new Set(['CONFIRMED', 'REJECTED']),
  CONFIRMED: new Set(['ACCEPTED', 'CONTAINED', 'SCHEDULED', 'IN_REMEDIATION', 'TRANSFERRED', 'REJECTED']),
  ACCEPTED: new Set(['SCHEDULED', 'CONTAINED', 'IN_REMEDIATION', 'TRANSFERRED', 'EXPIRED']),
  CONTAINED: new Set(['SCHEDULED', 'ACCEPTED', 'IN_REMEDIATION', 'TRANSFERRED', 'EXPIRED']),
  SCHEDULED: new Set(['IN_REMEDIATION', 'CONTAINED', 'ACCEPTED', 'TRANSFERRED']),
  IN_REMEDIATION: new Set(['PAID', 'SCHEDULED', 'CONTAINED', 'TRANSFERRED']),
  PAID: new Set(['REOPENED']),
  TRANSFERRED: new Set(['REOPENED', 'PAID']),
  EXPIRED: new Set(['REOPENED']),
  REJECTED: new Set(['REOPENED']),
  REOPENED: new Set(['CONFIRMED', 'ACCEPTED', 'REJECTED']),
});

/** True iff `from → to` is a legal transition (defensive: unknown state → false). */
export function isLegalTransition(from, to) {
  if (!DEBT_STATES.has(from) || !DEBT_STATES.has(to)) return false;
  return LEGAL_TRANSITIONS[from].has(to);
}

/**
 * The state a finding currently carries. A finding the registry has never seen
 * has no `lifecycleState`; it is treated as the entry state CANDIDATE.
 * @param {Object} finding  a Finding (may lack `lifecycleState`).
 * @returns {string} a DebtState value.
 */
export function currentState(finding) {
  const state = finding && finding.lifecycleState;
  return DEBT_STATES.has(state) ? state : DebtState.CANDIDATE;
}

/**
 * Validate a lifecycle transition and return the finding with its new state
 * stamped (immutably — a fresh object). Fail-fast: THROWS a `RangeError` on an
 * illegal or unknown transition (constitution §8). The canonical state lives in
 * the pipeline substrate; this returns the projection to persist there.
 *
 * @param {Object} finding  the Finding whose lifecycle is advancing.
 * @param {string} toState  the target DebtState.
 * @returns {Object} a new Finding object with `lifecycleState: toState`.
 * @throws {RangeError} when `toState` is unknown or the transition is illegal.
 */
export function transition(finding, toState) {
  if (!finding || typeof finding !== 'object') {
    throw new TypeError('transition: expected a finding object');
  }
  if (!DEBT_STATES.has(toState)) {
    throw new RangeError(`transition: "${toState}" is not a legal DebtState`);
  }
  const from = currentState(finding);
  if (from === toState) return { ...finding, lifecycleState: toState };
  if (!isLegalTransition(from, toState)) {
    throw new RangeError(
      `transition: illegal lifecycle move ${from} → ${toState}` +
      ` (legal from ${from}: [${[...LEGAL_TRANSITIONS[from]].join(', ')}])`,
    );
  }
  return { ...finding, lifecycleState: toState };
}
