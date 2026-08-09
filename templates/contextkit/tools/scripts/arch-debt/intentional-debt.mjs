/**
 * Architecture-debt gate — governed INTENTIONAL-DEBT validators (WF-0057,
 * ADR-0122; W0-contracts.md §1.2/§6.1, PROMPT-SPEC §21/§22, decisions fork #3/#5).
 *
 * Governed acceptance of debt is the ONLY thing that turns a CONFIRMED debt into a
 * passing `DEBT_ACCEPTED` GateOutcome (§6.1). It is NOT a silent pass: an
 * `ACCEPT_TEMPORARILY` recommendation routes here, and acceptance requires a fully
 * governed record (business justification, expected value, owner, acceptance
 * authority, containment, known risk, repayment trigger, expiry, impact, and the
 * related Business/Operation). Anything less is an explicit refusal.
 *
 * Constitution §8 — validators THROW, never warn; a missing field never silently
 * downgrades to a pass. §16 — HUMAN_REVIEWED is authoritative for ACCEPTANCE but
 * cannot manufacture a fact: an EXPIRED record reopens for REVIEW, it does not
 * auto-accept.
 *
 * PURE: no clock here — `now` is injected (testability, §H3). Zero runtime deps,
 * ESM, `node:`/relative imports only (immutable rule #1).
 */

import { GateOutcome, FindingStatus } from './finding-enums.mjs';

/**
 * Required governance fields for a governed intentional-debt record (§21).
 * Missing ANY of these is an explicit refusal — the record is not governed.
 * `relatedWorkflow` / `relatedDecision` are conditional (see {@link CONDITIONAL_FIELDS}).
 * @type {readonly string[]}
 */
export const REQUIRED_FIELDS = Object.freeze([
  'businessJustification',
  'expectedValue',
  'owner',
  'acceptanceAuthority',
  'containment',
  'knownRisk',
  'repaymentTrigger',
  'expiry',
  'impact',
  'relatedBusiness',
  'relatedOperation',
]);

/**
 * Fields required only WHEN APPLICABLE (§21). If the record declares the
 * triggering flag, the paired field becomes mandatory.
 * @type {readonly {flag:string, field:string}[]}
 */
export const CONDITIONAL_FIELDS = Object.freeze([
  { flag: 'requiresWorkflow', field: 'relatedWorkflow' },
  { flag: 'requiresDecision', field: 'relatedDecision' },
]);

/**
 * Bare deferral phrases that are NEVER a governed acceptance on their own (§21).
 * A record whose justification is only one of these — with no owner, repayment
 * trigger, acceptance authority, or containment — is an ungoverned TODO, refused.
 * @type {readonly string[]}
 */
const BARE_DEFERRAL_PATTERNS = Object.freeze([
  'fix later', 'fix it later', 'temporary', 'temp ', 'todo', 'to-do',
  "we'll revisit", 'we will revisit', 'revisit later', 'for now', 'hack',
  'quick fix', 'tech debt', 'clean up later', 'cleanup later',
]);

/** Typed error for a refused intentional-debt record (§8 — validators throw). */
export class IntentionalDebtError extends TypeError {
  /** @param {string} message  descriptive, corrective reason for the refusal. */
  constructor(message) {
    super(message);
    this.name = 'IntentionalDebtError';
  }
}

/** True iff a value is a present, non-empty, trimmed string. */
const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * True iff `text` is ONLY a bare deferral phrase (no governance signal). Used to
 * catch "TODO / fix later / temporary" justifications that lack real governance.
 * @param {string} text  the field text to inspect.
 * @returns {boolean}
 */
const looksLikeBareDeferral = (text) => {
  if (!isNonEmptyString(text)) return false;
  const normalized = text.trim().toLowerCase();
  return BARE_DEFERRAL_PATTERNS.some((phrase) => normalized.includes(phrase));
};

/**
 * The four governance anchors that distinguish a governed acceptance from a bare
 * "fix later" TODO (§21). All four must be present for a deferral phrase to be
 * a legitimate, accepted debt rather than an ungoverned marker.
 * @param {Object} record  the intentional-debt record.
 * @returns {boolean} true iff every governance anchor is present.
 */
const hasGovernanceAnchors = (record) =>
  isNonEmptyString(record.owner)
  && isNonEmptyString(record.repaymentTrigger)
  && isNonEmptyString(record.acceptanceAuthority)
  && isNonEmptyString(record.containment);

/**
 * Validate a governed intentional-debt record (§21). THROWS — never warns — on
 * any contract violation (constitution §8), so a refused record can never silently
 * flow into a `DEBT_ACCEPTED` outcome. A bare "fix later / TODO / temporary"
 * without the four governance anchors is rejected as ungoverned.
 *
 * @param {Object} record  the intentional-debt record to validate.
 * @returns {true} when the record is fully governed.
 * @throws {IntentionalDebtError} naming the first missing/invalid field.
 */
export function validateIntentionalDebt(record) {
  if (!record || typeof record !== 'object') {
    throw new IntentionalDebtError(
      'validateIntentionalDebt: expected a governed intentional-debt record object',
    );
  }
  const missing = REQUIRED_FIELDS.filter((field) => !isNonEmptyString(record[field]));
  if (missing.length > 0) {
    throw new IntentionalDebtError(
      `Intentional-debt record is ungoverned — missing required field(s): ${missing.join(', ')}`
      + ' (§21: governed acceptance needs all of business justification, expected value,'
      + ' owner, acceptance authority, containment, known risk, repayment trigger, expiry,'
      + ' impact, related Business + Operation).',
    );
  }
  for (const { flag, field } of CONDITIONAL_FIELDS) {
    if (record[flag] && !isNonEmptyString(record[field])) {
      throw new IntentionalDebtError(
        `Intentional-debt record declares "${flag}" but is missing "${field}" (§21 conditional field).`,
      );
    }
  }
  // §21: a bare deferral marker is only governed if it also carries the anchors.
  if (looksLikeBareDeferral(record.businessJustification) && !hasGovernanceAnchors(record)) {
    throw new IntentionalDebtError(
      'Intentional-debt justification reads as a bare deferral ("fix later / temporary / TODO /'
      + " we'll revisit\") without an owner, repayment trigger, acceptance authority, and"
      + ' containment. A TODO is not governed acceptance (§21) — refused.',
    );
  }
  return true;
}

/**
 * Decide whether a governed record has passed its expiry (§22). PURE — `now` is
 * injected, no clock here. Supports a date expiry (`expiry` parseable as a date)
 * or a condition expiry (`expiryCondition` reported as met by the caller).
 *
 * @param {Object} record  a (validated) intentional-debt record.
 * @param {Date|number|string} now  the injected current instant.
 * @returns {{expired:boolean, signal:string, reason:string}}
 *   `signal` is a FindingStatus-style outcome: never an auto-accept. An expired
 *   record yields `expired:true` → the caller REOPENS/REVIEWS it, never accepts.
 */
export function isExpired(record, now) {
  if (!record || typeof record !== 'object') {
    return { expired: true, signal: FindingStatus.UNKNOWN, reason: 'no record to evaluate' };
  }
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(nowMs)) {
    // Cannot establish "now" → fail closed; never silently treat as not-expired.
    return { expired: true, signal: FindingStatus.UNKNOWN, reason: 'injected "now" is not a valid instant' };
  }
  // Condition-based expiry: the caller reports the repayment condition has fired.
  if (record.expiryConditionMet === true) {
    return { expired: true, signal: 'REOPENED', reason: 'expiry condition has been met' };
  }
  const expiryMs = new Date(record.expiry).getTime();
  if (Number.isNaN(expiryMs)) {
    // A non-date expiry that is a pure condition (no date) and not yet met → live.
    if (record.expiryConditionMet === false) {
      return { expired: false, signal: 'LIVE', reason: 'condition-based expiry not yet met' };
    }
    // Unparseable expiry with no condition signal → fail closed (§16, never PASS).
    return { expired: true, signal: FindingStatus.UNKNOWN, reason: `expiry "${record.expiry}" is neither a date nor a met condition` };
  }
  return nowMs >= expiryMs
    ? { expired: true, signal: 'REOPENED', reason: `expired on ${record.expiry}` }
    : { expired: false, signal: 'LIVE', reason: `valid until ${record.expiry}` };
}

/**
 * Governed acceptance of a debt finding (§21/§6.1). Stamps the finding
 * `DEBT_ACCEPTED` with the governance metadata attached — but ONLY when the record
 * validates AND has not expired. Otherwise the finding is routed to
 * `REVIEW_REQUIRED` (an expired/invalid record is never a silent pass, §16).
 *
 * Acceptance authority is HUMAN_REVIEWED-class (§16): authoritative for the
 * acceptance decision, but it cannot manufacture a fact the deterministic tier
 * lacks — an expired record reopens for review, it does not auto-accept.
 *
 * @param {Object} finding  the CONFIRMED debt finding being considered.
 * @param {Object} record   the governed intentional-debt record (§21).
 * @param {Date|number|string} now  injected current instant (no clock here).
 * @returns {Object} a new finding object: either accepted (outcome DEBT_ACCEPTED,
 *   `acceptedDebt` metadata attached) or routed to REVIEW_REQUIRED with a reason.
 * @throws {IntentionalDebtError} when the record fails {@link validateIntentionalDebt}.
 */
export function acceptDebt(finding, record, now) {
  if (!finding || typeof finding !== 'object') {
    throw new IntentionalDebtError('acceptDebt: a finding object is required');
  }
  // Validation throws on a refused record — acceptance never proceeds ungoverned.
  validateIntentionalDebt(record);

  const expiry = isExpired(record, now);
  if (expiry.expired) {
    return {
      ...finding,
      outcome: GateOutcome.REVIEW_REQUIRED,
      acceptedDebt: null,
      reviewReason: `intentional-debt acceptance ${expiry.signal}: ${expiry.reason} — reopened for review (§22)`,
    };
  }

  return {
    ...finding,
    outcome: GateOutcome.DEBT_ACCEPTED,
    acceptedDebt: {
      owner: record.owner,
      acceptanceAuthority: record.acceptanceAuthority,
      businessJustification: record.businessJustification,
      expectedValue: record.expectedValue,
      containment: record.containment,
      knownRisk: record.knownRisk,
      repaymentTrigger: record.repaymentTrigger,
      expiry: record.expiry,
      impact: record.impact,
      relatedBusiness: record.relatedBusiness,
      relatedOperation: record.relatedOperation,
      relatedWorkflow: record.relatedWorkflow ?? null,
      relatedDecision: record.relatedDecision ?? null,
    },
  };
}
