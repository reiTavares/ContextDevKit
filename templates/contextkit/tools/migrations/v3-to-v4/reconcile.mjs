/** @param {object} plan @returns {string[]} */
function legacyTaskIds(plan) {
  return [...new Set((plan?.waves || []).flatMap((wave) => (wave?.tasks || []))
    .map((task) => String(task?.id || '')).filter(Boolean))].sort();
}

/** @param {object[]} events @returns {string} */
function foldLegacyEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return 'not_started';
  return String(events.at(-1)?.to || events.at(-1)?.status || 'not_started');
}

/**
 * Read-only compatibility reconciliation used only by the explicit migration
 * corpus command. It never writes v3 and cannot authorize v4 cutover.
 *
 * @param {object} workflowRef
 * @returns {object}
 */
export function reconcileLegacyWorkflow(workflowRef) {
  const workflowId = workflowRef?.plan?.workflowId || workflowRef?.workflowId || null;
  if (workflowRef?.excluded === true) {
    return { workflowId, status: 'excluded', reason: workflowRef.exclusionReason || 'out-of-scope' };
  }
  if (workflowRef?.unreadable === true || !workflowRef?.plan || typeof workflowRef.plan !== 'object') {
    return { workflowId, status: 'quarantined', divergences: [{ kind: 'unreadable-artifact' }] };
  }
  const state = workflowRef.workflowState && typeof workflowRef.workflowState === 'object'
    ? workflowRef.workflowState : {};
  const stateTasks = state.taskStates && typeof state.taskStates === 'object' ? state.taskStates : {};
  const taskIds = legacyTaskIds(workflowRef.plan);
  const divergences = [];
  let inferred = false;
  for (const taskId of taskIds) {
    const hasJournal = Object.prototype.hasOwnProperty.call(workflowRef.journals || {}, taskId);
    const events = hasJournal ? workflowRef.journals[taskId] : [];
    if (hasJournal && !Array.isArray(events)) {
      divergences.push({ taskId, kind: 'invalid-journal' });
      continue;
    }
    const recordedStatus = String(stateTasks[taskId]?.status || 'not_started');
    const foldedStatus = foldLegacyEvents(events);
    if (recordedStatus !== foldedStatus) {
      if (hasJournal) divergences.push({ taskId, kind: 'fold-mismatch', recordedStatus, foldedStatus });
      else inferred = true;
    }
  }
  for (const taskId of Object.keys(stateTasks)) {
    if (!taskIds.includes(taskId)) divergences.push({ taskId, kind: 'state-task-not-in-plan' });
  }
  // The caller may pass the legacy stable-plan hash when it owns that serializer.
  if (state.planHash != null && workflowRef.expectedPlanHash && state.planHash !== workflowRef.expectedPlanHash) {
    divergences.push({ kind: 'plan-hash-mismatch' });
  }
  return {
    workflowId,
    status: divergences.length > 0 ? 'quarantined' : inferred ? 'reconciled-by-inference' : 'ready',
    divergences,
    provenance: { observed: divergences.length === 0 && !inferred },
  };
}

/** @param {object[]} workflowRefs @returns {object} */
export function reconcileWorkflowCorpus(workflowRefs) {
  const refs = Array.isArray(workflowRefs) ? workflowRefs : [];
  const excluded = refs.filter((ref) => ref?.excluded === true).map((ref) => ({
    workflowId: ref.plan?.workflowId || ref.workflowId || null,
    reason: ref.exclusionReason || 'out-of-scope',
  }));
  const results = refs.filter((ref) => ref?.excluded !== true).map(reconcileLegacyWorkflow);
  return {
    schemaVersion: 1,
    kind: 'workflow-task-reconciliation',
    status: results.some((reconciliation) => reconciliation.status === 'quarantined')
      ? 'quarantined' : (results.length === 0 ? 'skipped' : 'ready'),
    workflowCount: results.length,
    results,
    excluded,
  };
}
