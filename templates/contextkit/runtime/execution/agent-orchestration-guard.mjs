/**
 * Optional subagent-count recommendation (ADR-0158).
 *
 * The active agent owns whether parallel work is useful. Complexity tiers,
 * councils, roles, and configured semantic caps cannot trim a plan or deny
 * delivery. A host may enforce its own technical concurrency limit externally;
 * this module reports that limit but does not impersonate the host scheduler.
 */

const DEFAULT_RECOMMENDED_CAPS = Object.freeze({ trivial: 0, feature: 3, architectural: 5 });

/**
 * Returns a non-negative numeric value or a fallback.
 *
 * @param {unknown} value candidate numeric value.
 * @param {number} fallback fallback value.
 * @returns {number}
 */
function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Counts planned non-lead agents.
 *
 * @param {object} selection normalized selection.
 * @returns {number}
 */
function countSubAgents(selection) {
  return selection.supporting.length
    + selection.scouts.length
    + selection.reviewers.length
    + selection.council.length;
}

/**
 * Normalizes a selection without mutating the caller's arrays.
 *
 * @param {object} selection raw selection.
 * @returns {object}
 */
function normalizeSelection(selection) {
  const source = selection && typeof selection === 'object' ? selection : {};
  return {
    lead: source.lead ?? null,
    supporting: Array.isArray(source.supporting) ? source.supporting.slice() : [],
    scouts: Array.isArray(source.scouts) ? source.scouts.slice() : [],
    reviewers: Array.isArray(source.reviewers) ? source.reviewers.slice() : [],
    council: Array.isArray(source.council) ? source.council.slice() : [],
    synthesizer: source.synthesizer ?? null,
    reasonCodes: Array.isArray(source.reasonCodes) ? source.reasonCodes.slice() : [],
  };
}

/**
 * Advises on orchestration size while returning the plan unchanged.
 *
 * @param {object} selection specialist selection.
 * @param {object} classification task classification.
 * @param {object} [config] project config.
 * @param {object} [opts] optional caller metadata.
 * @returns {Readonly<object>} unchanged selection plus non-binding audit data.
 */
export function applyOverOrchestrationGuard(selection, classification, config = {}, opts = {}) {
  const normalized = normalizeSelection(selection);
  const complexity = ['trivial', 'feature', 'architectural'].includes(classification?.complexity)
    ? classification.complexity
    : 'feature';
  const configuredCaps = config?.orchestration?.overOrchestrationGuard?.tierCaps;
  const recommendedCap = nonNegativeNumber(
    configuredCaps?.[complexity],
    DEFAULT_RECOMMENDED_CAPS[complexity],
  );
  const technicalHostLimit = Number.isFinite(Number(opts.hostTechnicalLimit))
    ? Math.max(0, Number(opts.hostTechnicalLimit))
    : null;
  const planned = countSubAgents(normalized);
  const excess = Math.max(0, planned - recommendedCap);
  const reasonCodes = normalized.reasonCodes.slice();
  if (excess > 0) reasonCodes.push(`orchestration-size-recommendation:${planned}>${recommendedCap}`);
  if (classification?.needsDebate === true) reasonCodes.push('council-is-optional-owner-guidance');
  if (technicalHostLimit !== null && planned > technicalHostLimit) {
    reasonCodes.push(`host-technical-limit-observed:${planned}>${technicalHostLimit}`);
  }

  return Object.freeze({
    lead: normalized.lead,
    supporting: Object.freeze(normalized.supporting),
    scouts: Object.freeze(normalized.scouts),
    reviewers: Object.freeze(normalized.reviewers),
    council: Object.freeze(normalized.council),
    synthesizer: normalized.synthesizer,
    reasonCodes: Object.freeze(reasonCodes),
    guard: Object.freeze({
      tier: complexity,
      cap: recommendedCap,
      recommendedCap,
      hostTechnicalLimit: technicalHostLimit,
      plannedBefore: planned,
      plannedAfter: planned,
      excess,
      enforced: false,
      blocking: false,
      authority: 'recommendation-only',
      trimmed: Object.freeze({ scouts: 0, supporting: 0, reviewers: 0, council: 0 }),
    }),
  });
}
