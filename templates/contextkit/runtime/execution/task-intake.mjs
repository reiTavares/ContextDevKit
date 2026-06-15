/**
 * task-intake.mjs — Task request → deterministic signals (CDK-021, ADR-0072).
 *
 * Turns a raw task request into a typed, canonical `signals` object by running the
 * request's objective through the deterministic complexity rubric classifier.
 * No LLM, no Math.random — same input always produces the same output.
 *
 * Consumers: execution-contract.mjs, slash commands, the pre-write governance gate.
 * NOT consumed by hooks directly — hooks call load.mjs; this module stays out of
 * that chain to avoid circular imports (ADR-0001 / immutable rule 1).
 *
 * Zero runtime dependencies — only `node:*` and the canonical platform helpers.
 */
import { classify, loadRubric } from '../../tools/scripts/complexity-rubric.mjs';

/**
 * Converts a task request into canonical, deterministic signals plus a human-
 * readable `reasons` array recording WHY each classification decision was made
 * (ADR-0072 §2: signals and reasons must be recorded, not just the verdict).
 *
 * The function is pure given its arguments: `env.root` drives rubric loading
 * (which itself falls back to the embedded DEFAULT_RUBRIC), but the rubric is
 * deterministic for any given root, so the output is reproducible.
 *
 * @param {{ objective: string, taskId?: string, sessionId?: string,
 *           branch?: string, paths?: string[], level?: number,
 *           phase?: string, host?: string }} request task request object
 * @param {{ root?: string, level?: number }} [env] runtime environment hints
 * @returns {{ signals: object, reasons: string[] }}
 *
 * @example
 * const { signals, reasons } = intake({ objective: 'fix typo in README' });
 * // signals.tier === 'trivial'
 */
export function intake(request, env = {}) {
  if (!request || typeof request !== 'object') {
    throw new TypeError('intake: request must be a non-null object');
  }

  const objective = String(request.objective ?? '').trim();
  const rubric = loadRubric(env.root);
  const classification = classify(objective, rubric);

  const tier = classification.tier;
  const domain = classification.domain;
  const needsAdr = classification.needsAdr;
  const level = request.level ?? env.level ?? 7;

  // Build the reasons array — records the rationale for each key decision.
  const reasons = buildReasons(classification, tier, domain);

  const signals = {
    taskId: request.taskId ?? null,
    sessionId: request.sessionId ?? null,
    branch: request.branch ?? null,
    host: request.host ?? null,
    tier,
    domain,
    needsAdr,
    paths: Array.isArray(request.paths) ? request.paths : [],
    phase: request.phase ?? '*',
    level,
  };

  return { signals, reasons };
}

/**
 * Builds the human-readable reasons array from the classification result.
 * Each entry is a short string identifying WHY the classifier produced a value.
 *
 * @param {object} classification result from classify()
 * @param {string} tier resolved tier
 * @param {string} domain resolved domain
 * @returns {string[]}
 */
function buildReasons(classification, tier, domain) {
  const reasons = [];

  // Tier reason — identify which rubric signal triggered the tier.
  const rubricSignalHint = inferTierSignalHint(classification);
  if (classification.forcedByDomain) {
    reasons.push(
      `tier=${tier} (forced by regulated domain '${domain}' — complexity=high overrides rubric signal)`,
    );
  } else {
    reasons.push(`tier=${tier}${rubricSignalHint ? ` (rubric signal: '${rubricSignalHint}')` : ' (default tier)'}`);
  }

  // Domain reason.
  if (domain !== 'general') {
    reasons.push(`domain=${domain} (regulated domain detected; requiredAgents=[${classification.requiredAgents.join(', ')}])`);
  } else {
    reasons.push('domain=general (no regulated domain signals matched)');
  }

  // ADR reason.
  if (classification.needsAdr) {
    reasons.push('needsAdr=true (tier=architectural requires an ADR before implementation)');
  }

  return reasons;
}

/**
 * Attempts to surface the single rubric signal that drove the tier classification.
 * Because classify() does not expose which specific signal matched, we infer it
 * from the input text so the reason stays informative without re-implementing the
 * rubric match loop.
 *
 * Returns the first matched signal string, or '' when the tier was the default.
 *
 * @param {object} classification classify() result
 * @returns {string}
 */
function inferTierSignalHint(classification) {
  // The input text that was classified is available as classification.input.
  const text = String(classification.input ?? '').toLowerCase();
  if (!text) return '';
  // Map tier → common trigger words that exist in the rubric's embedded fallback.
  const tierHints = {
    architectural: ['refactor', 'migrate', 'migration', 'auth', 'schema', 'breaking', 'rewrite', 'encrypt', 'deprecat', 'add dependency', 'new dependency'],
    feature: ['add', 'feature', 'endpoint', 'component', 'screen', 'page', 'command', 'field', 'report', 'export'],
    trivial: ['typo', 'rename', 'comment', 'bump', 'lint', 'format', 'whitespace', 'docstring', 'fix link'],
  };
  const candidates = tierHints[classification.tier] ?? [];
  return candidates.find((hint) => text.includes(hint)) ?? '';
}
