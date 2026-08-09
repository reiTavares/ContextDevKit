/**
 * Hand-rolled, zero-dependency validator for the Authoritative Decision Record
 * YAML front matter (schema v2, BIZ-0001 / WF-0037 / B1-T1).
 *
 * Matches the kit's defensive validator style (no zod on the hot path; mirrors
 * `schema-business.mjs`). Validates the v2 fields per `architecture/schema-plan.md`
 * §"B1 — Decision" and enforces the B0-T2 contract rules (one primary context;
 * `contextType` ↔ `primaryContext.type` agreement; `legacy ⟹ null`;
 * `accepted ⟹ approvalSource.actor === 'human'`). Closed enums come from the
 * B-owned `decision-enums.mjs`; `valueIntents` references A's VALUE_INTENTS.
 *
 * Also exposes `classifyDecisionFile()` so B1-T2's registry can index BOTH the
 * new v2 (front-matter) form AND legacy `NNNN-slug.md` plain-markdown ADRs —
 * the latter classified LOGICALLY only, never rewritten (compatibility-plan).
 *
 * `validateDecision()` returns `{ ok, errors[] }` and NEVER throws. The real
 * ADR-0102 front matter MUST validate as `{ ok: true }`.
 */
import { VALUE_INTENTS, isNonEmptyString } from './enums.mjs';
import { readFrontMatter } from './front-matter.mjs';
import {
  DECISION_KINDS,
  DECISION_STATUSES,
  DECISION_SCOPES,
  DECISION_CONTEXT_TYPES,
  APPROVAL_SOURCE_TYPES,
  DECISION_ID_PATTERN,
  LEGACY_DECISION_FILENAME_PATTERN,
} from './decision-enums.mjs';

/** Schema version this validator understands. */
export const DECISION_SCHEMA_VERSION = 2;

/** Required scalar/string fields on every v2 decision record. */
const REQUIRED_STRINGS = ['title', 'contextType', 'decisionKind', 'decisionScope'];

/** Timestamp fields — required, ISO-ish `YYYY-MM-DD` (kept lenient: presence). */
const TIMESTAMP_FIELDS = ['createdAt', 'acceptedAt', 'updatedAt'];

/**
 * Validates the `valueIntents` shape against A's VALUE_INTENTS (exactly one
 * primary, secondary[] all members). Reused contract with the Business schema.
 *
 * @param {unknown} valueIntents - the field value.
 * @param {string[]} errors - human-readable error sink.
 * @returns {void}
 */
function checkValueIntents(valueIntents, errors) {
  if (!valueIntents || typeof valueIntents !== 'object') {
    errors.push('valueIntents: missing or not an object');
    return;
  }
  if (!VALUE_INTENTS.includes(valueIntents.primary)) {
    errors.push(`valueIntents.primary: "${valueIntents.primary}" is not a known value intent`);
  }
  const { secondary } = valueIntents;
  if (secondary !== undefined && secondary !== null) {
    if (!Array.isArray(secondary)) {
      errors.push('valueIntents.secondary: must be an array when present');
    } else {
      for (const intent of secondary) {
        if (!VALUE_INTENTS.includes(intent)) {
          errors.push(`valueIntents.secondary: "${intent}" is not a known value intent`);
        }
      }
    }
  }
}

/**
 * Validates the context-ownership block: `contextType`, `primaryContext`, and
 * their agreement (B0-T2-decision-domain-contract §2.2). `legacy` ⟹ null.
 *
 * @param {object} record - parsed front matter.
 * @param {string[]} errors - error sink.
 * @returns {void}
 */
function checkContextOwnership(record, errors) {
  const { contextType, primaryContext } = record;
  if (!DECISION_CONTEXT_TYPES.includes(contextType)) {
    errors.push(`contextType: "${contextType}" is not a known context type`);
  }
  if (contextType === 'legacy') {
    if (primaryContext !== null) errors.push('primaryContext: must be null when contextType is "legacy"');
    return;
  }
  if (!primaryContext || typeof primaryContext !== 'object') {
    errors.push('primaryContext: required object { type, id } for non-legacy decisions');
    return;
  }
  if (!isNonEmptyString(primaryContext.type)) errors.push('primaryContext.type: required non-empty string');
  if (!isNonEmptyString(primaryContext.id)) errors.push('primaryContext.id: required non-empty string');
  if (isNonEmptyString(contextType) && primaryContext.type !== contextType) {
    errors.push(`primaryContext.type "${primaryContext.type}" must agree with contextType "${contextType}"`);
  }
}

/**
 * Validates the `approvalSource` block (B0-T2-decision-domain-contract §3).
 * Enforces `accepted ⟹ actor === 'human'`.
 *
 * @param {object} record - parsed front matter.
 * @param {string[]} errors - error sink.
 * @returns {void}
 */
function checkApprovalSource(record, errors) {
  const source = record.approvalSource;
  if (!source || typeof source !== 'object') {
    errors.push('approvalSource: required object');
    return;
  }
  if (!APPROVAL_SOURCE_TYPES.includes(source.type)) {
    errors.push(`approvalSource.type: "${source.type}" is not a known approval source`);
  }
  for (const field of ['id', 'revision', 'decisionHash', 'approvedAt', 'actor']) {
    if (source[field] === undefined || source[field] === null) {
      errors.push(`approvalSource.${field}: required`);
    }
  }
  if (record.status === 'accepted' && source.actor !== 'human') {
    errors.push('approvalSource.actor: must be "human" for an accepted decision');
  }
}

/**
 * Validates the `governs` block — `{ workflows[], operations[], business[] }`.
 *
 * @param {unknown} governs - the field value.
 * @param {string[]} errors - error sink.
 * @returns {void}
 */
function checkGoverns(governs, errors) {
  if (!governs || typeof governs !== 'object') {
    errors.push('governs: required object { workflows, operations, business }');
    return;
  }
  for (const field of ['workflows', 'operations', 'business']) {
    if (!Array.isArray(governs[field])) errors.push(`governs.${field}: must be an array`);
  }
}

/**
 * Validates a parsed v2 decision front-matter object. Defensive — never throws.
 * The legacy front-matter shape (`contextType:legacy`, `status:legacy`,
 * `primaryContext:null`) is accepted (legacy grandfathering).
 *
 * @param {unknown} record - parsed front matter (NOT a file path/string).
 * @returns {{ ok: boolean, errors: string[] }} `ok` true only when no errors.
 */
export function validateDecision(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['decision: front matter must be a non-array object'] };
  }

  if (record.schemaVersion !== DECISION_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${DECISION_SCHEMA_VERSION}, got ${JSON.stringify(record.schemaVersion)}`);
  }
  if (!DECISION_ID_PATTERN.test(record.id ?? '')) errors.push('id: must match ^ADR-\\d{4}$');

  for (const field of REQUIRED_STRINGS) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}: required non-empty string`);
  }
  if (!DECISION_STATUSES.includes(record.status)) {
    errors.push(`status: "${record.status}" is not a known decision status`);
  }
  if (record.decisionKind !== undefined && !DECISION_KINDS.includes(record.decisionKind)) {
    errors.push(`decisionKind: "${record.decisionKind}" is not a known decision kind`);
  }
  if (record.decisionScope !== undefined && !DECISION_SCOPES.includes(record.decisionScope)) {
    errors.push(`decisionScope: "${record.decisionScope}" is not a known decision scope`);
  }

  checkContextOwnership(record, errors);
  if (record.relatedContexts !== undefined && !Array.isArray(record.relatedContexts)) {
    errors.push('relatedContexts: must be an array');
  }
  checkValueIntents(record.valueIntents, errors);
  if (!record.product || typeof record.product !== 'object') errors.push('product: required object');
  checkApprovalSource(record, errors);
  checkGoverns(record.governs, errors);

  if (record.supersedes !== undefined && !Array.isArray(record.supersedes)) {
    errors.push('supersedes: must be an array');
  }
  if (!('supersededBy' in record)) errors.push('supersededBy: required (may be null)');
  if (record.tags !== undefined && !Array.isArray(record.tags)) errors.push('tags: must be an array');
  for (const field of TIMESTAMP_FIELDS) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}: required non-empty string`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Classifies a decision file as `new` (v2 front matter) vs `legacy` (plain
 * markdown), so a registry can index both. Reads only — never rewrites the file.
 *
 * - A file WITH a `--- … ---` front-matter block parsing to `schemaVersion: 2`
 *   is `new`; its parsed data + validation verdict are returned.
 * - A `NNNN-slug.md` plain-markdown ADR (matching the legacy filename pattern)
 *   with no v2 front matter is `legacy`, classified LOGICALLY: the caller treats
 *   it as `contextType:legacy`, `status:legacy`, `primaryContext:null` in the
 *   registry without touching the file (compatibility-plan §"Legacy
 *   classification").
 * - Anything else (e.g. a templated/non-ADR markdown) is `unknown`.
 *
 * @param {string} filename - the bare file name (e.g. `ADR-0102-...md` / `0099-x.md`).
 * @param {unknown} contents - the full file contents.
 * @returns {{ kind: 'new'|'legacy'|'unknown', data: object|null, validation: ({ok:boolean,errors:string[]}|null) }}
 */
export function classifyDecisionFile(filename, contents) {
  const front = readFrontMatter(contents);
  if (front.hasFrontMatter && front.data && front.data.schemaVersion === DECISION_SCHEMA_VERSION) {
    return { kind: 'new', data: front.data, validation: validateDecision(front.data) };
  }
  if (typeof filename === 'string' && LEGACY_DECISION_FILENAME_PATTERN.test(filename)) {
    return { kind: 'legacy', data: null, validation: null };
  }
  return { kind: 'unknown', data: null, validation: null };
}
