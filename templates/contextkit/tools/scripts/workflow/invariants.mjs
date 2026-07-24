/**
 * WF-0084 I1-I10 drift guard.
 *
 * Each checker returns an explicit `pass`, `fail`, or `skipped` verdict. The
 * evaluator applies the rollout posture separately, so an unknown substrate is
 * never promoted to a pass and never becomes a false block. Existing I7/I8/I9
 * seams are consumed as evidence; they are not reimplemented here.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { gatherRegistryEvidence } from '../../../runtime/work/journey-evidence-registry.mjs';
import { finalizationEvent, lastJournalSeq } from './finalization.mjs';
import { parseFrontmatter } from '../workflow-frontmatter.mjs';

/** Machine-readable invariant catalogue and rollout class. */
export const INVARIANT_DEFINITIONS = Object.freeze([
  { id: 'I1', name: 'done-parity', class: 'hot-path', blockable: true },
  { id: 'I2', name: 'projection-integrity', class: 'advisory', blockable: false },
  { id: 'I3', name: 'ref-resolution', class: 'advisory', blockable: false },
  { id: 'I4', name: 'move-provenance', class: 'hot-path', blockable: true },
  { id: 'I5', name: 'no-orphan-tasks', class: 'advisory', blockable: false },
  { id: 'I6', name: 'single-done-source', class: 'hot-path', blockable: true },
  { id: 'I7', name: 'adr-contiguity', class: 'hot-path', blockable: true },
  { id: 'I8', name: 'workflow-nested-under-owner', class: 'hot-path', blockable: true },
  { id: 'I9', name: 'plan-hash', class: 'hot-path', blockable: true },
  { id: 'I10', name: 'journal-monotonic', class: 'advisory', blockable: false },
]);

/** The invariant set that may block a hot-path write after promotion. */
export const BLOCKABLE_INVARIANTS = Object.freeze(['I1', 'I4', 'I6', 'I7', 'I8', 'I9']);

/** The corpus checks that remain advisory until finalization. */
export const ADVISORY_INVARIANTS = Object.freeze(['I2', 'I3', 'I5', 'I10']);

const INVARIANT_IDS = new Set(INVARIANT_DEFINITIONS.map((definition) => definition.id));

/** Build one stable invariant verdict. */
function verdict(id, status, reason, evidence = {}) {
  return { id, status, reason, evidence };
}

/** Return a skipped verdict when a required substrate cannot be read. */
function skipped(id, reason = 'substrate-unavailable') {
  return verdict(id, 'skipped', reason);
}

/** True for a workflow path physically filed under an immediate `done/` holder. */
function isFiledInDone(workflowDir = '') {
  return workflowDir.replace(/\\/g, '/').split('/').includes('done');
}

/** Read a state file while preserving absent vs unreadable distinction. */
function readStateSnapshot(workflowDir) {
  const path = join(workflowDir, 'workflow-state.json');
  if (!existsSync(path)) return { present: false, readable: true, state: null };
  try {
    return { present: true, readable: true, state: JSON.parse(readFileSync(path, 'utf8').replace(/^ï»¿/, '')) };
  } catch {
    return { present: true, readable: false, state: null };
  }
}

/** Read only the frontmatter projection of an index. */
function readIndexSnapshot(workflowDir) {
  const path = join(workflowDir, 'index.md');
  if (!existsSync(path)) return { present: false, readable: true, frontmatter: {} };
  try {
    const parsed = parseFrontmatter(readFileSync(path, 'utf8'));
    return { present: true, readable: Boolean(parsed), frontmatter: parsed?.frontmatter || {} };
  } catch {
    return { present: true, readable: false, frontmatter: {} };
  }
}

/** Build a filesystem-backed checker context, or leave it explicitly unknown. */
function loadContext(input) {
  if (!input?.workflowDir) return input || {};
  const stateSnapshot = input.state ? { state: input.state, present: true, readable: true } : readStateSnapshot(input.workflowDir);
  const indexSnapshot = input.index ? { frontmatter: input.index, present: true, readable: true } : readIndexSnapshot(input.workflowDir);
  const evidence = input.evidence || (input.root && input.owner ? gatherRegistryEvidence(input.root, input.owner) : {});
  return {
    ...input,
    state: stateSnapshot.state,
    statePresent: stateSnapshot.present,
    stateReadable: stateSnapshot.readable,
    index: indexSnapshot.frontmatter,
    indexPresent: indexSnapshot.present,
    indexReadable: indexSnapshot.readable,
    inDone: input.inDone ?? isFiledInDone(input.workflowDir),
    evidence,
  };
}

/** I1: an archived state-bearing workflow must be done, and vice versa. */
function checkI1(input) {
  if (typeof input.inDone !== 'boolean' || !input.statePresent) return skipped('I1');
  if (!input.stateReadable || !input.state) return skipped('I1', 'state-unreadable');
  const stateDone = input.state.overallStatus === 'done';
  return stateDone === input.inDone
    ? verdict('I1', 'pass', 'done path and workflow state agree', { inDone: input.inDone, stateDone })
    : verdict('I1', 'fail', 'done path and workflow state diverge', { inDone: input.inDone, stateDone });
}

/**
 * The closed set of journal event types that carry a task-status transition.
 * Single-sourced here so every consumer (the I2 fold, the corpus reconcile
 * walker) reads one authority — adding a 4th type never silently drifts a copy.
 */
export const TASK_STATUS_EVENT_TYPES = Object.freeze(['task.status', 'task.updated', 'workflow.task-status']);

/** Fold task status events into the taskStates projection. */
export function foldTaskStates(journal) {
  const folded = {};
  for (const event of Array.isArray(journal) ? journal : []) {
    if (!event?.taskId || typeof event.status !== 'string') continue;
    if (!TASK_STATUS_EVENT_TYPES.includes(event.type)) continue;
    folded[event.taskId] = { status: event.status };
  }
  return folded;
}

/** I2: taskStates must equal the fold of the task-status journal slice. */
function checkI2(input) {
  const journal = input.journal ?? input.state?.events;
  const taskStates = input.taskStates ?? input.state?.taskStates;
  if (!Array.isArray(journal) || !taskStates || typeof taskStates !== 'object') return skipped('I2');
  const folded = foldTaskStates(journal);
  if (Object.keys(folded).length === 0) {
    return Object.keys(taskStates).length === 0
      ? verdict('I2', 'pass', 'empty task journal and empty projection')
      : skipped('I2', 'task-status-journal-not-integrated');
  }
  const actual = Object.fromEntries(Object.entries(taskStates).map(([taskId, entry]) => [taskId, { status: entry?.status }]));
  const expectedText = JSON.stringify(Object.entries(folded).sort(([left], [right]) => left.localeCompare(right)));
  const actualText = JSON.stringify(Object.entries(actual).sort(([left], [right]) => left.localeCompare(right)));
  return expectedText === actualText
    ? verdict('I2', 'pass', 'fold(journal) equals taskStates', { folded })
    : verdict('I2', 'fail', 'fold(journal) differs from taskStates', { folded, actual });
}

/** Extract workflow references from the governed `workflows` subtree. */
function workflowRefs(value, key = '') {
  if (typeof value === 'string') {
    if (key === 'workflows' || /workflow|ref|path|id/i.test(key) || /^(WF-|\d{4}-)/.test(value)) return [value];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((entry) => workflowRefs(entry, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, child]) => workflowRefs(child, childKey));
}

/** Resolve a workflow reference against explicit fixtures or the local roots. */
function resolvesWorkflowRef(root, reference, input) {
  if (input.resolvedRefs && Object.prototype.hasOwnProperty.call(input.resolvedRefs, reference)) {
    return input.resolvedRefs[reference] === true;
  }
  const candidate = resolve(root, reference);
  if (existsSync(candidate)) return true;
  const workflowDirs = Array.isArray(input.workflowDirs) ? input.workflowDirs : [];
  return workflowDirs.some((workflowDir) => {
    const normalized = workflowDir.replace(/\\/g, '/');
    return normalized.endsWith(`/${reference}`) || basename(normalized) === reference;
  });
}

/** I3: every declared business workflow reference must resolve. */
function checkI3(input) {
  const records = Array.isArray(input.businessRecords)
    ? input.businessRecords
    : input.business ? [{ business: input.business }] : [];
  if (!records.length) return skipped('I3', 'business-records-unavailable');
  const root = input.root || process.cwd();
  const dangling = [];
  for (const record of records) {
    const business = record.business || record;
    const references = workflowRefs(business?.workflows, 'workflows');
    for (const reference of references) {
      if (!resolvesWorkflowRef(root, reference, input)) dangling.push(reference);
    }
  }
  return dangling.length
    ? verdict('I3', 'fail', 'business workflow reference is dangling', { dangling: [...new Set(dangling)] })
    : verdict('I3', 'pass', 'all business workflow references resolve');
}

/** I4: a state-bearing directory in done/ has finalization provenance. */
function checkI4(input) {
  if (!input.inDone) return skipped('I4', 'workflow-not-filed');
  if (!input.statePresent) return skipped('I4', 'legacy-pack-without-state');
  if (!input.stateReadable || !input.state) return skipped('I4', 'state-unreadable');
  try {
    const event = finalizationEvent(input.state);
    return event
      ? verdict('I4', 'pass', 'done move has a workflow.concluded event', { seq: event.seq })
      : verdict('I4', 'fail', 'done move has no workflow.concluded event');
  } catch (error) {
    return verdict('I4', 'fail', error.message);
  }
}

/** I5: every explicitly mapped tasks.json belongs to a registered workflow. */
function checkI5(input) {
  const mappings = Array.isArray(input.taskMappings) ? input.taskMappings : [];
  if (!mappings.length) return skipped('I5', 'task-workflow-registry-unavailable');
  const registered = new Set((input.registeredWorkflows || []).map((entry) => String(entry)));
  const orphans = mappings
    .filter((mapping) => !registered.has(String(mapping.workflowRef || mapping.workflowDir || '')))
    .map((mapping) => mapping.tasksPath || mapping.path || '(unknown tasks.json)');
  return orphans.length
    ? verdict('I5', 'fail', 'tasks.json is not mapped to a registered workflow', { orphans })
    : verdict('I5', 'pass', 'all tasks.json mappings resolve to registered workflows');
}

/** I6: index conclusion is only a projection and may not contradict state. */
function checkI6(input) {
  if (!input.statePresent || !input.indexPresent) return skipped('I6');
  if (!input.stateReadable || !input.indexReadable || !input.state) return skipped('I6', 'projection-unreadable');
  const indexDone = input.index.conclusion === 'done';
  const stateDone = input.state.overallStatus === 'done';
  return indexDone === stateDone
    ? verdict('I6', 'pass', 'index conclusion agrees with state authority', { indexDone, stateDone })
    : verdict('I6', 'fail', 'index conclusion contradicts state authority', { indexDone, stateDone });
}

/** I7: consume the existing ADR-contiguity evidence seam verbatim. */
function checkI7(input) {
  const evidence = input.adrNumberContiguous ?? input.evidence?.adrNumberContiguous;
  return typeof evidence !== 'boolean'
    ? skipped('I7', 'existing-adr-contiguity-evidence-unavailable')
    : evidence ? verdict('I7', 'pass', 'existing ADR contiguity seam passed') : verdict('I7', 'fail', 'existing ADR contiguity seam failed');
}

/** I8: consume the existing owner-nesting evidence seam verbatim. */
function checkI8(input) {
  const evidence = input.workflowNestedUnderOwner ?? input.evidence?.workflowNestedUnderOwner;
  return typeof evidence !== 'boolean'
    ? skipped('I8', 'existing-owner-nesting-evidence-unavailable')
    : evidence ? verdict('I8', 'pass', 'existing workflow nesting seam passed') : verdict('I8', 'fail', 'existing workflow nesting seam failed');
}

/** I9: verify the plan hash bound to the state, preserving state.mjs refusal. */
function checkI9(input) {
  const matches = input.planHashMatches ?? (
    input.state && typeof input.expectedPlanHash === 'string'
      ? input.state.planHash === input.expectedPlanHash
      : undefined
  );
  return typeof matches !== 'boolean'
    ? skipped('I9', 'plan-hash-evidence-unavailable')
    : matches ? verdict('I9', 'pass', 'state planHash matches the expected plan') : verdict('I9', 'fail', 'state planHash differs from the expected plan');
}

/** I10: journal sequence must be strictly increasing and append-oriented. */
function checkI10(input) {
  const events = input.journal ?? input.state?.events;
  if (!Array.isArray(events)) return skipped('I10', 'journal-unavailable');
  try {
    const seq = lastJournalSeq({ events });
    return verdict('I10', 'pass', 'journal sequence is strictly monotonic', { lastSeq: seq });
  } catch (error) {
    return verdict('I10', 'fail', error.message);
  }
}

const CHECKERS = Object.freeze({ I1: checkI1, I2: checkI2, I3: checkI3, I4: checkI4, I5: checkI5, I6: checkI6, I7: checkI7, I8: checkI8, I9: checkI9, I10: checkI10 });

/**
 * Evaluate one invariant in isolation. Useful for deterministic adversarial
 * fixtures and for the pre-commit touched-file adapter.
 * @param {string} id invariant id
 * @param {object} [input] checker context
 * @returns {{id:string,status:'pass'|'fail'|'skipped',reason:string,evidence:object}}
 */
export function checkInvariant(id, input = {}) {
  if (!INVARIANT_IDS.has(id)) throw new Error(`Unknown workflow invariant "${id}"`);
  try { return CHECKERS[id](loadContext(input)); }
  catch (error) { return skipped(id, `checker-error:${error?.message || 'unknown'}`); }
}

/** Build a deterministic self-healing proposal from the authoritative journal. */
function selfHealingFor(row, context) {
  if (row.status !== 'fail') return null;
  if (row.id === 'I2') {
    const folded = foldTaskStates(context.journal ?? context.state?.events);
    if (Object.keys(folded).length) return { status: 'available', action: 'rebuild-taskStates', projection: folded };
  }
  if (row.id === 'I1' && context.state && finalizationEvent(context.state)) {
    return { status: 'available', action: 'rebuild-state-status', projection: { overallStatus: 'done', journeyPhase: 'conclusion' } };
  }
  return null;
}

/**
 * Evaluate the complete I1-I10 set under a rollout posture.
 * @param {{root?:string,workflowDir?:string,mode?:'shadow'|'advisory'|'guarded'|'finalization',phase?:string}} [input]
 * @returns {{status:string,mode:string,phase:string,invariants:object[],blocked:object[],warnings:object[],skipped:object[],selfHealing:object[]}}
 */
export function evaluateInvariants(input = {}) {
  const mode = input.mode || 'shadow';
  const phase = input.phase || 'in-flight';
  const context = loadContext(input);
  const rows = INVARIANT_DEFINITIONS.map((definition) => checkInvariant(definition.id, context));
  const blockIds = mode === 'finalization'
    ? new Set([...BLOCKABLE_INVARIANTS, ...ADVISORY_INVARIANTS])
    : (mode === 'guarded' ? new Set(BLOCKABLE_INVARIANTS) : new Set());
  if (phase === 'finalization' && mode === 'guarded') for (const id of ADVISORY_INVARIANTS) blockIds.add(id);
  const blocked = rows.filter((row) => row.status === 'fail' && blockIds.has(row.id));
  const warnings = rows.filter((row) => row.status === 'fail' && !blockIds.has(row.id));
  const skippedRows = rows.filter((row) => row.status === 'skipped');
  const selfHealing = rows.map((row) => selfHealingFor(row, context)).filter(Boolean);
  return {
    status: blocked.length ? 'blocked' : warnings.length ? 'advisory' : rows.every((row) => row.status === 'skipped') ? 'skipped' : 'pass',
    mode,
    phase,
    invariants: rows,
    blocked,
    warnings,
    skipped: skippedRows,
    selfHealing,
  };
}

/** Return the project workflow directories, including active and done roots. */
export function workflowCorpusRoots(root = process.cwd()) {
  const paths = pathsFor(root);
  const roots = [paths.workflows, join(paths.workflows, 'done')];
  for (const parent of [paths.business, paths.operations]) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      roots.push(join(parent, entry.name, 'workflows'), join(parent, entry.name, 'done'));
    }
  }
  return roots;
}
