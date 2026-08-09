/**
 * `work reconcile` handler — rebuilds the work-context and decision registries
 * while reading workflow state from the canonical v4 authority.
 *
 * Routes to:
 *   `registry/work-context.mjs` → `buildWorkContextRegistry` + `writeWorkContextRegistry`
 *   `authority-reader.mjs`      → read-only canonical workflow/task projection
 *   `registry/decision.mjs`     → `buildDecisionRegistry` + `writeDecisionRegistry`
 *
 * Posture (constitution §8): DRY-RUN BY DEFAULT. `--apply` writes the two
 * derived registry files atomically. Idempotent: calling twice with the same disk state
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
import { readAuthoritySnapshot } from '../../runtime/authority-reader.mjs';
import { buildDecisionRegistry, writeDecisionRegistry } from './registry/decision.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Checks which registry files exist on disk for `--check` mode.
 *
 * @param {string} root - project root.
 * @returns {{ workContext: boolean, decision: boolean }}
 */
function checkRegistryPresence(root) {
  const paths = pathsFor(root);
  return {
    workContext: existsSync(paths.workContextRegistry),
    decision: existsSync(paths.decisionRegistry),
  };
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

/**
 * Handles `work reconcile` — builds (and optionally writes) the work-context
 * and decision registries, and reports workflows from canonical JSON authority.
 *
 * In `--check` mode (no rebuild), it reports which registry files are present.
 * In `--apply` mode, it writes only the two derived registries atomically.
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
    const allPresent = presence.workContext && presence.decision;
    return makeReceipt({
      command: 'reconcile',
      applied: false,
      writes: [],
      detail: {
        check: true,
        registries: {
          workContext: { path: paths.workContextRegistry, exists: presence.workContext },
          decision: { path: paths.decisionRegistry, exists: presence.decision },
        },
        allPresent,
      },
    });
  }

  // Build derived registries and read canonical workflow authority in memory.
  const workContextPayload = buildWorkContextRegistry(root);
  const workflowPayload = readAuthoritySnapshot(root);
  const decisionPayload = buildDecisionRegistry(root);

  const targetPaths = [
    paths.workContextRegistry,
    paths.decisionRegistry,
  ];

  if (apply) {
    writeWorkContextRegistry(root);
    writeDecisionRegistry(root);
  }

  return makeReceipt({
    command: 'reconcile',
    applied: apply,
    writes: targetPaths,
    detail: {
      workContextCount: Array.isArray(workContextPayload.contexts) ? workContextPayload.contexts.length : 0,
      workflowCount: workflowPayload.workflows.length,
      decisionCount: Array.isArray(decisionPayload.decisions) ? decisionPayload.decisions.length : 0,
    },
  });
}
