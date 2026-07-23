/**
 * Crash-consistent workflow finalization primitives (WF-0084 / ADR-0148).
 *
 * The journal + workflow state are the authoritative CAS unit. Markdown and
 * `done/` placement are recoverable projections: a failed projection is safe
 * to retry because the state event is idempotent and the move is conflict-aware.
 * This distinction is intentional; Windows cannot transact a JSON rename and a
 * directory rename as one filesystem transaction without introducing a runtime
 * dependency.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from './io.mjs';
import {
  applyStateUpdate,
  initState,
  readState,
  StateConflictError,
  writeStateCas,
} from './state.mjs';
import { planHash, readPlan } from './plan.mjs';
import { parseFrontmatter } from '../workflow-frontmatter.mjs';

/** Journal event emitted once when a workflow reaches finalization. */
export const FINALIZATION_EVENT_TYPE = 'workflow.concluded';

/** Typed refusal for an impossible or unsafe finalization projection. */
export class FinalizationRefusalError extends Error {
  /**
   * @param {string} message human-readable refusal
   * @param {string} code stable machine-readable refusal code
   * @param {object} [detail] structured evidence
   */
  constructor(message, code, detail = {}) {
    super(message);
    this.name = 'FinalizationRefusalError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Return the last journal sequence after proving the existing sequence is
 * strictly monotonic. Empty journals start at sequence zero.
 * @param {object} state workflow state
 * @returns {number} last sequence number
 * @throws {FinalizationRefusalError} when the journal is malformed or reordered
 */
export function lastJournalSeq(state) {
  const events = Array.isArray(state?.events) ? state.events : [];
  let previous = 0;
  for (const event of events) {
    if (!Number.isInteger(event?.seq) || event.seq <= previous) {
      throw new FinalizationRefusalError(
        'workflow journal is not strictly monotonic',
        'JOURNAL_NOT_MONOTONIC',
        { previous, event },
      );
    }
    previous = event.seq;
  }
  return previous;
}

/**
 * Find the unique valid finalization event in a state journal.
 * @param {object} state workflow state
 * @returns {object|null} the finalization event, or null when not concluded
 * @throws {FinalizationRefusalError} when duplicate/invalid finalization exists
 */
export function finalizationEvent(state) {
  lastJournalSeq(state);
  const events = Array.isArray(state?.events) ? state.events : [];
  const matches = events.filter((event) => event?.type === FINALIZATION_EVENT_TYPE);
  if (matches.length > 1) {
    throw new FinalizationRefusalError(
      'workflow journal contains duplicate finalization events',
      'DUPLICATE_FINALIZATION_EVENT',
      { count: matches.length },
    );
  }
  const event = matches[0] || null;
  if (event && event.status !== 'done') {
    throw new FinalizationRefusalError(
      'workflow finalization event does not declare status done',
      'INVALID_FINALIZATION_EVENT',
      { event },
    );
  }
  return event;
}

/**
 * Append the finalization event and set the authoritative state in one pure
 * revision update. A second call is a no-op when the valid event is present.
 * @param {object} current current workflow state
 * @param {{ now:string, actor?:string, expectedRevision?:number,
 *   expectedJournalSeq?:number, planHash?:string, movedTo?:string|null }} ctx
 * @returns {{ state:object, changed:boolean, event:object|null }} transition
 * @throws {FinalizationRefusalError|StateConflictError} on drift or stale CAS
 */
export function finalizeState(current, ctx = {}) {
  if (!current || typeof current !== 'object') {
    throw new TypeError('finalizeState: current state is required');
  }
  if (!ctx.now) throw new TypeError('finalizeState: now is required');
  const sequence = lastJournalSeq(current);
  const existing = finalizationEvent(current);
  if (ctx.expectedRevision !== undefined && ctx.expectedRevision !== current.revision) {
    throw new StateConflictError(
      `stale finalization write: expected revision ${ctx.expectedRevision}, but current is ${current.revision}`,
      'stale-revision',
    );
  }
  if (ctx.planHash !== undefined && ctx.planHash !== current.planHash) {
    throw new StateConflictError(
      `finalization planHash ${ctx.planHash} does not match state planHash ${current.planHash}`,
      'plan-hash-mismatch',
    );
  }
  if (ctx.expectedJournalSeq !== undefined && ctx.expectedJournalSeq !== sequence) {
    throw new StateConflictError(
      `stale journal write: expected sequence ${ctx.expectedJournalSeq}, but current is ${sequence}`,
      'stale-revision',
    );
  }
  if (existing) {
    if (current.overallStatus !== 'done') {
      throw new FinalizationRefusalError(
        'workflow has a finalization event but overallStatus is not done',
        'FINALIZATION_STATE_MISMATCH',
        { overallStatus: current.overallStatus, event: existing },
      );
    }
    return { state: current, changed: false, event: existing };
  }
  if (current.overallStatus === 'done') {
    throw new FinalizationRefusalError(
      'workflow state is done without a finalization event',
      'FINALIZATION_EVENT_MISSING',
      { revision: current.revision },
    );
  }
  const event = {
    type: FINALIZATION_EVENT_TYPE,
    seq: sequence + 1,
    workflowId: current.workflowId,
    status: 'done',
    actor: typeof ctx.actor === 'string' && ctx.actor ? ctx.actor : 'agent',
    at: ctx.now,
    movedTo: ctx.movedTo ?? null,
  };
  const state = applyStateUpdate(
    current,
    {
      overallStatus: 'done',
      journeyPhase: 'conclusion',
      events: [...(Array.isArray(current.events) ? current.events : []), event],
    },
    { expectedRevision: ctx.expectedRevision, planHash: ctx.planHash, now: ctx.now },
  );
  return { state, changed: true, event };
}

/**
 * Read the legacy `conclusion` projection from an index file.
 * @param {string} indexPath absolute index path
 * @returns {{ conclusion:string|null, readable:boolean }} projection status
 */
export function readConclusionProjection(indexPath) {
  if (!existsSync(indexPath)) return { conclusion: null, readable: true };
  try {
    const parsed = parseFrontmatter(readFileSync(indexPath, 'utf8'));
    return { conclusion: parsed?.frontmatter?.conclusion || null, readable: Boolean(parsed) };
  } catch {
    return { conclusion: null, readable: false };
  }
}

/** Read an explicit owner projection without making it lifecycle authority. */
export function ownerFromIndex(indexPath) {
  if (!existsSync(indexPath)) return null;
  try {
    const parsed = parseFrontmatter(readFileSync(indexPath, 'utf8'));
    const owner = parsed?.frontmatter?.owner || '';
    return /^(BIZ|OP)-\d{4}$/.test(owner) ? owner : null;
  } catch {
    return null;
  }
}

/**
 * Regenerate the index conclusion field from authoritative state. Human text
 * and all unrelated frontmatter are preserved byte-for-byte.
 * @param {string} indexPath absolute index path
 * @param {'done'|'not-done'} status desired projection
 * @returns {{ changed:boolean, skipped:boolean }} projection receipt
 */
export function projectConclusion(indexPath, status) {
  if (!existsSync(indexPath)) return { changed: false, skipped: true };
  const source = readFileSync(indexPath, 'utf8');
  const parsed = parseFrontmatter(source);
  if (!parsed) return { changed: false, skipped: true };
  const desired = status === 'done' ? 'done' : 'pending';
  const lines = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]?.split(/\r?\n/) || [];
  let found = false;
  const nextLines = lines.map((line) => {
    if (!/^conclusion\s*:/.test(line)) return line;
    found = true;
    return `conclusion: ${desired}`;
  });
  if (!found) nextLines.push(`conclusion: ${desired}`);
  const next = `---\n${nextLines.join('\n')}\n---${source.slice(source.indexOf('\n---', 4) + 4)}`;
  if (next === source) return { changed: false, skipped: false };
  writeFileAtomicSync(indexPath, next);
  return { changed: true, skipped: false };
}

/** Resolve an owner folder by its canonical id. */
function resolveOwnerDir(root, owner) {
  if (!/^(BIZ|OP)-\d{4}$/.test(owner || '')) return null;
  const paths = pathsFor(root);
  const parent = owner.startsWith('BIZ-') ? paths.business : paths.operations;
  if (!existsSync(parent)) return null;
  const names = listDirectories(parent);
  const name = names.find((candidate) => candidate === owner || candidate.startsWith(`${owner}-`));
  return name ? join(parent, name) : null;
}

/** Read immediate directory names without turning a filesystem error into authority. */
function listDirectories(parent) {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Infer an owner id from a nested workflow holder path. */
function ownerFromHolder(holder) {
  const match = holder.replace(/\\/g, '/').match(/\/(?:business|operations)\/((?:BIZ|OP)-\d{4})-[^/]+\/workflows$/);
  return match ? match[1] : null;
}

/**
 * Compute the canonical archive target for one active workflow directory.
 * @param {string} root project root
 * @param {string} packDir active workflow directory
 * @param {string|null} owner explicit owner, when present
 * @returns {{ owner:string|null, to:string, ownerMissing:boolean }} target
 */
export function doneTarget(root, packDir, owner = null) {
  const normalized = packDir.replace(/\\/g, '/');
  if (/(?:^|\/)done\/[^/]+$/.test(normalized)) {
    return { owner: owner || null, to: packDir, ownerMissing: false };
  }
  const holder = normalized.endsWith('/workflows')
    ? normalized
    : normalized.slice(0, normalized.lastIndexOf('/'));
  const resolvedOwner = owner || ownerFromHolder(holder);
  const ownerDir = resolvedOwner ? resolveOwnerDir(root, resolvedOwner) : null;
  const memory = pathsFor(root).memory;
  const archive = ownerDir ? join(ownerDir, 'done') : join(memory, 'workflows', 'done');
  return {
    owner: resolvedOwner,
    to: join(archive, basename(packDir)),
    ownerMissing: Boolean(resolvedOwner) && !ownerDir,
  };
}

/**
 * Move an active workflow directory with explicit conflict semantics. A missing
 * source plus an existing target is the idempotent retry case; both present is
 * a hard refusal so the sweep never silently chooses a side.
 * @param {{from:string,to:string}} move move plan
 * @returns {{ status:'applied'|'noop', from:string, to:string }} receipt
 * @throws {FinalizationRefusalError} on collision or missing source
 */
export function moveWorkflowDirectory(move) {
  const sourceExists = existsSync(move.from);
  const targetExists = existsSync(move.to);
  if (sourceExists && targetExists) {
    throw new FinalizationRefusalError(
      `done move conflict: source and target both exist (${move.from} / ${move.to})`,
      'DONE_MOVE_CONFLICT',
      move,
    );
  }
  if (!sourceExists && targetExists) return { status: 'noop', ...move };
  if (!sourceExists) {
    throw new FinalizationRefusalError(`done move source is missing: ${move.from}`, 'DONE_MOVE_SOURCE_MISSING', move);
  }
  mkdirSync(dirname(move.to), { recursive: true });
  renameSync(move.from, move.to);
  return { status: 'applied', ...move };
}

/**
 * Execute a synchronous operation under an exclusive per-workflow lock.
 * @param {string} root project root
 * @param {string} workflowId stable workflow id/slug
 * @param {()=>any} operation critical-section callback
 * @returns {any} callback result
 * @throws {FinalizationRefusalError} when another finalizer owns the lock
 */
export function withWorkflowLock(root, workflowId, operation) {
  const lockRoot = join(pathsFor(root).memory, '.workflow-locks');
  const safeId = String(workflowId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
  const lockPath = join(lockRoot, `${safeId}.lock`);
  mkdirSync(lockRoot, { recursive: true });
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new FinalizationRefusalError(
        `workflow finalization lock is already held: ${workflowId}`,
        'FINALIZATION_LOCKED',
        { lockPath, workflowId },
      );
    }
    throw error;
  }
  try {
    return operation();
  } finally {
    try { rmdirSync(lockPath); } catch { /* cleanup cannot alter the verdict */ }
  }
}

/** Return a repo-relative, forward-slashed path for journal provenance. */
export function relativeProvenance(root, absolutePath) {
  return relative(root, absolutePath).replace(/\\/g, '/');
}

/** Read the current conclusion projection without making it authoritative. */
function projectStatus(packDir) {
  return readConclusionProjection(join(packDir, 'index.md'));
}

/** Build a revision-zero state for a pack that has not started execution yet. */
function initialPackState(plan, now) {
  return initState({
    workflowId: plan.workflowId,
    planHash: planHash(plan),
    journeyPhase: plan.journey?.currentPhase || 'intake',
    now,
  });
}

/** Validate an optional caller-supplied plan hash against the live plan. */
function expectedPlan(plan, supplied) {
  const current = planHash(plan);
  if (supplied && supplied !== current) {
    throw new StateConflictError(
      `finalization refused: supplied planHash ${supplied} does not match current ${current}`,
      'plan-hash-mismatch',
    );
  }
  return current;
}

/**
 * Conclude a pack through the journal/state CAS unit, then repair its index and
 * archive projections. This is the orchestration seam used by the CLI command.
 * @param {string} root project root
 * @param {string} packDir absolute workflow pack directory
 * @param {{apply?:boolean,now:string,actor?:string,expectedRevision?:number,
 *   expectedJournalSeq?:number,planHash?:string}} [options] finalization options
 * @returns {object} deterministic finalization receipt
 */
export function concludePack(root, packDir, {
  apply = false,
  now,
  actor = 'agent',
  expectedRevision,
  expectedJournalSeq,
  planHash: suppliedPlanHash,
} = {}) {
  if (!now) throw new TypeError('conclude: now is required');
  const plan = readPlan(join(packDir, 'workflow-plan.json'));
  const currentPlanHash = expectedPlan(plan, suppliedPlanHash);
  const statePath = join(packDir, 'workflow-state.json');
  const target = doneTarget(root, packDir, ownerFromIndex(join(packDir, 'index.md')));
  const movedTo = relativeProvenance(root, target.to);
  const current = readState(statePath);
  if (existsSync(statePath) && !current) {
    throw new FinalizationRefusalError(
      'conclude refused: workflow state is unreadable',
      'STATE_UNREADABLE',
      { statePath },
    );
  }
  const preview = finalizeState(current || initialPackState(plan, now), {
    now,
    actor,
    expectedRevision,
    expectedJournalSeq,
    planHash: currentPlanHash,
    movedTo,
  });
  if (!apply) {
    return {
      status: preview.changed ? 'dry-run' : 'noop',
      applied: false,
      overallStatus: preview.state.overallStatus,
      journalSeq: preview.event?.seq ?? lastJournalSeq(preview.state),
      revision: preview.state.revision,
      movedTo: target.to,
      owner: target.owner,
      ownerMissing: target.ownerMissing,
      stateChanged: preview.changed,
      projectionChanged: false,
      move: { status: 'dry-run', from: packDir, to: target.to },
    };
  }

  return withWorkflowLock(root, plan.workflowId || basename(packDir), () => {
    const lockedState = readState(statePath);
    const final = finalizeState(lockedState || initialPackState(plan, now), {
      now,
      actor,
      expectedRevision: expectedRevision ?? (lockedState ? lockedState.revision : 0),
      expectedJournalSeq,
      planHash: currentPlanHash,
      movedTo,
    });
    if (final.changed) {
      writeStateCas(statePath, final.state, {
        expectedRevision: lockedState ? (expectedRevision ?? lockedState.revision) : (expectedRevision ?? 0),
        planHash: currentPlanHash,
      });
    }
    const projectionDir = existsSync(packDir) ? packDir : target.to;
    const projection = projectConclusion(join(projectionDir, 'index.md'), 'done');
    const move = projectionDir === target.to
      ? { status: 'noop', from: packDir, to: target.to }
      : moveWorkflowDirectory({ from: packDir, to: target.to });
    return {
      status: final.changed || projection.changed || move.status === 'applied' ? 'applied' : 'noop',
      applied: final.changed || projection.changed || move.status === 'applied',
      overallStatus: final.state.overallStatus,
      journalSeq: final.event?.seq ?? lastJournalSeq(final.state),
      revision: final.state.revision,
      movedTo: target.to,
      owner: target.owner,
      ownerMissing: target.ownerMissing,
      stateChanged: final.changed,
      projectionChanged: projection.changed,
      move,
    };
  });
}

/**
 * Reconcile or move a state-concluded pack without appending another event.
 * @param {string} root project root
 * @param {string} packDir absolute workflow pack directory
 * @param {{apply?:boolean,expectedRevision?:number,planHash?:string}} [options] move options
 * @returns {object} deterministic move receipt
 */
export function doneMovePack(root, packDir, {
  apply = false,
  expectedRevision,
  planHash: suppliedPlanHash,
} = {}) {
  const plan = readPlan(join(packDir, 'workflow-plan.json'));
  const currentPlanHash = expectedPlan(plan, suppliedPlanHash);
  const statePath = join(packDir, 'workflow-state.json');
  const state = readState(statePath);
  if (existsSync(statePath) && !state) {
    throw new FinalizationRefusalError(
      'done-move refused: workflow state is unreadable',
      'STATE_UNREADABLE',
      { statePath },
    );
  }
  const projection = projectStatus(packDir);
  if (!state) {
    if (projection.conclusion !== 'done') return { status: 'noop', applied: false, reason: 'not-concluded', movedTo: null };
    const target = doneTarget(root, packDir, ownerFromIndex(join(packDir, 'index.md')));
    if (!apply) return { status: 'dry-run', applied: false, movedTo: target.to, legacy: true };
    return withWorkflowLock(root, plan.workflowId || basename(packDir), () => ({
      status: moveWorkflowDirectory({ from: packDir, to: target.to }).status,
      applied: true,
      movedTo: target.to,
      legacy: true,
    }));
  }
  if (expectedRevision !== undefined && expectedRevision !== state.revision) {
    throw new StateConflictError(`done-move refused: expected revision ${expectedRevision}, but current is ${state.revision}`, 'stale-revision');
  }
  const event = finalizationEvent(state);
  if (event && state.overallStatus !== 'done') {
    throw new StateConflictError('done-move refused: finalization event contradicts workflow state', 'stale-revision');
  }
  if (state.overallStatus === 'done' && !event) {
    throw new StateConflictError('done-move refused: overallStatus is done without a finalization event', 'stale-revision');
  }
  if (projection.conclusion === 'done' && state.overallStatus !== 'done') {
    throw new StateConflictError('done-move refused: index conclusion contradicts workflow state', 'stale-revision');
  }
  if (state.overallStatus !== 'done') return { status: 'noop', applied: false, reason: 'not-concluded', movedTo: null };

  const target = doneTarget(root, packDir, ownerFromIndex(join(packDir, 'index.md')));
  if (!apply) return { status: 'dry-run', applied: false, movedTo: target.to, journalSeq: event.seq };
  return withWorkflowLock(root, plan.workflowId || basename(packDir), () => {
    const projectionResult = projectConclusion(join(packDir, 'index.md'), 'done');
    const move = packDir === target.to
      ? { status: 'noop', from: packDir, to: target.to }
      : moveWorkflowDirectory({ from: packDir, to: target.to });
    return {
      status: projectionResult.changed || move.status === 'applied' ? 'applied' : 'noop',
      applied: projectionResult.changed || move.status === 'applied',
      movedTo: target.to,
      journalSeq: event.seq,
      projectionChanged: projectionResult.changed,
      move,
    };
  });
}
