/**
 * In-process self-test for WF-0059 W2 — the `tasks.json` schema + validators
 * (`tasks-schema.mjs` + `tasks-validate.mjs`), the source-of-truth guardrail.
 *
 * Tests the ACTUAL exported API against in-memory fixtures (no disk, no live
 * tree). Every assertion maps to a deliberation ratification condition:
 *   validateTask / validateTasksDoc → { ok, errors }
 *   assertTasksDoc                  → throws on any error
 *   foldStatus / isLegalTransition / eventsContiguous → pure lifecycle primitives
 *
 * Sections:
 *   [a] lifecycle table — legal edges pass; illegal/blocked-actor edges fail; done terminal
 *   [b] foldStatus — empty ⇒ initial; folds to last event's `to`
 *   [c] O4 — a task without a resolvable owner FK is refused
 *   [d] single-journal fence — inline `events` on a task is a violation; sidecarRef required
 *   [e] fold==status fence — status disagreeing with fold(events) is refused; contiguity checked
 *   [f] done predicate — done without acceptanceMet+evidenceRef refused
 *   [g] blocked predicate — blocked without category/explanation/deterministic releaseCondition refused
 *   [h] O2 (doc) — a task whose owner FK differs from the document owner is refused
 *   [i] assertTasksDoc — throws on invalid, returns doc on valid
 *   [j] a fully-valid doc passes clean
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import {
  TASK_STATES, LEGAL_TRANSITIONS, foldStatus, isLegalTransition, eventsContiguous,
} from './tasks-schema.mjs';
import { validateTask, validateTasksDoc, assertTasksDoc } from './tasks-validate.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/** A valid baseline task (owner WF-0059, working, journal folds to working). */
const okOwner = () => true;
const journalWorking = () => [{ from: 'not_started', to: 'working' }];
function validTask(extra = {}) {
  return {
    id: '342', title: 'schema + validators', type: 'feature', status: 'working',
    owner: { kind: 'WF', id: 'WF-0059', lane: null },
    sidecarRef: 'state/342', acceptanceMet: false, evidenceRef: null, blocker: null,
    ...extra,
  };
}
function validDoc(tasks) {
  return { schemaVersion: 1, owner: { kind: 'WF', id: 'WF-0059', lane: null }, revision: 1, executionMode: 'workflow', tasks };
}
const deps = { resolveOwner: okOwner, foldEvents: journalWorking };

// [a] lifecycle table
assert('[a] 5 states exactly', TASK_STATES.length === 5 && TASK_STATES.includes('blocked'));
assert('[a] working→testing legal', isLegalTransition('working', 'testing'));
assert('[a] working→blocked legal', isLegalTransition('working', 'blocked'));
assert('[a] blocked→working legal', isLegalTransition('blocked', 'working'));
assert('[a] blocked enters from working ONLY (not_started→blocked illegal)', !isLegalTransition('not_started', 'blocked'));
assert('[a] blocked exits to working ONLY (blocked→testing illegal)', !isLegalTransition('blocked', 'testing'));
assert('[a] testing→working (qa-reject) legal', isLegalTransition('testing', 'working'));
assert('[a] testing→done (qa-approve) legal', isLegalTransition('testing', 'done'));
assert('[a] done is terminal', LEGAL_TRANSITIONS.done.length === 0);
assert('[a] no working→done shortcut', !isLegalTransition('working', 'done'));

// [b] foldStatus
assert('[b] empty journal ⇒ not_started', foldStatus([]) === 'not_started');
assert('[b] folds to last to', foldStatus([{ from: 'not_started', to: 'working' }, { from: 'working', to: 'testing' }]) === 'testing');
assert('[b] contiguous legal chain ok', eventsContiguous([{ from: 'not_started', to: 'working' }, { from: 'working', to: 'testing' }]));
assert('[b] broken chain rejected', !eventsContiguous([{ from: 'not_started', to: 'working' }, { from: 'testing', to: 'done' }]));

// [c] O4 — ownerless refused
assert('[c] missing owner refused', !validateTask(validTask({ owner: undefined }), deps).ok);
assert('[c] bad owner kind refused', !validateTask(validTask({ owner: { kind: 'ZZ', id: 'x' } }), deps).ok);
assert('[c] unresolvable owner refused', !validateTask(validTask(), { resolveOwner: () => false, foldEvents: journalWorking }).ok);

// [d] single-journal fence
assert('[d] inline events forbidden', !validateTask(validTask({ events: [{ from: 'not_started', to: 'working' }] }), deps).ok);
assert('[d] missing sidecarRef refused', !validateTask(validTask({ sidecarRef: '' }), deps).ok);

// [e] fold==status fence
assert('[e] status disagreeing with fold refused', !validateTask(
  validTask({ status: 'testing' }), { resolveOwner: okOwner, foldEvents: journalWorking }).ok);
assert('[e] status agreeing with fold passes', validateTask(
  validTask({ status: 'working' }), { resolveOwner: okOwner, foldEvents: journalWorking }).ok);
assert('[e] no resolver ⇒ fold fence skipped (still ok)', validateTask(validTask(), { resolveOwner: okOwner }).ok);

// [f] done predicate
assert('[f] done w/o evidence refused', !validateTask(
  validTask({ status: 'done', acceptanceMet: false }), { resolveOwner: okOwner, foldEvents: () => [{ from: 'testing', to: 'done' }] }).ok);
assert('[f] done w/ evidence + acceptance passes', validateTask(
  validTask({ status: 'done', acceptanceMet: true, evidenceRef: 'reports/x.md' }),
  { resolveOwner: okOwner, foldEvents: () => [{ from: 'not_started', to: 'working' }, { from: 'working', to: 'testing' }, { from: 'testing', to: 'done' }] }).ok);

// [g] blocked predicate
const blockedFold = () => [{ from: 'not_started', to: 'working' }, { from: 'working', to: 'blocked' }];
assert('[g] blocked w/o blocker refused', !validateTask(
  validTask({ status: 'blocked', blocker: null }), { resolveOwner: okOwner, foldEvents: blockedFold }).ok);
assert('[g] blocked w/ free-text releaseCondition refused', !validateTask(
  validTask({ status: 'blocked', blocker: { category: 'dependency_unmet', explanation: 'waits', releaseCondition: 'when 341 merges' } }),
  { resolveOwner: okOwner, foldEvents: blockedFold }).ok);
assert('[g] blocked w/ deterministic predicate passes', validateTask(
  validTask({ status: 'blocked', blocker: { category: 'dependency_unmet', explanation: 'waits on 341', releaseCondition: { kind: 'task_done', ref: '341' } } }),
  { resolveOwner: okOwner, foldEvents: blockedFold }).ok);

// [h] O2 (doc-level) — task owner must match doc owner
const crossKind = validDoc([validTask({ owner: { kind: 'OP', id: 'OP-0004' } })]);
assert('[h] cross-kind owner in doc refused', !validateTasksDoc(crossKind, deps).ok);

// [i] assertTasksDoc throws / returns
let threw = false;
try { assertTasksDoc(validDoc([validTask({ owner: undefined })]), deps); } catch { threw = true; }
assert('[i] assertTasksDoc throws on invalid', threw);
assert('[i] assertTasksDoc returns doc on valid', assertTasksDoc(validDoc([validTask()]), deps).revision === 1);

// [j] fully-valid doc passes clean
const good = validateTasksDoc(validDoc([validTask(), validTask({ id: '343', sidecarRef: 'state/343' })]), deps);
assert('[j] valid doc ok, zero errors', good.ok && good.errors.length === 0, JSON.stringify(good.errors));

// defensive — never throws on garbage
assert('[k] validateTasksDoc(null) → not ok, no throw', validateTasksDoc(null).ok === false);
assert('[k] validateTask(null) → not ok, no throw', validateTask(null).ok === false);

process.stdout.write(`\nWF-0059 W2 tasks-schema/validators selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
