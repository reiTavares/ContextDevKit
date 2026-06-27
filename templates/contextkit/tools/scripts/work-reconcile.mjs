/**
 * `work reconcile` handler — rebuilds the work-context, workflow, and decision
 * registries from disk (BIZ-0001 / WF-0036, Wave 3, OP-0005 / ADR-0125).
 *
 * Routes to:
 *   `registry/work-context.mjs` → `buildWorkContextRegistry` + `writeWorkContextRegistry`
 *   `registry/workflow.mjs`     → `buildWorkflowRegistry` + `writeWorkflowRegistry`
 *   `registry/decision.mjs`     → `buildDecisionRegistry` + `writeDecisionRegistry`
 *
 * Posture (constitution §8): DRY-RUN BY DEFAULT. `--apply` writes the three
 * registry files atomically. Idempotent: calling twice with the same disk state
 * produces byte-identical output (via `serializeRegistry` from serialize.mjs).
 *
 * `--check` reports whether the registries exist on disk (readiness-only; no rebuild).
 *
 * Zero runtime dependencies — `node:*` + sibling/runtime modules only.
 *
 * @module work-reconcile
 */
import { existsSync } from 'node:fs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { makeReceipt } from './work-io.mjs';
import { buildWorkContextRegistry, writeWorkContextRegistry } from './registry/work-context.mjs';
import { buildWorkflowRegistry, writeWorkflowRegistry } from './registry/workflow.mjs';
import { buildDecisionRegistry, writeDecisionRegistry } from './registry/decision.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Checks which registry files exist on disk for `--check` mode.
 *
 * @param {string} root - project root.
 * @returns {{ workContext: boolean, workflow: boolean, decision: boolean }}
 */
function checkRegistryPresence(root) {
  const paths = pathsFor(root);
  return {
    workContext: existsSync(paths.workContextRegistry),
    workflow: existsSync(paths.workflowRegistry),
    decision: existsSync(paths.decisionRegistry),
  };
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

/**
 * Handles `work reconcile` — builds (and optionally writes) the three work
 * registries: work-context, workflow, and decision.
 *
 * In `--check` mode (no rebuild), it reports which registry files are present.
 * In `--apply` mode, it writes all three atomically.
 * In dry-run mode (default), it builds but does not write.
 *
 * The operation is idempotent: running twice on the same disk state writes
 * the same bytes (byte-identical output is guaranteed by `serializeRegistry`).
 *
 * @param {{ flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleReconcile({ flags, apply, root }) {
  const checkOnly = flags.check === true;
  const paths = pathsFor(root);

  if (checkOnly) {
    const presence = checkRegistryPresence(root);
    const allPresent = presence.workContext && presence.workflow && presence.decision;
    return makeReceipt({
      command: 'reconcile',
      applied: false,
      writes: [],
      detail: {
        check: true,
        registries: {
          workContext: { path: paths.workContextRegistry, exists: presence.workContext },
          workflow: { path: paths.workflowRegistry, exists: presence.workflow },
          decision: { path: paths.decisionRegistry, exists: presence.decision },
        },
        allPresent,
      },
    });
  }

  // Build all three registries in memory first (pure read, no write yet).
  const workContextPayload = buildWorkContextRegistry(root);
  const workflowPayload = buildWorkflowRegistry(root);
  const decisionPayload = buildDecisionRegistry(root);

  const targetPaths = [
    paths.workContextRegistry,
    paths.workflowRegistry,
    paths.decisionRegistry,
  ];

  if (apply) {
    writeWorkContextRegistry(root);
    writeWorkflowRegistry(root);
    writeDecisionRegistry(root);
  }

  return makeReceipt({
    command: 'reconcile',
    applied: apply,
    writes: targetPaths,
    detail: {
      workContextCount: Array.isArray(workContextPayload.contexts) ? workContextPayload.contexts.length : 0,
      workflowCount: Array.isArray(workflowPayload.workflows) ? workflowPayload.workflows.length : 0,
      decisionCount: Array.isArray(decisionPayload.decisions) ? decisionPayload.decisions.length : 0,
    },
  });
}
