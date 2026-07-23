/** Rollout adapter for the WF-0084 invariant set and optional projection repair. */
import { join } from 'node:path';
import { applyStateUpdate, readState, writeStateCas } from './state.mjs';
import { planHash } from './plan.mjs';
import { evaluateInvariants, foldTaskStates } from './invariants.mjs';
import { ownerFromIndex, withWorkflowLock } from './finalization.mjs';

/**
 * Run a guard for an already-resolved workflow pack.
 * @param {string} root project root
 * @param {{packDir:string,statePath:string,plan:object}} pack loaded pack
 * @param {{mode?:string,phase?:string,apply?:boolean,now?:string}} [options] rollout options
 * @returns {object} guard receipt
 */
export function guardPack(root, pack, {
  mode = 'shadow',
  phase = 'in-flight',
  apply = false,
  now = new Date().toISOString(),
} = {}) {
  const expectedPlanHash = planHash(pack.plan);
  const context = {
    root,
    workflowDir: pack.packDir,
    owner: ownerFromIndex(join(pack.packDir, 'index.md')),
    expectedPlanHash,
    mode,
    phase,
  };
  let outcome = evaluateInvariants(context);
  const repairs = [];
  if (!apply || !outcome.selfHealing.length || !pack.statePath) return { ...outcome, repairs, applied: false };

  return withWorkflowLock(root, pack.plan.workflowId || pack.packDir, () => {
    const current = readState(pack.statePath);
    if (!current) return { ...outcome, repairs, applied: false };
    const repairPatch = {};
    for (const repair of outcome.selfHealing) {
      if (repair.action === 'rebuild-state-status') {
        Object.assign(repairPatch, repair.projection);
        repairs.push(repair.action);
      } else if (repair.action === 'rebuild-taskStates') {
        repairPatch.taskStates = foldTaskStates(current.events);
        repairs.push(repair.action);
      }
    }
    if (repairs.length) {
      const next = applyStateUpdate(current, repairPatch, {
        expectedRevision: current.revision,
        planHash: expectedPlanHash,
        now,
      });
      writeStateCas(pack.statePath, next, { expectedRevision: current.revision, planHash: expectedPlanHash });
      outcome = evaluateInvariants(context);
    }
    return { ...outcome, repairs, applied: repairs.length > 0 };
  });
}
