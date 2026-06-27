/**
 * decision-cli-registry.mjs — glue for the `registry`, `render`, and
 * `migrate-legacy` verbs of `decision.mjs`.
 *
 * Thin verb handlers only — no business logic. Each handler delegates to the
 * backing module that already owns the logic and returns a `makeReceipt`-shaped
 * object so `decision.mjs` prints a consistent receipt.
 *
 * Zero runtime dependencies — `node:*` + siblings (immutable rule 1).
 *
 * @module decision-cli-registry
 */
import { buildDecisionRegistry, writeDecisionRegistry, renderDecisionCatalog } from './registry/decision.mjs';
import { planFiling, applyFiling } from './decisions-file.mjs';
import { makeReceipt } from './work-io.mjs';

// ---------------------------------------------------------------------------
// `registry` verb — rebuild decision-registry.json
// ---------------------------------------------------------------------------

/**
 * Handles the `registry` verb: scans all decisions trees and writes the
 * canonical decision-registry.json. Idempotent (byte-identical content = no
 * write). Dry-run by default.
 *
 * @param {object} args
 * @param {boolean} args.apply - write when true.
 * @param {string}  args.root  - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleRegistry({ apply, root }) {
  const registry = buildDecisionRegistry(root);
  if (!apply) {
    return makeReceipt({
      command: 'registry',
      applied: false,
      writes: [],
      detail: { decisionsFound: registry.decisions.length, mode: 'dry-run' },
    });
  }
  const writtenJson = writeDecisionRegistry(root);
  return makeReceipt({
    command: 'registry',
    applied: true,
    writes: [],
    detail: { decisionsFound: registry.decisions.length, bytesWritten: writtenJson.length },
  });
}

// ---------------------------------------------------------------------------
// `render` verb — print the human-readable decision catalog
// ---------------------------------------------------------------------------

/**
 * Handles the `render` verb: loads the current registry and renders the
 * decision catalog to stdout. Never writes files; always a read-only op.
 *
 * @param {object} args
 * @param {string} args.root - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleRender({ root }) {
  const registry = buildDecisionRegistry(root);
  const catalog = renderDecisionCatalog(registry);
  return makeReceipt({
    command: 'render',
    applied: false,
    writes: [],
    detail: { catalog, decisionsFound: registry.decisions.length },
  });
}

// ---------------------------------------------------------------------------
// `migrate-legacy` verb — file loose top-level ADRs into owned subdirs
// ---------------------------------------------------------------------------

/**
 * Handles the `migrate-legacy` verb: plans (dry-run) or applies the
 * ownership-based filing of loose `NNNN-slug.md` ADRs from the top-level
 * `decisions/` into `decisions/business/`, `decisions/operations/`, or
 * `decisions/legacy/`. Idempotent (already-filed targets are skipped).
 *
 * @param {object} args
 * @param {boolean} args.apply - rename files when true.
 * @param {string}  args.root  - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleMigrateLegacy({ apply, root }) {
  const plan = planFiling(root);
  const writes = plan.map((entry) => entry.to);

  if (!apply) {
    return makeReceipt({
      command: 'migrate-legacy',
      applied: false,
      writes,
      detail: { moves: plan.length, plan: plan.map((e) => ({ from: e.from, to: e.to, owner: e.owner })) },
    });
  }

  const moved = applyFiling(plan);
  return makeReceipt({
    command: 'migrate-legacy',
    applied: true,
    writes: moved.map((e) => e.to),
    detail: { moves: moved.length, plan: moved },
  });
}
