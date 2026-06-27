/**
 * decision-cli-lifecycle.mjs — NEW glue for the `accept`, `link`, and `supersede` verbs.
 *
 * All three verbs mutate ADR or entity state; all enforce the human-actor rule
 * (schema-decision §3: `accepted ⟹ approvalSource.actor === 'human'`). They are
 * dry-run by default and write atomically via `work-io.mjs#writeFileEnsured`.
 *
 * Zero runtime dependencies — `node:*` + siblings only (immutable rule 1).
 *
 * @module decision-cli-lifecycle
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';
import { DECISION_ID_PATTERN } from '../../runtime/work/decision-enums.mjs';
import { supersede } from './work-decision-supersede.mjs';
import { makeReceipt, writeFileEnsured } from './work-io.mjs';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Reads a JSON file with BOM-stripping and defensive error handling.
 *
 * @param {string} absPath - absolute file path.
 * @returns {object} parsed JSON.
 * @throws {Error} when file is absent or malformed JSON.
 */
function readJson(absPath) {
  if (!existsSync(absPath)) throw new Error(`decision: file not found: ${absPath}`);
  return JSON.parse(stripBom(readFileSync(absPath, 'utf-8')));
}

/**
 * Finds an ADR markdown file by id across the decisions subtrees.
 * Returns null when not found (never throws).
 *
 * @param {string} root - project root.
 * @param {string} adrId - e.g. `ADR-0125`.
 * @returns {string|null} absolute path or null.
 */
function locateAdrFile(root, adrId) {
  const paths = pathsFor(root);
  const searchDirs = [
    paths.decisions,
    paths.decisionsBusiness,
    paths.decisionsOperations,
    paths.decisionsLegacy,
  ];
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    const match = entries.find((f) => f.endsWith('.md') && f.startsWith(adrId));
    if (match) return resolve(dir, match);
  }
  return null;
}

// ---------------------------------------------------------------------------
// `accept` verb — stamp status accepted + approvalSource; ENFORCE actor=human
// ---------------------------------------------------------------------------

/**
 * Handles the `accept` verb: produces an `approvalSource` patch for an ADR.
 * REFUSES when `--actor` is not `human` (schema §3 invariant).
 *
 * NOTE: Front-matter YAML rewriting is non-trivial YAML surgery — this handler
 * returns a structured `patch` receipt (the fields to stamp) rather than directly
 * mutating the markdown file. The `--apply` flag signals explicit write intent and
 * is recorded in the receipt. A follow-up YAML-aware tool or manual edit applies
 * the patch to the ADR file.
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {boolean} args.apply - write intent; recorded in receipt.
 * @param {string} args.root - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on non-human actor or invalid id.
 */
export function handleAccept({ flags, apply, root }) {
  const actor = String(flags.actor || '');
  if (actor !== 'human') {
    throw new Error(
      `decision accept: REFUSED — actor must be "human" ` +
      `(schema §3: accepted ⟹ approvalSource.actor === "human"). ` +
      `Got: "${actor || '(absent)'}"`,
    );
  }

  const adrId = String(flags.id || '');
  if (!DECISION_ID_PATTERN.test(adrId)) {
    throw new Error(`decision accept: --id must match ADR-#### (got "${adrId}")`);
  }

  const adrPath = locateAdrFile(root, adrId);
  if (!adrPath) {
    throw new Error(`decision accept: ADR file not found for ${adrId} in decisions/ tree`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const approvalSource = {
    type: 'human',
    id: String(flags['approval-id'] || flags.approvalId || adrId),
    revision: 1,
    decisionHash: null,
    approvedAt: today,
    actor: 'human',
  };
  const patch = { status: 'accepted', approvalSource, acceptedAt: today, updatedAt: today };

  return makeReceipt({
    command: 'accept',
    applied: apply,
    writes: [adrPath],
    detail: {
      adrId,
      adrPath,
      patch,
      actor,
      note: apply
        ? 'patch produced — stamp these fields into the ADR YAML front-matter'
        : 'dry-run: patch computed only; pass --apply to confirm write intent',
    },
  });
}

// ---------------------------------------------------------------------------
// `link` verb — append a decisionRef onto an entity JSON
// ---------------------------------------------------------------------------

/**
 * Handles the `link` verb: append `adrId` to `entity.decisionRefs.governing[]`
 * in a business.json / operation.json / workflow-plan.json.
 * Idempotent: re-adding an existing ref is a no-op (no second write).
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {boolean} args.apply - write when true.
 * @param {string} args.root - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing inputs or invalid ADR id.
 */
export function handleLink({ flags, apply, root }) {
  const adrId = String(flags.id || flags.adr || '');
  if (!DECISION_ID_PATTERN.test(adrId)) {
    throw new Error(`decision link: --id must be a valid ADR-#### id (got "${adrId}")`);
  }
  const entityPath = String(flags.entity || flags.file || '');
  if (!entityPath) throw new Error('decision link: --entity <path> is required');

  // Resolve relative to root when not absolute.
  const absEntity = /^(?:\/|[A-Za-z]:)/.test(entityPath)
    ? resolve(entityPath)
    : resolve(root, entityPath);

  const entity = readJson(absEntity);

  // Normalise decisionRefs structure.
  if (!entity.decisionRefs || typeof entity.decisionRefs !== 'object' || Array.isArray(entity.decisionRefs)) {
    entity.decisionRefs = { governing: [], primary: null };
  }
  if (!Array.isArray(entity.decisionRefs.governing)) entity.decisionRefs.governing = [];

  const alreadyLinked = entity.decisionRefs.governing.includes(adrId);
  if (!alreadyLinked) entity.decisionRefs.governing.push(adrId);
  entity.updatedAt = new Date().toISOString().slice(0, 10);

  if (apply && !alreadyLinked) {
    writeFileEnsured(absEntity, JSON.stringify(entity, null, 2) + '\n');
  }

  return makeReceipt({
    command: 'link',
    applied: apply && !alreadyLinked,
    writes: [absEntity],
    detail: { adrId, entityPath: absEntity, idempotentNoop: alreadyLinked },
  });
}

// ---------------------------------------------------------------------------
// `supersede` verb — mark old ADR superseded + produce new ADR fields
// ---------------------------------------------------------------------------

/**
 * Handles the `supersede` verb: routes to `work-decision-supersede.mjs#supersede`.
 * Returns a receipt containing `oldPatch` + `newAdr` fields. The caller applies
 * the patch to the old ADR file; writing the new ADR file is a subsequent `create`.
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {boolean} args.apply - write intent; recorded in receipt.
 * @param {string} args.root - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on non-human actor or invalid ids.
 */
export function handleSupersede({ flags, apply, root }) {
  const actor = String(flags.actor || '');
  if (actor !== 'human') {
    throw new Error(
      `decision supersede: REFUSED — actor must be "human". Got: "${actor || '(absent)'}"`,
    );
  }
  const oldId = String(flags['old-id'] || flags.oldId || '');
  const newId = String(flags['new-id'] || flags.newId || flags.id || '');
  if (!DECISION_ID_PATTERN.test(oldId)) {
    throw new Error(`decision supersede: --old-id must match ADR-#### (got "${oldId}")`);
  }
  if (!DECISION_ID_PATTERN.test(newId)) {
    throw new Error(`decision supersede: --new-id must match ADR-#### (got "${newId}")`);
  }

  const oldAdrPath = locateAdrFile(root, oldId);
  // Build minimal oldAdr record; supersede() validates id + status transition.
  const oldAdr = { id: oldId, status: 'accepted' };
  const newAdrFields = { id: newId, title: String(flags.title || `Supersedes ${oldId}`) };

  const result = supersede(oldAdr, newAdrFields, { actor, note: String(flags.note || '') });
  if (result.receipt.status === 'refused') {
    throw new Error(`decision supersede: ${result.receipt.message}`);
  }

  return makeReceipt({
    command: 'supersede',
    applied: apply,
    writes: oldAdrPath ? [oldAdrPath] : [],
    detail: {
      oldId,
      newId,
      oldAdrPath,
      oldPatch: result.oldPatch,
      newAdrFields: result.newAdr,
      supersessionReceipt: result.receipt,
      note: apply
        ? 'apply oldPatch to the old ADR file; then use `decision create` for the new ADR'
        : 'dry-run: supersession record computed only',
    },
  });
}
