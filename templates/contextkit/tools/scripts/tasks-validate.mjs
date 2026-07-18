/**
 * WF-0059 W2 — `tasks.json` validators (the source-of-truth guardrail).
 *
 * Enforces, at the boundary, the invariants the 2026-06-26 deliberation made the
 * ratification conditions (SPEC §"Test plan"):
 *   - **O4 — ownerlessness is unrepresentable.** A task without a resolvable
 *     `owner:{kind,id}` FK is refused (`validateTask` collects it; `assertTasks`
 *     THROWS). A task only exists inside an owner's file.
 *   - **Single-journal fence.** `tasks.json` carries NO inline events — only a
 *     `sidecarRef` pointing at the ADR-0043 journal. An `events` array on a task
 *     is a violation (that would be a second journal).
 *   - **`fold(events)==status` fence.** The persisted `status` must equal the
 *     fold of the task's journal. A hand-edited status that disagrees with the
 *     journal is refused — this is why `tasks.json.status` is a re-derivable
 *     projection, not a competing authority.
 *   - **`done` predicate.** `done := acceptanceMet===true && evidenceRef!=null`.
 *   - **`blocked` predicate.** `blocked := category && explanation &&
 *     releaseCondition` with a deterministic `releaseCondition.kind`.
 *
 * Two-tier API mirroring the kit's convention (`validateTaskV2` / `runValidate`):
 * pure `validateTask`/`validateTasksDoc` return `{ ok, errors }` (never throw);
 * `assertTasksDoc` THROWS on any error (constitution §8: validators throw, run at
 * the top of an I/O sequence so a refused state never wastes a write). Pure,
 * zero-dep — the journal is passed in (a `sidecarRef → events` resolver), never
 * read from disk here, so this stays testable and hot-path-safe.
 */
import {
  TASK_STATES, OWNER_KINDS, EXECUTION_MODES, BLOCKER_CATEGORIES, RELEASE_CONDITION_KINDS,
  foldStatus, eventsContiguous,
} from './tasks-schema.mjs';

/** True for a non-empty string. */
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Validates the structured `blocker` object required when `status === 'blocked'`
 * (SPEC §D4). Returns error strings (empty when valid).
 *
 * @param {object|null|undefined} blocker
 * @param {string} taskId
 * @returns {string[]}
 */
function validateBlocker(blocker, taskId) {
  const errors = [];
  if (!blocker || typeof blocker !== 'object') {
    return [`${taskId}: status "blocked" requires a structured blocker { category, explanation, releaseCondition }`];
  }
  if (!BLOCKER_CATEGORIES.includes(blocker.category)) {
    errors.push(`${taskId}: blocker.category "${blocker.category}" not in the closed taxonomy`);
  }
  if (!isNonEmptyString(blocker.explanation)) errors.push(`${taskId}: blocker.explanation is required`);
  const rc = blocker.releaseCondition;
  if (!rc || typeof rc !== 'object' || !RELEASE_CONDITION_KINDS.includes(rc.kind)) {
    errors.push(`${taskId}: blocker.releaseCondition.kind must be a deterministic predicate (one of ${RELEASE_CONDITION_KINDS.join(', ')})`);
  }
  return errors;
}

/**
 * Validates one task record against the schema + the source-of-truth guardrails.
 * `resolveOwner(ownerFk)` returns truthy when the FK references a real owner
 * (injected — no disk read here). `foldEvents(sidecarRef)` returns the task's
 * journal events array (or null when the resolver can't find it); when provided,
 * the `fold(events)==status` + contiguity + no-inline-events fences are checked.
 *
 * @param {object} task — a `tasks.json` task record
 * @param {{ resolveOwner?: (fk: object) => boolean, foldEvents?: (ref: string) => (Array|null) }} [deps]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTask(task, deps = {}) {
  const errors = [];
  if (!task || typeof task !== 'object') return { ok: false, errors: ['task: not an object'] };
  const id = isNonEmptyString(task.id) ? task.id : '(no-id)';
  if (!isNonEmptyString(task.id)) errors.push('task: id is required');
  if (!isNonEmptyString(task.title)) errors.push(`${id}: title is required`);

  // Lifecycle status.
  if (!TASK_STATES.includes(task.status)) errors.push(`${id}: status "${task.status}" not in the 5-state lifecycle`);

  // O4 — owner FK must be structurally present and (when a resolver is given) resolvable.
  const owner = task.owner;
  if (!owner || typeof owner !== 'object' || !OWNER_KINDS.includes(owner.kind) || !isNonEmptyString(owner.id)) {
    errors.push(`${id}: owner FK { kind, id } is required (ownerlessness is unrepresentable — O4)`);
  } else if (typeof deps.resolveOwner === 'function' && !deps.resolveOwner(owner)) {
    errors.push(`${id}: owner ${owner.kind}:${owner.id} does not resolve to an existing owner`);
  }

  // Single-journal fence — no inline events; only a sidecarRef.
  if ('events' in task) errors.push(`${id}: inline "events" are forbidden — the ADR-0043 journal lives in the sidecar (use sidecarRef)`);
  if (!isNonEmptyString(task.sidecarRef)) errors.push(`${id}: sidecarRef (path to the journal) is required`);

  // done predicate.
  if (task.status === 'done' && !(task.acceptanceMet === true && task.evidenceRef != null)) {
    errors.push(`${id}: status "done" requires acceptanceMet===true && evidenceRef!=null`);
  }
  // blocked predicate.
  if (task.status === 'blocked') errors.push(...validateBlocker(task.blocker, id));

  // fold(events)==status fence (only when the journal is resolvable).
  if (typeof deps.foldEvents === 'function' && isNonEmptyString(task.sidecarRef)) {
    const events = deps.foldEvents(task.sidecarRef);
    if (Array.isArray(events)) {
      if (!eventsContiguous(events)) errors.push(`${id}: journal is not a contiguous legal chain — cannot trust fold`);
      const folded = foldStatus(events);
      if (folded !== task.status) errors.push(`${id}: status "${task.status}" disagrees with fold(events)="${folded}" (never hand-edit status)`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validates a whole `tasks.json` document: the envelope (owner, executionMode,
 * revision) plus every task. Also enforces O2 at the doc level — every task's
 * owner FK must match the document owner (an OP file cannot hold a WF task).
 *
 * @param {object} doc — parsed `tasks.json`
 * @param {{ resolveOwner?: Function, foldEvents?: Function }} [deps]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTasksDoc(doc, deps = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['tasks.json: not an object'] };
  const owner = doc.owner;
  if (!owner || typeof owner !== 'object' || !OWNER_KINDS.includes(owner.kind) || !isNonEmptyString(owner.id)) {
    errors.push('tasks.json: document owner { kind, id } is required');
  }
  if (!EXECUTION_MODES.includes(doc.executionMode)) errors.push(`tasks.json: executionMode "${doc.executionMode}" invalid`);
  if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push('tasks.json: revision must be a non-negative integer (CAS token)');
  if (!Array.isArray(doc.tasks)) return { ok: false, errors: [...errors, 'tasks.json: tasks[] is required'] };

  const seen = new Set();
  for (const task of doc.tasks) {
    const result = validateTask(task, deps);
    errors.push(...result.errors);
    if (task && isNonEmptyString(task.id)) {
      if (seen.has(task.id)) errors.push(`${task.id}: duplicate task id within one owner file`);
      seen.add(task.id);
    }
    // O2 — a task's owner FK must match the document owner (no cross-kind duplication).
    if (task && task.owner && owner && (task.owner.kind !== owner.kind || task.owner.id !== owner.id)) {
      errors.push(`${task.id || '(no-id)'}: owner ${task.owner.kind}:${task.owner.id} does not match document owner ${owner.kind}:${owner.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Throwing wrapper (constitution §8: validators throw, run at the top of an I/O
 * sequence so a refused state never wastes a write).
 *
 * @param {object} doc
 * @param {{ resolveOwner?: Function, foldEvents?: Function }} [deps]
 * @returns {object} the validated doc (for chaining)
 * @throws {Error} on any validation error, message listing every problem
 */
export function assertTasksDoc(doc, deps = {}) {
  const { ok, errors } = validateTasksDoc(doc, deps);
  if (!ok) throw new Error(`tasks.json invalid:\n  - ${errors.join('\n  - ')}`);
  return doc;
}
