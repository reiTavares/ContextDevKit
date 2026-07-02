/**
 * rule-classes.mjs — accessor over the rule-classes policy table (ADR-0129 §1).
 *
 * Every rule the classifier feeds is tagged Class A (deterministic invariant,
 * MAY reach `strict` only by policy pre-authorization) or Class B (predictive,
 * automatic ceiling `guarded`, NEVER auto-`strict`). This module is the single
 * read surface so no consumer hardcodes a class. WF-0063 ships every rule in
 * `shadow` with zero blocking power.
 *
 * Pure: the table is INJECTED. Zero runtime dependencies.
 *
 * @module domain-engineering/rule-classes
 */

/** The automatic authority ceiling Class B rules may never exceed (§1). */
export const CLASS_B_CEILING = 'guarded';

/**
 * Returns the class record for a rule id, or null when unknown.
 *
 * @param {string} ruleId
 * @param {object} table the rule-classes policy table.
 * @returns {object|null}
 */
export function getRule(ruleId, table) {
  if (!table || !ruleId) return null;
  return (table.rules && table.rules[ruleId]) || (table.invariantRules && table.invariantRules[ruleId]) || null;
}

/**
 * True iff the rule is Class A (deterministic invariant).
 * @param {string} ruleId
 * @param {object} table
 * @returns {boolean}
 */
export function isClassA(ruleId, table) {
  const rule = getRule(ruleId, table);
  return Boolean(rule && rule.class === 'A');
}

/**
 * Resolves the maximum automatic authority level a rule may reach. Class B is
 * always capped at `guarded` regardless of any table value (defensive: the
 * ceiling is a hard invariant, not a tunable for predictive rules).
 *
 * @param {string} ruleId
 * @param {object} table
 * @returns {string} 'shadow' | 'advisory' | 'guarded' | 'strict'
 */
export function maximumAutomaticLevel(ruleId, table) {
  const rule = getRule(ruleId, table);
  if (!rule) return 'shadow';
  if (rule.class === 'B') return CLASS_B_CEILING;
  // Class A: may declare strict, but only when pre-authorized (else cap guarded).
  if (rule.maximumAutomaticLevel === 'strict' && rule.strictPreAuthorized !== true) return 'guarded';
  return rule.maximumAutomaticLevel || 'guarded';
}

/**
 * Validates that the table honors the ADR-0129 invariants: every Class B rule
 * is capped at `guarded` and never `strict`-pre-authorized. Returns the list of
 * violations (empty ⇒ valid). Used by the self-check.
 *
 * @param {object} table the rule-classes policy table.
 * @returns {string[]} violation messages.
 */
export function validateRuleClasses(table) {
  const violations = [];
  if (!table || !table.rules) return ['rule-classes table missing `rules`'];
  for (const [id, rule] of Object.entries(table.rules)) {
    if (rule.class !== 'A' && rule.class !== 'B') violations.push(`${id}: class must be A or B`);
    if (rule.class === 'B' && rule.maximumAutomaticLevel === 'strict') {
      violations.push(`${id}: Class B may never declare maximumAutomaticLevel=strict`);
    }
    if (rule.class === 'B' && rule.strictPreAuthorized === true) {
      violations.push(`${id}: Class B may never be strictPreAuthorized`);
    }
  }
  return violations;
}

/**
 * Lists rule ids by class. Confusion matrices apply to predictive (B) rules only
 * (ADR-0129 §2) — consumers use this to scope calibration.
 *
 * @param {object} table
 * @param {string} klass 'A' | 'B'
 * @returns {string[]}
 */
export function listRulesByClass(table, klass) {
  if (!table || !table.rules) return [];
  return Object.entries(table.rules).filter(([, rule]) => rule.class === klass).map(([id]) => id);
}
