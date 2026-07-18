/**
 * WF-0059 W8 — authority cutover + old-writer fence (migration Phase 2).
 *
 * The subtractive half of the additive-then-subtractive migration (SPEC §D9).
 * Phase 1 (W7) authored the per-owner `tasks.json` alongside the frozen flat
 * board (the parity oracle). Phase 2 flips authority to the per-owner surface and
 * FENCES the old flat-board writer — but ONLY after two gates the deliberation
 * made non-negotiable:
 *
 *   1. **Parity proven.** The derived board (W4) must match the frozen Stage-0
 *      oracle (W1) — `assertParity` refuses cutover otherwise.
 *   2. **Rollback exercised.** A real rollback drill (W7) must have run and
 *      restored byte-identical — `canCutover` requires the recorded receipt.
 *
 * After `cutover`, `fenceOldWriter` REFUSES any direct write to the flat board
 * (`move`/`relocate`/frontmatter-status) — the old writer is dead; all status
 * flows through the W3 transition engine onto `tasks.json`. Before cutover the
 * fence is inert (Phase 1 keeps the old board live read-only as the oracle).
 *
 * The cutover state is a small persisted marker (`{ phase, parityOk,
 * rollbackExercised, at }`) read/written through an injected `io`, so this is
 * testable without a live board and reversible (rollback resets the marker to
 * Phase 1). Pure guards + injected effects. Zero-dep beyond `node:*`.
 */

/** Migration phases. `phase1` = additive/parity; `phase2` = cutover complete. */
export const MIGRATION_PHASES = Object.freeze(['phase1', 'phase2']);

/** Thrown when a fenced old-board write is attempted post-cutover. */
export class OldWriterFenced extends Error {
  /** @param {string} operation @param {string} target */
  constructor(operation, target) {
    super(`old-writer fenced: "${operation}" on the flat board (${target}) is refused post-cutover — status flows through the transition engine onto the owner's tasks.json`);
    this.name = 'OldWriterFenced';
    this.operation = operation;
    this.target = target;
  }
}

/**
 * Pure parity check: the derived board's per-card (id, status) set must match the
 * frozen Stage-0 oracle's. Returns `{ ok, mismatches }` — never throws (the
 * caller decides). Compares on the migratable surface: id → status.
 *
 * @param {object} derivedBoard — from W4 `deriveBoard` (has `rows[]`)
 * @param {object} oracleInventory — from W1 `buildInventory` (has `cards[]`)
 * @returns {{ ok: boolean, mismatches: string[] }}
 */
export function checkParity(derivedBoard, oracleInventory) {
  const derived = new Map((derivedBoard?.rows || []).map((r) => [String(r.id), r.status]));
  const oracle = new Map((oracleInventory?.cards || []).map((c) => [String(c.id), c.status]));
  const mismatches = [];
  for (const [id, status] of oracle) {
    if (!derived.has(id)) mismatches.push(`${id}: in oracle, absent from derived board`);
    else if (derived.get(id) !== status) mismatches.push(`${id}: oracle "${status}" != derived "${derived.get(id)}"`);
  }
  for (const id of derived.keys()) if (!oracle.has(id)) mismatches.push(`${id}: in derived board, absent from oracle`);
  return { ok: mismatches.length === 0, mismatches: mismatches.sort() };
}

/**
 * Throwing parity gate (constitution §8: refuse by default).
 *
 * @param {object} derivedBoard @param {object} oracleInventory
 * @returns {true}
 * @throws {Error} listing every mismatch
 */
export function assertParity(derivedBoard, oracleInventory) {
  const { ok, mismatches } = checkParity(derivedBoard, oracleInventory);
  if (!ok) throw new Error(`cutover refused — parity not proven:\n  - ${mismatches.join('\n  - ')}`);
  return true;
}

/**
 * Pure precondition check for cutover: BOTH gates must hold. Returns `{ ok,
 * reasons }` — the reasons name exactly which gate is unmet (default-refuse).
 *
 * @param {{ parityOk?: boolean, rollbackExercised?: boolean }} state
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function canCutover(state) {
  const reasons = [];
  if (!state || state.parityOk !== true) reasons.push('parity not proven (run derive vs oracle)');
  if (!state || state.rollbackExercised !== true) reasons.push('rollback drill not exercised');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Reads the cutover marker via `io.readMarker()`; a missing marker means Phase 1
 * (the safe default — the old board is still authoritative/oracle).
 *
 * @param {{ readMarker: Function }} io
 * @returns {{ phase: string, parityOk: boolean, rollbackExercised: boolean, at: string|null }}
 */
export function readCutoverState(io) {
  const marker = io.readMarker?.() || null;
  return {
    phase: MIGRATION_PHASES.includes(marker?.phase) ? marker.phase : 'phase1',
    parityOk: marker?.parityOk === true,
    rollbackExercised: marker?.rollbackExercised === true,
    at: typeof marker?.at === 'string' ? marker.at : null,
  };
}

/**
 * Performs the cutover to Phase 2 — REFUSES unless both gates hold. Writes the
 * Phase 2 marker via `io.writeMarker`. `stamp` (injected clock string) keeps this
 * deterministic under test. Idempotent: cutover when already in Phase 2 is a
 * no-op re-write of the same phase.
 *
 * @param {{ readMarker: Function, writeMarker: Function }} io
 * @param {{ parityOk: boolean, rollbackExercised: boolean }} gates
 * @param {string} [stamp] — recorded `at` (injected; not `Date.now()`)
 * @returns {{ phase: string, at: string }}
 * @throws {Error} when a gate is unmet
 */
export function cutover(io, gates, stamp = '') {
  const { ok, reasons } = canCutover(gates);
  if (!ok) throw new Error(`cutover refused: ${reasons.join('; ')}`);
  const marker = { phase: 'phase2', parityOk: true, rollbackExercised: true, at: stamp };
  io.writeMarker(marker);
  return { phase: 'phase2', at: stamp };
}

/**
 * The old-writer fence. Post-cutover (Phase 2), any direct flat-board write is
 * refused. Pre-cutover (Phase 1) it is inert (the old board is the live oracle).
 * Call this at the TOP of the legacy `move`/`relocate` path.
 *
 * @param {{ readMarker: Function }} io
 * @param {string} operation — the attempted op (e.g. "move", "relocate")
 * @param {string} target — the flat-board path/id
 * @returns {void}
 * @throws {OldWriterFenced} when phase === 'phase2'
 */
export function fenceOldWriter(io, operation, target) {
  if (readCutoverState(io).phase === 'phase2') throw new OldWriterFenced(operation, target);
}

/**
 * Rollback of the cutover itself: reset the marker to Phase 1 (un-fence the old
 * board). Pairs with W7's byte-identical board restore — together they undo Phase
 * 2 completely. Idempotent.
 *
 * @param {{ writeMarker: Function }} io
 * @param {string} [stamp]
 * @returns {{ phase: string }}
 */
export function rollbackCutover(io, stamp = '') {
  io.writeMarker({ phase: 'phase1', parityOk: false, rollbackExercised: false, at: stamp });
  return { phase: 'phase1' };
}
