/**
 * Lifecycle Map projection for WF-0085.
 *
 * The map has no persistence authority. It is reconstructed from the canonical
 * journey, ceremony manifest, and workflow/entity state. A mismatching stored
 * candidate is rejected as a hand edit.
 */
import { renderJourneyCommand } from './journey-command.mjs';

const PHASE_TO_STAGE = Object.freeze({
  intake: 'intake',
  prd: 'workflow-nested',
  spec: 'governing-adr',
  adr: 'governing-adr',
  roadmap: 'tasks-authoring',
  pipeline: 'tasks-authoring',
  ship: 'implement',
  implementation: 'implement',
  testing: 'tests',
  qa: 'qa-signoff',
  conclusion: 'done-move',
  done: 'done-move',
});

/**
 * Resolves a ceremony shape to its journey branch.
 *
 * @param {object} manifest - Canonical ceremony template manifest.
 * @param {object} state - Workflow/entity state.
 * @returns {{ shape: string|null, branchId: string|null }}
 */
function resolveBranch(manifest, state) {
  const shape = state?.ceremonyShape || state?.shape || state?.executionShape || null;
  const branchId = state?.journeyBranch || (shape ? manifest?.shapes?.[shape]?.journeyBranch : null);
  return { shape, branchId: branchId || null };
}

/**
 * Resolves a branch-specific command without collapsing Business and child
 * workflow finalization into one mutation.
 *
 * @param {object} stage - Journey stage.
 * @param {string} branchId - Selected branch.
 * @param {object} state - Current normalized state.
 * @returns {object|null} Command descriptor.
 */
function resolveStageCommand(stage, branchId, state) {
  if (
    stage.id === 'done-move'
    && branchId === 'business-workflow'
    && state.childWorkflowsDone === true
  ) {
    return stage.businessCloseCommand || null;
  }
  const hasBranchCommand = Object.prototype.hasOwnProperty.call(stage.commandByBranch || {}, branchId);
  return hasBranchCommand ? stage.commandByBranch[branchId] : stage.command || null;
}

/**
 * Creates the complete derived Lifecycle Map.
 *
 * @param {object} journey - Canonical journey definition.
 * @param {object} manifest - Canonical ceremony manifest.
 * @param {object} state - Workflow/entity state plus optional branch hints.
 * @returns {object|null} Derived map, or null when inputs cannot resolve safely.
 */
export function projectLifecycleMap(journey, manifest, state) {
  if (!journey?.branches || !manifest?.shapes || !state || typeof state !== 'object') return null;
  const { shape, branchId } = resolveBranch(manifest, state);
  const branchSequence = branchId ? journey.branches[branchId] : null;
  if (!Array.isArray(branchSequence)) return null;
  const sequence = [
    ...branchSequence,
    ...(Array.isArray(journey.postTerminal) ? journey.postTerminal : []),
  ];

  const phase = state.journeyPhase || state.currentPhase || state.phase || 'intake';
  let requestedStage = state.stageId || PHASE_TO_STAGE[phase] || phase;
  if (
    branchId === 'business-workflow'
    && state.childWorkflowsDone === true
    && !['validated', 'partially-validated', 'closed'].includes(state.businessStatus)
  ) {
    requestedStage = 'done-move';
  } else if (
    state.entityMovedToDone === true
    || state.overallStatus === 'done'
    || ['validated', 'partially-validated', 'closed'].includes(state.status)
  ) {
    requestedStage = state.sessionLogged === true ? null : 'log-session';
  }
  if (!requestedStage) return null;
  const stageId = sequence.includes(requestedStage) ? requestedStage : sequence[0];
  const stage = (journey.stages || []).find((candidate) => candidate.id === stageId);
  if (!stage) return null;
  const command = resolveStageCommand(stage, branchId, state);

  return Object.freeze({
    schemaVersion: 1,
    shape,
    branchId,
    phase,
    stageId,
    nextCommand: renderJourneyCommand(command),
  });
}

/**
 * Renders the derived map deterministically.
 *
 * @param {object|null} map - Result from {@link projectLifecycleMap}.
 * @returns {string} Stable text representation, or an empty string.
 */
export function renderLifecycleMap(map) {
  if (!map) return '';
  return [
    `shape: ${map.shape || 'unknown'}`,
    `branch: ${map.branchId}`,
    `phase: ${map.phase}`,
    `stage: ${map.stageId}`,
    `next: ${map.nextCommand || 'none'}`,
  ].join('\n');
}

/**
 * Rejects a candidate map that differs from the canonical projection.
 *
 * @param {string} candidate - Candidate rendered map.
 * @param {object} journey - Canonical journey definition.
 * @param {object} manifest - Canonical ceremony manifest.
 * @param {object} state - Current source state.
 * @returns {true}
 * @throws {Error} When the candidate was hand-edited or inputs are unresolved.
 */
export function assertLifecycleMapProjection(candidate, journey, manifest, state) {
  const expected = renderLifecycleMap(projectLifecycleMap(journey, manifest, state));
  if (!expected) throw new Error('Lifecycle Map projection is unavailable');
  if (String(candidate).trim() !== expected) {
    throw new Error('Lifecycle Map hand edit rejected: regenerate from journey + manifest + state');
  }
  return true;
}
