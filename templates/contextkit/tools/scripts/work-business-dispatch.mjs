/**
 * Thin I/O adapters for the Business lifecycle commands (`approve`, `revise`,
 * `reject`, `status`) wired in `work.mjs` (BIZ-0001 / WF-0036, A3-T2).
 *
 * RESPONSIBILITY: resolve business.json path → read → call pure logic → optionally
 * write back (atomic, dry-run default). This module is the only place that does
 * business-file I/O for the lifecycle commands; it keeps `work.mjs` thin.
 *
 * Dry-run default (constitution §8): nothing is written without `apply === true`.
 * The human-actor guard for `approve` is enforced inside `work-business-lifecycle`
 * (throws `APPROVAL_ACTOR_REFUSED`); this adapter propagates that error unchanged.
 *
 * Zero runtime dependencies — `node:*` + sibling modules only (immutable rule 1).
 *
 * @module work-business-dispatch
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { makeReceipt, writeFileEnsured } from './work-io.mjs';
import { transition } from './work-business-lifecycle.mjs';
import { evaluateBusinessGate, generateAuthorizedWorkflows } from './work-business-gate.mjs';

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to a Business's `business.json` from its id or
 * full folder name. Searches the Business memory root for `BIZ-####-*` when
 * only the bare id is given, mirroring `resolveTasksPath` in `work.mjs`.
 *
 * @param {string} root - project root.
 * @param {string} bizId - `BIZ-####` id or full folder name.
 * @returns {string} absolute path to `business.json` (may not exist yet).
 */
function resolveBizJsonPath(root, bizId) {
  const paths = pathsFor(root);
  // `pathsFor` may not yet define a `business` key — fall back defensively.
  const bizRoot = paths.business
    || join(root, 'contextkit', 'memory', 'business');

  const direct = join(bizRoot, bizId, 'business.json');
  if (existsSync(direct)) return direct;

  // Try prefix match: `BIZ-0001-my-title/business.json`
  const prefix = `${bizId}-`;
  let match;
  try {
    match = readdirSync(bizRoot).find((name) => name === bizId || name.startsWith(prefix));
  } catch {
    // bizRoot does not exist yet — return the predictable direct path for the error.
  }
  return match ? join(bizRoot, match, 'business.json') : direct;
}

/**
 * Reads and JSON-parses a `business.json` file. Throws descriptively when the
 * file is missing or contains invalid JSON (fail-fast, constitution §4).
 *
 * @param {string} bizJsonPath - absolute path.
 * @returns {object} the parsed business entity.
 * @throws {Error} on missing file or JSON parse failure.
 */
function readBusiness(bizJsonPath) {
  if (!existsSync(bizJsonPath)) {
    throw new Error(`work: business.json not found at "${bizJsonPath}" — supply a valid --id BIZ-####`);
  }
  const raw = readFileSync(bizJsonPath, 'utf-8').replace(/^﻿/, ''); // strip BOM
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`work: failed to parse "${bizJsonPath}": ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Public command handlers
// ---------------------------------------------------------------------------

/**
 * Handles `approve`, `revise`, or `reject` lifecycle commands.
 *
 * For `approve` the caller MUST pass `--actor human`; any other value causes
 * `transition()` to throw with code `APPROVAL_ACTOR_REFUSED`. This adapter
 * propagates that error unchanged so `work.mjs` surfaces it to stderr.
 *
 * Optional `--adr-data <JSON>` provides the primary ADR's canonical fields for
 * the decision-hash computation; if omitted the hash is null (gate will block).
 *
 * @param {{ command: string, flags: object, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing --id, missing file, illegal transition, or
 *   non-human actor on `approve`.
 */
export function handleBusinessTransition({ command, flags, apply, root }) {
  const bizId = flags.id;
  if (!bizId || typeof bizId !== 'string') {
    throw new Error(`work ${command}: --id BIZ-#### is required`);
  }
  const bizJsonPath = resolveBizJsonPath(root, String(bizId));
  const business = readBusiness(bizJsonPath);

  // Actor defaults to 'agent' so an omitted flag is never silently treated as human.
  const actor = typeof flags.actor === 'string' ? flags.actor : 'agent';
  const note = typeof flags.note === 'string' ? flags.note : undefined;

  // The primary ADR's canonical fields, supplied as a JSON string via --adr-data.
  let primaryAdr = null;
  if (typeof flags['adr-data'] === 'string') {
    try { primaryAdr = JSON.parse(flags['adr-data']); } catch { /* gate will surface */ }
  }

  const { business: updated, receipt: txReceipt } = transition(
    business,
    command,
    { actor, note, primaryAdr, now: flags.now },
  );

  if (apply) {
    writeFileEnsured(bizJsonPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  return makeReceipt({
    command,
    applied: apply,
    writes: [bizJsonPath],
    detail: {
      id: bizId,
      fromStatus: txReceipt.fromStatus,
      toStatus: txReceipt.toStatus,
      actor: txReceipt.actor,
      decisionHash: txReceipt.decisionHash,
    },
  });
}

/**
 * Handles `status` — reads a business entity, evaluates the Business Gate, and
 * returns a receipt. Pure read; `apply` flag has no effect.
 *
 * @param {{ flags: object, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing --id or missing / unparseable file.
 */
export function handleBusinessStatus({ flags, root }) {
  const bizId = flags.id;
  if (!bizId || typeof bizId !== 'string') {
    throw new Error('work status: --id BIZ-#### is required');
  }
  const bizJsonPath = resolveBizJsonPath(root, String(bizId));
  const business = readBusiness(bizJsonPath);

  const gate = evaluateBusinessGate(business, {});
  const workflows = generateAuthorizedWorkflows(business, {});

  return makeReceipt({
    command: 'status',
    applied: false,
    writes: [],
    detail: {
      id: bizId,
      status: business.status,
      gate: { pass: gate.pass, reasons: gate.reasons },
      authorizedWorkflowCount: workflows.length,
    },
  });
}
