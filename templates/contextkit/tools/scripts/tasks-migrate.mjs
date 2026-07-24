/**
 * WF-0059 W7 — migration (additive-then-subtractive, with an exercised rollback).
 *
 * Relocates the flat DevPipeline board onto per-owner `tasks.json` WITHOUT losing
 * history or provenance, faithful to the 2026-06-26 CONSENSUS (SPEC §D9). The
 * discipline, not just the end state:
 *
 *   - **Dry-run by default.** `planMigration` produces a `migration-manifest.json`
 *     and writes NOTHING (constitution §8). `applyMigration` needs an explicit
 *     apply intent.
 *   - **Identity = `contentHash + sourcePath`.** The numeric id is provenance,
 *     not a key — the duplicate `001` proves it. Two cards with the same id but
 *     different content+path are two distinct survivors.
 *   - **Conservation law.** `total === Σ{migrated, merged, cancelled, fixture,
 *     invalid, review_required}` — every Stage-0 card is accounted for, nothing
 *     invented, nothing dropped. `buildManifest` refuses (throws) if the law fails.
 *   - **No fabricated history.** A card is classified from OBSERVED facts only;
 *     no card is assigned `blocked` at migration; the 148 unowned + dup ids go to
 *     `review_required` (a triage inbox), never a guessed owner.
 *   - **Exercised rollback.** `applyMigration` first snapshots Stage-0 into an
 *     immutable archive; `rollbackMigration` restores it BYTE-IDENTICALLY. The
 *     selftest actually runs the drill (not just documents it) — rollback is the
 *     sole safety net under complete replacement.
 *   - **Idempotent.** Re-running `applyMigration` with the same manifest is a
 *     no-op (same archive, same outputs) — safe to resume.
 *
 * Pure core (`classifyCard`, `buildManifest`) + an injected `io` for the apply/
 * rollback file effects, so the whole thing is testable without touching a live
 * board. Consumes the W1 inventory (the parity oracle) and the W6 compat
 * resolvers. Zero-dep beyond `node:*`.
 */
import { createHash } from 'node:crypto';
import { foldStatus, INITIAL_STATE } from './tasks-schema.mjs';
import { deriveWorkflowTasks } from './tasks-derive.mjs';
import { planHash } from './workflow/plan.mjs';

/** The closed disposition set — the conservation law sums over exactly these. */
export const DISPOSITIONS = Object.freeze([
  'migrated', 'merged', 'cancelled', 'fixture', 'invalid', 'review_required',
]);

/**
 * The closed provenance-aware reconciliation verdict set (D1, ADR-0148):
 *   - `ready` — an OBSERVED journal folds to the recorded status; cutover-eligible.
 *   - `reconciled-by-inference` — a concluded workflow with no journal but a
 *     self-consistent `taskStates`; corpus-safe, but NEVER authorizes cutover
 *     (provenance.observed = false). The honest verdict for the legacy corpus.
 *   - `quarantined` — a genuine divergence (fold-mismatch / plan-hash-mismatch /
 *     state-task-not-in-plan / invalid-journal); blocks the corpus gate.
 *   - `excluded` — out of scope (a parallel session owns it); recorded explicitly.
 */
export const RECONCILIATION_VERDICTS = Object.freeze([
  'ready', 'reconciled-by-inference', 'quarantined', 'excluded',
]);

/**
 * Divergence kinds that quarantine a workflow (a genuine inconsistency, never
 * silently reconciled). `missing-journal` is deliberately NOT here: on a concluded
 * workflow it is inference-grade evidence, downgrading the verdict to
 * `reconciled-by-inference` rather than blocking (constitution §8: an inferred
 * fact is honestly marked, not fabricated into an observed pass).
 */
export const BLOCKING_DIVERGENCE_KINDS = Object.freeze([
  'fold-mismatch', 'plan-hash-mismatch', 'state-task-not-in-plan', 'invalid-journal',
]);

/**
 * The conservation-law invariant, extracted so it is single-sourced AND directly
 * testable: `total` must equal the sum of `counts` over the closed disposition
 * set. A mismatch means a Stage-0 card was dropped, invented, or classified into
 * an unknown bucket — a migration bug, not a warning. THROWS on violation.
 *
 * @param {number} total — the Stage-0 card count
 * @param {Record<string, number>} counts — per-disposition counts
 * @returns {number} the summed total (equal to `total` on success)
 * @throws {Error} when `total !== Σ counts`
 */
export function assertConservation(total, counts) {
  const summed = DISPOSITIONS.reduce((acc, disposition) => acc + (counts[disposition] || 0), 0);
  if (total !== summed) {
    throw new Error(`migration conservation law violated: total ${total} !== Σ ${summed} (${JSON.stringify(counts)})`);
  }
  return summed;
}

/**
 * Classifies ONE Stage-0 inventory card into a disposition from OBSERVED facts.
 * `verdicts` (optional) is an injected map `id -> 'merged'|'cancelled'` carrying
 * pre-recorded human reconciliation decisions; without a verdict, an ambiguous
 * card falls to `review_required` (never a guess).
 *
 * @param {object} card — a W1 inventory record { id, owned, fixture, workflow, ... }
 * @param {{ duplicateIds?: Set<string>, verdicts?: Record<string,string> }} [ctx]
 * @returns {{ disposition: string, reason: string }}
 */
export function classifyCard(card, ctx = {}) {
  if (!card || typeof card !== 'object' || !card.id) return { disposition: 'invalid', reason: 'missing id' };
  const verdict = ctx.verdicts?.[card.id];
  if (verdict === 'merged' || verdict === 'cancelled') return { disposition: verdict, reason: 'human verdict' };
  if (card.fixture) return { disposition: 'fixture', reason: 'fixture card' };
  if (ctx.duplicateIds?.has(card.id)) return { disposition: 'review_required', reason: 'duplicate id — needs reconciliation' };
  if (!card.owned) return { disposition: 'review_required', reason: 'unowned — needs reconciliation' };
  return { disposition: 'migrated', reason: 'resolvable owner' };
}

/**
 * Builds the migration manifest from a W1 inventory. Deterministic; THROWS if the
 * conservation law fails (a card unaccounted for is a migration bug, not a warning).
 *
 * @param {object} inventory — from `buildInventory` (W1): { totals, anomalies, cards }
 * @param {{ verdicts?: Record<string,string> }} [ctx]
 * @returns {object} the manifest (schemaVersion, total, counts, entries[])
 * @throws {Error} when total !== Σ counts
 */
export function buildManifest(inventory, ctx = {}) {
  const cards = Array.isArray(inventory?.cards) ? inventory.cards : [];
  const duplicateIds = new Set(inventory?.anomalies?.duplicateIds || []);
  const counts = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  const entries = cards.map((card) => {
    const { disposition, reason } = classifyCard(card, { duplicateIds, verdicts: ctx.verdicts });
    counts[disposition] += 1;
    return {
      id: card.id,
      disposition,
      reason,
      owner: disposition === 'migrated' ? { kind: 'WF', ref: card.workflow } : null,
      identity: { contentHash: card.contentHash, sourcePath: card.sourcePath },
    };
  }).sort((a, b) => a.identity.sourcePath.localeCompare(b.identity.sourcePath));

  const total = cards.length;
  assertConservation(total, counts);
  return { schemaVersion: 1, kind: 'migration-manifest', total, conservationOk: true, counts, entries };
}

/** Byte-stable manifest serialization (2-space, trailing newline). */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Return the task ids in plan order-independent form. */
function workflowTaskIds(plan) {
  const ids = [];
  for (const wave of plan?.waves || []) {
    for (const task of wave?.tasks || []) if (task?.id) ids.push(String(task.id));
  }
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

/**
 * Reconcile journal folds against the legacy workflow-state projection, deciding
 * a provenance-aware verdict (D1, ADR-0148). A task whose status came from a real
 * journal read is OBSERVED evidence; a concluded task with a non-initial status
 * but no journal is INFERRED evidence — honestly downgraded to
 * `reconciled-by-inference`, never fabricated into an observed pass (§8). A
 * genuine inconsistency (fold-mismatch / plan-hash / orphan task / invalid
 * journal) quarantines.
 *
 * @param {object} plan workflow topology
 * @param {object} workflowState existing workflow-state projection
 * @param {Record<string, Array<object>>} [journals] task id to journal events
 * @returns {{ ok: boolean, divergences: object[], verdict: string,
 *   provenance: { observed: boolean } }} parity result
 */
export function reconcileWorkflowTaskStates(plan, workflowState, journals = {}) {
  const divergences = [];
  const stateTasks = workflowState?.taskStates && typeof workflowState.taskStates === 'object'
    ? workflowState.taskStates : {};
  const journalMap = journals && typeof journals === 'object' ? journals : {};
  const taskIds = workflowTaskIds(plan);
  let inferredCount = 0;

  for (const taskId of taskIds) {
    const recordedStatus = stateTasks[taskId]?.status ?? INITIAL_STATE;
    const hasJournal = Object.prototype.hasOwnProperty.call(journalMap, taskId);
    const events = hasJournal ? journalMap[taskId] : [];
    if (hasJournal && !Array.isArray(events)) {
      divergences.push({ taskId, kind: 'invalid-journal', detail: 'journal must be an array' });
      continue;
    }
    const foldedStatus = foldStatus(events);
    if (recordedStatus !== foldedStatus) {
      // A missing journal on a non-initial concluded status is inference-grade
      // evidence (not a blocking divergence); a real fold-mismatch is genuine.
      if (!hasJournal) inferredCount += 1;
      divergences.push({
        taskId,
        kind: hasJournal ? 'fold-mismatch' : 'missing-journal',
        foldedStatus,
        recordedStatus,
      });
    }
  }
  for (const taskId of Object.keys(stateTasks)) {
    if (!taskIds.includes(taskId)) divergences.push({ taskId, kind: 'state-task-not-in-plan' });
  }
  if (workflowState?.planHash != null && workflowState.planHash !== planHash(plan)) {
    divergences.push({ kind: 'plan-hash-mismatch', expected: planHash(plan), actual: workflowState.planHash });
  }

  const hasBlocking = divergences.some((divergence) => BLOCKING_DIVERGENCE_KINDS.includes(divergence.kind));
  const verdict = hasBlocking
    ? 'quarantined'
    : inferredCount > 0 ? 'reconciled-by-inference' : 'ready';
  // `observed` is true only when every status came from a real journal read —
  // i.e. a `ready` verdict with no inferred contribution.
  return {
    ok: divergences.length === 0,
    divergences,
    verdict,
    provenance: { observed: verdict === 'ready' },
  };
}

/**
 * Build a dry-run, additive workflow migration projection. No filesystem write
 * occurs here. `status` carries the provenance-aware verdict (D1): only `ready`
 * (observed journal) authorizes a downstream cutover; `reconciled-by-inference`
 * is corpus-safe but non-authorizing; `quarantined` blocks; `excluded` is a
 * short-circuit for a ref another session owns. Callers must not persist the
 * projection or flip a consumer on a non-`ready` verdict.
 *
 * @param {{ plan: object, workflowState: object, journals?: object,
 *   excluded?: boolean, exclusionReason?: string }} workflowRef
 * @returns {{ schemaVersion: number, kind: string, status: string, planHash?: string,
 *   reconciliation?: object, projection?: object }} migration plan
 * @throws {TypeError} when the workflow reference is incomplete
 */
export function migrateWorkflow(workflowRef) {
  if (!workflowRef || typeof workflowRef !== 'object') throw new TypeError('migrateWorkflow: workflowRef is required');
  // `excluded` short-circuits BEFORE reconcile/derive — an out-of-scope ref (a
  // parallel session owns it) is recorded explicitly, never silently dropped (§8).
  if (workflowRef.excluded === true) {
    return {
      schemaVersion: 1,
      kind: 'workflow-task-migration-plan',
      workflowId: workflowRef.plan?.workflowId ?? workflowRef.workflowId ?? null,
      status: 'excluded',
      reason: workflowRef.exclusionReason ?? 'out-of-scope',
    };
  }
  // `unreadable` = a present-but-unparseable plan/state file. It is an integrity
  // fault, not an empty workflow: quarantine it, never certify ready+observed (§8).
  if (workflowRef.unreadable === true) {
    return {
      schemaVersion: 1,
      kind: 'workflow-task-migration-plan',
      workflowId: workflowRef.plan?.workflowId ?? workflowRef.workflowId ?? null,
      status: 'quarantined',
      reconciliation: { ok: false, verdict: 'quarantined', provenance: { observed: false },
        divergences: [{ kind: 'unreadable-artifact', detail: 'workflow plan or state present but unparseable' }] },
    };
  }
  if (!workflowRef.plan || typeof workflowRef.plan !== 'object') throw new TypeError('migrateWorkflow: workflowRef.plan is required');
  const workflowPlanHash = planHash(workflowRef.plan);
  const reconciliation = reconcileWorkflowTaskStates(
    workflowRef.plan,
    workflowRef.workflowState || {},
    workflowRef.journals || {},
  );
  const projection = deriveWorkflowTasks(workflowRef.plan);
  const journalMap = workflowRef.journals && typeof workflowRef.journals === 'object' ? workflowRef.journals : {};
  projection.tasks = projection.tasks.map((task) => ({
    ...task,
    status: Object.prototype.hasOwnProperty.call(journalMap, task.id)
      ? foldStatus(journalMap[task.id])
      : INITIAL_STATE,
  }));
  // The projection carries the same provenance verdict — a downstream reader
  // must be able to tell an inferred projection from an observed one.
  projection.provenance = { observed: reconciliation.provenance.observed };
  return {
    schemaVersion: 1,
    kind: 'workflow-task-migration-plan',
    workflowId: workflowRef.plan.workflowId,
    planHash: workflowPlanHash,
    stateRevision: Number.isInteger(workflowRef.workflowState?.revision)
      ? workflowRef.workflowState.revision : null,
    status: reconciliation.verdict,
    reconciliation,
    projection,
  };
}

/**
 * Reconcile a frozen corpus before any consumer cutover (D1). Out-of-scope refs
 * (`ref.excluded`) are partitioned into an auditable `excluded[]` and never enter
 * the readiness computation (§8: recorded explicitly, never silently dropped).
 * The corpus is `ready` iff ZERO in-scope results are `quarantined`; an in-scope
 * `reconciled-by-inference` is corpus-safe (does not block) but does NOT authorize
 * a cutover — that gate is `canCutover`'s observed-parity check, independently.
 *
 * @param {Array<object>} workflowRefs workflow references with plan/state/journals
 * @returns {{ schemaVersion: number, kind: string, status: string,
 *   workflowCount: number, results: object[], excluded: object[] }} corpus receipt
 */
export function reconcileWorkflowCorpus(workflowRefs) {
  const refs = Array.isArray(workflowRefs) ? workflowRefs : [];
  const inScope = refs.filter((ref) => ref?.excluded !== true);
  const excludedRefs = refs.filter((ref) => ref?.excluded === true);
  const excluded = excludedRefs.map((ref) => ({
    workflowId: ref.plan?.workflowId ?? ref.workflowId ?? null,
    reason: ref.exclusionReason ?? 'out-of-scope',
  }));

  if (inScope.length === 0) {
    return {
      schemaVersion: 1,
      kind: 'workflow-task-reconciliation',
      status: 'skipped',
      workflowCount: 0,
      results: [],
      excluded,
    };
  }
  const results = inScope.map((workflowRef) => {
    try {
      return migrateWorkflow(workflowRef);
    } catch (error) {
      return {
        status: 'quarantined',
        workflowId: workflowRef?.plan?.workflowId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  // Green iff nothing genuinely divergent — an inferred reconciliation is honest,
  // not a block; a fabricated observed pass is what §8 forbids and what we avoid.
  const hasQuarantine = results.some((result) => result.status === 'quarantined');
  return {
    schemaVersion: 1,
    kind: 'workflow-task-reconciliation',
    status: hasQuarantine ? 'quarantined' : 'ready',
    workflowCount: results.length,
    results,
    excluded,
  };
}

/** sha256 of a string, prefixed — matches W1's contentHash for parity checks. */
function hash(text) {
  return `sha256:${createHash('sha256').update(String(text), 'utf-8').digest('hex')}`;
}

/**
 * Applies the migration ADDITIVELY via the injected `io`, snapshotting Stage-0
 * into an immutable archive FIRST (the rollback source). Idempotent: a second
 * apply with the same manifest re-snapshots identical bytes and re-writes the
 * same outputs. Does NOT delete the old board — that is Phase 2 (W8), only after
 * parity + an exercised rollback.
 *
 * `io` contract:
 *   - `snapshotStage0()` → `{ [path]: contents }` a byte map of the current board
 *   - `writeArchive(byteMap)` — persist the immutable Stage-0 archive
 *   - `readArchive()` → `{ [path]: contents }` — read it back (for the drill)
 *   - `writeManifest(text)` — persist the manifest
 *
 * @param {object} io
 * @param {object} manifest
 * @returns {{ archivedPaths: string[], archiveDigest: string, applied: boolean }}
 */
export function applyMigration(io, manifest) {
  const byteMap = io.snapshotStage0();
  io.writeArchive(byteMap);
  io.writeManifest(serializeManifest(manifest));
  const archivedPaths = Object.keys(byteMap).sort();
  const archiveDigest = hash(archivedPaths.map((p) => `${p}${byteMap[p]}`).join(''));
  return { archivedPaths, archiveDigest, applied: true };
}

/**
 * The EXERCISED rollback: reads the archive and restores every path byte-for-byte
 * via `io.restore(path, contents)`. Returns the restored digest so the caller (or
 * the selftest) can assert it equals the pre-migration digest — byte-identical.
 *
 * @param {object} io — { readArchive, restore }
 * @returns {{ restoredPaths: string[], digest: string }}
 */
export function rollbackMigration(io) {
  const byteMap = io.readArchive();
  const restoredPaths = Object.keys(byteMap).sort();
  for (const path of restoredPaths) io.restore(path, byteMap[path]);
  const digest = hash(restoredPaths.map((p) => `${p}${byteMap[p]}`).join(''));
  return { restoredPaths, digest };
}
