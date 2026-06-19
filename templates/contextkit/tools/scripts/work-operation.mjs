/**
 * Operation creation command (BIZ-0001 / WF-0036, A1-T2). Produces a canonical
 * Operation package — `operation.json` + `reason.md` + `tasks.md` — under the
 * Operations root resolved from `paths.mjs` (never hardcoded; immutable rule 4).
 *
 * Posture (constitution §8): DRY-RUN BY DEFAULT. Without `--apply` the command
 * computes and returns the full plan and writes NOTHING. With `--apply` it
 * validates the built `operation.json` and writes all three files atomically
 * (tmp + rename via `writeFileEnsured`). Validation runs at the boundary so a
 * refused (schema-invalid) operation never wastes a write.
 *
 * Zero runtime dependencies — `node:*` + sibling/runtime modules only.
 */
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { EXECUTION_MODES, VALUE_INTENTS, isNonEmptyString } from '../../runtime/work/enums.mjs';
import { validateOperation, OPERATION_ID_PATTERN } from '../../runtime/work/schema-operation.mjs';
import { makeReceipt, slugify, writeFileEnsured } from './work-io.mjs';
import { buildOperationJson, buildReasonMd, buildTasksMd } from './work-templates.mjs';
import { operationTasksMarkers } from './work-render.mjs';

/** Default execution mode when `--mode` is omitted. */
const DEFAULT_MODE = 'direct';

/**
 * Resolves and validates the create inputs from parsed flags/positionals,
 * throwing a typed boundary error on the first refusal (fail-fast, §4).
 *
 * @param {object} args - `{ positionals, flags }` from `parseArgs`.
 * @returns {{ id, title, slug, kind, executionMode, valueIntents, urgency, severity }}
 * @throws {Error} when required inputs are missing/invalid.
 */
export function resolveCreateInputs({ positionals, flags }) {
  const title = isNonEmptyString(flags.title) ? String(flags.title) : positionals.join(' ').trim();
  if (!isNonEmptyString(title)) throw new Error('operation: a title is required (positional or --title)');

  const executionMode = String(flags.mode || DEFAULT_MODE);
  if (!EXECUTION_MODES.includes(executionMode)) {
    throw new Error(`operation: --mode "${executionMode}" must be one of ${EXECUTION_MODES.join('|')}`);
  }
  if (executionMode === 'workflow') {
    throw new Error('operation: --mode workflow is not creatable here — use the workflow engine');
  }

  const primary = String(flags.intent || 'IMPROVE');
  if (!VALUE_INTENTS.includes(primary)) {
    throw new Error(`operation: --intent "${primary}" must be one of ${VALUE_INTENTS.join('|')}`);
  }

  const id = isNonEmptyString(flags.id) ? String(flags.id) : 'OP-0001';
  if (!OPERATION_ID_PATTERN.test(id)) throw new Error(`operation: --id "${id}" must match OP-####`);

  return {
    id,
    title,
    slug: slugify(title),
    kind: isNonEmptyString(flags.kind) ? String(flags.kind) : 'MAINTENANCE',
    executionMode,
    valueIntents: { primary, secondary: [] },
    urgency: isNonEmptyString(flags.urgency) ? String(flags.urgency) : 'normal',
    severity: isNonEmptyString(flags.severity) ? String(flags.severity) : 'low',
  };
}

/**
 * Computes the package plan: the target directory + the three file contents.
 * Pure — performs no writes. Validation of `operation.json` happens here so a
 * refused operation never reaches the apply path.
 *
 * @param {object} inputs - resolved create inputs.
 * @param {string} root - project root (for the Operations path).
 * @param {string} createdAt - injected ISO date.
 * @returns {{ dir, files: Array<{path, content}>, operation }}
 * @throws {Error} when the built `operation.json` is schema-invalid.
 */
export function planOperationPackage(inputs, root, createdAt) {
  const operation = buildOperationJson(inputs);
  const verdict = validateOperation(operation);
  if (!verdict.ok) throw new Error(`operation: built operation.json is invalid — ${verdict.errors.join('; ')}`);

  const operationsRoot = pathsFor(root).operations;
  const dir = join(operationsRoot, `${inputs.id}-${inputs.slug}`);
  const markers = operationTasksMarkers();
  const files = [
    { path: join(dir, 'operation.json'), content: `${JSON.stringify(operation, null, 2)}\n` },
    { path: join(dir, 'reason.md'), content: buildReasonMd(operation, createdAt) },
    { path: join(dir, 'tasks.md'), content: buildTasksMd(operation, markers) },
  ];
  return { dir, files, operation };
}

/**
 * Runs `work operation` (create). Dry-run by default; `--apply` writes the
 * package atomically. Always returns a receipt describing what it did/would do.
 *
 * @param {object} ctx - `{ positionals, flags, apply, root, now }`.
 * @returns {ReturnType<typeof makeReceipt>} the create receipt.
 * @throws {Error} on invalid inputs or a schema-invalid built operation.
 */
export function runOperationCreate(ctx) {
  const { positionals, flags, apply, root = process.cwd(), now } = ctx;
  const createdAt = now || new Date().toISOString().slice(0, 10);
  const inputs = resolveCreateInputs({ positionals, flags });
  const plan = planOperationPackage(inputs, root, createdAt);

  if (apply) {
    for (const file of plan.files) writeFileEnsured(file.path, file.content);
  }

  return makeReceipt({
    command: 'operation',
    applied: apply,
    writes: plan.files.map((file) => file.path),
    detail: { id: inputs.id, slug: inputs.slug, executionMode: inputs.executionMode, dir: plan.dir },
  });
}
