/**
 * Field-provenance sidecar + idempotent re-derive engine (WF-0089 SA2, BIZ-0006,
 * ADR-0148 §9 field-level provenance keystone). Builds directly on SA1
 * (`projections.mjs`): every projection there returns the shared envelope
 * `{ source, available, value, reason, inputs }`; this module is what turns
 * "a projection ran" into a durable, single-authority claim over the field it
 * filled.
 *
 * The sidecar (`provenance.json`, one per work-context root, sibling to
 * `tasks.json`/`workflow-state.json`) is a FIELD-AUTHORITY record only — it
 * NEVER carries task status, journeyPhase, or overallStatus. Those stay the
 * journal's job; this module only ever consumes a lifecycle value as an opaque
 * hash input (see `inputDomainForStateProjection`), never re-derives or stores it.
 *
 * The idempotency law (SA2-T2, enforced by `deriveField`):
 *   1. `authored` (explicit OR unclaimed-by-default, constitution §8 fail-safe)
 *      -> permanent SKIP. Never reads the file, never calls the projection.
 *   2. `derived` -> compare `hash(currentContent)` to `entry.contentHash` FIRST.
 *      A mismatch is an out-of-band human edit -> PROMOTE to `authored`, one-way,
 *      forever (nothing on this path ever flips authored back to derived).
 *   3. Only once content matches does it compare `hash(inputDomain)` to
 *      `entry.inputHash`: equal -> NO-OP (no field write, no sidecar write);
 *      different -> RE-DERIVE, re-stamping both hashes to what was just written.
 * Content-hash-before-input-hash is the disambiguator: a legitimate re-derive
 * re-stamps `contentHash` to what IT wrote, so a grown graph is never mistaken
 * for a human edit on the *next* run — only a genuine out-of-band change leaves
 * `contentHash` stale.
 *
 * Reuses existing idioms rather than inventing new ones: `stableStringify` +
 * `node:crypto` sha256 (the same canonical-JSON-then-hash idiom as
 * `project-map-graph.mjs#graphSignature` and `workflow/io.mjs#sha256Hex`), and
 * `md-extract.mjs#section` for markdown section bodies.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJsonSafe, stableStringify, writeJsonStable } from '../tools/scripts/workflow/io.mjs';
import { section as sectionLines } from '../runtime/hooks/md-extract.mjs';
import { deriveTasks } from './projections.mjs';
import { PROVENANCE_SIDECAR_SCHEMA_VERSION, validateProvenanceSidecar } from './schema-provenance-sidecar.mjs';

/** Sidecar filename, sibling to `tasks.json`/`workflow-state.json` in a work-context root. */
const PROVENANCE_FILENAME = 'provenance.json';

/** Default entry for a field with no sidecar record — human-owned, never silently claimed. */
export const DEFAULT_FIELD_ENTRY = Object.freeze({ state: 'authored' });

/** 12-hex digest of a UTF-8 string (matches the `graphSignature` convention). */
function shortHash(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 12);
}

/** Full 64-hex sha256 of a string — used for a nested hash FIELD inside an input domain. */
function fullSha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf-8').digest('hex');
}

/**
 * sha256(canonicalJson(domainObject)).slice(0,12) — the inputHash formula (SA2
 * build contract). `domainObject` is source + normalized identity; canonicalization
 * (sorted keys) comes from `stableStringify`, so key order never churns the hash.
 * @param {object} domainObject
 * @returns {string} 12-hex digest
 */
export function hashInputDomain(domainObject) {
  return shortHash(stableStringify(domainObject, 0));
}

/**
 * Hashes the CURRENT content of a field. JSON fields hash their canonical value;
 * markdown fields hash the trimmed, `\n`-normalized section body (so CRLF/
 * trailing-newline churn never triggers a false promote-to-authored).
 * @param {unknown} content
 * @param {'json'|'markdown'} [contentKind='json']
 * @returns {string} 12-hex digest
 */
export function hashFieldContent(content, contentKind = 'json') {
  if (contentKind === 'markdown') {
    const normalized = String(content ?? '').replace(/\r\n/g, '\n').trim();
    return shortHash(normalized);
  }
  return shortHash(stableStringify(content, 0));
}

/**
 * Extracts a markdown field's section body: the trimmed, `\n`-normalized text
 * between a `## …<headingKeyword>…` heading and the next heading (reuses
 * `md-extract.mjs#section` rather than re-parsing markdown here).
 * @param {string} markdownText full file contents
 * @param {string} headingKeyword substring matched case-insensitively against the heading
 * @returns {string}
 */
export function markdownSectionBody(markdownText, headingKeyword) {
  const lines = String(markdownText ?? '').replace(/\r\n/g, '\n').split('\n');
  return sectionLines(lines, headingKeyword).join('\n').trim();
}

// ---------------------------------------------------------------------------
// Input-domain builders — one per SA0-ratified source id (SA2 build contract).
// Each folds the SA1 envelope's `source` + `inputs` (+ a graph signature for
// graph-backed sources) into the exact domain shape `hashInputDomain` hashes.
// ---------------------------------------------------------------------------

/** Domain for `biz0004:fwd-reach` (deriveScope). */
export function inputDomainForScope(envelope, graphSignature = '') {
  return { source: envelope.source, graphSignature, entrySymbols: envelope.inputs.entrySymbols, budget: envelope.inputs.budget };
}

/** Domain for `biz0004:rev-consumers` (deriveRisk). */
export function inputDomainForRisk(envelope, graphSignature = '') {
  return { source: envelope.source, graphSignature, targetSymbols: envelope.inputs.entrySymbols };
}

/** Domain for `biz0003:tasks-derive` (deriveTasks). `plan` is folded in as-is — `stableStringify` canonicalizes it. */
export function inputDomainForTasks(envelope, plan) {
  return { source: envelope.source, workflowId: envelope.inputs.workflowId, plan };
}

/** Domain for `work-classifier` (deriveClassification). `policyHash` is the caller's loaded-policy fingerprint. */
export function inputDomainForClassification(envelope, policyHash = '') {
  return { source: envelope.source, objectiveHash: fullSha256(envelope.inputs.objective), policyHash };
}

/** Domain for `scaffold` (derive-once; immutable ⇒ permanent no-op after first write). */
export function inputDomainForScaffold({ contextRef, resolvedAxes, ceremonyShape, manifestSchemaVersion }) {
  return { source: 'scaffold', contextRef, resolvedAxes, ceremonyShape, manifestSchemaVersion };
}

/** Domain for `scaffold:state-projection` (derive-and-refresh, e.g. `index.currentPhase`). */
export function inputDomainForStateProjection({ overallStatus, journeyPhase }) {
  return { source: 'scaffold:state-projection', overallStatus, journeyPhase };
}

// ---------------------------------------------------------------------------
// Sidecar I/O — the thin disk boundary. Everything above this line is pure.
// ---------------------------------------------------------------------------

/** Absolute path of the sidecar inside a work-context root. */
export function sidecarPath(contextDir) {
  return join(contextDir, PROVENANCE_FILENAME);
}

/**
 * Loads the sidecar, defaulting to an empty one (never throws on a missing
 * file — a fresh context has no provenance yet).
 * @param {string} contextDir
 * @param {string|null} [contextRef] used only when no sidecar exists yet
 * @returns {{schemaVersion:number, contextRef:(string|null), fields:object}}
 */
export function readSidecar(contextDir, contextRef = null) {
  const raw = readJsonSafe(sidecarPath(contextDir), null);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return { schemaVersion: PROVENANCE_SIDECAR_SCHEMA_VERSION, contextRef, fields: {} };
}

/**
 * Validates then atomically persists a sidecar (stable JSON, no mtime churn).
 * A refused sidecar never reaches disk (constitution §8 — validators throw).
 * @returns {{changed:boolean}}
 * @throws {Error} when `sidecar` fails `validateProvenanceSidecar`
 */
export function writeSidecar(contextDir, sidecar) {
  const verdict = validateProvenanceSidecar(sidecar);
  if (!verdict.ok) {
    throw new Error(`provenance: refused to write an invalid sidecar - ${verdict.errors.join('; ')}`);
  }
  return writeJsonStable(sidecarPath(contextDir), sidecar);
}

/** Returns a NEW sidecar with `fieldKey` set to `entry` (never mutates the input). */
export function setFieldEntry(sidecar, fieldKey, entry) {
  return { ...sidecar, fields: { ...(sidecar.fields ?? {}), [fieldKey]: entry } };
}

/**
 * The single-authority lookup: an ABSENT field key defaults to `authored`
 * (constitution §8 — unclaimed is human-owned, never silently claimed). Also
 * reports whether the field was actually claimed in the sidecar, so callers can
 * tell "explicitly authored" apart from "defaulted" for logging/tests.
 * @returns {{entry:{state:string}, claimed:boolean}}
 */
export function fieldAuthority(sidecar, fieldKey) {
  const rawEntry = sidecar?.fields?.[fieldKey];
  return { entry: rawEntry ?? DEFAULT_FIELD_ENTRY, claimed: rawEntry !== undefined };
}

/** Convenience accessor over `fieldAuthority` — just the entry. */
export function getFieldEntry(sidecar, fieldKey) {
  return fieldAuthority(sidecar, fieldKey).entry;
}

/** One-way promotion: drop source/inputHash/contentHash, lock the field to `authored` forever. */
export function promoteToAuthored() {
  return { state: 'authored' };
}

/** Builds a fresh `derived` entry, stamping `contentHash` to what was ACTUALLY written. */
export function stampDerivedEntry({ source, inputHash, newContent, contentKind = 'json' }) {
  return { state: 'derived', source, inputHash, contentHash: hashFieldContent(newContent, contentKind) };
}

// ---------------------------------------------------------------------------
// The idempotent re-derive engine (SA2-T2).
// ---------------------------------------------------------------------------

/**
 * Runs the idempotent re-derive engine for ONE field. Sequencing is lazy by
 * construction: `readContent`/`compute`/`writeContent` are only invoked on the
 * branch that actually needs them, so an `authored` field is never touched and
 * a content-drifted field is never re-derived.
 *
 * @param {object} args
 * @param {object} args.sidecar the loaded sidecar (see `readSidecar`)
 * @param {string} args.fieldKey the `<fileAlias>.<leaf>` field key
 * @param {'json'|'markdown'} [args.contentKind='json']
 * @param {() => unknown} args.readContent returns the CURRENT field content
 *   (called only when the field is `derived`)
 * @param {() => {inputDomain:object, source:string, value:unknown}} args.compute
 *   runs the SA1 projection (called only when content matches — never on a
 *   promote, never on an authored field)
 * @param {(value:unknown) => void} args.writeContent persists a rederived value
 *   (called only when the input domain actually changed)
 * @returns {{action:'skip'|'promote'|'noop'|'rederive', sidecar:object, reason:string}}
 */
export function deriveField({ sidecar, fieldKey, contentKind = 'json', readContent, compute, writeContent }) {
  const { entry, claimed } = fieldAuthority(sidecar, fieldKey);

  if (entry.state !== 'derived') {
    return { action: 'skip', sidecar, reason: claimed ? 'authored-lock' : 'unclaimed-defaults-to-authored' };
  }

  const currentContent = readContent();
  const currentContentHash = hashFieldContent(currentContent, contentKind);
  if (currentContentHash !== entry.contentHash) {
    return {
      action: 'promote',
      sidecar: setFieldEntry(sidecar, fieldKey, promoteToAuthored()),
      reason: 'content-hash-mismatch (out-of-band edit) -> promoted to authored, one-way',
    };
  }

  const { inputDomain, source, value } = compute();
  const inputHash = hashInputDomain(inputDomain);
  if (inputHash === entry.inputHash) {
    return { action: 'noop', sidecar, reason: 'input-hash-unchanged' };
  }

  writeContent(value);
  const newEntry = stampDerivedEntry({ source, inputHash, newContent: value, contentKind });
  return { action: 'rederive', sidecar: setFieldEntry(sidecar, fieldKey, newEntry), reason: 'input-hash-changed' };
}

/**
 * Fail-open convenience over `deriveField` for a caller holding an
 * already-computed SA1 envelope rather than a lazy `compute()` callback. An
 * unavailable envelope (`available:false`) is a pure no-op — R7: never blocks,
 * never fabricates, leaves the field exactly as it is.
 * @returns {{action:string, sidecar:object, reason:string}}
 */
export function deriveFieldFromEnvelope({ sidecar, fieldKey, envelope, inputDomain, contentKind = 'json', readContent, writeContent }) {
  if (!envelope || envelope.available !== true) {
    return { action: 'skip', sidecar, reason: envelope?.reason ?? 'projection unavailable (fail-open)' };
  }
  return deriveField({
    sidecar,
    fieldKey,
    contentKind,
    readContent,
    compute: () => ({ inputDomain, source: envelope.source, value: envelope.value }),
    writeContent,
  });
}

// ---------------------------------------------------------------------------
// SA2-T2 shape-creation wiring: the `tasks` field shadow stamp.
// ---------------------------------------------------------------------------

/**
 * Shadow-stamps the `tasks` field as `biz0003:tasks-derive`-derived immediately
 * after a workflow writes its (already-derived) `tasks.json` — the ONE
 * structural field `workflow/create.mjs` can stamp today without inventing an
 * entry-symbol resolution it does not have (scope/risk/classification/KPI need
 * one; SA4 owns wiring those once it exists — see `deriveFieldFromEnvelope` +
 * `inputDomainForScope`/`inputDomainForRisk` above, which are the ready-made seam).
 *
 * Advisory/shadow by design: this only RECORDS provenance for content the
 * caller already wrote; it never mutates `tasks.json` itself. Fail-open (R7) is
 * the CALLER's responsibility (wrap in try/catch) so a provenance-write failure
 * never blocks workflow creation.
 *
 * @param {string} contextDir absolute pack directory (sibling of `tasks.json`)
 * @param {{plan:object, workflowId:(string|number), tasksDocument:object, contextRef?:(string|null)}} args
 * @returns {{changed:boolean}} whether `provenance.json` was written
 */
export function stampWorkflowTasksProvenance(contextDir, { plan, workflowId, tasksDocument, contextRef = null }) {
  const envelope = deriveTasks(plan, { workflowId });
  if (!envelope.available) return { changed: false };
  const inputDomain = inputDomainForTasks(envelope, plan);
  const inputHash = hashInputDomain(inputDomain);
  const entry = stampDerivedEntry({ source: envelope.source, inputHash, newContent: tasksDocument, contentKind: 'json' });
  const resolvedContextRef = contextRef ?? tasksDocument?.owner?.id ?? null;
  const sidecar = setFieldEntry(readSidecar(contextDir, resolvedContextRef), 'tasks', entry);
  return writeSidecar(contextDir, sidecar);
}
