/**
 * intake-proposal-store.mjs — the ONE owner of the A2 temporary intake-proposal
 * store (BIZ-0001 / WF-0036 Wave A2, ADR-0102; design §9).
 *
 * Runtime, per-task, ephemeral proposals written by the execution-contract hook
 * after intake classifies a prompt. They live under the already-transient,
 * gitignored workspace at `.claude/.workspace/intake/proposals/<taskId>.json`,
 * alongside (but never colliding with) A0's hand-curated `BIZ-0001-proposal/`.
 *
 * These are ADVISORY state, never primary source of truth — the canonical
 * Business/Operation packages (A1/A3) are authoritative; a proposal is discarded
 * once accepted (promoted) or rejected. Single owner of the path + shape (rule 4).
 *
 * Defensive everywhere (immutable rule 2): a missing dir is created on write; an
 * unreadable proposal is treated as absent; nothing here ever throws on the hot
 * path. Atomic writes via `safe-io.writeFileAtomicSync` (tmp + rename).
 *
 * Zero runtime dependencies — only `node:*`, the canonical path helper, and the
 * shared safe-io module.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathsFor } from '../config/paths.mjs';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';

/** Schema version of an emitted `<taskId>.json` proposal. */
export const INTAKE_PROPOSAL_VERSION = 1;

/** Stable status enum for a proposal lifecycle (advisory; A3 promotes/discards). */
export const PROPOSAL_STATUSES = Object.freeze(['proposed', 'accepted', 'rejected', 'superseded']);

/**
 * Resolves the proposals directory under the transient workspace for `root`.
 * `.claude/.workspace/` is already gitignored runtime state, so these never reach
 * `main` and need no installer propagation (design §9).
 *
 * @param {string} root - project root.
 * @returns {string} absolute path of the `intake/proposals/` directory.
 */
export function proposalsDir(root) {
  return join(pathsFor(root).workspaceStateDir, 'intake', 'proposals');
}

/**
 * Resolves the absolute path of one task's proposal file.
 *
 * @param {string} root - project root.
 * @param {string} taskId - the intake task id (file stem).
 * @returns {string} absolute `<taskId>.json` path.
 */
export function proposalPath(root, taskId) {
  return join(proposalsDir(root), `${String(taskId)}.json`);
}

/**
 * Builds the canonical proposal payload (design §9) from a classification and an
 * optional matcher verdict. Pure — performs no I/O, stamps no time (the caller
 * passes `createdAt` so fixtures can pin or omit the one allowed non-determinism).
 *
 * @param {string} taskId - the intake task id.
 * @param {object} work - the `signals.work` classification (§5 shape).
 * @param {object|null} match - the matcher verdict (§8 shape) or null.
 * @param {object} [meta] - `{ objective, action, createdAt }` extras.
 * @returns {object} the proposal object ready to persist.
 */
export function buildIntakeProposal(taskId, work, match = null, meta = {}) {
  const classification = work && typeof work === 'object' ? work : null;
  return {
    schemaVersion: INTAKE_PROPOSAL_VERSION,
    taskId: String(taskId),
    createdAt: meta.createdAt ?? null,
    objective: typeof meta.objective === 'string' ? meta.objective : null,
    classification,
    match: match && typeof match === 'object' ? match : null,
    proposedAction: meta.action && typeof meta.action === 'object' ? meta.action : null,
    status: 'proposed',
  };
}

/**
 * Atomically persists a proposal for `taskId`. Creates the proposals directory on
 * demand. Fail-OPEN: any failure (unwritable dir, serialization error) is
 * swallowed and reported via the boolean return — it NEVER throws (rule 2), so a
 * proposal-store hiccup can never break a real prompt.
 *
 * @param {string} root - project root.
 * @param {string} taskId - the intake task id.
 * @param {object} proposal - a built proposal payload.
 * @returns {boolean} true when the file was written, false on any failure.
 */
export function saveIntakeProposal(root, taskId, proposal) {
  try {
    const path = proposalPath(root, taskId);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileAtomicSync(path, `${JSON.stringify(proposal, null, 2)}\n`);
    return true;
  } catch {
    return false; // advisory store — never break the prompt
  }
}

/**
 * Reads a proposal for `taskId`, or null when absent/unreadable. Defensive:
 * BOM-tolerant via `readJsonSafe`; a missing file or invalid JSON is treated as
 * absent rather than an error (rule 2).
 *
 * @param {string} root - project root.
 * @param {string} taskId - the intake task id.
 * @returns {object|null} the parsed proposal, or null.
 */
export function readIntakeProposal(root, taskId) {
  return readJsonSafe(proposalPath(root, taskId), null);
}
