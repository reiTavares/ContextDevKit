/**
 * Eligibility predicate + the single-sourced sentinel table for the eight
 * REASONED fields (WF-0090 GA1, BIZ-0006, ADR-0148 §10 + rail (b)).
 *
 * This module answers exactly one question: *may the content engine write into
 * this field at all?* It is the narrowest of the four rails and the one that
 * protects human bytes, so it is deliberately separate from retrieval (rail a)
 * and from orchestration: a field is eligible only when the bytes it currently
 * holds were written by the scaffold, never by a person.
 *
 * Two conditions, both required:
 *   1. the current content is the literal `{{TOKEN}}` **or** the scaffold
 *      sentinel for that field — the only bytes no human authored;
 *   2. the sidecar holds no entry for the field, or holds a `draft`. An
 *      `authored` entry (explicit or defaulted, constitution §8) and a `derived`
 *      entry (WF-0089's authority) both refuse.
 *
 * The sentinel table lives HERE and `work-business-create.mjs#ceremonyTokens`
 * spreads it, rather than the reverse: the predicate and the scaffold text must
 * never drift, and the file that *refuses* on a sentinel is the honest owner of
 * what a sentinel is.
 *
 * `REASONED_FIELD_KEYS` is a frozen, closed list the engine ITERATES — not a
 * filter applied to whatever the skeleton happens to contain. Anything absent
 * from it is refused by construction, which is what bounds GA0 risk R7 (scope
 * creep into structural fields) mechanically instead of by review.
 *
 * Pure and I/O-free: no disk, no clock, no graph. Zero runtime dependencies.
 */

/**
 * The closed set of fields the content engine may fill — ADR-0148 §10's REASONED
 * half: problem statement, acceptance-criteria semantics, trade-off narratives.
 * Provably disjoint from `DERIVED_FIELD_KEYS` (asserted in the selftest).
 */
export const REASONED_FIELD_KEYS = Object.freeze([
  'prd.problem',
  'prd.goals',
  'prd.nonGoals',
  'spec.summary',
  'spec.tradeoffs',
  'spec.testPlan',
  'acceptance.criterion',
  'acceptance.evidence',
]);

/**
 * Field key → the skeleton token name it fills. The `{{NAME}}` placeholder form
 * is derived from this, so a token rename cannot desynchronize the two.
 */
export const REASONED_FIELD_TOKENS = Object.freeze({
  'prd.problem': 'PROBLEM',
  'prd.goals': 'GOALS',
  'prd.nonGoals': 'NON_GOALS',
  'spec.summary': 'SUMMARY',
  'spec.tradeoffs': 'TRADEOFFS',
  'spec.testPlan': 'TEST_PLAN',
  'acceptance.criterion': 'CRITERION',
  'acceptance.evidence': 'EVIDENCE',
});

/**
 * Field key → the markdown heading keyword whose section body holds it. Used with
 * `provenance.mjs#markdownSectionBody` by the caller that extracts current
 * content. `acceptance.*` are CELL-granular (a table column, not a section), so
 * they carry no heading — GA0 §2/risk R-E: introducing an `acceptance.table`
 * block key would re-trigger WF-0089's `{{STATUS}}` content-hash collision.
 */
export const REASONED_FIELD_SECTIONS = Object.freeze({
  'prd.problem': 'Problem',
  'prd.goals': 'Goals',
  'prd.nonGoals': 'Non-goals',
  'spec.summary': 'Executive summary',
  'spec.tradeoffs': 'Trade-offs',
  'spec.testPlan': 'Test plan',
  'acceptance.criterion': null,
  'acceptance.evidence': null,
});

/**
 * The scaffold sentinel text for every reasoned token — the single source of
 * truth `ceremonyTokens` spreads. Parameterized by title because several
 * sentinels name the work being scaffolded.
 *
 * @param {{title: string}} inputs the resolved work-context title
 * @returns {Record<string,string>} token name → sentinel text
 */
export function reasonedSentinels({ title }) {
  return {
    PROBLEM: `The owner must define the problem for "${title}".`,
    GOALS: '- Define the desired business outcome.\n- Record evidence for the owner decision.',
    NON_GOALS: '- No implementation is authorized by this scaffold.',
    SUMMARY: `This workflow provides the governed scaffold for "${title}".`,
    TRADEOFFS: 'The owner must record the trade-offs this workflow accepts.',
    TEST_PLAN: '- Validate the Business schema.\n- Validate the ceremony structure.\n- Record QA evidence before promotion.',
    CRITERION: 'Owner-approved ceremony acceptance',
    EVIDENCE: 'To be recorded by the workflow owner',
  };
}

/** Normalizes markdown-ish content for comparison (CRLF + trailing whitespace churn). */
function normalize(content) {
  return String(content ?? '').replace(/\r\n/g, '\n').trim();
}

/**
 * True when the field still holds scaffold-written bytes: either the unresolved
 * `{{TOKEN}}` placeholder, or the sentinel the scaffold rendered in its place.
 * Empty content counts as a placeholder — an empty section is unwritten, not
 * authored.
 *
 * @param {string} fieldKey one of `REASONED_FIELD_KEYS`
 * @param {string} current the field's current content
 * @param {Record<string,string>} [sentinels] a `reasonedSentinels()` result
 * @returns {boolean}
 */
export function isPlaceholderOrSentinel(fieldKey, current, sentinels = {}) {
  const tokenName = REASONED_FIELD_TOKENS[fieldKey];
  if (!tokenName) return false;
  const text = normalize(current);
  if (text.length === 0) return true;
  if (text === `{{${tokenName}}}`) return true;
  const sentinel = sentinels[tokenName];
  return typeof sentinel === 'string' && text === normalize(sentinel);
}

/**
 * The rail (b) eligibility verdict for ONE field. Refuses by default: an
 * unrecognized key, human prose, or a non-draft sidecar claim all decline.
 *
 * @param {object} args
 * @param {string} args.fieldKey candidate field key
 * @param {string} args.current the field's current content
 * @param {{state:string}} args.entry the sidecar entry (use
 *   `provenance.mjs#getFieldEntry`, which defaults an absent key to `authored`)
 * @param {boolean} args.claimed whether the sidecar actually holds the key
 *   (`fieldAuthority().claimed`) — an UNCLAIMED default is fillable, an explicit
 *   `authored` claim is not
 * @param {Record<string,string>} [args.sentinels] a `reasonedSentinels()` result
 * @returns {{eligible: boolean, reason: string}}
 */
export function evaluateEligibility({ fieldKey, current, entry, claimed, sentinels = {} }) {
  if (!REASONED_FIELD_KEYS.includes(fieldKey)) {
    return { eligible: false, reason: 'field-not-in-reasoned-set' };
  }
  const state = entry?.state ?? 'authored';
  if (claimed && state !== 'draft') {
    return { eligible: false, reason: `${state}-lock` };
  }
  if (!isPlaceholderOrSentinel(fieldKey, current, sentinels)) {
    return { eligible: false, reason: 'authored-in-fact (content is neither placeholder nor sentinel)' };
  }
  return { eligible: true, reason: claimed ? 'draft-refill' : 'placeholder-unclaimed' };
}
