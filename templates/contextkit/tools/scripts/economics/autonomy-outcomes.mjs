/**
 * Autonomy outcomes adapter — EACP / card #255 (EACP-20), ADR-0105.
 *
 * Turns the pipeline's append-only state-substrate events into the
 * `usefulAutonomy`-shaped task records the Autonomy Multiplier consumes — so the
 * multiplier stops reporting "skipped (insufficient autonomy signals)" and starts
 * measuring real throughput. NO parallel ledger is created (constitution §9): the
 * `events` log is already the immutable source of truth ("if it isn't an event,
 * it didn't happen" — ADR-0043). This module only DERIVES; it never writes.
 *
 * Honesty (ADR-0080 / ADR-0105):
 *   - A task counts as a QA-green outcome ONLY via an `actor:'qa'` transition to a
 *     terminal stage. `qa-approve`/`pipetest` is a DETERMINISTIC gate (ADR-0054/
 *     0055: acceptance criteria checked + suite-green evidence) where the suite —
 *     not the implementing agent — is the evaluator. That makes `externalCriteria`
 *     and `evaluatorNotOperator` legitimately true. An AI `/qa-signoff` verdict is
 *     NOT an `actor:'qa'` event and is correctly never counted.
 *   - A later re-open (terminal → non-terminal) flags `materialErrorReopen` →
 *     excluded from the useful count (the throughput wasn't durable).
 *   - A QA-decided-but-rejected task (qa event, no terminal approval) is emitted
 *     with `qaGreen:false` so it lands in the denominator but never the numerator.
 *   - Tasks with no `actor:'qa'` event are in-flight, not outcomes → not emitted.
 * DETERMINISTIC: no Date.now() / Math.random() / new Date(). Zero runtime deps.
 */

/** Canonical schema identifier for autonomy-outcome summary objects. */
export const AUTONOMY_OUTCOMES_SCHEMA_VERSION = 'eacp-autonomy-outcomes/1';

/** Stages that mean "QA-approved / shipped". */
const TERMINAL_STAGES = Object.freeze(['conclusion', 'done']);

/** True when a stage string denotes a terminal (approved) lane. */
function isTerminal(stage) {
  return typeof stage === 'string' && TERMINAL_STAGES.includes(stage);
}

/**
 * Derives a single `usefulAutonomy`-shaped record from one task state, or null
 * when the task has no QA decision yet (still in-flight — not an outcome).
 *
 * @param {{ id?: string, kind?: string, events?: Array<{actor?: string, from?: string, to?: string}> }} state
 * @returns {Readonly<object>|null}
 */
export function outcomeForState(state) {
  if (state === null || typeof state !== 'object') return null;
  const events = Array.isArray(state.events) ? state.events : [];

  // Index of the first QA approval (actor:'qa' → terminal stage).
  let approvalIdx = -1;
  let sawQaEvent = false;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev?.actor !== 'qa') continue;
    sawQaEvent = true;
    if (approvalIdx === -1 && isTerminal(ev.to)) approvalIdx = i;
  }
  // No QA decision at all → the task is in-flight, not a measurable outcome.
  if (!sawQaEvent) return null;

  const approved = approvalIdx !== -1;
  // A re-open is any post-approval transition out of a terminal stage.
  let reopened = false;
  if (approved) {
    for (let i = approvalIdx + 1; i < events.length; i++) {
      const ev = events[i];
      if (isTerminal(ev?.from) && !isTerminal(ev?.to)) { reopened = true; break; }
    }
  }

  const green = approved && !reopened;
  return Object.freeze({
    taskId: typeof state.id === 'string' ? state.id : String(state.id ?? ''),
    acceptanceMet: green,
    testsRun: green,
    qaGreen: green,
    // Deterministic QA gate: pre-existing suite is the externally-authored
    // evaluator, distinct from the operator (ADR-0054/0055).
    externalCriteria: approved,
    evaluatorNotOperator: approved,
    materialErrorReopen: reopened,
  });
}

/**
 * Derives the full list of `usefulAutonomy` task records from an array of state
 * records (e.g. `listStates(PIPE, { kind: 'task' })`). In-flight tasks (no QA
 * decision) are dropped. Non-array input → []. The result is ready to pass as
 * `tasks` to `multiplierSummary` (autonomy-multiplier.mjs).
 *
 * @param {object[]} states
 * @returns {Readonly<object[]>}
 */
export function deriveOutcomes(states) {
  if (!Array.isArray(states)) return Object.freeze([]);
  const records = [];
  for (const state of states) {
    const record = outcomeForState(state);
    if (record !== null) records.push(record);
  }
  return Object.freeze(records);
}

/**
 * Summarises derived outcomes for advisory display: total QA-decided tasks, how
 * many reached durable QA-green, and how many were excluded (rejected/reopened).
 *
 * @param {object[]} states
 * @returns {Readonly<{ schemaVersion: string, decided: number, green: number,
 *   reopened: number, rejected: number, tasks: object[] }>}
 */
export function outcomesSummary(states) {
  const tasks = deriveOutcomes(states);
  let green = 0, reopened = 0, rejected = 0;
  for (const t of tasks) {
    if (t.qaGreen) green++;
    else if (t.materialErrorReopen) reopened++;
    else rejected++;
  }
  return Object.freeze({
    schemaVersion: AUTONOMY_OUTCOMES_SCHEMA_VERSION,
    decided: tasks.length,
    green,
    reopened,
    rejected,
    tasks: [...tasks],
  });
}
