/**
 * agent-orchestration-guard.mjs — Per-tier over-orchestration guard (WF0038 A8-T1, ADR-0112).
 *
 * Applies hard numeric caps to the count of sub-agents produced by
 * selectAgents() before a dispatch plan is executed. The guard is the final
 * gate in the planning wave: it trims surplus roles in a fixed priority order
 * (scouts → supporting → reviewers → council) while honouring the deliberation
 * council minimum when `classification.needsDebate` is true.
 *
 * Pure + deterministic: same inputs always produce byte-identical output.
 * No I/O, no Date.now(), no Math.random(). Zero runtime dependencies.
 * Never mutates the input selection; returns a frozen result object.
 *
 * Consumers: request-orchestrator.mjs (wave W3, after selectAgents()).
 *
 * @module agent-orchestration-guard
 */

/** Default per-tier sub-agent caps (§A8, ADR-0112). */
const DEFAULT_TIER_CAPS = Object.freeze({ trivial: 0, feature: 3, architectural: 5 });

/**
 * Resolves the effective per-tier caps, merging config overrides over defaults.
 * Only numeric overrides are accepted; non-numeric values fall back to the default.
 *
 * @param {object|undefined} configGuard config.orchestration.overOrchestrationGuard
 * @returns {{ trivial: number, feature: number, architectural: number }}
 */
function resolveTierCaps(configGuard) {
  const override = configGuard?.tierCaps;
  if (!override || typeof override !== 'object') return DEFAULT_TIER_CAPS;
  return {
    trivial: Number.isFinite(Number(override.trivial)) ? Number(override.trivial) : DEFAULT_TIER_CAPS.trivial,
    feature: Number.isFinite(Number(override.feature)) ? Number(override.feature) : DEFAULT_TIER_CAPS.feature,
    architectural: Number.isFinite(Number(override.architectural)) ? Number(override.architectural) : DEFAULT_TIER_CAPS.architectural,
  };
}

/**
 * Reads the deliberation council minimum from config.
 * Defaults to 3 to match the deliberation-council contract in request-agent-select.mjs.
 *
 * @param {object|undefined} config project config
 * @returns {number}
 */
function resolveDebateMin(config) {
  const raw = config?.deliberations?.council?.min;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;
}

/**
 * Counts the total number of planned sub-agents across all non-lead roles.
 * The lead (direct executor) is excluded from the sub-agent count per the spec.
 *
 * @param {{ supporting: string[], scouts: string[], reviewers: string[], council: string[] }} sel
 * @returns {number}
 */
function countSubAgents(sel) {
  return sel.supporting.length + sel.scouts.length + sel.reviewers.length + sel.council.length;
}

/**
 * Trims arrays in priority order until the total sub-agent count is ≤ budget,
 * respecting the debate floor for council. Returns the trimmed arrays and a
 * per-role trim count record.
 *
 * Priority: scouts first, then supporting, then reviewers, then council.
 * Council is never trimmed below debateMin when needsDebate is true.
 *
 * @param {{ supporting: string[], scouts: string[], reviewers: string[], council: string[] }} sel
 * @param {number} budget max sub-agents allowed
 * @param {boolean} needsDebate whether a council minimum must be preserved
 * @param {number} debateMin minimum council size when needsDebate
 * @returns {{ supporting: string[], scouts: string[], reviewers: string[], council: string[],
 *             trimmed: { scouts: number, supporting: number, reviewers: number, council: number },
 *             debateFloorApplied: boolean }}
 */
function trimTobudget(sel, budget, needsDebate, debateMin) {
  // Work on mutable copies; originals are never touched.
  let scouts = sel.scouts.slice();
  let supporting = sel.supporting.slice();
  let reviewers = sel.reviewers.slice();
  let council = sel.council.slice();

  const trimmed = { scouts: 0, supporting: 0, reviewers: 0, council: 0 };
  let debateFloorApplied = false;

  // Helper: remove from tail until count is ≤ remaining budget, tracking trims.
  const trim = (arr, key, limit) => {
    while (arr.length > limit && countCurrent() > budget) {
      arr.pop();
      trimmed[key] += 1;
    }
  };

  function countCurrent() {
    return scouts.length + supporting.length + reviewers.length + council.length;
  }

  if (countCurrent() <= budget) {
    return { supporting, scouts, reviewers, council, trimmed, debateFloorApplied };
  }

  // 1. Drop scouts first (zero standing).
  trim(scouts, 'scouts', 0);

  // 2. Drop supporting.
  trim(supporting, 'supporting', 0);

  // 3. Drop extra reviewers.
  trim(reviewers, 'reviewers', 0);

  // 4. Drop council — but never below the debate minimum when needsDebate.
  const councilFloor = needsDebate ? debateMin : 0;
  const councilAllowed = Math.max(budget - scouts.length - supporting.length - reviewers.length, 0);
  const effectiveCouncilFloor = Math.max(councilFloor, Math.min(councilAllowed, council.length));

  if (needsDebate && council.length > 0) {
    const councilLimit = Math.max(effectiveCouncilFloor, councilAllowed);
    const before = council.length;
    council = council.slice(0, Math.max(councilLimit, councilFloor));
    trimmed.council += before - council.length;
    // If we still exceed budget due to the debate floor, flag it.
    if (countCurrent() > budget && council.length >= debateMin) {
      debateFloorApplied = true;
    }
  } else {
    trim(council, 'council', 0);
  }

  return { supporting, scouts, reviewers, council, trimmed, debateFloorApplied };
}

/**
 * Applies the over-orchestration guard to a specialist selection produced by
 * selectAgents(). Enforces hard per-tier sub-agent caps, trims in priority
 * order (scouts → supporting → reviewers → council), and honours the
 * deliberation council minimum when `classification.needsDebate` is true.
 *
 * When the debate minimum exceeds the tier cap, the debate floor wins and a
 * `guard-yields-to-debate-minimum` reason code is appended for audit.
 *
 * @param {{ lead: string|null, supporting: string[], scouts: string[],
 *   reviewers: string[], council: string[], synthesizer: string|null,
 *   reasonCodes: string[] }} selection result of selectAgents()
 * @param {{ complexity: string, needsDebate: boolean }} classification
 * @param {object} [config] project config
 * @param {{ dry?: boolean }} [opts] reserved for future use
 * @returns {Readonly<{ lead: string|null, supporting: string[], scouts: string[],
 *   reviewers: string[], council: string[], synthesizer: string|null,
 *   reasonCodes: string[],
 *   guard: { tier: string, cap: number, plannedBefore: number, plannedAfter: number,
 *            trimmed: { scouts: number, supporting: number, reviewers: number, council: number } }
 * }>}
 */
export function applyOverOrchestrationGuard(selection, classification, config = {}, opts = {}) {
  // --- Defensive normalisation (fail-open: malformed input → pass-through) ---
  const sel = selection && typeof selection === 'object' ? selection : {};
  const cls = classification && typeof classification === 'object' ? classification : {};
  const safeSelection = {
    lead: sel.lead ?? null,
    supporting: Array.isArray(sel.supporting) ? sel.supporting.slice() : [],
    scouts: Array.isArray(sel.scouts) ? sel.scouts.slice() : [],
    reviewers: Array.isArray(sel.reviewers) ? sel.reviewers.slice() : [],
    council: Array.isArray(sel.council) ? sel.council.slice() : [],
    synthesizer: sel.synthesizer ?? null,
    reasonCodes: Array.isArray(sel.reasonCodes) ? sel.reasonCodes.slice() : [],
  };

  const tier = ['trivial', 'feature', 'architectural'].includes(cls.complexity)
    ? cls.complexity
    : 'feature'; // conservative fallback

  const tierCaps = resolveTierCaps(config?.orchestration?.overOrchestrationGuard);
  const cap = tierCaps[tier];
  const needsDebate = Boolean(cls.needsDebate);
  const debateMin = resolveDebateMin(config);
  const plannedBefore = countSubAgents(safeSelection);

  const newReasonCodes = safeSelection.reasonCodes.slice();

  if (plannedBefore <= cap) {
    // No trimming needed — pass through as frozen.
    return Object.freeze({
      lead: safeSelection.lead,
      supporting: safeSelection.supporting,
      scouts: safeSelection.scouts,
      reviewers: safeSelection.reviewers,
      council: safeSelection.council,
      synthesizer: safeSelection.synthesizer,
      reasonCodes: newReasonCodes,
      guard: Object.freeze({
        tier,
        cap,
        plannedBefore,
        plannedAfter: plannedBefore,
        trimmed: Object.freeze({ scouts: 0, supporting: 0, reviewers: 0, council: 0 }),
      }),
    });
  }

  // Trim to cap, preserving debate floor.
  const { supporting, scouts, reviewers, council, trimmed, debateFloorApplied } =
    trimTobudget(safeSelection, cap, needsDebate, debateMin);

  const plannedAfter = scouts.length + supporting.length + reviewers.length + council.length;

  // Emit reason codes for every non-zero trim.
  if (trimmed.scouts > 0) newReasonCodes.push(`guard-trimmed-scouts:${trimmed.scouts} (tier=${tier} cap=${cap})`);
  if (trimmed.supporting > 0) newReasonCodes.push(`guard-trimmed-supporting:${trimmed.supporting} (tier=${tier} cap=${cap})`);
  if (trimmed.reviewers > 0) newReasonCodes.push(`guard-trimmed-reviewers:${trimmed.reviewers} (tier=${tier} cap=${cap})`);
  if (trimmed.council > 0) newReasonCodes.push(`guard-trimmed-council:${trimmed.council} (tier=${tier} cap=${cap})`);
  if (debateFloorApplied) newReasonCodes.push(`guard-yields-to-debate-minimum:${debateMin} (debate floor > cap=${cap})`);

  return Object.freeze({
    lead: safeSelection.lead,
    supporting,
    scouts,
    reviewers,
    council,
    synthesizer: safeSelection.synthesizer,
    reasonCodes: newReasonCodes,
    guard: Object.freeze({
      tier,
      cap,
      plannedBefore,
      plannedAfter,
      trimmed: Object.freeze({ ...trimmed }),
    }),
  });
}
