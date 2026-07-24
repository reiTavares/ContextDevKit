/**
 * Read-only adapters for `work next` and `work map` (WF-0085).
 *
 * Unreadable journey/manifest/state yields a skipped result and no command
 * output, so discoverability never fail-closes a fresh installation.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { buildWorkflowRegistry, resolveWorkflow } from './registry/workflow.mjs';
import { buildWorkContextRegistry } from './registry/work-context.mjs';
import { resolveActiveContext } from '../../runtime/execution/active-context-resolver.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { loadJourney } from '../../runtime/work/journey-verifier.mjs';
import {
  assertLifecycleMapProjection,
  projectLifecycleMap,
  renderLifecycleMap,
} from '../../runtime/work/lifecycle-map.mjs';
import { makeReceipt } from './work-io.mjs';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

/** Resolve a registry-relative workflow path against the canonical memory root. */
function workflowPackPath(root, workflow) {
  return isAbsolute(workflow.path)
    ? workflow.path
    : join(pathsFor(root).memory, workflow.path);
}

/** Derive a legacy pack's shape without creating a second shape taxonomy. */
function deriveWorkflowShape(plan, workflow) {
  const declaredShape = plan?.journey?.shape;
  if (declaredShape) return declaredShape;
  if (workflow.owner?.startsWith('BIZ-')) return 'multi-workflow-program';
  if (workflow.owner?.startsWith('OP-')) return 'single-workflow-operation';
  return null;
}

/** True only when every workflow owned by the Business is authoritatively done. */
function allOwnerWorkflowsDone(root, workflow) {
  if (!workflow.owner?.startsWith('BIZ-')) return false;
  try {
    const owned = buildWorkflowRegistry(root).workflows.filter((row) => row.owner === workflow.owner);
    return owned.length > 0 && owned.every((row) => row.status === 'done');
  } catch {
    return false;
  }
}

/** Builds a normalized journey state for a non-workflow Business or Operation. */
function loadEntityState(root, active, manifest) {
  const entityId = active.operation || active.business;
  if (!entityId) return null;
  try {
    const row = buildWorkContextRegistry(root).contexts.find((candidate) => candidate.id === entityId);
    if (!row) return null;
    const entityDir = join(pathsFor(root).memory, row.path);
    const isOperation = entityId.startsWith('OP-');
    const entity = readJson(join(entityDir, isOperation ? 'operation.json' : 'business.json'));
    if (!entity) return null;

    if (isOperation) {
      const shape = entity.executionMode === 'batch'
        ? 'batch-operation'
        : entity.executionMode === 'workflow'
          ? 'single-workflow-operation'
          : 'quick-fix';
      const terminal = ['done', 'closed', 'concluded'].includes(entity.status);
      return {
        ceremonyShape: shape,
        journeyBranch: manifest.shapes?.[shape]?.journeyBranch || null,
        stageId: terminal
          ? 'log-session'
          : shape === 'single-workflow-operation'
              ? 'workflow-nested'
              : 'implement',
        status: entity.status || null,
      };
    }

    const shape = entity.intake?.programProfile === 'multi-workflow'
      || entity.intake?.ceremony === 'workflow'
      ? 'multi-workflow-program'
      : 'decision-only';
    const owned = buildWorkflowRegistry(root).workflows.filter((workflow) => workflow.owner === entityId);
    const childWorkflowsDone = owned.length > 0 && owned.every((workflow) => workflow.status === 'done');
    const terminal = ['validated', 'partially-validated', 'closed'].includes(entity.status);
    return {
      ceremonyShape: shape,
      journeyBranch: manifest.shapes?.[shape]?.journeyBranch || null,
      stageId: terminal
        ? 'log-session'
        : shape === 'multi-workflow-program' && childWorkflowsDone
          ? 'done-move'
          : shape === 'multi-workflow-program'
            ? 'workflow-nested'
            : 'business-context',
      childWorkflowsDone,
      businessStatus: entity.status || null,
      status: entity.status || null,
    };
  } catch {
    return null;
  }
}

/**
 * Loads canonical Lifecycle Map inputs from flags and disk.
 *
 * @param {object} flags - Parsed CLI flags.
 * @param {string} root - Project root.
 * @returns {{ journey: object, manifest: object, state: object }|null}
 */
function loadInputs(flags, root) {
  if (process.env.CONTEXTKIT_WORK_DISCOVERY === '0') return null;
  const journey = loadJourney(root);
  const manifest = readJson(join(root, 'contextkit', 'methodology', 'templates', 'manifest.json'))
    || readJson(join(root, 'templates', 'contextkit', 'methodology', 'templates', 'manifest.json'));
  if (!journey || !manifest) return null;

  let state = null;
  if (flags.state) {
    state = readJson(String(flags.state));
    if (!state) return null;
  } else {
    const explicitIds = flags.id ? [String(flags.id)] : [];
    const active = flags.workflow
      ? { state: 'confirmed', workflow: String(flags.workflow) }
      : resolveActiveContext({ cwd: root, explicitIds }, { root });
    if (active.state === 'ambiguous') return null;
    if (active.workflow) {
      const workflow = resolveWorkflow(active.workflow, root);
      if (!workflow) return null;
      const packPath = workflowPackPath(root, workflow);
      state = readJson(join(packPath, 'workflow-state.json'));
      const plan = readJson(join(packPath, 'workflow-plan.json'));
      if (!state || !plan) return null;
      const shape = deriveWorkflowShape(plan, workflow);
      state.ceremonyShape = shape;
      state.journeyBranch = plan.journey?.journeyBranch
        || manifest.shapes?.[shape]?.journeyBranch
        || null;
      state.childWorkflowsDone = allOwnerWorkflowsDone(root, workflow);
      state.businessStatus = readJson(join(packPath, '..', '..', 'business.json'))?.status || null;
    } else {
      state = loadEntityState(root, active, manifest);
      if (!state) return null;
    }
  }
  if (flags.shape) state.ceremonyShape = String(flags.shape);
  if (flags.branch) state.journeyBranch = String(flags.branch);
  return { journey, manifest, state };
}

/**
 * Returns the exact next command derived from canonical inputs.
 *
 * @param {{ flags: object, root: string }} context - Command context.
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleNext({ flags, root }) {
  const inputs = loadInputs(flags, root);
  const map = inputs ? projectLifecycleMap(inputs.journey, inputs.manifest, inputs.state) : null;
  return makeReceipt({
    command: 'next',
    applied: false,
    writes: [],
    detail: { status: map?.nextCommand ? 'ready' : 'skipped', nextCommand: map?.nextCommand || null },
  });
}

/**
 * Returns the complete derived Lifecycle Map.
 *
 * @param {{ flags: object, root: string }} context - Command context.
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleMap({ flags, root }) {
  const inputs = loadInputs(flags, root);
  const map = inputs ? projectLifecycleMap(inputs.journey, inputs.manifest, inputs.state) : null;
  const lifecycleMap = renderLifecycleMap(map);
  if (flags.check && inputs && lifecycleMap) {
    const candidate = readFileSync(String(flags.check), 'utf8');
    assertLifecycleMapProjection(candidate, inputs.journey, inputs.manifest, inputs.state);
  }
  return makeReceipt({
    command: 'map',
    applied: false,
    writes: [],
    detail: {
      status: flags.check && map ? 'verified' : map ? 'ready' : 'skipped',
      lifecycleMap,
    },
  });
}
