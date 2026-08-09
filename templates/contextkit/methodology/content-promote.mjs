/**
 * `draft` → `authored` promotion (WF-0090 GA2, BIZ-0006, ADR-0148 rail (b)).
 *
 * Rail (b) says model-written content lands as `draft` and only a *verified*
 * verdict promotes it. This module is that verdict, and it deliberately invents
 * no new approval concept, no new store, and no new verb (GA0 decision D4) —
 * both promotion channels already exist in the kit:
 *
 *   1. **Explicit verified verdict** — the workflow gate receipt. `approveGate`
 *      already refuses an anonymous approver ("approval is never inferred"),
 *      already stamps a timestamp, already carries `evidence[]`, and already
 *      binds a `revision`; `readGateResult(packDir, gateId, {expectedRevision})`
 *      already marks a stale verdict `status:'stale'`. So the "human verdict" is
 *      literally the same receipt the G-GA4 human gate produces: any field key
 *      listed in that receipt's `evidence[]` is promoted.
 *   2. **Implicit human edit** — the same content-hash-first rule WF-0089 uses.
 *      If a draft's `contentHash` no longer matches the field's current bytes, a
 *      human edited it, so it becomes `authored`, one-way, forever.
 *      `deriveField` deliberately never touches a draft, which is exactly why
 *      this pass has to perform the check for drafts itself.
 *
 * Nothing else promotes. A draft that is neither approved nor edited stays a
 * draft indefinitely — the correct resting state for unreviewed content. And
 * promotion is strictly one-way: nothing here ever writes `draft` over
 * `authored`, or turns an `authored` field back into anything else.
 *
 * Pure and I/O-free: the sidecar arrives parsed, the gate receipt arrives read,
 * and current field bytes arrive through an injected `readContent`. The caller
 * persists the returned sidecar with the existing `writeSidecar`, which refuses
 * an invalid one.
 *
 * Zero runtime dependencies — sibling modules only.
 */
import { hashFieldContent, promoteToAuthored, setFieldEntry } from './provenance.mjs';
import { REASONED_FIELD_KEYS } from './content-eligibility.mjs';

/** Reasons a field was promoted, or left alone — recorded per field for the report. */
export const PROMOTION_REASONS = Object.freeze({
  GATE: 'verified-gate-verdict',
  EDIT: 'content-hash-mismatch (human edit) -> authored, one-way',
  UNREVIEWED: 'draft left unreviewed (neither approved nor edited)',
});

/**
 * The field keys a gate receipt authorizes for promotion: the entries of its
 * `evidence[]` that name a reasoned field. Anything else in `evidence[]` (a
 * script path, a report name, a receipt id) is ignored rather than guessed at.
 *
 * A `null`, `stale`, or unapproved receipt authorizes NOTHING (constitution §8 —
 * a stale verdict never auto-passes; `readGateResult` already labels it).
 *
 * @param {{status?: string, evidence?: unknown[]}|null} gateResult a
 *   `readGateResult` result — pass `expectedRevision` there so a stale receipt
 *   arrives already marked
 * @returns {string[]} sorted, deduped authorized field keys
 */
export function authorizedFieldKeys(gateResult) {
  if (!gateResult || gateResult.status !== 'approved') return [];
  if (typeof gateResult.humanApproval?.approver !== 'string' || gateResult.humanApproval.approver.trim().length === 0) {
    return [];
  }
  const evidence = Array.isArray(gateResult.evidence) ? gateResult.evidence : [];
  const named = evidence
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => REASONED_FIELD_KEYS.includes(entry));
  return [...new Set(named)].sort();
}

/**
 * Runs the promotion pass over every `draft` in the sidecar.
 *
 * Never throws: a missing reader, an unreadable field, or a malformed entry
 * leaves that draft exactly as it is. Promotion can only ever move a field
 * FORWARD to `authored`, so a failure here can never lose human content.
 *
 * @param {object} args
 * @param {object} args.sidecar the parsed provenance sidecar
 * @param {object|null} [args.gateResult] a `readGateResult` result (channel 1)
 * @param {(fieldKey: string) => unknown} [args.readContent] returns the field's
 *   CURRENT content, for the edit check (channel 2). Absent ⇒ channel 2 is
 *   skipped, not assumed clean
 * @param {Record<string,'markdown'|'json'>} [args.contentKinds] per-field content
 *   kind (defaults to `markdown`, matching how a reasoned field is stored)
 * @returns {{sidecar: object, promoted: Array<{fieldKey: string, reason: string}>,
 *   unchanged: Array<{fieldKey: string, reason: string}>}}
 */
export function promoteDrafts({ sidecar, gateResult = null, readContent = null, contentKinds = {} }) {
  const fields = sidecar?.fields ?? {};
  const approved = new Set(authorizedFieldKeys(gateResult));
  const promoted = [];
  const unchanged = [];
  let nextSidecar = sidecar;

  for (const fieldKey of Object.keys(fields).sort()) {
    if (fields[fieldKey]?.state !== 'draft') continue;

    if (approved.has(fieldKey)) {
      nextSidecar = setFieldEntry(nextSidecar, fieldKey, promoteToAuthored());
      promoted.push({ fieldKey, reason: PROMOTION_REASONS.GATE });
      continue;
    }

    if (typeof readContent === 'function' && edited(fields[fieldKey], fieldKey, readContent, contentKinds)) {
      nextSidecar = setFieldEntry(nextSidecar, fieldKey, promoteToAuthored());
      promoted.push({ fieldKey, reason: PROMOTION_REASONS.EDIT });
      continue;
    }

    unchanged.push({ fieldKey, reason: PROMOTION_REASONS.UNREVIEWED });
  }

  return { sidecar: nextSidecar, promoted, unchanged };
}

/**
 * True when a draft's recorded `contentHash` no longer matches the field's
 * current bytes — i.e. a human edited it out of band. A reader that throws is
 * treated as "cannot tell", which leaves the draft alone rather than promoting
 * on a failed read.
 *
 * @param {{contentHash?: string}} entry the draft entry
 * @param {string} fieldKey
 * @param {(fieldKey: string) => unknown} readContent
 * @param {Record<string,'markdown'|'json'>} contentKinds
 * @returns {boolean}
 */
function edited(entry, fieldKey, readContent, contentKinds) {
  let current;
  try {
    current = readContent(fieldKey);
  } catch {
    return false;
  }
  // "Cannot tell" must never promote. A read that produced NOTHING — undefined,
  // null, a non-string, or a string that normalizes to empty — is a failed read,
  // not evidence of a human edit. This matters concretely, not theoretically:
  // `REASONED_FIELD_SECTIONS` is `null` for `acceptance.criterion` and
  // `acceptance.evidence` (they are table cells, not sections), so the natural
  // `markdownSectionBody`-based reader returns `''` for those two fields. Reading
  // `''` as a hash mismatch would hand model-written content permanent `authored`
  // authority with no human anywhere in the loop — the exact inversion of rail (b).
  const kind = contentKinds[fieldKey] ?? 'markdown';
  if (kind === 'markdown') {
    if (typeof current !== 'string' || current.replace(/\r\n/g, '\n').trim().length === 0) return false;
  } else if (current === undefined || current === null) {
    return false;
  }
  return hashFieldContent(current, kind) !== entry.contentHash;
}
